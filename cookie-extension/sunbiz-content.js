// Injected into search.sunbiz.org pages
// ByAddress form → fill + submit → results list → click first → detail → extract name → send back

(function () {
  const url = window.location.href;

  // Step 1: Address search form — read street from URL hash, fill form, submit
  if (url.includes('ByAddress')) {
    const street = decodeURIComponent(window.location.hash.slice(1));
    if (!street) return;
    setTimeout(() => {
      const input = document.querySelector('input[name="searchTerm"], input[name="SearchTerm"], input#searchTerm, input[type="text"]');
      if (!input) {
        chrome.runtime.sendMessage({ type: 'sunbiz_result', name: null });
        return;
      }
      input.value = street;
      const form = input.closest('form') || document.querySelector('form');
      if (form) {
        form.submit();
      } else {
        const btn = document.querySelector('input[type="submit"], button[type="submit"], button');
        if (btn) btn.click();
      }
    }, 800);
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
      const allText = document.body.innerText;

      // Pattern: "Registered Agent Name" label followed by ALL-CAPS name on next line
      const m1 = allText.match(/Registered Agent Name[^\n]*\n\s*([A-Z]{2,}[A-Z,\s.]+)/);
      if (m1) agentName = m1[1].trim().split('\n')[0].trim();

      // Fallback: scan elements for ALL-CAPS "LASTNAME, FIRSTNAME" near the label
      if (!agentName) {
        const els = document.querySelectorAll('td, span, div, p');
        for (let i = 0; i < els.length; i++) {
          if (/Registered Agent Name/i.test(els[i].textContent)) {
            for (let j = i + 1; j < Math.min(i + 8, els.length); j++) {
              const txt = els[j].textContent.trim();
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
