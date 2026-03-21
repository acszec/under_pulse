async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function injectAndSend(tabId, action) {
  // injeta o content script (se já estiver carregado o guard interno impede duplicata)
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"]
    });
  } catch (_) {}

  // pequeno delay para garantir que o listener está pronto
  await new Promise(r => setTimeout(r, 80));

  chrome.tabs.sendMessage(tabId, { action });
}

document.getElementById("btnSelect").addEventListener("click", async () => {
  const tab = await getActiveTab();
  if (!tab?.id) return;
  await injectAndSend(tab.id, "startSelect");
  window.close();
});

document.getElementById("btnStop").addEventListener("click", async () => {
  const tab = await getActiveTab();
  if (!tab?.id) return;
  await injectAndSend(tab.id, "stopPip");
  window.close();
});
