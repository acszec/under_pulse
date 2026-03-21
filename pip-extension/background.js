chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "captureTab") {
    chrome.tabs.captureVisibleTab(
      sender.tab.windowId,
      { format: "png" },
      (dataUrl) => sendResponse({ dataUrl: dataUrl || null })
    );
    return true; // resposta assíncrona
  }
});
