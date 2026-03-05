const { app, BrowserWindow, ipcMain, Menu, net, session } = require("electron");
const path = require("path");

let painel;
let laybackWindow;
let tempoWindow;
let graficoWindow;
let volumeWindow;
let homeWindow;
let intervalId;

let acrescimosGlobal = 5;
let tempoBaseGlobal = 90;

// 🔹 HISTÓRICO (percentual)
let historicoPorMinuto = {};
let historicoPercentual = [];
let ultimoPercentual = null;

// 🔥 MATCHED FLOW (estimado)
let lastRunnerVolume = null; // último underRunner.volume (acumulado)
let lastOdd = null;          // última odd (last-matched-odds)

let matchedBackTotal = 0;
let matchedLayTotal = 0;
let matchedNeutroTotal = 0;

let matchedByMinute = {}; // { 12: {back, lay, neutro}, ... }

/**
 * ✅ Menu cross-platform (com Edit no Windows/Linux p/ garantir colar)
 */
function setupAppMenu() {
  const template = [];

  if (process.platform === "darwin") {
    template.push(
      {
        label: app.name,
        submenu: [
          { role: "about" },
          { type: "separator" },
          { role: "services" },
          { type: "separator" },
          { role: "hide" },
          { role: "hideOthers" },
          { role: "unhide" },
          { type: "separator" },
          { role: "quit" }
        ]
      },
      {
        label: "Edit",
        submenu: [
          { role: "undo" }, { role: "redo" },
          { type: "separator" },
          { role: "cut" }, { role: "copy" }, { role: "paste" },
          { role: "delete" }, { role: "selectAll" }
        ]
      },
      {
        label: "View",
        submenu: [
          { role: "reload" },
          { role: "forceReload" },
          { role: "toggleDevTools" },
          { type: "separator" },
          { role: "resetZoom" },
          { role: "zoomIn" },
          { role: "zoomOut" },
          { type: "separator" },
          { role: "togglefullscreen" }
        ]
      },
      {
        label: "Window",
        submenu: [
          { role: "minimize" },
          { role: "zoom" },
          { type: "separator" },
          { role: "front" }
        ]
      }
    );
  } else {
    template.push(
      {
        label: "Edit",
        submenu: [
          { role: "undo" }, { role: "redo" },
          { type: "separator" },
          { role: "cut" }, { role: "copy" }, { role: "paste" },
          { role: "delete" }, { role: "selectAll" }
        ]
      },
      {
        label: "View",
        submenu: [
          { role: "reload" },
          { role: "forceReload" },
          { role: "toggleDevTools" }
        ]
      }
    );
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/**
 * ✅ Context menu (botão direito) com Colar/Copiar em TODAS as janelas
 */
function attachContextMenu(win) {
  if (!win || win.isDestroyed()) return;
  win.webContents.on("context-menu", (_event, params) => {
    const menu = Menu.buildFromTemplate([
      { role: "undo", enabled: params.editFlags.canUndo },
      { role: "redo", enabled: params.editFlags.canRedo },
      { type: "separator" },
      { role: "cut", enabled: params.editFlags.canCut },
      { role: "copy", enabled: params.editFlags.canCopy },
      { role: "paste", enabled: params.editFlags.canPaste },
      { type: "separator" },
      { role: "selectAll", enabled: params.editFlags.canSelectAll }
    ]);
    menu.popup({ window: win });
  });
}

// 🔧 pega minuto de textos tipo "51:58" / "1 parte - 30:50" / "2 parte - 12:01"
function parseMinutoDoTextoTempo(tempoTxt) {
  if (!tempoTxt) return 0;
  const m = String(tempoTxt).match(/(\d{1,2}):(\d{2})/);
  if (!m) return 0;
  const minuto = parseInt(m[1], 10);
  return Number.isFinite(minuto) ? minuto : 0;
}

/**
 * ✅ Busca JSON usando a session/partition persist:main
 */
function requestJsonWithPersistSession(url) {
  return new Promise((resolve, reject) => {
    const ses = session.fromPartition("persist:main");
    const req = net.request({ url, method: "GET", session: ses });

    let raw = "";
    req.on("response", (res) => {
      res.on("data", (chunk) => (raw += chunk.toString("utf-8")));
      res.on("end", () => {
        try {
          resolve(JSON.parse(raw));
        } catch (e) {
          reject(new Error("Falha ao parsear JSON: " + e.message));
        }
      });
    });

    req.on("error", (err) => reject(err));
    req.end();
  });
}

/**
 * ✅ Detecta se um item está AO VIVO (tolerante)
 */
function isInPlay(item) {
  if (!item || typeof item !== "object") return false;

  const pick = (...keys) => {
    for (const k of keys) {
      const v = item?.[k];
      if (v !== undefined && v !== null) return v;
    }
    return undefined;
  };

  const status = String(pick("status", "state", "matchStatus", "eventStatus", "gameStatus", "phase") ?? "")
    .toUpperCase();

  const flags = [
    pick("inplay", "inPlay", "isInPlay", "live", "isLive", "in_play", "inPlayFlag"),
    pick("is_inplay", "is_live")
  ];

  const hasTrueFlag = flags.some(v => v === true || v === 1 || v === "1");

  const statusLive = ["IN_PLAY", "INPLAY", "LIVE", "PLAYING", "INPROGRESS", "IN_PROGRESS"].includes(status);

  // fallback: alguns feeds têm clock/timeElapsed preenchido
  const hasClock = Boolean(pick("clock", "time", "matchTime", "timer", "timeElapsed"));

  return hasTrueFlag || statusLive || hasClock;
}

/**
 * ✅ Extrai “itens candidatos” de qualquer JSON (array direto ou aninhado)
 * - Busca por arrays em chaves comuns e também faz uma varredura leve no objeto
 */
function extractCandidateItems(json) {
  const asArray = (v) => (Array.isArray(v) ? v : []);
  if (Array.isArray(json)) return json;

  if (!json || typeof json !== "object") return [];

  // chaves comuns (rápido)
  const direct = [
    ...asArray(json.inplay),
    ...asArray(json.inPlay),
    ...asArray(json.live),
    ...asArray(json.events),
    ...asArray(json.data),
    ...asArray(json.items),
    ...asArray(json.result),
    ...asArray(json.matches)
  ];
  if (direct.length) return direct;

  // varredura leve (2 níveis) pra achar arrays de objetos
  const found = [];
  const visited = new Set();

  const pushIfArray = (v) => {
    if (Array.isArray(v) && v.length && typeof v[0] === "object") {
      found.push(...v);
    }
  };

  const walk = (obj, depth) => {
    if (!obj || typeof obj !== "object") return;
    if (visited.has(obj)) return;
    visited.add(obj);

    for (const k of Object.keys(obj)) {
      const v = obj[k];
      pushIfArray(v);
      if (depth > 0 && v && typeof v === "object" && !Array.isArray(v)) {
        walk(v, depth - 1);
      }
    }
  };

  walk(json, 2);

  return found;
}

function createWindows() {
  // 🔹 JANELA LAYBACK (login)
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

  // 🔹 JANELA OCULTA PARA TEMPO
  tempoWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      partition: "persist:main",
      contextIsolation: false
    }
  });
  attachContextMenu(tempoWindow);

  // 🔹 HOME (jogos ao vivo)
  homeWindow = new BrowserWindow({
    width: 980,
    height: 720,
    title: "Home — Jogos ao vivo",
    webPreferences: {
      preload: path.join(__dirname, "preload_home.js"),
      contextIsolation: true
    }
  });
  homeWindow.loadFile(path.join(__dirname, "home.html"));
  homeWindow.on("closed", () => (homeWindow = null));
  attachContextMenu(homeWindow);

  // 🔹 PAINEL PRINCIPAL
  painel = new BrowserWindow({
    width: 420,
    height: 550,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true
    }
  });

  if (process.platform !== "darwin") {
    painel.setMenuBarVisibility(false);
    painel.autoHideMenuBar = true;
  }

  painel.loadFile(path.join(__dirname, "index.html"));
  painel.on("closed", () => (painel = null));
  attachContextMenu(painel);

  // 🔹 GRÁFICOS
  graficoWindow = new BrowserWindow({
    width: 900,
    height: 650,
    title: "Gráficos - Under",
    webPreferences: {
      preload: path.join(__dirname, "preload_grafico.js"),
      contextIsolation: true
    }
  });
  graficoWindow.loadFile(path.join(__dirname, "grafico.html"));
  graficoWindow.on("closed", () => (graficoWindow = null));
  attachContextMenu(graficoWindow);

  // 🔹 BOOK DE OFERTAS
  volumeWindow = new BrowserWindow({
    width: 520,
    height: 760,
    title: "Book de Ofertas - Under",
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

/**
 * ✅ HOME: retornar somente jogos ao vivo
 * ✅ Correção: home/away e score vêm (na maioria dos casos) dentro de it.score.home / it.score.away
 */
ipcMain.handle("home-get-inplay", async () => {
  const url = "https://bolsadeaposta.bet.br/client/api/jumper/feedSports/inplay-info";
  const json = await requestJsonWithPersistSession(url);

  const items = extractCandidateItems(json);

  const out = items
    .filter((it) => {
      const st = String(it?.status ?? "").toUpperCase();
      // esse endpoint geralmente vem com status IN_PLAY
      return st === "IN_PLAY" || isInPlay(it);
    })
    .map((it) => {
      // ✅ prioridade: it.score.home/away
      const h = it?.score?.home ?? it?.home ?? {};
      const a = it?.score?.away ?? it?.away ?? {};

      const homeName = String(h?.name ?? "").trim();
      const awayName = String(a?.name ?? "").trim();

      const homeScore = Number(h?.score ?? 0) || 0;
      const awayScore = Number(a?.score ?? 0) || 0;

      const id = it?.eventId ?? it?.id ?? it?.event_id ?? null;

      return {
        id,
        league:
          it?.competition?.name ??
          it?.league?.name ??
          it?.tournament?.name ??
          it?.competitionName ??
          "",
        clock: it?.timeElapsed ?? it?.clock ?? it?.time ?? it?.matchTime ?? "",
        home: { name: homeName, score: homeScore },
        away: { name: awayName, score: awayScore },
        raw: it
      };
    })
    // evita itens quebrados
    .filter(x => x.home.name && x.away.name);

  return out;
});

// 🔹 INICIAR CAPTURA
ipcMain.on("iniciar-captura", async (_event, payload) => {
  const { urlOdds, urlTempo, acrescimos, tempoBase } = payload;

  acrescimosGlobal = parseInt(acrescimos, 10) || 5;
  tempoBaseGlobal = parseInt(tempoBase, 10) || 90;

  // reset percentuais
  historicoPorMinuto = {};
  historicoPercentual = [];
  ultimoPercentual = null;

  // reset matched flow
  lastRunnerVolume = null;
  lastOdd = null;
  matchedBackTotal = 0;
  matchedLayTotal = 0;
  matchedNeutroTotal = 0;
  matchedByMinute = {};

  if (graficoWindow && !graficoWindow.isDestroyed()) graficoWindow.webContents.send("grafico-reset");
  if (volumeWindow && !volumeWindow.isDestroyed()) volumeWindow.webContents.send("book-reset");

  const ids = (urlOdds || "").match(/\d{10,}/g);
  if (!ids || ids.length < 2) {
    if (painel && !painel.isDestroyed()) painel.webContents.send("erro", "Não foi possível extrair eventId e marketId.");
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
      const [data, tempoTxt] = await Promise.all([
        // 🔹 ODDS + runner.volume via API
        laybackWindow.webContents.executeJavaScript(`
          fetch("https://mexchange-api.bolsadeaposta.bet.br/api/events/${eventId}?market-ids=${marketId}&price-depth=350", {
            credentials: "include"
          }).then(r => r.json())
        `),

        // 🔹 TEMPO via XPath (com fallback em iframes same-origin)
        tempoWindow.webContents.executeJavaScript(`
          (function(){
            const XPATH = "//div[@class='clockWrapper']/span[@data-push='clock']/text()";

            function xpathToString(doc){
              try{
                const res = doc.evaluate(
                  XPATH,
                  doc,
                  null,
                  XPathResult.STRING_TYPE,
                  null
                );
                const s = (res && res.stringValue) ? res.stringValue.trim() : "";
                return s || null;
              }catch(e){
                return null;
              }
            }

            // 1) tenta no documento principal
            let t = xpathToString(document);
            if (t) return Promise.resolve(t);

            // 2) fallback antigo (.eventTime)
            const a = document.querySelector(".eventTime");
            if (a && a.innerText) return Promise.resolve(a.innerText.trim());

            // 3) tenta iframes same-origin
            const iframes = Array.from(document.querySelectorAll("iframe"));
            for (const f of iframes) {
              try {
                const d = f.contentDocument;
                if (!d) continue;
                const tt = xpathToString(d);
                if (tt) return Promise.resolve(tt);
              } catch(e) {}
            }
            return Promise.resolve(null);
          })()
        `)
      ]);

      if (!data?.markets?.length) return;

      const market = data.markets[0];
      const underRunner = market.runners?.find(r =>
        (r.name || "").toLowerCase().includes("menos") ||
        (r.name || "").toLowerCase().includes("under")
      );
      if (!underRunner) return;

      const oddAtual = parseFloat(underRunner["last-matched-odds"]);
      if (!Number.isFinite(oddAtual)) return;

      const oddSemPonto = Math.round(oddAtual * 100);
      const minutoAtual = parseMinutoDoTextoTempo(tempoTxt);

      // ============================
      // ✅ PERCENTUAL POR MINUTO (sua fórmula)
      // ============================
      const divisor = (tempoBaseGlobal + acrescimosGlobal) - minutoAtual;
      const tempoRestante = divisor;

      let percentualPorMinuto = null;
      let mediaMinuto = null;

      if (divisor > 0) {
        percentualPorMinuto = (oddSemPonto - 100) / divisor;

        if (!historicoPorMinuto[minutoAtual]) historicoPorMinuto[minutoAtual] = [];
        historicoPorMinuto[minutoAtual].push(percentualPorMinuto);

        const somaMinuto = historicoPorMinuto[minutoAtual].reduce((acc, v) => acc + v, 0);
        mediaMinuto = somaMinuto / historicoPorMinuto[minutoAtual].length;

        historicoPercentual.push(percentualPorMinuto);
      }

      const mediaGeral = historicoPercentual.length
        ? historicoPercentual.reduce((acc, v) => acc + v, 0) / historicoPercentual.length
        : null;

      let tendencia = "estavel";
      if (ultimoPercentual !== null && percentualPorMinuto !== null) {
        if (percentualPorMinuto > ultimoPercentual + 0.05) tendencia = "subindo";
        else if (percentualPorMinuto < ultimoPercentual - 0.05) tendencia = "caindo";
      }
      ultimoPercentual = percentualPorMinuto;

      // ============================
      // ✅ MATCHED FLOW (Caminho A - estimado) -> continua pros gráficos
      // ============================
      const runnerVolume = Number(underRunner.volume);
      const runnerVolumeOk = Number.isFinite(runnerVolume) ? runnerVolume : null;

      let deltaMatched = null;
      let tickBack = 0;
      let tickLay = 0;
      let tickNeutro = 0;

      if (runnerVolumeOk !== null) {
        if (lastRunnerVolume !== null) {
          deltaMatched = runnerVolumeOk - lastRunnerVolume;

          if (!Number.isFinite(deltaMatched) || deltaMatched <= 0) {
            deltaMatched = null;
          } else {
            if (lastOdd !== null) {
              if (oddAtual < lastOdd) {
                tickBack = deltaMatched;
                matchedBackTotal += deltaMatched;
              } else if (oddAtual > lastOdd) {
                tickLay = deltaMatched;
                matchedLayTotal += deltaMatched;
              } else {
                tickNeutro = deltaMatched;
                matchedNeutroTotal += deltaMatched;
              }
            } else {
              tickNeutro = deltaMatched;
              matchedNeutroTotal += deltaMatched;
            }

            if (!matchedByMinute[minutoAtual]) matchedByMinute[minutoAtual] = { back: 0, lay: 0, neutro: 0 };
            matchedByMinute[minutoAtual].back += tickBack;
            matchedByMinute[minutoAtual].lay += tickLay;
            matchedByMinute[minutoAtual].neutro += tickNeutro;
          }
        }
        lastRunnerVolume = runnerVolumeOk;
      }
      lastOdd = oddAtual;

      // ============================
      // ✅ BOOK DE OFERTAS (available-amount) -> volume.html
      // API back => EXIBIR como LAY
      // API lay  => EXIBIR como BACK
      // ============================
      const prices = Array.isArray(underRunner.prices) ? underRunner.prices : [];
      const toNum = (v) => {
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
      };

      const apiBacks = prices
        .filter(p => (p.side || "").toLowerCase() === "back")
        .map(p => ({ odds: toNum(p.odds), amount: toNum(p["available-amount"]) }))
        .filter(x => x.odds !== null && x.amount !== null);

      const apiLays = prices
        .filter(p => (p.side || "").toLowerCase() === "lay")
        .map(p => ({ odds: toNum(p.odds), amount: toNum(p["available-amount"]) }))
        .filter(x => x.odds !== null && x.amount !== null);

      apiBacks.sort((a, b) => b.odds - a.odds);
      apiLays.sort((a, b) => a.odds - b.odds);

      const topApiBacks = apiBacks.slice(0, 12);
      const topApiLays  = apiLays.slice(0, 12);

      const displayLays = topApiBacks.map(x => ({ side: "LAY", odds: x.odds, amount: x.amount }));
      const displayBacks = topApiLays.map(x => ({ side: "BACK", odds: x.odds, amount: x.amount }));

      const bookList = [
        ...displayBacks.map(x => ({ ...x, _sortKey: 0 })),
        ...displayLays.map(x => ({ ...x, _sortKey: 1 }))
      ];

      const bookBackSum = displayBacks.reduce((acc, x) => acc + x.amount, 0);
      const bookLaySum  = displayLays.reduce((acc, x) => acc + x.amount, 0);

      // ============================
      // ENVIO: painel
      // ============================
      if (painel && !painel.isDestroyed()) {
        painel.webContents.send("atualizar-dados", {
          odd: oddAtual,
          tempo: tempoTxt,
          percentual: percentualPorMinuto,
          mediaMinuto,
          mediaGeral,
          tendencia,
          tempoRestante
        });
      }

      // ============================
      // ENVIO: gráficos (matched estimado)
      // ============================
      if (graficoWindow && !graficoWindow.isDestroyed()) {
        graficoWindow.webContents.send("grafico-dados", {
          tempo: tempoTxt || null,
          minuto: minutoAtual,
          odd: oddAtual,
          percentual: percentualPorMinuto,
          tempoRestante,

          deltaMatched,
          tickBack, tickLay, tickNeutro,
          matchedBackTotal,
          matchedLayTotal,
          matchedNeutroTotal
        });
      }

      // ============================
      // ENVIO: volumeWindow (book de ofertas)
      // ============================
      if (volumeWindow && !volumeWindow.isDestroyed()) {
        volumeWindow.webContents.send("book-dados", {
          tempo: tempoTxt || null,
          minuto: minutoAtual,
          odd: oddAtual,
          bookList,
          bookBacks: displayBacks,
          bookLays: displayLays,
          bookBackSum,
          bookLaySum
        });
      }

      console.log(
        "odd:", oddAtual,
        "| tempo:", tempoTxt,
        "| bookBackSum:", bookBackSum,
        "| bookLaySum:", bookLaySum
      );

    } catch (err) {
      console.log("Erro:", err.message);
    }
  }, 3000);
}

app.on("window-all-closed", () => app.quit());