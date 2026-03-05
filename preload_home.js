const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("homeApi", {
  // ✅ busca lista de jogos ao vivo (retorna array)
  getInplay: () => ipcRenderer.invoke("home-get-inplay"),

  // (opcional) selecionar um jogo: só vai funcionar quando você implementar no main.js
  selectEvent: (data) => ipcRenderer.invoke("home-select-event", data),
});