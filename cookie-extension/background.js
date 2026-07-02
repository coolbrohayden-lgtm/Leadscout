// Background service worker — makes authenticated fetches to Instagram/TikTok
// from the browser context so the user's session cookies are sent automatically
// SW version: 23 (IG posts fetch)

// Keep the service worker alive during long operations (MV3 gets killed after ~30s idle)
let keepAlivePort = null;
chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'keepalive') return;
  keepAlivePort = port;
  port.onDisconnect.addListener(() => { keepAlivePort = null; });
});
function stayAwake() {
  // Ping ourselves via an alarm to prevent SW termination
  chrome.alarms.create('keepalive', { periodInMinutes: 0.4 });
}
chrome.alarms.onAlarm.addListener(a => { if (a.name === 'keepalive') {} });
stayAwake();

// Context menu — send highlighted text to LeadScout as owner name
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'send_to_leadscout',
    title: 'Move to LeadScout (owner name)',
    contexts: ['selection'],
  });
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId !== 'send_to_leadscout') return;
  const text = (info.selectionText || '').trim();
  if (!text) return;
  chrome.tabs.query({}, tabs => {
    // Prefer the database tab specifically
    const dbTab = tabs.find(t => t.url && t.url.includes('/database'));
    const lsTab = dbTab || tabs.find(t => t.url && (t.url.includes('leadscout-production-f926.up.railway.app') || t.url.startsWith('http://localhost:3000')));
    if (!lsTab) return;
    chrome.tabs.sendMessage(lsTab.id, { type: 'owner_text', name: text });
  });
});

// Track which LeadScout tab requested a SunBiz lookup
let pendingSunbizTabId = null;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // LeadScout page requests: open SunBiz search in a new tab
  if (msg.type === 'open_sunbiz') {
    pendingSunbizTabId = sender.tab ? sender.tab.id : null;
    const url = `https://search.sunbiz.org/Inquiry/CorporationSearch/ByAddress`;
    chrome.storage.session.set({ sunbiz_street: msg.street });
    chrome.tabs.create({ url, active: true });
    sendResponse({ ok: true });
    return true;
  }

  // SunBiz content script reports back the agent name
  if (msg.type === 'sunbiz_result') {
    if (msg.name && sender.tab) chrome.tabs.remove(sender.tab.id).catch(() => {});
    // Find the LeadScout tab to send result back to
    chrome.tabs.query({}, tabs => {
      const dbTab = tabs.find(t => t.url && t.url.includes('/database'));
      const anyLsTab = tabs.find(t => t.url && (t.url.includes('leadscout-production-f926.up.railway.app') || t.url.startsWith('http://localhost:3000')));
      const target = dbTab || anyLsTab;
      console.log('[LeadScout] Sending owner to tab:', target?.url, '| name:', msg.name);
      if (target) {
        chrome.tabs.sendMessage(target.id, { type: 'owner_text', name: msg.name || null }, (resp) => {
          if (chrome.runtime.lastError) {
            // Content script not connected (tab opened before extension reload) — fall back to executeScript
            chrome.scripting.executeScript({
              target: { tabId: target.id },
              func: (n) => { if (window.receiveOwnerText) window.receiveOwnerText(n); else if (window.receiveSunbizOwner) window.receiveSunbizOwner(n); },
              args: [msg.name || null]
            }).catch(e => console.log('[LeadScout] executeScript also failed:', e.message));
          }
        });
      }
      pendingSunbizTabId = null;
    });
    return true;
  }

  if (msg.type === 'sync_cookies') {
    (async () => {
      const igCookie = await chrome.cookies.get({ url: 'https://www.instagram.com', name: 'sessionid' });
      const ttCookie = await chrome.cookies.get({ url: 'https://www.tiktok.com', name: 'sessionid' });
      sendResponse({
        ig_cookie: igCookie ? `sessionid=${igCookie.value}` : null,
        tt_cookie: ttCookie ? `sessionid=${ttCookie.value}` : null,
      });
    })();
    return true;
  }

  if (msg.type === 'set_rapidapi_key') {
    chrome.storage.local.set({ rapidapi_key: msg.key });
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === 'version') {
    sendResponse({ version: 22, endpoint: 'tiktok-search+bio+category+ratelimit+rapidapi-fallback' });
    return true;
  }
  if (msg.type === 'fetchig') {
    fetchInstagram(msg.handle).then(sendResponse).catch(e => sendResponse({ error: e.message }));
    return true;
  }
  if (msg.type === 'fetchig_posts') {
    fetchInstagramPosts(msg.handle).then(sendResponse).catch(e => sendResponse({ error: e.message }));
    return true;
  }
  if (msg.type === 'fetchtt') {
    fetchTikTok(msg.handle).then(sendResponse).catch(e => sendResponse({ error: e.message }));
    return true;
  }
  if (msg.type === 'searchig') {
    searchInstagram(msg.name, msg.city, msg.bizType).then(sendResponse).catch(e => sendResponse({ error: e.message }));
    return true;
  }
  if (msg.type === 'searchtt') {
    searchTikTok(msg.name, msg.city).then(sendResponse).catch(e => sendResponse({ error: e.message }));
    return true;
  }
  if (msg.type === 'scanpage') {
    scanPageForSocials(msg.url).then(sendResponse).catch(e => sendResponse({ error: e.message }));
    return true;
  }

});

