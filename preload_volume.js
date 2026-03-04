const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("volumeApi", {
  onBookDados: (callback) =>
    ipcRenderer.on("book-dados", (_event, dados) => callback(dados)),

  onReset: (callback) =>
    ipcRenderer.on("book-reset", () => callback())
});