// Injected into search.sunbiz.org pages
// On a results list: auto-clicks the first result
// On a detail page: extracts the registered agent name and sends it back to LeadScout

(function () {
  const url = window.location.href;

  // Results list page — click the first corporation link
  if (url.includes('SearchResults')) {
    setTimeout(() => {
      const link = document.querySelector('a[href*="SearchResultDetail"]');
      if (link) {
        link.click();
      } else {
        // No results found — report back
        chrome.runtime.sendMessage({ type: 'sunbiz_result', name: null, notFound: true });
      }
    }, 1200);
    return;
  }

  // Detail page — extract registered agent name
  if (url.includes('SearchResultDetail')) {
    setTimeout(() => {
      let agentName = null;

      // SunBiz detail page uses a span-based layout
      // "Registered Agent Name & Address" label followed by the name
      const spans = document.querySelectorAll('span');
      for (let i = 0; i < spans.length; i++) {
        if (/Registered Agent Name/i.test(spans[i].textContent)) {
          // Name is usually the next non-empty span
          for (let j = i + 1; j < Math.min(i + 6, spans.length); j++) {
            const txt = spans[j].textContent.trim();
            if (txt && /^[A-Z]{2,}/.test(txt) && !/address|agent|name/i.test(txt)) {
              agentName = txt;
              break;
            }
          }
          break;
        }
      }

      // Fallback: scan page text for ALL-CAPS "LASTNAME, FIRSTNAME" pattern near "Registered Agent"
      if (!agentName) {
        const text = document.body.innerText;
        const m = text.match(/Registered Agent Name[^\n]*\n+([A-Z]{2,},\s+[A-Z]{2,}(?:\s+[A-Z])?)/);
        if (m) agentName = m[1].trim();
      }

      // Format "GARCIA, ALEJANDRO J" → "Alejandro J Garcia"
      if (agentName) {
        const parts = agentName.split(/,\s*/);
        if (parts.length >= 2) {
          const last = parts[0].trim();
          const first = parts[1].trim();
          const cap = s => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
          const firstWords = first.split(' ').map(w => w.length <= 1 ? w.toUpperCase() : cap(w)).join(' ');
          agentName = firstWords + ' ' + cap(last);
        }
      }

      chrome.runtime.sendMessage({ type: 'sunbiz_result', name: agentName || null });
    }, 1500);
  }
})();
