// Injected into search.sunbiz.org pages

(function () {
  const url = window.location.href;

  // Step 1: ByAddress form — fill street from URL hash, let user click Search Now
  if (url.includes('ByAddress')) {
    const street = decodeURIComponent(window.location.hash.slice(1));
    if (!street) return;
    setTimeout(() => {
      const input = document.querySelector('input[name="searchTerm"], input[name="SearchTerm"], input#searchTerm, input[type="text"]');
      if (!input) return;
      input.value = street;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.focus();
      // Auto-submit after a short pause so user can see it
      setTimeout(() => {
        const btn = document.querySelector('input[type="submit"], button[type="submit"], button');
        if (btn) btn.click();
      }, 600);
    }, 800);
    return;
  }

  // Step 2: Results page — fetch first detail page behind the scenes, send name back
  if (url.includes('SearchResults')) {
    setTimeout(async () => {
      try {
        const link = document.querySelector('a[href*="SearchResultDetail"], a[href*="searchresultdetail"]');
        if (!link) {
          // No results — leave tab open so user can see; don't close
          chrome.runtime.sendMessage({ type: 'sunbiz_result', name: null });
          return;
        }
        const detailUrl = new URL(link.getAttribute('href'), 'https://search.sunbiz.org').href;
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

  // If search lands directly on a detail page
  if (url.includes('SearchResultDetail')) {
    setTimeout(() => {
      const name = extractAgentName(document.body.innerHTML);
      chrome.runtime.sendMessage({ type: 'sunbiz_result', name: name || null });
    }, 1500);
  }

  function extractAgentName(html) {
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const m = text.match(/Registered Agent Name[^A-Z]{0,80}([A-Z]{2,},\s+[A-Z]{2,}(?:\s+[A-Z])?)/);
    if (!m) return null;
    const raw = m[1].trim();
    const parts = raw.split(/,\s*/);
    if (parts.length < 2) return raw;
    const last = parts[0].trim();
    const first = parts[1].trim();
    const cap = s => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
    const firstWords = first.split(' ').map(w => w.length <= 1 ? w.toUpperCase() : cap(w)).join(' ');
    return firstWords + ' ' + cap(last);
  }
})();
