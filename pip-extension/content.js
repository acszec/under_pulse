(() => {
  let pipVideo    = null;
  let pipCanvas   = null;
  let pipCtx      = null;
  let selectedEl  = null;
  let observer    = null;
  let updateTimer = null;
  let isSelecting = false;

  // ── Modo de seleção de elemento ────────────────────────
  function enterSelectMode() {
    if (isSelecting) return;
    isSelecting = true;

    // aviso visual no topo da página
    const banner = document.createElement("div");
    banner.id = "__pip_banner__";
    banner.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; z-index: 2147483647;
      background: rgba(255,170,0,.92); color: #111; font-family: Arial, sans-serif;
      font-size: 13px; font-weight: bold; text-align: center;
      padding: 8px; pointer-events: none; letter-spacing: .3px;
    `;
    banner.textContent = "Under Pulse PiP — Clique no elemento que deseja monitorar  •  ESC para cancelar";
    document.body.appendChild(banner);

    // overlay transparente para interceptar cliques
    const overlay = document.createElement("div");
    overlay.id = "__pip_overlay__";
    overlay.style.cssText = `
      position: fixed; inset: 0; z-index: 2147483646;
      cursor: crosshair; background: transparent;
    `;
    document.body.appendChild(overlay);

    let highlighted = null;

    function highlight(el) {
      if (highlighted && highlighted !== el) {
        highlighted.style.outline    = highlighted.__pipOldOutline    ?? "";
        highlighted.style.background = highlighted.__pipOldBackground ?? "";
        delete highlighted.__pipOldOutline;
        delete highlighted.__pipOldBackground;
      }
      if (el && el !== overlay && el !== banner) {
        highlighted = el;
        highlighted.__pipOldOutline    = highlighted.style.outline;
        highlighted.__pipOldBackground = highlighted.style.background;
        highlighted.style.outline      = "2px solid rgba(255,170,0,.95)";
        highlighted.style.background   = "rgba(255,170,0,.12)";
      }
    }

    function clearHighlight() {
      if (highlighted) {
        highlighted.style.outline    = highlighted.__pipOldOutline    ?? "";
        highlighted.style.background = highlighted.__pipOldBackground ?? "";
        delete highlighted.__pipOldOutline;
        delete highlighted.__pipOldBackground;
        highlighted = null;
      }
    }

    overlay.addEventListener("mousemove", e => {
      overlay.style.pointerEvents = "none";
      const el = document.elementFromPoint(e.clientX, e.clientY);
      overlay.style.pointerEvents = "auto";
      highlight(el);
    });

    overlay.addEventListener("click", async e => {
      e.preventDefault();
      e.stopPropagation();

      overlay.style.pointerEvents = "none";
      const el = document.elementFromPoint(e.clientX, e.clientY);
      overlay.style.pointerEvents = "auto";

      clearHighlight();
      overlay.remove();
      banner.remove();
      isSelecting = false;

      if (el) await startPip(el);
    });

    function onEsc(e) {
      if (e.key !== "Escape") return;
      clearHighlight();
      overlay.remove();
      banner.remove();
      isSelecting = false;
      document.removeEventListener("keydown", onEsc);
    }
    document.addEventListener("keydown", onEsc);
  }

  // ── Inicia o Picture-in-Picture ────────────────────────
  async function startPip(el) {
    selectedEl = el;

    // encerra PiP anterior
    stopPip();

    // canvas com as dimensões do PiP
    pipCanvas        = document.createElement("canvas");
    pipCanvas.width  = 320;
    pipCanvas.height = 100;
    pipCtx           = pipCanvas.getContext("2d");

    // vídeo oculto alimentado pelo canvas
    pipVideo              = document.createElement("video");
    pipVideo.srcObject    = pipCanvas.captureStream(15);
    pipVideo.muted        = true;
    pipVideo.style.cssText = "position:fixed;width:1px;height:1px;opacity:0.01;pointer-events:none;top:0;left:0;";
    document.body.appendChild(pipVideo);

    renderCanvas();

    try {
      await pipVideo.play();
      await pipVideo.requestPictureInPicture();
    } catch (err) {
      console.warn("[Under Pulse PiP] Erro ao iniciar PiP:", err.message);
      pipVideo.remove();
      pipVideo = null;
      return;
    }

    // atualiza canvas a cada 250ms
    updateTimer = setInterval(() => renderCanvas(), 250);

    // MutationObserver como reforço
    observer = new MutationObserver(() => renderCanvas());
    observer.observe(el, { childList: true, subtree: true, characterData: true });

    pipVideo.addEventListener("leavepictureinpicture", stopPip);
  }

  // ── Para e limpa o PiP ─────────────────────────────────
  function stopPip() {
    if (updateTimer)  { clearInterval(updateTimer); updateTimer = null; }
    if (observer)     { observer.disconnect(); observer = null; }
    if (pipVideo)     { pipVideo.remove(); pipVideo = null; }
    if (document.pictureInPictureElement) {
      document.exitPictureInPicture().catch(() => {});
    }
    pipCanvas  = null;
    pipCtx     = null;
    selectedEl = null;
  }

  // ── Renderiza o texto no canvas ────────────────────────
  function renderCanvas() {
    if (!pipCtx || !selectedEl) return;

    const text = (selectedEl.textContent ?? "").trim().replace(/\s+/g, " ");
    const w = pipCanvas.width;
    const h = pipCanvas.height;

    // fundo escuro
    pipCtx.fillStyle = "#0f0f0f";
    pipCtx.fillRect(0, 0, w, h);

    // borda mostarda
    pipCtx.strokeStyle = "rgba(255,170,0,.45)";
    pipCtx.lineWidth = 2;
    pipCtx.strokeRect(1, 1, w - 2, h - 2);

    // texto em mostarda — ajusta tamanho para caber
    pipCtx.textAlign    = "center";
    pipCtx.textBaseline = "middle";
    pipCtx.fillStyle    = "#ffaa00";

    let size = 62;
    pipCtx.font = `bold ${size}px Arial`;
    while (pipCtx.measureText(text).width > w - 24 && size > 10) {
      size -= 2;
      pipCtx.font = `bold ${size}px Arial`;
    }

    pipCtx.fillText(text, w / 2, h / 2);
  }

  // ── Mensagens vindas do popup ──────────────────────────
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === "startSelect") enterSelectMode();
    if (msg.action === "stopPip")     stopPip();
  });

})();
