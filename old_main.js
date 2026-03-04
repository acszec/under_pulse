const { app, BrowserWindow, ipcMain, Menu } = require("electron");
const path = require("path");

let painel;
let laybackWindow;
let tempoWindow;
let graficoWindow;
let volumeWindow;
let intervalId;

let acrescimosGlobal = 5;
let tempoBaseGlobal = 90;

// 🔹 HISTÓRICO GLOBAL
let historicoPorMinuto = {};
let historicoPercentual = [];
let ultimoPercentual = null;

/**
 * ✅ Menu cross-platform
 * - macOS: usa menus padrão (inclui Edit -> Copy/Paste, evita dores com atalhos)
 * - Windows/Linux: remove menu e deixa app clean (Ctrl+V continua funcionando)
 */
function setupAppMenu() {
  if (process.platform === "darwin") {
    // Menus padrão do macOS (inclui Edit menu, Window menu, etc.)
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        { role: "appMenu" },
        { role: "editMenu" },   // ✅ ESSENCIAL para ⌘V/⌘C etc.
        { role: "viewMenu" },
        { role: "windowMenu" }
      ])
    );
  } else {
    Menu.setApplicationMenu(null);
  }
}

/**
 * ✅ Menu de contexto (botão direito) com Paste/Copy/Cut
 * Ajuda MUITO no macOS e também deixa útil no Windows.
 */
function attachContextMenu(win) {
  if (!win || win.isDestroyed()) return;

  win.webContents.on("context-menu", () => {
    const template = [
      { role: "undo" },
      { role: "redo" },
      { type: "separator" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },       // ✅ colar
      { role: "selectAll" }
    ];

    const menu = Menu.buildFromTemplate(template);
    menu.popup({ window: win });
  });
}

function createWindows() {
  laybackWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      partition: "persist:main",
      contextIsolation: false
    }
  });
  laybackWindow.loadURL("https://laybacksoftware.bolsadeaposta.bet.br/");
  attachContextMenu(laybackWindow);

  tempoWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      partition: "persist:main",
      contextIsolation: false
    }
  });
  attachContextMenu(tempoWindow);

  painel = new BrowserWindow({
    width: 420,
    height: 550,
    autoHideMenuBar: process.platform !== "darwin",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true
    }
  });
  painel.loadFile(path.join(__dirname, "index.html"));
  painel.on("closed", () => (painel = null));
  attachContextMenu(painel);

  graficoWindow = new BrowserWindow({
    width: 900,
    height: 650,
    title: "Gráficos - Under",
    autoHideMenuBar: process.platform !== "darwin",
    webPreferences: {
      preload: path.join(__dirname, "preload_grafico.js"),
      contextIsolation: true
    }
  });
  graficoWindow.loadFile(path.join(__dirname, "grafico.html"));
  graficoWindow.on("closed", () => (graficoWindow = null));
  attachContextMenu(graficoWindow);

  volumeWindow = new BrowserWindow({
    width: 520,
    height: 760,
    title: "Volume / Book - Under",
    autoHideMenuBar: process.platform !== "darwin",
    webPreferences: {
      preload: path.join(__dirname, "preload_volume.js"),
      contextIsolation: true
    }
  });
  volumeWindow.loadFile(path.join(__dirname, "volume.html"));
  volumeWindow.on("closed", () => (volumeWindow = null));
  attachContextMenu(volumeWindow);
}

app.whenReady().then(() => {
  setupAppMenu();
  createWindows();
});

// 🔹 INICIAR CAPTURA
ipcMain.on("iniciar-captura", async (_event, payload) => {
  const { urlOdds, urlTempo, acrescimos, tempoBase } = payload;

  acrescimosGlobal = parseInt(acrescimos, 10) || 5;
  tempoBaseGlobal = parseInt(tempoBase, 10) || 90;

  historicoPorMinuto = {};
  historicoPercentual = [];
  ultimoPercentual = null;

  if (graficoWindow && !graficoWindow.isDestroyed()) {
    graficoWindow.webContents.send("grafico-reset");
  }

  if (volumeWindow && !volumeWindow.isDestroyed()) {
    volumeWindow.webContents.send("volume-reset");
  }

  const ids = urlOdds.match(/\d{10,}/g);
  if (!ids || ids.length < 2) {
    if (painel && !painel.isDestroyed()) {
      painel.webContents.send("erro", "Não foi possível extrair eventId e marketId.");
    }
    return;
  }

  const eventId = ids[0];
  const marketId = ids[1];

  await tempoWindow.loadURL(urlTempo);
  iniciarCaptura(eventId, marketId);
});

// 🔹 ATUALIZAR ACRÉSCIMOS
ipcMain.on("atualizar-acrescimos", (_event, novoValor) => {
  acrescimosGlobal = parseInt(novoValor, 10) || 5;
});

