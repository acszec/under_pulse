const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("espelhoApi", {
  getSources: () => ipcRenderer.invoke("espelho-get-sources"),
  close:      () => ipcRenderer.send("espelho-close"),
  minimize:   () => ipcRenderer.send("espelho-minimize"),
});