// Global IG rate-limit state — shared across all calls in this SW
let _igLastCall = 0;
const IG_MIN_GAP_MS = 5000; // minimum ms between IG API calls

async function fetchInstagram(handle) {
  // Enforce minimum gap between IG calls to avoid 429
  const now = Date.now();
  const wait = IG_MIN_GAP_MS - (now - _igLastCall);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  _igLastCall = Date.now();

  const result = await _doFetchIg(handle);

  // On 429, try RapidAPI fallback before waiting and retrying
  if (result?.error === 'HTTP 429') {
    const rapid = await _doFetchIgRapidApi(handle);
    if (rapid && !rapid.error) return rapid;
    // RapidAPI also failed — wait 20s and retry direct
    await new Promise(r => setTimeout(r, 20000));
    _igLastCall = Date.now();
    return _doFetchIg(handle);
  }
  return result;
}

async function _doFetchIgRapidApi(handle) {
  const { rapidapi_key } = await chrome.storage.local.get('rapidapi_key');
  if (!rapidapi_key) return { error: 'no rapidapi key' };
  try {
    const r = await fetch(
      `https://flashapi1.p.rapidapi.com/ig/info_username?user=${encodeURIComponent(handle)}&nocors=false`,
      { headers: { 'x-rapidapi-key': rapidapi_key, 'x-rapidapi-host': 'flashapi1.p.rapidapi.com' } }
    );
    if (!r.ok) return { error: `FlashAPI HTTP ${r.status}` };
    const json = await r.json();
    if (json.message) return { error: json.message };
    const user = json?.user || json;
    const followers = user?.follower_count ?? null;
    if (followers === null) return { error: 'no follower data', raw: JSON.stringify(json).slice(0, 200) };
    return {
      followers,
      posts: user?.media_count ?? null,
      biography: user?.biography || '',
      category: user?.category_name || user?.category || '',
      source: 'flashapi',
    };
  } catch(e) { return { error: e.message }; }
}

async function _doFetchIg(handle) {
  const url = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(handle)}`;
  try {
    const r = await fetch(url, {
      credentials: 'include',
      headers: {
        'x-ig-app-id': '936619743392459',
        'x-requested-with': 'XMLHttpRequest',
        'Referer': `https://www.instagram.com/${handle}/`,
        'Accept': 'application/json',
      }
    });
    if (!r.ok) return { error: `HTTP ${r.status}` };
    const json = await r.json();
    const user = json?.data?.user;
    if (!user) return { error: 'no user object', raw: JSON.stringify(json).slice(0, 200) };
    return {
      followers: user.edge_followed_by?.count ?? user.follower_count ?? null,
      posts: user.edge_owner_to_timeline_media?.count ?? user.media_count ?? null,
      biography: user.biography || '',
      category: user.category_name || user.category || '',
    };
  } catch(e) { return { error: e.message }; }
}

async function fetchInstagramPosts(handle) {
  const { rapidapi_key } = await chrome.storage.local.get('rapidapi_key');
  if (!rapidapi_key) return { error: 'no rapidapi key' };
  try {
    const r = await fetch(
      `https://flashapi1.p.rapidapi.com/ig/posts_username?user=${encodeURIComponent(handle)}&nocors=false`,
      { headers: { 'x-rapidapi-key': rapidapi_key, 'x-rapidapi-host': 'flashapi1.p.rapidapi.com' } }
    );
    if (!r.ok) return { error: `FlashAPI HTTP ${r.status}` };
    const json = await r.json();
    if (json.message) return { error: json.message };
    const items = json?.items || json?.data?.items || [];
    if (!items.length) return { error: 'no posts', raw: JSON.stringify(json).slice(0,200) };
    const posts = items.slice(0, 8).map(p => ({
      taken_at: p.taken_at,
      like_count: p.like_count ?? null,
      play_count: p.play_count ?? p.view_count ?? null,
      media_type: p.media_type, // 1=photo, 2=video, 8=carousel
    }));
    return { posts };
  } catch(e) { return { error: e.message }; }
}

