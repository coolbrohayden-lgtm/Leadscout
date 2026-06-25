(function () {
  if (!window.location.href.includes('ByAddress')) return;
  const street = decodeURIComponent(window.location.hash.slice(1));
  if (!street) return;
  setTimeout(() => {
    const input = document.querySelector('input[type="text"]');
    if (input) {
      input.value = street;
      input.focus();
    }
  }, 600);
})();
