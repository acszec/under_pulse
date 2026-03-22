const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("graficoApi", {
  onDados: (callback) => {
    const handler = (_e, dados) => callback(dados);
    ipcRenderer.removeAllListeners("grafico-dados");
    ipcRenderer.on("grafico-dados", handler);
  },

  onReset: (callback) => {
    const handler = () => callback();
    ipcRenderer.removeAllListeners("grafico-reset");
    ipcRenderer.on("grafico-reset", handler);
  },

  onOddExtensao: (callback) =>
    ipcRenderer.on("odd-extensao", (_e, value) => callback(value)),
});