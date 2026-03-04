const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {

  iniciarCaptura: (dados) =>
    ipcRenderer.send("iniciar-captura", dados),

  atualizarAcrescimos: (valor) =>
    ipcRenderer.send("atualizar-acrescimos", valor),

  onAtualizarDados: (callback) =>
    ipcRenderer.on("atualizar-dados", (event, dados) => callback(dados)),

  onErro: (callback) =>
    ipcRenderer.on("erro", (event, msg) => callback(msg))
});