async function fetchTikTok(handle) {
  // Try the user detail API first
  const urls = [
    `https://www.tiktok.com/api/user/detail/?uniqueId=${encodeURIComponent(handle)}&aid=1988&app_language=en&device_platform=web_pc`,
    `https://www.tiktok.com/@${handle}`,
  ];

  for (const url of urls) {
    try {
      const r = await fetch(url, { credentials: 'include', headers: { 'Referer': 'https://www.tiktok.com/', 'Accept': '*/*' } });
      if (!r.ok) continue;
      const text = await r.text();
      if (!text || text.length < 10) continue;

      // Try JSON parse first (API endpoint)
      try {
        const json = JSON.parse(text);
        const stats = json?.userInfo?.stats;
        if (stats) {
          return {
            followers: stats.followerCount ?? null,
            totalLikes: stats.heartCount ?? stats.diggCount ?? null,
            biography: json?.userInfo?.user?.signature || '',
          };
        }
      } catch (_) {}

      // Fall back to scraping the page HTML for SIGI_STATE JSON blob
      const sigiMatch = text.match(/"followerCount"\s*:\s*(\d+)/);
      const likesMatch = text.match(/"heartCount"\s*:\s*(\d+)/);
      const sigMatch = text.match(/"signature"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      if (sigiMatch) {
        return {
          followers: parseInt(sigiMatch[1]),
          totalLikes: likesMatch ? parseInt(likesMatch[1]) : null,
          biography: sigMatch ? sigMatch[1].replace(/\\n/g,' ').replace(/\\u[\da-f]{4}/gi, c => String.fromCharCode(parseInt(c.slice(2),16))) : '',
        };
      }

      // Try meta description as last resort
      const metaMatch = text.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i);
      if (metaMatch) {
        const txt = metaMatch[1];
        const fol = txt.match(/([\d,.]+[KkMm]?)\s+Followers/i);
        const likes = txt.match(/([\d,.]+[KkMm]?)\s+Likes/i);
        if (fol) {
          return {
            followers: parseSocialNum(fol[1]),
            totalLikes: likes ? parseSocialNum(likes[1]) : null,
            biography: '',
          };
        }
      }
    } catch(e) { /* try next url */ }
  }
  return { error: 'no data found' };
}

