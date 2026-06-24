// LeadScout local server
// Run: node server.js
// Then open: http://localhost:3000

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = 3000;
const HTML_FILE = path.join(__dirname, 'restaurant_lead_finder.html');

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

  const CORS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

  // NEW: Nearby search using Places API (New)
  if (parsed.pathname === '/nearbysearch') {
    const { lat, lng, radius, key } = parsed.query;
    if (!lat || !lng || !key) { res.writeHead(400); res.end('Missing params'); return; }
    try {
      const body = {
        includedTypes: ['restaurant'],
        maxResultCount: 20,
        locationRestriction: {
          circle: {
            center: { latitude: parseFloat(lat), longitude: parseFloat(lng) },
            radius: parseFloat(radius) || 1500
          }
        }
      };
      const data = await httpsPost(
        'https://places.googleapis.com/v1/places:searchNearby',
        body, key
      );
      // Normalize to legacy format so HTML code doesn't need to change much
      const results = (data.places || []).map(p => ({
        place_id: p.id,
        name: p.displayName?.text || '',
        vicinity: p.formattedAddress || '',
        rating: p.rating,
        user_ratings_total: p.userRatingCount,
        geometry: { location: { lat: p.location?.latitude, lng: p.location?.longitude } },
        // carry extra fields through
        website: p.websiteUri || '',
        phone: p.nationalPhoneNumber || p.internationalPhoneNumber || '',
      }));
      res.writeHead(200, CORS);
      res.end(JSON.stringify({ status: 'OK', results }));
    } catch(e) {
      console.error('nearbysearch error:', e.message);
      res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // NEW: Place details using Places API (New)
  if (parsed.pathname === '/placedetails') {
    const { place_id, key } = parsed.query;
    if (!place_id || !key) { res.writeHead(400); res.end('Missing params'); return; }
    try {
      const apiUrl = `https://places.googleapis.com/v1/places/${place_id}`;
      const urlObj = new URL(apiUrl);
      const data = await new Promise((resolve, reject) => {
        const options = {
          hostname: urlObj.hostname,
          path: urlObj.pathname,
          method: 'GET',
          headers: {
            'X-Goog-Api-Key': key,
            'X-Goog-FieldMask': 'id,displayName,formattedAddress,nationalPhoneNumber,websiteUri,rating,userRatingCount,location'
          }
        };
        const req = https.request(options, (res) => {
          let d = '';
          res.on('data', c => d += c);
          res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
        });
        req.on('error', reject);
        req.end();
      });
      // Normalize to legacy format
      const result = {
        name: data.displayName?.text || '',
        formatted_address: data.formattedAddress || '',
        formatted_phone_number: data.nationalPhoneNumber || '',
        website: data.websiteUri || '',
        rating: data.rating,
        user_ratings_total: data.userRatingCount,
      };
      res.writeHead(200, CORS);
      res.end(JSON.stringify({ status: 'OK', result }));
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
