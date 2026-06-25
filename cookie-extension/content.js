// Content script injected into localhost:3000
// Bridges window.postMessage from the LeadScout page to the extension background worker

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const msg = event.data;
  if (!msg) return;

  // Page is pinging to check if extension is alive
  if (msg.__leadscout_ext_ping) {
    window.postMessage({ __leadscout_ext_ready: true }, '*');
    return;
  }

  if (!msg.__leadscout_ext) return;

  chrome.runtime.sendMessage(msg, (response) => {
    if (chrome.runtime.lastError) {
      window.postMessage({
        __leadscout_ext_reply: true,
        id: msg.id,
        data: { error: 'sw_dead: ' + chrome.runtime.lastError.message },
      }, '*');
      return;
    }
    window.postMessage({
      __leadscout_ext_reply: true,
      id: msg.id,
      data: response,
    }, '*');
  });
});

// Also announce immediately in case page is already listening
window.postMessage({ __leadscout_ext_ready: true }, '*');

// Relay messages FROM background TO the page (e.g. context menu owner text)
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'owner_text') {
    window.postMessage({ __leadscout_owner_text: true, name: msg.name }, '*');
  }
});
