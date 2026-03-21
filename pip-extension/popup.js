async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

document.getElementById("btnSelect").addEventListener("click", async () => {
  const tab = await getActiveTab();
  if (!tab?.id) return;
  chrome.tabs.sendMessage(tab.id, { action: "startSelect" });
  window.close();
});

document.getElementById("btnStop").addEventListener("click", async () => {
  const tab = await getActiveTab();
  if (!tab?.id) return;
  chrome.tabs.sendMessage(tab.id, { action: "stopPip" });
  window.close();
});
