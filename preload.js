const { contextBridge, ipcRenderer, clipboard } = require("electron");

contextBridge.exposeInMainWorld("api", {
  iniciarCaptura: (dados) => ipcRenderer.send("iniciar-captura", dados),
  atualizarAcrescimos: (valor) => ipcRenderer.send("atualizar-acrescimos", valor),
  getSources: () => ipcRenderer.invoke("espelho-get-sources"),

  onAtualizarDados: (callback) =>
    ipcRenderer.on("atualizar-dados", (_event, dados) => callback(dados)),

  onErro: (callback) =>
    ipcRenderer.on("erro", (_event, msg) => callback(msg)),
});

// =====================================================
// ✅ PASTE FIX (macOS + Windows) — não depende de "paste"
// =====================================================
function insertTextIntoActiveInput(text) {
  const el = document.activeElement;
  if (!el) return;
  const tag = (el.tagName || "").toUpperCase();

  if (tag !== "INPUT" && tag !== "TEXTAREA") return;
  if (el.readOnly || el.disabled) return;

  const start = Number.isFinite(el.selectionStart) ? el.selectionStart : el.value.length;
  const end = Number.isFinite(el.selectionEnd) ? el.selectionEnd : el.value.length;

  el.value = el.value.slice(0, start) + text + el.value.slice(end);

  const pos = start + text.length;
  try { el.setSelectionRange(pos, pos); } catch (_) {}

  // dispara input para qualquer listener reagir
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

window.addEventListener("DOMContentLoaded", () => {
  // 1) Ctrl/Cmd+V via keydown (mais confiável)
  document.addEventListener(
    "keydown",
    (e) => {
      const isMac = process.platform === "darwin";
      const isPaste =
        (isMac && e.metaKey && !e.ctrlKey && e.key.toLowerCase() === "v") ||
        (!isMac && e.ctrlKey && !e.metaKey && e.key.toLowerCase() === "v");

      if (!isPaste) return;

      const text = clipboard.readText();
      if (!text) return;

      e.preventDefault();
      e.stopPropagation();
      insertTextIntoActiveInput(text);
    },
    true // capture
  );

  // 2) Se o evento "paste" existir, também cobre
  document.addEventListener(
    "paste",
    (e) => {
      const text = clipboard.readText();
      if (!text) return;

      e.preventDefault();
      e.stopPropagation();
      insertTextIntoActiveInput(text);
    },
    true
  );
});