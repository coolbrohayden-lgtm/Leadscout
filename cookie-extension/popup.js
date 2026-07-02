const igStatus = document.getElementById('igStatus');
const ttStatus = document.getElementById('ttStatus');
const syncBtn = document.getElementById('syncBtn');
const msg = document.getElementById('msg');

let igCookie = null;
let ttCookie = null;

async function getCookie(domain, name) {
  return new Promise(resolve => {
    chrome.cookies.get({ url: domain, name }, cookie => {
      resolve(cookie ? cookie.value : null);
    });
  });
}

async function getAllCookies(domain) {
  return new Promise(resolve => {
    chrome.cookies.getAll({ domain }, cookies => resolve(cookies));
  });
}

async function checkCookies() {
  // Instagram — need sessionid + csrftoken
  const igSession = await getCookie('https://www.instagram.com', 'sessionid');
  const igCsrf = await getCookie('https://www.instagram.com', 'csrftoken');

  if (igSession) {
    igCookie = `sessionid=${igSession}${igCsrf ? '; csrftoken=' + igCsrf : ''}`;
    igStatus.textContent = 'Logged in ✓';
    igStatus.className = 'status ok';
  } else {
    igCookie = null;
    igStatus.textContent = 'Not logged in';
    igStatus.className = 'status warn';
  }

  // TikTok — need sessionid
  const ttSession = await getCookie('https://www.tiktok.com', 'sessionid');
  const ttWeb = await getCookie('https://www.tiktok.com', 'tt_webid_v2');

  if (ttSession) {
    ttCookie = `sessionid=${ttSession}${ttWeb ? '; tt_webid_v2=' + ttWeb : ''}`;
    ttStatus.textContent = 'Logged in ✓';
    ttStatus.className = 'status ok';
  } else {
    ttCookie = null;
    ttStatus.textContent = 'Not logged in';
    ttStatus.className = 'status warn';
  }

  syncBtn.disabled = !igCookie && !ttCookie;
}

async function findLeadScoutTab() {
  return new Promise(resolve => {
    chrome.tabs.query({}, tabs => {
      const railway = tabs.find(t => t.url && t.url.includes('leadscout-production-f926.up.railway.app'));
      const local = tabs.find(t => t.url && t.url.startsWith('http://localhost:3000'));
      const match = railway || local;
      console.log('[LeadScout] All tabs:', tabs.map(t=>t.url));
      console.log('[LeadScout] Matched tab:', match?.url);
      resolve(match || null);
    });
  });
}

syncBtn.addEventListener('click', async () => {
  syncBtn.disabled = true;
  msg.textContent = 'Syncing...';
  msg.className = 'msg';

  const tab = await findLeadScoutTab();
  if (!tab) {
    msg.textContent = 'LeadScout tab not found — make sure it is open';
    msg.className = 'msg err';
    syncBtn.disabled = false;
    return;
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (ig, tt) => {
        if (ig) {
          localStorage.setItem('leadscout_ig_cookie', ig);
          const el = document.getElementById('igCookieInput');
          if (el) el.value = ig;
        }
        if (tt) {
          localStorage.setItem('leadscout_tt_cookie', tt);
          const el = document.getElementById('ttCookieInput');
          if (el) el.value = tt;
        }
        return true;
      },
      args: [igCookie, ttCookie]
    });

    msg.textContent = 'Synced! Ready to scan.';
    msg.className = 'msg ok';
  } catch (e) {
    msg.textContent = 'Error: ' + e.message;
    msg.className = 'msg err';
  }

  syncBtn.disabled = false;
});

checkCookies();

