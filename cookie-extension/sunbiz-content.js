// Injected into search.sunbiz.org pages
// Opens directly on SearchResults page, fetches detail page, extracts registered agent name

(function () {
  const url = window.location.href;

  // Results page — fetch the first detail page directly (no navigation needed)
  if (url.includes('SearchResults')) {
    setTimeout(async () => {
      try {
        const link = document.querySelector('a[href*="SearchResultDetail"], a[href*="searchresultdetail"]');
        if (!link) {
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
    }, 1500);
    return;
  }

  // If search returns only one result it lands directly on the detail page
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