function iniciarCaptura(eventId, marketId) {
  if (intervalId) clearInterval(intervalId);

  intervalId = setInterval(async () => {
    try {
      const [data, tempo] = await Promise.all([
        laybackWindow.webContents.executeJavaScript(`
          fetch("https://mexchange-api.bolsadeaposta.bet.br/api/events/${eventId}?market-ids=${marketId}&price-depth=350", {
            credentials: "include"
          }).then(r => r.json())
        `),

        tempoWindow.webContents.executeJavaScript(`
          new Promise(resolve => {
            const el = document.querySelector(".eventTime");
            resolve(el ? el.innerText.trim() : null);
          })
        `)
      ]);

      if (!data?.markets?.length) return;

      const market = data.markets[0];
      const underRunner = market.runners.find(r =>
        r.name.toLowerCase().includes("menos") ||
        r.name.toLowerCase().includes("under")
      );
      if (!underRunner) return;

      const oddAtual = parseFloat(underRunner["last-matched-odds"]);
      if (!Number.isFinite(oddAtual)) return;

      const oddSemPonto = Math.round(oddAtual * 100);

      let minutoAtual = 0;
      if (tempo) {
        const m = parseInt(tempo.split(":")[0], 10);
        if (Number.isFinite(m)) minutoAtual = m;
      }

      const divisor = (tempoBaseGlobal + acrescimosGlobal) - minutoAtual;
      const tempoRestante = divisor;

      let percentualPorMinuto = null;
      let mediaMinuto = null;

      if (divisor > 0) {
        // ✅ fórmula exata
        percentualPorMinuto = (oddSemPonto - 100) / divisor;

        if (!historicoPorMinuto[minutoAtual]) historicoPorMinuto[minutoAtual] = [];
        historicoPorMinuto[minutoAtual].push(percentualPorMinuto);

        const somaMinuto = historicoPorMinuto[minutoAtual].reduce((acc, val) => acc + val, 0);
        mediaMinuto = somaMinuto / historicoPorMinuto[minutoAtual].length;

        historicoPercentual.push(percentualPorMinuto);
      }

      const mediaGeral = historicoPercentual.length > 0
        ? historicoPercentual.reduce((acc, val) => acc + val, 0) / historicoPercentual.length
        : null;

      let tendencia = "estavel";
      if (ultimoPercentual !== null && percentualPorMinuto !== null) {
        if (percentualPorMinuto > ultimoPercentual + 0.05) tendencia = "subindo";
        else if (percentualPorMinuto < ultimoPercentual - 0.05) tendencia = "caindo";
      }
      ultimoPercentual = percentualPorMinuto;

      // ============================
      // ✅ VOLUME/BOOK
      // ============================
      const volumeMercado = Number(market.volume) || null;
      const volumeRunner = Number(underRunner.volume) || null;

      const prices = Array.isArray(underRunner.prices) ? underRunner.prices : [];

      const toNum = (v) => {
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
      };

      const backs = prices
        .filter(p => (p.side || "").toLowerCase() === "back")
        .map(p => ({ odds: toNum(p.odds), amount: toNum(p["available-amount"]) }))
        .filter(x => x.odds !== null && x.amount !== null);

      const lays = prices
        .filter(p => (p.side || "").toLowerCase() === "lay")
        .map(p => ({ odds: toNum(p.odds), amount: toNum(p["available-amount"]) }))
        .filter(x => x.odds !== null && x.amount !== null);

      backs.sort((a, b) => b.odds - a.odds);
      lays.sort((a, b) => a.odds - b.odds);

      const topBacks = backs.slice(0, 12);
      const topLays = lays.slice(0, 12);

      const volumeBackTop10 = topBacks.reduce((acc, x) => acc + x.amount, 0);
      const volumeLayTop10 = topLays.reduce((acc, x) => acc + x.amount, 0);

      // ✅ envia para painel
      if (painel && !painel.isDestroyed()) {
        painel.webContents.send("atualizar-dados", {
          odd: oddAtual,
          tempo: tempo,
          percentual: percentualPorMinuto,
          mediaMinuto,
          mediaGeral,
          tendencia,
          tempoRestante
        });
      }

      // ✅ envia para gráficos
      if (graficoWindow && !graficoWindow.isDestroyed()) {
        graficoWindow.webContents.send("grafico-dados", {
          tempo: tempo || null,
          minuto: minutoAtual,
          odd: oddAtual,
          percentual: percentualPorMinuto,
          tempoRestante,
          volumeBackTop10,
          volumeLayTop10
        });
      }

      // ✅ envia para volume
      if (volumeWindow && !volumeWindow.isDestroyed()) {
        volumeWindow.webContents.send("volume-dados", {
          tempo: tempo || null,
          minuto: minutoAtual,
          odd: oddAtual,
          volumeMercado,
          volumeRunner,
          volumeBackTop10,
          volumeLayTop10,
          topBacks,
          topLays
        });
      }

      console.log(
        "odd:", oddAtual,
        "| tempo:", tempo,
        "| volMkt:", volumeMercado,
        "| volRunner:", volumeRunner,
        "| backTop10:", volumeBackTop10,
        "| layTop10:", volumeLayTop10
      );

    } catch (err) {
      console.log("Erro:", err.message);
    }
  }, 3000);
}

app.on("window-all-closed", () => app.quit());