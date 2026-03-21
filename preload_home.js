const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("homeApi", {
  // ✅ busca lista de jogos ao vivo (retorna array)
  getInplay: () => ipcRenderer.invoke("home-get-inplay"),

  // ✅ inicia captura a partir da seleção feita na home
  startCapture: (data) => ipcRenderer.invoke("home-start-capture", data),

  // ✅ abre/foca janela de login do Layback
  openLaybackLogin: () => ipcRenderer.invoke("home-open-layback-login"),

  // ✅ abre espelho de tela (always on top)
  openEspelho: () => ipcRenderer.invoke("home-open-espelho"),
});