// Open a hidden tab, fully render the page, scan the live DOM for social media signals
async function scanPageForSocials(url) {
  let tab;
  try {
    tab = await chrome.tabs.create({ url, active: false });

    // Wait for the page to fully load
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('tab load timeout')), 15000);
      chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
        if (tabId === tab.id && info.status === 'complete') {
          clearTimeout(timeout);
          chrome.tabs.onUpdated.removeListener(listener);
          setTimeout(resolve, 3500); // extra wait for JS frameworks (Angular/React/Vue) to fully render
        }
      });
    });

    // Inject a scanner into the rendered page
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const found = { instagram: null, tiktok: null, facebook: null, signals: [] };

        const IG_SKIP = ['p','explore','reels','stories','accounts','sharer','share','dialog','intent','hashtag'];
        const FB_SKIP = ['sharer','share','dialog','plugins','login','photo','video','events','groups','hashtag','intent'];

        function extractIg(url) {
          if (!url) return null;
          const m = url.match(/instagram\.com\/([A-Za-z0-9._]{2,30})/);
          if (!m) return null;
          const h = m[1].toLowerCase().replace(/\/$/, '');
          return IG_SKIP.includes(h) ? null : h;
        }
        function extractTt(url) {
          if (!url) return null;
          const m = url.match(/tiktok\.com\/@?([A-Za-z0-9._]{2,30})/);
          return m ? m[1].toLowerCase() : null;
        }
        function extractFb(url) {
          if (!url) return null;
          const m = url.match(/facebook\.com\/([A-Za-z0-9._\-]{3,60})/);
          if (!m) return null;
          const pg = m[1].replace(/[/?].*$/, '').toLowerCase();
          if (/^\d+$/.test(pg) || FB_SKIP.some(s => pg.includes(s))) return null;
          return pg;
        }

        // 1. Check all <a href> links
        document.querySelectorAll('a[href]').forEach(a => {
          const href = a.href || '';
          if (!found.instagram) { const h = extractIg(href); if (h) { found.instagram = h; found.signals.push(`link:ig:${h}`); } }
          if (!found.tiktok)    { const h = extractTt(href); if (h) { found.tiktok = h;    found.signals.push(`link:tt:${h}`); } }
          if (!found.facebook)  { const h = extractFb(href); if (h) { found.facebook = h;  found.signals.push(`link:fb:${h}`); } }
        });

        // 2. Check onclick, data-href, data-url, data-link attributes (Yext / Uberall / similar CMS)
        if (!found.instagram || !found.tiktok || !found.facebook) {
          document.querySelectorAll('[onclick],[data-href],[data-url],[data-link],[data-social-url]').forEach(el => {
            const vals = [
              el.getAttribute('onclick') || '',
              el.getAttribute('data-href') || '',
              el.getAttribute('data-url') || '',
              el.getAttribute('data-link') || '',
              el.getAttribute('data-social-url') || '',
            ].join(' ');
            if (!found.instagram) { const h = extractIg(vals); if (h) { found.instagram = h; found.signals.push(`onclick:ig:${h}`); } }
            if (!found.tiktok)    { const h = extractTt(vals); if (h) { found.tiktok = h;    found.signals.push(`onclick:tt:${h}`); } }
            if (!found.facebook)  { const h = extractFb(vals); if (h) { found.facebook = h;  found.signals.push(`onclick:fb:${h}`); } }
          });
        }

        // 3. Scan inline <script> tags for social URLs embedded in JSON/JS config
        if (!found.instagram || !found.tiktok || !found.facebook) {
          document.querySelectorAll('script:not([src])').forEach(s => {
            const txt = s.textContent || '';
            if (!found.instagram) { const h = extractIg(txt); if (h) { found.instagram = h; found.signals.push(`script:ig:${h}`); } }
            if (!found.tiktok)    { const h = extractTt(txt); if (h) { found.tiktok = h;    found.signals.push(`script:tt:${h}`); } }
            if (!found.facebook)  { const h = extractFb(txt); if (h) { found.facebook = h;  found.signals.push(`script:fb:${h}`); } }
          });
        }

        // 4. Scan all images — src, alt, title for social platform names
        document.querySelectorAll('img').forEach(img => {
          const src = (img.src || img.dataset.src || '').toLowerCase();
          const alt = (img.alt || '').toLowerCase();
          const title = (img.title || '').toLowerCase();
          const combined = src + ' ' + alt + ' ' + title;
          if (/instagram/.test(combined)) found.signals.push(`img:instagram:${alt||src.split('/').pop()}`);
          if (/tiktok/.test(combined))   found.signals.push(`img:tiktok:${alt||src.split('/').pop()}`);
          if (/facebook/.test(combined)) found.signals.push(`img:facebook:${alt||src.split('/').pop()}`);
        });

        // 5. Scan SVG elements and icon font classes (Font Awesome, etc.)
        document.querySelectorAll('[class]').forEach(el => {
          const cls = (el.getAttribute('class') || '').toLowerCase();
          if (/instagram|fa-instagram/.test(cls)) found.signals.push(`icon:instagram`);
          if (/tiktok|fa-tiktok/.test(cls))       found.signals.push(`icon:tiktok`);
          if (/facebook|fa-facebook/.test(cls))   found.signals.push(`icon:facebook`);
        });

        // 6. Scan visible text for @handle near social keywords
        const bodyText = document.body?.innerText || '';
        const igHandle = bodyText.match(/(?:instagram|follow us)[^\n@]{0,30}@([A-Za-z0-9._]{2,30})/i);
        if (igHandle && !found.instagram) {
          found.instagram = igHandle[1].toLowerCase();
          found.signals.push(`text:ig:${found.instagram}`);
        }

        // Deduplicate signals
        found.signals = [...new Set(found.signals)];
        return found;
      }
    });

    return results?.[0]?.result || { error: 'no result from scanner' };
  } finally {
    if (tab) chrome.tabs.remove(tab.id).catch(() => {});
  }
}

