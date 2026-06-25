(function () {
  const url = window.location.href;
  let hashData = {};
  try { hashData = JSON.parse(decodeURIComponent(window.location.hash.slice(1))); } catch(e) {}

  // Fill the search field on the form page
  if (url.includes('ByName') || url.includes('ByAddress')) {
    const val = hashData.name || hashData.address || '';
    if (!val) return;
    setTimeout(() => {
      const input = document.querySelector('input[type="text"]');
      if (input) { input.value = val; input.focus(); }
    }, 600);
    return;
  }

  // Results page — auto-pick the best matching active entity
  if (url.includes('SearchResults')) {
    setTimeout(async () => {
      const searchName = (hashData.name || '').toLowerCase().replace(/[^a-z0-9\s]/g, '');
      const searchWords = searchName.split(/\s+/).filter(w => w.length > 2);

      // Collect all rows with their name, link, and status
      const rows = [...document.querySelectorAll('table tr, .search-results tr')];
      let best = null, bestScore = -1;

      for (const row of rows) {
        const cells = row.querySelectorAll('td');
        if (cells.length < 3) continue;
        const link = cells[0].querySelector('a[href*="SearchResultDetail"]');
        if (!link) continue;
        const status = cells[2]?.textContent?.trim() || '';
        if (!/^active$/i.test(status)) continue; // skip inactive

        const entityName = cells[0].textContent.trim().toLowerCase().replace(/[^a-z0-9\s]/g, '');
        const matchedWords = searchWords.filter(w => entityName.includes(w));
        const score = matchedWords.length;
        if (score > bestScore) { bestScore = score; best = link; }
      }

      if (!best) {
        // No active match — leave page open for manual selection
        chrome.runtime.sendMessage({ type: 'sunbiz_result', name: null });
        return;
      }

      // Fetch the detail page of the best match
      try {
        const detailUrl = new URL(best.getAttribute('href'), 'https://search.sunbiz.org').href;
        const resp = await fetch(detailUrl, { credentials: 'include' });
        const html = await resp.text();
        const name = extractAgentName(html);
        chrome.runtime.sendMessage({ type: 'sunbiz_result', name: name || null });
      } catch(e) {
        chrome.runtime.sendMessage({ type: 'sunbiz_result', name: null });
      }
    }, 1800);
    return;
  }

  // Detail page — extract name directly if landed here
  if (url.includes('SearchResultDetail')) {
    setTimeout(() => {
      const name = extractAgentName(document.body.innerHTML);
      chrome.runtime.sendMessage({ type: 'sunbiz_result', name: name || null });
    }, 1500);
  }

  function extractAgentName(html) {
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    // Try registered agent first
    const m = text.match(/Registered Agent Name[^A-Z]{0,80}([A-Z]{2,},\s+[A-Z]{2,}(?:\s+[A-Z])?)/);
    // Fallback: officer/director names (President, Manager, etc.)
    const m2 = !m && text.match(/(?:President|Manager|Director|Member|Owner)[^A-Z]{0,40}([A-Z]{2,},\s+[A-Z]{2,}(?:\s+[A-Z])?)/);
    const raw = (m || m2)?.[1]?.trim();
    if (!raw) return null;
    const parts = raw.split(/,\s*/);
    if (parts.length < 2) return raw;
    const cap = s => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
    const first = parts[1].trim().split(' ').map(w => w.length <= 1 ? w.toUpperCase() : cap(w)).join(' ');
    return first + ' ' + cap(parts[0].trim());
  }
})();
