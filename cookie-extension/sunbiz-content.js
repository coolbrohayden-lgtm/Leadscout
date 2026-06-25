(function () {
  const url = window.location.href;

  // ByName form page — read lead data from hash, store in session, fill + submit
  if (url.includes('ByAddress') || url.includes('ByName')) {
    let hashData = {};
    try { hashData = JSON.parse(decodeURIComponent(window.location.hash.slice(1))); } catch(e) {}
    const val = hashData.address || hashData.name || '';
    if (!val) return;

    // Persist lead data across navigation (hash is lost on form submit)
    sessionStorage.setItem('sunbiz_lead', JSON.stringify(hashData));

    setTimeout(() => {
      const input = document.querySelector('input[type="text"]');
      if (!input) return;
      input.value = val;
      input.focus();
      // Auto-submit
      setTimeout(() => {
        const btn = document.querySelector('input[type="submit"], button[type="submit"]');
        if (btn) btn.click();
        else input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
      }, 400);
    }, 700);
    return;
  }

  // Results page — read lead data from session storage, score + fetch best match
  if (url.includes('SearchResults')) {
    setTimeout(async () => { // async kept for Promise.all fetch below
      // Address search returns results already matched to the address — just take first active result
      const rows = [...document.querySelectorAll('tr')];
      let firstActive = null;
      for (const row of rows) {
        const cells = row.querySelectorAll('td');
        if (cells.length < 3) continue;
        const link = cells[0].querySelector('a[href*="SearchResultDetail"]');
        if (!link) continue;
        const docNum = cells[1]?.textContent?.trim() || '';
        if (/^T/i.test(docNum)) continue; // skip trademarks
        const status = cells[2]?.textContent?.trim() || '';
        if (!/^active$/i.test(status)) continue;
        firstActive = new URL(link.getAttribute('href'), 'https://search.sunbiz.org').href;
        break;
      }

      console.log('[LeadScout] First active result:', firstActive);

      if (!firstActive) {
        console.log('[LeadScout] No active results — leaving tab open');
        return;
      }

      try {
        const resp = await fetch(firstActive, { credentials: 'include' });
        const html = await resp.text();
        const ownerName = extractAgentName(html);
        console.log('[LeadScout] Owner found:', ownerName);
        chrome.runtime.sendMessage({ type: 'sunbiz_result', name: ownerName || null });
      } catch(e) {
        console.log('[LeadScout] Fetch failed:', e.message);
        chrome.runtime.sendMessage({ type: 'sunbiz_result', name: null });
      }

    }, 1800);
    return;
  }

  // Landed directly on detail page
  if (url.includes('SearchResultDetail')) {
    setTimeout(() => {
      chrome.runtime.sendMessage({ type: 'sunbiz_result', name: extractAgentName(document.body.innerHTML) || null });
    }, 1500);
  }

  function extractAgentName(html) {
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

    const idx = text.indexOf('Registered Agent');
    if (idx >= 0) console.log('[LeadScout] Agent section:', JSON.stringify(text.slice(idx, idx + 300)));

    // Capture: "LASTNAME, FIRSTNAME [MIDDLE] ADDRESS CITY, STATE ZIP"
    // Stop at "Name Changed", "Address Changed", "Authorized", or end of block
    const m = text.match(/Registered Agent Name\s*&\s*Address\s+([A-Z][A-Z,. ]+?(?:\d[\w ,.\-]+(?:FL|GA|TX|NY|CA|AL|AZ|CO|CT|DE|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY)\s+\d{5}(?:-\d{4})?))\s/i);
    if (m?.[1]) return m[1].trim();

    // Fallback: just grab name portion (LASTNAME, FIRSTNAME M)
    const m2 = text.match(/Registered Agent Name[^A-Z]{0,120}([A-Z]{2,},\s+[A-Z]{2,}(?:\s+[A-Z])?)/);
    if (m2?.[1]) return m2[1].trim();

    return null;
  }
})();
