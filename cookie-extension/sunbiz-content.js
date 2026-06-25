(function () {
  const url = window.location.href;
  const val = decodeURIComponent(window.location.hash.slice(1));
  if (!val) return;

  if (url.includes('ByName') || url.includes('ByAddress')) {
    setTimeout(() => {
      const input = document.querySelector('input[type="text"]');
      if (input) {
        input.value = val;
        input.focus();
      }
    }, 600);
  }
})();
