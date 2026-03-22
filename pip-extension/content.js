(() => {
  if (window.__underPulsePipLoaded) return;
  window.__underPulsePipLoaded = true;

  let highlighted = null;
  let selectedEl  = null;
  let pipWin      = null;
  let pipImg      = null;
  let updateTimer = null;
  let isSelecting = false;

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

  // ── Captura screenshot do elemento via background ──────
  // context: quantas vezes maior que o elemento capturar ao redor (>1 = zoom out)
  function captureElement(el, context = 2) {
    return new Promise((resolve) => {
      const rect = el.getBoundingClientRect();
      const dpr  = window.devicePixelRatio || 1;

      const padW = rect.width  * (context - 1) / 2;
      const padH = rect.height * (context - 1) / 2;
      const cx   = Math.max(0, rect.left - padW);
      const cy   = Math.max(0, rect.top  - padH);
      const cw   = rect.width  * context;
      const ch   = rect.height * context;

      chrome.runtime.sendMessage({ action: "captureTab" }, (res) => {
        if (!res?.dataUrl) return resolve(null);

        const img = new Image();
        img.onload = () => {
          const c   = document.createElement("canvas");
          c.width   = Math.round(cw * dpr);
          c.height  = Math.round(ch * dpr);
          const ctx = c.getContext("2d");
          ctx.drawImage(
            img,
            Math.round(cx * dpr),
            Math.round(cy * dpr),
            c.width, c.height,
            0, 0, c.width, c.height
          );
          resolve(c.toDataURL());
        };
        img.onerror = () => resolve(null);
        img.src = res.dataUrl;
      });
    });
  }

  // ── Inicia Document PiP ────────────────────────────────
  async function startPip() {
    if (!window.documentPictureInPicture) {
      alert("Seu Chrome não suporta Document PiP. Atualize para a versão 116 ou superior.");
      return;
    }

    const el   = selectedEl;
    const rect = el.getBoundingClientRect();
    stopPip();
    selectedEl = el;
    const SCALE = 1.0;
    const pipW  = Math.max(Math.round(rect.width)  || 220, 120) * SCALE;
    const pipH  = Math.max(Math.round(rect.height) || 80,  40)  * SCALE;

    try {
      pipWin = await window.documentPictureInPicture.requestWindow({
        width:  pipW,
        height: pipH
      });
    } catch (err) {
      console.error("[Under Pulse PiP]", err.message);
      return;
    }

    const style = pipWin.document.createElement("style");
    style.textContent = `
      * { margin:0; padding:0; box-sizing:border-box; }
      html, body {
        width:100%; height:100%;
        background:#0f0f0f;
        display:flex; align-items:center; justify-content:center;
        overflow:hidden;
      }
      img {
        width:100%; height:100%;
        object-fit:fill;
        image-rendering:crisp-edges;
      }
    `;
    pipWin.document.head.appendChild(style);

    pipImg = pipWin.document.createElement("img");
    pipWin.document.body.appendChild(pipImg);

    await updatePip();

    updateTimer = setInterval(updatePip, 1500);
    pipWin.addEventListener("pagehide", stopPip);
  }

  // ── Envia valor de texto para o app Electron ──────────
  function sendOddToApp(el) {
    const text = (el.innerText || el.textContent || "").trim();
    if (!text) return;
    fetch("http://localhost:9999/odd", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: text }),
    }).catch(() => {});
  }

  // ── Atualiza imagem no PiP ─────────────────────────────
  async function updatePip() {
    if (!pipImg || !selectedEl) return;
    sendOddToApp(selectedEl);
    const dataUrl = await captureElement(selectedEl);
    if (dataUrl && pipImg) pipImg.src = dataUrl;
  }

  // ── Para PiP ───────────────────────────────────────────
  function stopPip() {
    if (updateTimer) { clearInterval(updateTimer); updateTimer = null; }
    if (pipWin)      { try { pipWin.close(); } catch (_) {} pipWin = null; }
    pipImg     = null;
    selectedEl = null;
  }

  // ── Mensagens do popup ──────────────────────────────────
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === "startSelect") enterSelectMode();
    if (msg.action === "stopPip")     stopPip();
  });
})();
