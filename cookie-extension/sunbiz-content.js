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

  // Results page — score all ACTIVE results by name + address, pick best
  if (url.includes('SearchResults')) {
    setTimeout(async () => {
      const searchName = (hashData.name || '').toLowerCase().replace(/[^a-z0-9\s]/g, '');
      const searchAddr = (hashData.address || '').toLowerCase();
      const searchWords = searchName.split(/\s+/).filter(w => w.length > 2);

      // Extract city, state, zip from lead address for comparison
      const addrParts = searchAddr.split(',').map(s => s.trim());
      const searchCity = addrParts[1] || '';
      const searchZip  = (searchAddr.match(/\b(\d{5})\b/) || [])[1] || '';
      const searchStreetNum = (searchAddr.match(/^(\d+)/) || [])[1] || '';

      // Collect all ACTIVE rows only
      const rows = [...document.querySelectorAll('tr')];
      const candidates = [];

      for (const row of rows) {
        const cells = row.querySelectorAll('td');
        if (cells.length < 3) continue;
        const link = cells[0].querySelector('a[href*="SearchResultDetail"]');
        if (!link) continue;
        const status = cells[2]?.textContent?.trim() || '';
        if (!/^active$/i.test(status)) continue; // skip INACT, NAME HS, InActive, etc.

        const entityName = cells[0].textContent.trim().toLowerCase().replace(/[^a-z0-9\s]/g, '');
        const nameScore = searchWords.filter(w => entityName.includes(w)).length;
        const href = new URL(link.getAttribute('href'), 'https://search.sunbiz.org').href;
        candidates.push({ href, entityName, nameScore });
      }

      console.log('[LeadScout] SunBiz active candidates:', candidates.map(c => c.entityName));
      if (!candidates.length) {
        console.log('[LeadScout] No active candidates found — leaving tab open for manual selection');
        // Don't send null — leave tab open so user can right-click
        return;
      }

      // Fetch each active candidate's detail page and score by address too
      const scored = await Promise.all(candidates.map(async c => {
        try {
          const resp = await fetch(c.href, { credentials: 'include' });
          const html = await resp.text();
          const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').toLowerCase();

          let addrScore = 0;
          if (searchCity && text.includes(searchCity)) addrScore += 3;
          if (searchZip  && text.includes(searchZip))  addrScore += 4;
          if (searchStreetNum && text.includes(searchStreetNum)) addrScore += 2;

          const ownerName = extractAgentName(html);
          return { ...c, addrScore, totalScore: c.nameScore + addrScore, html, ownerName };
        } catch(e) {
          return { ...c, addrScore: 0, totalScore: c.nameScore, html: '', ownerName: null };
        }
      }));

      // Pick highest total score
      scored.sort((a, b) => b.totalScore - a.totalScore);
      const winner = scored[0];
      chrome.runtime.sendMessage({ type: 'sunbiz_result', name: winner?.ownerName || null });

    }, 1800);
    return;
  }

  // Landed directly on a detail page (single-result search)
  if (url.includes('SearchResultDetail')) {
    setTimeout(() => {
      const name = extractAgentName(document.body.innerHTML);
      chrome.runtime.sendMessage({ type: 'sunbiz_result', name: name || null });
    }, 1500);
  }

  function extractAgentName(html) {
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const m  = text.match(/Registered Agent Name[^A-Z]{0,80}([A-Z]{2,},\s+[A-Z]{2,}(?:\s+[A-Z])?)/);
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
