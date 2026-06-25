(function () {
  const url = window.location.href;

  // ByName form page — read lead data from hash, store in session, fill + submit
  if (url.includes('ByName') || url.includes('ByAddress')) {
    let hashData = {};
    try { hashData = JSON.parse(decodeURIComponent(window.location.hash.slice(1))); } catch(e) {}
    const val = hashData.name || hashData.address || '';
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
      const sunbiz_lead = JSON.parse(sessionStorage.getItem('sunbiz_lead') || '{}');
      const leadName = (sunbiz_lead.name || '').toLowerCase().replace(/[^a-z0-9\s]/g, '');
      const leadAddr = (sunbiz_lead.address || '').toLowerCase();
      const searchWords = leadName.split(/\s+/).filter(w => w.length > 2);
      const searchCity = (leadAddr.split(',')[1] || '').trim();
      const searchZip  = (leadAddr.match(/\b(\d{5})\b/) || [])[1] || '';
      const searchStreetNum = (leadAddr.match(/^(\d+)/) || [])[1] || '';

      console.log('[LeadScout] Lead name:', leadName, '| words:', searchWords);

      // Collect active rows only
      const rows = [...document.querySelectorAll('tr')];
      const candidates = [];
      for (const row of rows) {
        const cells = row.querySelectorAll('td');
        if (cells.length < 3) continue;
        const link = cells[0].querySelector('a[href*="SearchResultDetail"]');
        if (!link) continue;
        const docNum = cells[1]?.textContent?.trim() || '';
        if (/^T/i.test(docNum)) continue; // skip trademarks
        const status = cells[2]?.textContent?.trim() || '';
        if (!/^active$/i.test(status)) continue;
        const entityName = cells[0].textContent.trim().toLowerCase().replace(/[^a-z0-9\s]/g, '');
        const nameScore = searchWords.filter(w => entityName.includes(w)).length;
        const href = new URL(link.getAttribute('href'), 'https://search.sunbiz.org').href;
        candidates.push({ href, entityName, nameScore });
      }

      console.log('[LeadScout] Active candidates:', candidates.map(c => `${c.entityName} (score:${c.nameScore})`));

      if (!candidates.length) {
        console.log('[LeadScout] No active candidates — leaving tab open');
        return;
      }

      // Only keep top-scoring matches
      const maxScore = Math.max(...candidates.map(c => c.nameScore));
      const top = maxScore > 0 ? candidates.filter(c => c.nameScore === maxScore) : candidates;
      console.log('[LeadScout] Top candidates:', top.map(c => c.entityName));

      // Fetch each top candidate's detail page and score address
      const scored = await Promise.all(top.map(async c => {
        try {
          const resp = await fetch(c.href, { credentials: 'include' });
          const html = await resp.text();
          const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').toLowerCase();
          let addrScore = 0;
          if (searchCity && text.includes(searchCity)) addrScore += 3;
          if (searchZip  && text.includes(searchZip))  addrScore += 4;
          if (searchStreetNum && text.includes(searchStreetNum)) addrScore += 2;
          const ownerName = extractAgentName(html);
          console.log('[LeadScout]', c.entityName, '→ addrScore:', addrScore, '| owner:', ownerName);
          return { ...c, addrScore, totalScore: c.nameScore + addrScore, ownerName };
        } catch(e) {
          console.log('[LeadScout] Fetch failed:', c.entityName, e.message);
          return { ...c, addrScore: 0, totalScore: c.nameScore, ownerName: null };
        }
      }));

      scored.sort((a, b) => b.totalScore - a.totalScore);
      const winner = scored[0];
      console.log('[LeadScout] Winner:', winner?.entityName, '| owner:', winner?.ownerName);
      chrome.runtime.sendMessage({ type: 'sunbiz_result', name: winner?.ownerName || null });

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

    // Log a snippet around "Registered Agent" to see exact format
    const idx = text.indexOf('Registered Agent');
    if (idx >= 0) console.log('[LeadScout] Agent section:', JSON.stringify(text.slice(idx, idx + 200)));

    // Try various patterns — SunBiz formats differ
    const patterns = [
      /Registered Agent Name\s*&\s*Address\s+([A-Z][A-Z ,.']+(?:LLC|INC|CORP)?)\s/,
      /Registered Agent Name[^A-Z]{0,120}([A-Z]{2,}(?:,\s+[A-Z]{2,})+)/,
      /Registered Agent\s*:\s*([A-Z][A-Za-z ,.']+)/,
    ];
    let raw = null;
    for (const p of patterns) {
      const m = text.match(p);
      if (m?.[1]) { raw = m[1].trim(); break; }
    }

    // Fallback: officer names
    if (!raw) {
      const m2 = text.match(/(?:President|Manager|Director|Member|Authorized)\s+([A-Z]{2,},\s+[A-Z]{2,}(?:\s+[A-Z])?)/);
      if (m2?.[1]) raw = m2[1].trim();
    }

    if (!raw) return null;

    // Format "GARCIA, ALEJANDRO J" → "Alejandro J Garcia"
    const parts = raw.split(/,\s*/);
    if (parts.length < 2) return raw.replace(/\b\w/g, c => c.toUpperCase()).toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
    const cap = s => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
    const first = parts[1].trim().split(' ').map(w => w.length <= 1 ? w.toUpperCase() : cap(w)).join(' ');
    return first + ' ' + cap(parts[0].trim());
  }
})();
