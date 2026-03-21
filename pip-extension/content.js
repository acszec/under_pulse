(() => {
  if (window.__underPulsePipLoaded) return;
  window.__underPulsePipLoaded = true;

  let highlighted  = null;
  let selectedEl   = null;
  let pipVideo     = null;
  let pipCanvas    = null;
  let pipCtx       = null;
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

    // ── highlight: mouseover/mouseout direto no document ──
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

    // ── clique captura o elemento ──
    function onClick(e) {
      e.preventDefault();
      e.stopImmediatePropagation();

      // limpa estado de seleção
      cleanup(false);

      // salva elemento e inicia PiP ainda dentro do gesto do usuário
      selectedEl = e.target;
      startPip();
    }

    function onKey(e) {
      if (e.key === "Escape") cleanup(true);
    }

    function cleanup(full) {
      isSelecting = false;
      document.body.style.cursor = "";
      if (highlighted) {
        highlighted.style.outline = highlighted._pipOld ?? "";
        delete highlighted._pipOld;
        highlighted = null;
      }
      banner.remove();
      document.removeEventListener("mouseover", onOver, true);
      document.removeEventListener("mouseout",  onOut,  true);
      document.removeEventListener("click",     onClick, true);
      document.removeEventListener("keydown",   onKey,   true);
    }

    document.addEventListener("mouseover", onOver,  true);
    document.addEventListener("mouseout",  onOut,   true);
    document.addEventListener("click",     onClick, true);
    document.addEventListener("keydown",   onKey,   true);
  }

  // ── Inicia PiP ─────────────────────────────────────────
  function startPip() {
    stopPip();

    pipCanvas        = document.createElement("canvas");
    pipCanvas.width  = 320;
    pipCanvas.height = 100;
    pipCtx           = pipCanvas.getContext("2d");
    renderCanvas();

    pipVideo              = document.createElement("video");
    pipVideo.srcObject    = pipCanvas.captureStream(15);
    pipVideo.muted        = true;
    pipVideo.style.cssText = `
      position:fixed;top:-2px;left:-2px;
      width:1px;height:1px;opacity:0.01;pointer-events:none;
    `;
    document.body.appendChild(pipVideo);

    // play → requestPictureInPicture em cadeia .then para manter o gesto do usuário
    pipVideo.play()
      .then(() => pipVideo.requestPictureInPicture())
      .catch(err => console.warn("[Under Pulse PiP]", err.message));

    updateTimer = setInterval(renderCanvas, 300);

    observer = new MutationObserver(renderCanvas);
    observer.observe(selectedEl, { childList: true, subtree: true, characterData: true });

    pipVideo.addEventListener("leavepictureinpicture", stopPip);
  }

  // ── Para PiP ───────────────────────────────────────────
  function stopPip() {
    if (updateTimer) { clearInterval(updateTimer); updateTimer = null; }
    if (observer)    { observer.disconnect(); observer = null; }
    if (pipVideo)    { pipVideo.remove(); pipVideo = null; }
    if (document.pictureInPictureElement) {
      document.exitPictureInPicture().catch(() => {});
    }
    pipCanvas  = null;
    pipCtx     = null;
    selectedEl = null;
  }

  // ── Renderiza canvas ────────────────────────────────────
  function renderCanvas() {
    if (!pipCtx || !selectedEl) return;
    const text = (selectedEl.textContent || "").trim().replace(/\s+/g, " ");
    const w = 320, h = 100;

    pipCtx.fillStyle = "#0f0f0f";
    pipCtx.fillRect(0, 0, w, h);

    pipCtx.strokeStyle = "rgba(255,170,0,.4)";
    pipCtx.lineWidth   = 2;
    pipCtx.strokeRect(1, 1, w - 2, h - 2);

    pipCtx.fillStyle    = "#ffaa00";
    pipCtx.textAlign    = "center";
    pipCtx.textBaseline = "middle";

    let size = 64;
    pipCtx.font = `bold ${size}px Arial`;
    while (pipCtx.measureText(text).width > w - 24 && size > 10) {
      size -= 2;
      pipCtx.font = `bold ${size}px Arial`;
    }
    pipCtx.fillText(text, w / 2, h / 2);
  }

  // ── Mensagens do popup ──────────────────────────────────
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === "startSelect") enterSelectMode();
    if (msg.action === "stopPip")     stopPip();
  });
})();