const BIZ_KEYWORDS = {
  restaurant: /restaurant|cafe|cafeteria|bistro|kitchen|pizza|bakery|grill|taqueria|sushi|diner|eatery|food|burger|taco|ramen|deli|steakhouse|seafood|bbq|barbecue|tapas|cantina|trattoria|gastropub|patisserie|churros|falafel|gyro|pho|hibachi|teriyaki|noodle|dumpling|shawarma|kebab|curry|thai|mexican|italian|chinese|japanese|korean|indian|mediterranean|cuban|peruvian|colombian|venezuelan|salvadoran|jamaican|ethiopian/i,
  spa: /spa|med spa|medspa|medical spa|laser|botox|filler|aesthetic|aesthetics|skincare|skin care|facial|hydrafacial|microneedling|coolsculpting|body contouring|waxing|esthetician|beauty|wellness|rejuvenation|anti.?aging|anti.?ageing/i,
  hair_salon: /hair|salon|barber|haircut|hairstyle|highlights|balayage|color|colour|blowout|extensions|keratin|stylist|coiffure/i,
  nail_salon: /nail|nails|manicure|pedicure|acrylic|gel nails|nail art|nail tech/i,
  gym: /gym|fitness|workout|crossfit|training|personal trainer|bodybuilding|weightlifting|cardio|hiit|bootcamp|pilates|strength|conditioning/i,
  yoga_studio: /yoga|pilates|meditation|mindfulness|wellness|vinyasa|flow|hot yoga|power yoga|barre/i,
  dentist: /dental|dentist|teeth|smile|orthodontics|braces|invisalign|whitening|implant|oral/i,
  cafe: /cafe|coffee|espresso|latte|cappuccino|barista|roast|brew|tea|matcha|boba/i,
  bar: /bar|cocktail|drinks|nightclub|lounge|pub|brewery|craft beer|mixology|speakeasy/i,
  barber_shop: /barber|barbershop|haircut|fade|lineup|shave|grooming|trim/i,
};

