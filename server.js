// LeadScout local server
// Run: node server.js
// Then open: http://localhost:3000

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;
const HTML_FILE = path.join(__dirname, 'restaurant_lead_finder.html');

// ── Supabase token verification (protects API routes from public abuse) ──
const SUPA_URL = 'https://yiutqeuiwdrfiwioyhwr.supabase.co';
const SUPA_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlpdXRxZXVpd2RyZml3aW95aHdyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIyNzU3NDgsImV4cCI6MjA5Nzg1MTc0OH0.TlIwAggWacEj1ZutusH-gaMa2LSt_ZAjov-2Ao3LHlo';
const _tokenCache = new Map(); // token -> cache expiry (ms)

function verifySupaToken(token) {
  return new Promise((resolve) => {
    if (!token) return resolve(false);
    const hit = _tokenCache.get(token);
    if (hit && hit > Date.now()) return resolve(true);
    const u = new URL(SUPA_URL + '/auth/v1/user');
    const req = https.request({
      hostname: u.hostname, path: u.pathname, method: 'GET',
      headers: { 'apikey': SUPA_ANON_KEY, 'Authorization': `Bearer ${token}` }
    }, (r) => {
      let data = '';
      r.on('data', c => data += c);
      r.on('end', () => {
        try {
          const j = JSON.parse(data);
          if (j && j.id) {
            if (_tokenCache.size > 500) _tokenCache.clear();
            _tokenCache.set(token, Date.now() + 5 * 60 * 1000);
            return resolve(true);
          }
        } catch(e) {}
        resolve(false);
      });
    });
    req.on('error', () => resolve(false));
    req.setTimeout(8000, () => { req.destroy(); resolve(false); });
    req.end();
  });
}

function fetchPageDirect(pageUrl, redirects=0, extraHeaders={}, debug=false) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Too many redirects'));
    const urlObj = new URL(pageUrl);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'identity',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        ...extraHeaders
      }
    };
    const req = https.request(options, (r) => {
      if (debug) console.log(`[fetchig] status=${r.statusCode} headers=${JSON.stringify(r.headers)}`);
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
        const next = r.headers.location.startsWith('http') ? r.headers.location : `https://${urlObj.hostname}${r.headers.location}`;
        r.resume();
        return resolve(fetchPageDirect(next, redirects + 1, extraHeaders, debug));
      }
      const chunks = [];
      r.on('data', chunk => chunks.push(chunk));
      r.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (debug) console.log(`[fetchig] body bytes=${buf.length} first80=${buf.slice(0,80).toString('utf8')}`);
        resolve(buf.toString('utf8'));
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

function httpsPost(apiUrl, body, apiKey) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body);
    const urlObj = new URL(apiUrl);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': '*',
        'Content-Length': Buffer.byteLength(bodyStr)
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

// Read shared_settings row from Supabase (cached 60s) — used by /send-email
let _settingsCache = { data: null, at: 0 };
function getSharedSettings() {
  return new Promise((resolve) => {
    if (_settingsCache.data && Date.now() - _settingsCache.at < 60000) return resolve(_settingsCache.data);
    const u = new URL(SUPA_URL + '/rest/v1/shared_settings?id=eq.1&select=*');
    https.get({
      hostname: u.hostname, path: u.pathname + u.search,
      headers: { 'apikey': SUPA_ANON_KEY, 'Authorization': `Bearer ${SUPA_ANON_KEY}` }
    }, (r) => {
      let data = '';
      r.on('data', c => data += c);
      r.on('end', () => {
        try {
          const rows = JSON.parse(data);
          _settingsCache = { data: rows[0] || {}, at: Date.now() };
          resolve(_settingsCache.data);
        } catch(e) { resolve(_settingsCache.data || {}); }
      });
    }).on('error', () => resolve(_settingsCache.data || {}));
  });
}

