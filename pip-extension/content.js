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

    // pré-cria e pré-toca o vídeo ANTES do clique do usuário
    setupVideo();

    const banner = document.createElement("div");
    banner.id = "__pip_banner__";
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

      // limpa highlight
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

      // vídeo já está tocando — só precisa chamar requestPictureInPicture
      selectedEl = e.target;
      renderCanvas();

      pipVideo.requestPictureInPicture()
        .then(() => {
          // inicia updates após PiP aberto
          updateTimer = setInterval(renderCanvas, 300);
          if (selectedEl instanceof Node) {
            observer = new MutationObserver(renderCanvas);
            observer.observe(selectedEl, { childList: true, subtree: true, characterData: true });
          }
        })
        .catch(err => console.error("[Under Pulse PiP]", err.message));
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
      stopPip();
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

  // ── Pré-cria e toca o vídeo ────────────────────────────
  function setupVideo() {
    if (pipVideo && !pipVideo.paused) return; // já está tocando

    pipCanvas        = document.createElement("canvas");
    pipCanvas.width  = 640;
    pipCanvas.height = 80;
    pipCtx = pipCanvas.getContext("2d");

    // placeholder inicial
    pipCtx.fillStyle = "#0f0f0f";
    pipCtx.fillRect(0, 0, 320, 100);

    pipVideo              = document.createElement("video");
    pipVideo.srcObject    = pipCanvas.captureStream(15);
    pipVideo.muted        = true;
    pipVideo.style.cssText = `
      position:fixed;top:-2px;left:-2px;
      width:1px;height:1px;opacity:0.01;pointer-events:none;
    `;
    document.body.appendChild(pipVideo);

    pipVideo.play().catch(err => console.warn("[Under Pulse PiP] play():", err.message));
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
    if (!pipCtx) return;
    const text = selectedEl
      ? (selectedEl.textContent || "").trim().replace(/\s+/g, " ")
      : "";
    const w = 640, h = 80;

    pipCtx.fillStyle = "#0f0f0f";
    pipCtx.fillRect(0, 0, w, h);

    pipCtx.strokeStyle = "rgba(255,170,0,.4)";
    pipCtx.lineWidth   = 2;
    pipCtx.strokeRect(1, 1, w - 2, h - 2);

    if (!text) return;

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