function getBizKeywords(bizType) {
  if (!bizType) return BIZ_KEYWORDS.restaurant;
  const key = bizType.toLowerCase().replace(/\s+/g, '_');
  if (BIZ_KEYWORDS[key]) return BIZ_KEYWORDS[key];
  // Partial match — e.g. "med spa" → spa
  for (const [k, regex] of Object.entries(BIZ_KEYWORDS)) {
    if (key.includes(k) || k.includes(key)) return regex;
  }
  // Custom keyword — build a simple regex from the type itself
  return new RegExp(bizType.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
}

// Search Instagram by restaurant name, return best matching handle
async function searchInstagram(name, city, bizType) {
  const query = encodeURIComponent(name);
  // Try multiple known search endpoints
  const endpoints = [
    `https://www.instagram.com/web/search/topsearch/?context=user&query=${query}&include_reel=true`,
    `https://www.instagram.com/api/v1/fbsearch/topsearch/?context=user&query=${query}&count=5`,
  ];
  let users = [];
  for (const url of endpoints) {
    try {
      const r = await fetch(url, {
        credentials: 'include',
        headers: {
          'x-ig-app-id': '936619743392459',
          'x-requested-with': 'XMLHttpRequest',
          'Referer': 'https://www.instagram.com/',
          'Accept': 'application/json',
        }
      });
      if (!r.ok) continue;
      const json = await r.json();
      users = (json?.users || []).map(u => u.user || u).filter(u => u?.username);
      if (users.length) break;
    } catch(e) { continue; }
  }
  if (!users.length) return { handle: null, reason: 'no results from any endpoint' };
  if (!users.length) return { handle: null, reason: 'no results' };

  // Score each result by name similarity
  const nameLower = name.toLowerCase().replace(/[^a-z0-9\s]/g, '');
  const cityLower = (city || '').toLowerCase();
  let best = null, bestScore = 0;

  const BIZ_RE = getBizKeywords(bizType);

  for (const u of users) {
    const fullName = (u.full_name || '').toLowerCase().replace(/[^a-z0-9\s]/g, '');
    const username = (u.username || '').toLowerCase();
    const bio = (u.biography || '').toLowerCase();
    const category = (u.category || u.category_name || '').toLowerCase();
    let score = 0;

    const nameWords = nameLower.split(/\s+/).filter(w => w.length > 2);
    const matchedWords = nameWords.filter(w => fullName.includes(w) || username.includes(w));
    score += matchedWords.length / Math.max(nameWords.length, 1) * 60;

    if (cityLower && (fullName.includes(cityLower) || bio.includes(cityLower))) score += 15;
    if (u.is_verified) score += 5;
    if (matchedWords.length === 0) score -= 20;

    // Boost if Instagram category or bio matches the business type being scanned
    if (BIZ_RE.test(category)) score += 25;
    else if (BIZ_RE.test(bio)) score += 10;

    if (score > bestScore) { bestScore = score; best = u; }
  }

  if (!best || bestScore < 25) return { handle: null, reason: `low confidence (${bestScore.toFixed(0)})`, candidates: users.map(u=>u.username) };

  // Search results don't include follower counts — just return the handle.
  // scrapeIgStats will fetch real stats separately.
  return {
    handle: best.username,
    confidence: bestScore.toFixed(0),
  };
}

// Search TikTok by restaurant name using TikTok's own search page with user's session
async function searchTikTok(name, city) {
  await new Promise(r => setTimeout(r, 1000 + Math.random() * 1000));

  // TikTok's user search page — uses the user's existing TikTok session cookies
  const query = encodeURIComponent(name);
  const url = `https://www.tiktok.com/search/user?q=${query}`;

  let html, status;
  try {
    const r = await fetch(url, {
      credentials: 'include',
      headers: {
        'Referer': 'https://www.tiktok.com/',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      }
    });
    status = r.status;
    if (!r.ok) return { handle: null, reason: `TikTok search HTTP ${status}` };
    html = await r.text();
  } catch(e) { return { error: `fetch failed: ${e.message}` }; }

  // TikTok embeds results in __UNIVERSAL_DATA_FOR_REHYDRATION__ JSON in the page
  const dataMatch = html.match(/<script[^>]+id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/);
  const sigiMatch = html.match(/window\.__INIT_PROPS__\s*=\s*(\{[\s\S]*?\});\s*<\/script>/);

  let users = [];

  if (dataMatch) {
    try {
      const data = JSON.parse(dataMatch[1]);
      // Navigate the nested structure TikTok uses
      const pages = data?.['__DEFAULT_SCOPE__']?.['webapp.user-detail'] ||
                    data?.['__DEFAULT_SCOPE__']?.['webapp.search-result-list'] ||
                    data;
      // Collect all uniqueId values from any depth
      const json = JSON.stringify(data);
      const ids = [...json.matchAll(/"uniqueId"\s*:\s*"([A-Za-z0-9._]{2,30})"/g)].map(m => m[1]);
      const nicks = [...json.matchAll(/"nickname"\s*:\s*"([^"]{1,60})"/g)].map(m => m[1]);
      ids.forEach((id, i) => users.push({ unique_id: id, nickname: nicks[i] || '' }));
    } catch(_) {}
  }

  // Fallback: pull uniqueId from anywhere in the page HTML
  if (!users.length) {
    const ids = [...html.matchAll(/"uniqueId"\s*:\s*"([A-Za-z0-9._]{2,30})"/g)].map(m => m[1]);
    ids.forEach(id => users.push({ unique_id: id, nickname: '' }));
  }

  const snippet = html.slice(0, 200).replace(/\s+/g, ' ');
  if (!users.length) return { handle: null, reason: `TikTok search status=${status} no users found. snippet="${snippet}"` };

  // Deduplicate
  const seen = new Set();
  users = users.filter(u => { if (seen.has(u.unique_id)) return false; seen.add(u.unique_id); return true; });

  // Score by name similarity
  const nameLower = name.toLowerCase().replace(/[^a-z0-9\s]/g, '');
  const nameWords = nameLower.split(/\s+/).filter(w => w.length > 2);
  let best = null, bestScore = 0;

  for (const u of users) {
    const uid = u.unique_id.toLowerCase();
    const nick = (u.nickname || '').toLowerCase().replace(/[^a-z0-9\s]/g, '');
    let score = 0;
    const matchedWords = nameWords.filter(w => uid.includes(w) || nick.includes(w));
    score += matchedWords.length / Math.max(nameWords.length, 1) * 60;
    if (matchedWords.length === 0) score -= 20;
    if (score > bestScore) { bestScore = score; best = u; }
  }

  if (!best || bestScore < 30) {
    return { handle: null, reason: `low confidence (${bestScore.toFixed(0)}) candidates: ${users.slice(0,5).map(u=>u.unique_id).join(', ')}` };
  }
  return { handle: best.unique_id, confidence: bestScore.toFixed(0) };
}

function parseSocialNum(s) {
  if (!s) return null;
  s = s.replace(/,/g,'');
  if (/[Kk]$/.test(s)) return Math.round(parseFloat(s)*1000);
  if (/[Mm]$/.test(s)) return Math.round(parseFloat(s)*1000000);
  return parseInt(s) || null;
}
