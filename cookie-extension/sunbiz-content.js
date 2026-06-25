// Injected into search.sunbiz.org pages

(function () {
  const url = window.location.href;

  // Step 1: ByAddress form — fill in the street from URL hash and submit
  if (url.includes('ByAddress')) {
    const street = decodeURIComponent(window.location.hash.slice(1));
    if (!street) return;
    setTimeout(() => {
      const input = document.querySelector('input[name="searchTerm"], input[name="SearchTerm"], input#searchTerm, input[type="text"]');
      if (!input) { chrome.runtime.sendMessage({ type: 'sunbiz_result', name: null }); return; }
      input.value = street;
      const form = input.closest('form') || document.querySelector('form');
      if (form) form.submit();
      else {
        const btn = document.querySelector('input[type="submit"], button[type="submit"], button');
        if (btn) btn.click();
      }
    }, 800);
    return;
  }

  // Step 2: Results page — fetch the first detail page directly (no navigation)
  if (url.includes('SearchResults')) {
    setTimeout(async () => {
      try {
        // Find the first result link
        const link = document.querySelector('a[href*="SearchResultDetail"], a[href*="searchresultdetail"]');
        if (!link) {
          chrome.runtime.sendMessage({ type: 'sunbiz_result', name: null });
          return;
        }
        const detailUrl = new URL(link.href, 'https://search.sunbiz.org').href;

        // Fetch the detail page HTML directly (no navigation, tab stays put)
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

  // Step 3: If we land directly on a detail page (single-result search)
  if (url.includes('SearchResultDetail')) {
    setTimeout(() => {
      const name = extractAgentName(document.body.innerHTML);
      chrome.runtime.sendMessage({ type: 'sunbiz_result', name: name || null });
    }, 1500);
  }

  function extractAgentName(html) {
    // Remove tags for text-based matching
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

    // Pattern: "Registered Agent Name" followed by ALL-CAPS "LASTNAME, FIRSTNAME"
    const m = text.match(/Registered Agent Name[^A-Z]{0,60}([A-Z]{2,},\s+[A-Z]{2,}(?:\s+[A-Z])?)/);
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
