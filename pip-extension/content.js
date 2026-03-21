(() => {
  if (window.__underPulsePipLoaded) return;
  window.__underPulsePipLoaded = true;

  let highlighted  = null;
  let selectedEl   = null;
  let pipWin       = null;
  let pipEl        = null;
  let updateTimer  = null;
  let observer     = null;
  let isSelecting  = false;

  // ── Modo seleção ───────────────────────────────────────
  function enterSelectMode() {
    if (isSelecting) return;
    isSelecting = true;
    document.body.style.cursor = "crosshair";

    const banner = document.createElement("div");
    banner.style.cssText = `
      position:fixed;top:0;left:0;right:0;z-index:2147483647;
      background:rgba(255,170,0,.95);color:#111;font-family:Arial,sans-serif;
      font-size:13px;font-weight:bold;text-align:center;padding:9px;
      pointer-events:none;letter-spacing:.3px;
    `;
    banner.textContent = "Under Pulse PiP — Clique no elemento desejado  •  ESC para cancelar";
    document.body.appendChild(banner);

    function onOver(e) {
      if (highlighted && highlighted !== e.target) {
        highlighted.style.outline = highlighted._pipOld ?? "";
        delete highlighted._pipOld;
      }
      highlighted = e.target;
      highlighted._pipOld = highlighted.style.outline;
      highlighted.style.outline = "3px solid #ffaa00";
    }

    function onOut(e) {
      if (e.target !== highlighted) return;
      e.target.style.outline = e.target._pipOld ?? "";
      delete e.target._pipOld;
      highlighted = null;
    }

    function onClick(e) {
      e.preventDefault();
      e.stopImmediatePropagation();

      if (highlighted) {
        highlighted.style.outline = highlighted._pipOld ?? "";
        delete highlighted._pipOld;
        highlighted = null;
      }
      banner.remove();
      document.body.style.cursor = "";
      isSelecting = false;
      document.removeEventListener("mouseover", onOver,  true);
      document.removeEventListener("mouseout",  onOut,   true);
      document.removeEventListener("click",     onClick, true);
      document.removeEventListener("keydown",   onKey,   true);

      selectedEl = e.target;
      startPip();
    }

    function onKey(e) {
      if (e.key !== "Escape") return;
      banner.remove();
      document.body.style.cursor = "";
      isSelecting = false;
      if (highlighted) {
        highlighted.style.outline = highlighted._pipOld ?? "";
        delete highlighted._pipOld;
        highlighted = null;
      }
      document.removeEventListener("mouseover", onOver,  true);
      document.removeEventListener("mouseout",  onOut,   true);
      document.removeEventListener("click",     onClick, true);
      document.removeEventListener("keydown",   onKey,   true);
    }

    document.addEventListener("mouseover", onOver,  true);
    document.addEventListener("mouseout",  onOut,   true);
    document.addEventListener("click",     onClick, true);
    document.addEventListener("keydown",   onKey,   true);
  }

  // ── Inicia Document PiP ────────────────────────────────
  async function startPip() {
    stopPip();

    if (!window.documentPictureInPicture) {
      alert("Seu Chrome não suporta Document PiP. Atualize para a versão 116 ou superior.");
      return;
    }

    try {
      pipWin = await window.documentPictureInPicture.requestWindow({
        width:  200,
        height: 60
      });
    } catch (err) {
      console.error("[Under Pulse PiP]", err.message);
      return;
    }

    // estilos da janela PiP
    const style = pipWin.document.createElement("style");
    style.textContent = `
      * { margin:0; padding:0; box-sizing:border-box; }
      html, body {
        width:100%; height:100%;
        background:#0f0f0f;
        display:flex; align-items:center; justify-content:center;
        overflow:hidden;
      }
      #val {
        color:#ffaa00;
        font-family:Arial,sans-serif;
        font-weight:bold;
        font-size:10vw;
        white-space:nowrap;
        padding:0 6px;
        border:1px solid rgba(255,170,0,.35);
        border-radius:4px;
        max-width:100%;
        overflow:hidden;
        text-overflow:ellipsis;
      }
    `;
    pipWin.document.head.appendChild(style);

    pipEl = pipWin.document.createElement("div");
    pipEl.id = "val";
    pipWin.document.body.appendChild(pipEl);

    updatePip();

    updateTimer = setInterval(updatePip, 300);

    if (selectedEl instanceof Node) {
      observer = new MutationObserver(updatePip);
      observer.observe(selectedEl, { childList: true, subtree: true, characterData: true });
    }

    pipWin.addEventListener("pagehide", stopPip);
  }

  function updatePip() {
    if (!pipEl || !selectedEl) return;
    pipEl.textContent = (selectedEl.textContent || "").trim().replace(/\s+/g, " ");
  }

  // ── Para PiP ───────────────────────────────────────────
  function stopPip() {
    if (updateTimer) { clearInterval(updateTimer); updateTimer = null; }
    if (observer)    { observer.disconnect(); observer = null; }
    if (pipWin)      { try { pipWin.close(); } catch (_) {} pipWin = null; }
    pipEl      = null;
    selectedEl = null;
  }

  // ── Mensagens do popup ──────────────────────────────────
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === "startSelect") enterSelectMode();
    if (msg.action === "stopPip")     stopPip();
  });
})();
