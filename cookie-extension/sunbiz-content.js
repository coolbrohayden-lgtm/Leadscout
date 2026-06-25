// Injected into search.sunbiz.org pages
// ByAddress form → fill + submit → results list → click first → detail → extract name → send back

(function () {
  const url = window.location.href;

  // Step 1: Address search form — fill in the street and submit
  if (url.includes('ByAddress')) {
    chrome.storage.session.get('sunbiz_street', ({ sunbiz_street }) => {
      if (!sunbiz_street) return;
      setTimeout(() => {
        // Find the search input — SunBiz uses name="searchTerm" or similar
        const input = document.querySelector('input[name="searchTerm"], input[name="SearchTerm"], input#searchTerm, input[type="text"]');
        if (!input) {
          chrome.runtime.sendMessage({ type: 'sunbiz_result', name: null });
          return;
        }
        input.value = sunbiz_street;
        // Submit the form
        const form = input.closest('form') || document.querySelector('form');
        if (form) {
          form.submit();
        } else {
          const btn = document.querySelector('input[type="submit"], button[type="submit"], button');
          if (btn) btn.click();
        }
      }, 800);
    });
    return;
  }

  // Step 2: Results list — click the first corporation link
  if (url.includes('SearchResults')) {
    setTimeout(() => {
      const link = document.querySelector('a[href*="SearchResultDetail"]');
      if (link) {
        link.click();
      } else {
        chrome.runtime.sendMessage({ type: 'sunbiz_result', name: null });
      }
    }, 1200);
    return;
  }

  // Step 3: Detail page — extract registered agent name
  if (url.includes('SearchResultDetail')) {
    setTimeout(() => {
      let agentName = null;

      // SunBiz detail page: find "Registered Agent Name & Address" label, then read the next content
      const allText = document.body.innerText;

      // Pattern: label on one line, name on next line in ALL-CAPS
      const m1 = allText.match(/Registered Agent Name[^\n]*\n\s*([A-Z]{2,}[A-Z,\s.]+)/);
      if (m1) agentName = m1[1].trim().split('\n')[0].trim();

      // Fallback: scan table cells
      if (!agentName) {
        const cells = document.querySelectorAll('td, span, div');
        for (let i = 0; i < cells.length; i++) {
          if (/Registered Agent Name/i.test(cells[i].textContent)) {
            for (let j = i + 1; j < Math.min(i + 8, cells.length); j++) {
              const txt = cells[j].textContent.trim();
              if (txt && /^[A-Z]{2,},\s+[A-Z]/.test(txt)) {
                agentName = txt;
                break;
              }
            }
            if (agentName) break;
          }
        }
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