function httpsGet(apiUrl) {
  return new Promise((resolve, reject) => {
    https.get(apiUrl, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(e); }
      });
    }).on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);

  // Serve the main app
  if (parsed.pathname === '/' || parsed.pathname === '/index.html' || parsed.pathname === '/restaurant_lead_finder.html') {
    try {
      const html = fs.readFileSync(HTML_FILE, 'utf8');
      res.writeHead(200, {'Content-Type': 'text/html'});
      res.end(html);
    } catch(e) {
      res.writeHead(404); res.end('HTML file not found.');
    }
    return;
  }

  // Serve login page
  if (parsed.pathname === '/login') {
    try {
      const html = fs.readFileSync(path.join(__dirname, 'login.html'), 'utf8');
      res.writeHead(200, {'Content-Type': 'text/html'});
      res.end(html);
    } catch(e) {
      res.writeHead(404); res.end('login.html not found.');
    }
    return;
  }

  // Serve pending-approval page
  if (parsed.pathname === '/pending') {
    try {
      const html = fs.readFileSync(path.join(__dirname, 'pending.html'), 'utf8');
      res.writeHead(200, {'Content-Type': 'text/html'});
      res.end(html);
    } catch(e) {
      res.writeHead(404); res.end('pending.html not found.');
    }
    return;
  }

  // Serve auth.js
  if (parsed.pathname === '/auth.js') {
    try {
      const js = fs.readFileSync(path.join(__dirname, 'auth.js'), 'utf8');
      res.writeHead(200, {'Content-Type': 'application/javascript'});
      res.end(js);
    } catch(e) {
      res.writeHead(404); res.end('auth.js not found.');
    }
    return;
  }

  // Serve the database/CRM page
  if (parsed.pathname === '/database') {
    try {
      const html = fs.readFileSync(path.join(__dirname, 'database.html'), 'utf8');
      res.writeHead(200, {'Content-Type': 'text/html'});
      res.end(html);
    } catch(e) {
      res.writeHead(404); res.end('database.html not found.');
    }
    return;
  }

  const CORS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    res.end();
    return;
  }

  // All routes below are API — require a valid Supabase session token
  const authToken = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  if (!(await verifySupaToken(authToken))) {
    res.writeHead(401, CORS);
    res.end(JSON.stringify({ error: 'unauthorized — sign in required' }));
    return;
  }

  // Nearby search — legacy Places API (covered by $200/mo free credit, ~6,600 free searches)
  // Places API (New) has NO free tier and was causing unexpected charges.
  if (parsed.pathname === '/nearbysearch') {
    const { lat, lng, radius, key, type } = parsed.query;
    if (!lat || !lng || !key) { res.writeHead(400); res.end('Missing params'); return; }

    const TYPE_MAP = {
      'med spa': 'spa', 'medspa': 'spa', 'medical spa': 'spa',
      'hair salon': 'hair_salon', 'nail salon': 'nail_salon',
      'barber': 'barber_shop', 'barbershop': 'barber_shop',
      'gym': 'gym', 'fitness': 'gym', 'yoga': 'yoga_studio',
      'dentist': 'dentist', 'dental': 'dentist',
      'cafe': 'cafe', 'coffee': 'cafe',
      'bar': 'bar', 'night club': 'night_club',
      'hotel': 'lodging', 'car wash': 'car_wash',
    };
    const rawType = (type || 'restaurant').toLowerCase().trim();
    const resolvedType = TYPE_MAP[rawType] || rawType;

    try {
      const qs = new URLSearchParams({
        location: `${lat},${lng}`,
        radius: String(parseFloat(radius) || 1500),
        type: resolvedType,
        key,
      });
      const raw = await fetchPageDirect(`https://maps.googleapis.com/maps/api/place/nearbysearch/json?${qs}`);
      const data = JSON.parse(raw);
      res.writeHead(200, CORS);
      res.end(JSON.stringify({ status: data.status, results: data.results || [] }));
    } catch(e) {
      console.error('nearbysearch error:', e.message);
      res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // Place details — legacy Places API (same free credit as above)
  if (parsed.pathname === '/placedetails') {
    const { place_id, key } = parsed.query;
    if (!place_id || !key) { res.writeHead(400); res.end('Missing params'); return; }
    try {
      const qs = new URLSearchParams({
        place_id,
        fields: 'name,formatted_address,formatted_phone_number,website',
        key,
      });
      const raw = await fetchPageDirect(`https://maps.googleapis.com/maps/api/place/details/json?${qs}`);
      const data = JSON.parse(raw);
      res.writeHead(200, CORS);
      res.end(JSON.stringify({ status: data.status, result: data.result || {} }));
    } catch(e) {
      console.error('placedetails error:', e.message);
      res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // RapidAPI Instagram Statistics API — Profile by URL
  if (parsed.pathname === '/rapidapi-ig') {
    const { handle, key } = parsed.query;
    if (!handle || !key) { res.writeHead(400); res.end('Missing handle or key'); return; }
    try {
      const igUrl = `https://www.instagram.com/${encodeURIComponent(handle)}/`;
      const apiPath = `/community?url=${encodeURIComponent(igUrl)}`;
      const data = await new Promise((resolve, reject) => {
        const options = {
          hostname: 'instagram-statistics-api.p.rapidapi.com',
          path: apiPath,
          method: 'GET',
          headers: {
            'x-rapidapi-host': 'instagram-statistics-api.p.rapidapi.com',
            'x-rapidapi-key': key,
            'Content-Type': 'application/json',
          }
        };
        const req = https.request(options, (r) => {
          let d = '';
          r.on('data', c => d += c);
          r.on('end', () => {
            console.log(`[rapidapi-ig] @${handle} status=${r.statusCode} body=${d.slice(0,300)}`);
            try { resolve({ status: r.statusCode, body: JSON.parse(d) }); }
            catch(e) { resolve({ status: r.statusCode, raw: d.slice(0,500) }); }
          });
        });
        req.on('error', reject);
        req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')); });
        req.end();
      });
      if (data.status !== 200) {
        res.writeHead(200, CORS);
        res.end(JSON.stringify({ error: `RapidAPI HTTP ${data.status}`, detail: data.body || data.raw }));
      } else {
        res.writeHead(200, CORS);
        res.end(JSON.stringify(data.body));
      }
    } catch(e) {
      console.error('[rapidapi-ig] error:', e.message);
      res.writeHead(500, CORS); res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // FlashAPI — IG recent posts proxy
  if (parsed.pathname === '/rapidapi-ig-posts') {
    const { handle: rawHandle, key } = parsed.query;
    const handle = (rawHandle || '').replace(/^@/, '');
    if (!handle || !key) { res.writeHead(400, CORS); res.end(JSON.stringify({ error: 'Missing handle or key' })); return; }
    try {
      const data = await new Promise((resolve, reject) => {
        const path = `/ig/basic_engagement/?user=${encodeURIComponent(handle)}`;
        const options = {
          hostname: 'flashapi1.p.rapidapi.com',
          path,
          method: 'GET',
          headers: { 'x-rapidapi-host': 'flashapi1.p.rapidapi.com', 'x-rapidapi-key': key },
        };
        const req = https.request(options, (r) => {
          let d = '';
          r.on('data', c => d += c);
          r.on('end', () => {
            console.log(`[ig-posts] @${handle} status=${r.statusCode} body=${d.slice(0,200)}`);
            try { resolve({ status: r.statusCode, body: JSON.parse(d) }); }
            catch(e) { resolve({ status: r.statusCode, raw: d.slice(0,500) }); }
          });
        });
        req.on('error', reject);
        req.setTimeout(12000, () => { req.destroy(); reject(new Error('timeout')); });
        req.end();
      });
      res.writeHead(200, CORS);
      if (data.status !== 200) { res.end(JSON.stringify({ error: `FlashAPI HTTP ${data.status}`, detail: data.body || data.raw })); return; }
      res.end(JSON.stringify(data.body));
    } catch(e) {
      console.error('[ig-posts] error:', e.message);
      res.writeHead(500, CORS); res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // Fetch Instagram profile JSON via internal API
  if (parsed.pathname === '/fetchig') {
    const { handle, cookie } = parsed.query;
    if (!handle) { res.writeHead(400); res.end('Missing handle'); return; }
    try {
      const igUrl = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(handle)}`;
      const extraHeaders = {
        'x-ig-app-id': '936619743392459',
        'x-requested-with': 'XMLHttpRequest',
        'Referer': `https://www.instagram.com/${handle}/`,
        'Accept': 'application/json, text/plain, */*',
        'Origin': 'https://www.instagram.com',
      };
      if (cookie) extraHeaders['Cookie'] = cookie;
      console.log(`[fetchig] handle=${handle} cookie=${cookie ? cookie.slice(0,30)+'...' : 'none'}`);
      const data = await fetchPageDirect(igUrl, 0, extraHeaders, true);
      res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
      res.end(data);
    } catch(e) {
      res.writeHead(500, CORS); res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // Fetch TikTok profile JSON via internal API
  if (parsed.pathname === '/fetchtt') {
    const { handle, cookie } = parsed.query;
    if (!handle) { res.writeHead(400); res.end('Missing handle'); return; }
    try {
      const ttUrl = `https://www.tiktok.com/api/user/detail/?uniqueId=${encodeURIComponent(handle)}&aid=1988&app_language=en&device_platform=web_pc`;
      const extraHeaders = {
        'Referer': 'https://www.tiktok.com/',
        'Accept': 'application/json, text/plain, */*',
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Dest': 'empty',
      };
      if (cookie) extraHeaders['Cookie'] = cookie;
      const data = await fetchPageDirect(ttUrl, 0, extraHeaders);
      res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
      res.end(data);
    } catch(e) {
      res.writeHead(500, CORS); res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // Scrape business email from website
  if (parsed.pathname === '/scrape-email') {
    const { website } = parsed.query;
    if (!website) { res.writeHead(400, CORS); res.end(JSON.stringify({ error: 'Missing website' })); return; }
    const emailRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
    const skipDomains = ['sentry.io','wixpress.com','squarespace.com','shopify.com','wordpress.com','example.com','domain.com','email.com','youremail','yourname','name@','info@info','test@','noreply','no-reply','donotreply','support@support','admin@admin','placeholder'];
    const found = new Set();

    async function scrapeUrl(pageUrl) {
      try {
        const html = await fetchPageDirect(pageUrl, 0, {}, false);
        const matches = html.match(emailRegex) || [];
        for (const e of matches) {
          const lower = e.toLowerCase();
          if (!skipDomains.some(s => lower.includes(s))) found.add(lower);
        }
      } catch(e) {}
    }

    try {
      const base = website.replace(/\/$/, '');
      await scrapeUrl(base);
      if (found.size === 0) {
        await Promise.all(['/contact', '/about', '/contact-us', '/about-us'].map(p => scrapeUrl(base + p)));
      }
      const emails = [...found].slice(0, 5);
      res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ emails, primary: emails[0] || null }));
    } catch(e) {
      res.writeHead(500, CORS); res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // Fetch any external page server-side (bypasses CORS + proxy blocks)
  if (parsed.pathname === '/fetchpage') {
    const { url } = parsed.query;
    if (!url) { res.writeHead(400); res.end('Missing url'); return; }
    try {
      const html = await fetchPageDirect(url);
      res.writeHead(200, { ...CORS, 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch(e) {
      res.writeHead(500, CORS); res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // Send an email through Resend (key + from address live in shared_settings)
  if (parsed.pathname === '/send-email' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { to, subject, text } = JSON.parse(body);
        if (!to || !subject || !text) {
          res.writeHead(400, CORS); res.end(JSON.stringify({ error: 'Missing to/subject/text' })); return;
        }
        const settings = await getSharedSettings();
        if (!settings.resend_key) {
          res.writeHead(400, CORS); res.end(JSON.stringify({ error: 'No Resend API key configured. Admin: add it in Settings on the database page.' })); return;
        }
        const from = settings.resend_from || 'LeadScout <onboarding@resend.dev>';
        const result = await new Promise((resolve, reject) => {
          const payload = JSON.stringify({ from, to: [to], subject, text });
          const rq = https.request({
            hostname: 'api.resend.com', path: '/emails', method: 'POST',
            headers: {
              'Authorization': `Bearer ${settings.resend_key}`,
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(payload)
            }
          }, (r) => {
            let data = '';
            r.on('data', c => data += c);
            r.on('end', () => {
              try { resolve({ status: r.statusCode, body: JSON.parse(data) }); }
              catch(e) { resolve({ status: r.statusCode, body: { raw: data } }); }
            });
          });
          rq.on('error', reject);
          rq.setTimeout(15000, () => { rq.destroy(); reject(new Error('Resend timeout')); });
          rq.write(payload); rq.end();
        });
        if (result.status >= 200 && result.status < 300) {
          res.writeHead(200, CORS); res.end(JSON.stringify({ ok: true, id: result.body.id }));
        } else {
          res.writeHead(502, CORS); res.end(JSON.stringify({ error: result.body.message || `Resend error ${result.status}`, detail: result.body }));
        }
      } catch(e) {
        res.writeHead(500, CORS); res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // Save CSV to disk
  if (parsed.pathname === '/savecsv' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { filename, csv } = JSON.parse(body);
        const safe = filename.replace(/[^a-zA-Z0-9_\-\.]/g, '_');
        const filePath = path.join(__dirname, safe);
        fs.writeFileSync(filePath, csv, 'utf8');
        res.writeHead(200, CORS);
        res.end(JSON.stringify({ ok: true, path: filePath }));
      } catch(e) {
        res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // Owner lookup: SunBiz address search + IG bio parse + Google search link
  if (parsed.pathname === '/enrich') {
    const { name, address, ig_bio, facebook } = parsed.query;
    if (!name) { res.writeHead(400); res.end('Missing name'); return; }
    const result = { owner_name: null, owner_email: null, owner_phone: null, owner_source: null, google_search_url: null };
    try {
      // Always provide a Google search link for the caller
      result.google_search_url = `https://www.google.com/search?q=${encodeURIComponent('"' + name + '" owner')}`;

      // Step 1: SunBiz address search — street address only (e.g. "4000 SW 57th Ave")
      const street = (address||'').split(',')[0].trim();
      if (street) {
        try {
          const sunbizUrl = `https://search.sunbiz.org/Inquiry/CorporationSearch/SearchResults?inquiryType=Address&inquiryDirectionType=ForwardList&searchNameOrder=&masterDataType=Master&searchTerm=${encodeURIComponent(street)}&listNameOrder=`;
          const listHtml = await fetchPageDirect(sunbizUrl, 0, { 'Accept': 'text/html', 'Referer': 'https://search.sunbiz.org/' });
          // Find first detail link
          const linkMatch = listHtml.match(/href="(\/Inquiry\/CorporationSearch\/SearchResultDetail\?inquiryType=Address[^"]+)"/i);
          if (linkMatch) {
            const detailHtml = await fetchPageDirect(`https://search.sunbiz.org${linkMatch[1]}`, 0, { 'Accept': 'text/html', 'Referer': sunbizUrl });
            // Extract registered agent name (format: LASTNAME, FIRSTNAME M)
            const agentMatch = detailHtml.match(/Registered Agent Name[^]*?<span[^>]*>([^<]+)<\/span>/i)
              || detailHtml.match(/([A-Z]{2,},\s+[A-Z]{2,}(?:\s+[A-Z])?)\s*\n/);
            if (agentMatch) {
              const raw = agentMatch[1].trim();
              // Convert "GARCIA, ALEJANDRO J" → "Alejandro J Garcia"
              const parts = raw.split(/,\s*/);
              const formatted = parts.length > 1
                ? `${parts[1].trim()} ${parts[0].trim()}`.replace(/\b\w/g, c => c.toUpperCase()).toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
                : raw.replace(/\b\w/g, c => c.toUpperCase()).toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
              result.owner_name = formatted;
              result.owner_source = 'Florida SunBiz';
            }
          }
        } catch(e) { console.error('[enrich] SunBiz error:', e.message); }
      }

      // Step 2: Parse IG bio for owner mention
      if (!result.owner_name && ig_bio) {
        const ownerMatch = ig_bio.match(/(?:owner|founder|operated by|run by|by)[:\s]+([A-Za-z]+(?: [A-Za-z]+)?)/i);
        if (ownerMatch) {
          result.owner_name = ownerMatch[1].trim();
          result.owner_source = 'Instagram bio';
        }
      }

      res.writeHead(200, CORS);
      res.end(JSON.stringify(result));
    } catch(e) {
      console.error('[enrich] error:', e.message);
      res.writeHead(200, CORS);
      res.end(JSON.stringify({ ...result, error: e.message }));
    }
    return;
  }

  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, () => {
  console.log('');
  console.log('  LeadScout server running!');
  console.log(`  Open this in Chrome: http://localhost:${PORT}`);
  console.log('');
  console.log('  Press Ctrl+C to stop.');
  console.log('');
});
