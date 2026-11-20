// Burrow service worker. Kept deliberately small: it holds no state in memory
// (Chrome stops idle workers) and makes no network requests.

// Open the side panel when the toolbar icon is clicked.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((err: unknown) => {
  console.error('Burrow: could not set side panel behavior', err);
});
