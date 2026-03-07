const { app, BrowserWindow, ipcMain, Menu, net, session, clipboard } = require("electron");
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

// 🔹 Cache para mercados da home
const homeMarketCache = new Map();
const HOME_MARKET_CACHE_TTL_MS = 8000;

// 🔹 ENGINE DE REQUESTS AUTENTICADAS
const loggedRequestQueue = [];
let loggedRequestInFlight = 0;
const MAX_CONCURRENT_LOGGED_REQUESTS = 2;

const loggedRequestCache = new Map();
const LOGGED_REQUEST_CACHE_TTL_MS = 5000;

const loggedRequestPending = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJsonFromLoggedWindow(url) {
  if (!laybackWindow || laybackWindow.isDestroyed()) {
    throw new Error("Janela logada não está disponível.");
  }

  return await laybackWindow.webContents.executeJavaScript(`
    fetch(${JSON.stringify(url)}, {
      credentials: "include"
    }).then(async (r) => {
      if (!r.ok) {
        throw new Error("HTTP " + r.status);
      }
      return r.json();
    })
  `);
}

function processLoggedRequestQueue() {
  while (
    loggedRequestInFlight < MAX_CONCURRENT_LOGGED_REQUESTS &&
    loggedRequestQueue.length > 0
  ) {
    const job = loggedRequestQueue.shift();
    loggedRequestInFlight += 1;

    (async () => {
      try {
        const data = await fetchJsonFromLoggedWindow(job.url);

        loggedRequestCache.set(job.url, {
          ts: Date.now(),
          data
        });

        job.resolve(data);

        await sleep(120);
      } catch (err) {
        const errMsg = String(err?.message || "");
        if ((errMsg.includes("HTTP 401") || errMsg.includes("HTTP 403")) && laybackWindow && !laybackWindow.isDestroyed()) {
          laybackWindow.show();
          laybackWindow.focus();
        }
        job.reject(err);
      } finally {
        loggedRequestInFlight -= 1;
        loggedRequestPending.delete(job.url);
        processLoggedRequestQueue();
      }
    })();
  }
}

/**
 * ✅ Request autenticada com:
 * - cookies da janela logada
 * - cache curto
 * - deduplicação
 * - fila com concorrência limitada
 */
function requestLoggedJson(url) {
  const cached = loggedRequestCache.get(url);
  if (cached && (Date.now() - cached.ts) < LOGGED_REQUEST_CACHE_TTL_MS) {
    return Promise.resolve(cached.data);
  }

  const pending = loggedRequestPending.get(url);
  if (pending) {
    return pending;
  }

  const promise = new Promise((resolve, reject) => {
    loggedRequestQueue.push({ url, resolve, reject });
    processLoggedRequestQueue();
  });

  loggedRequestPending.set(url, promise);
  return promise;
}

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
 * Mantida apenas se você quiser usar em endpoints públicos no futuro.
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
  const hasClock = Boolean(pick("clock", "time", "matchTime", "timer", "timeElapsed"));

  return hasTrueFlag || statusLive || hasClock;
}

/**
 * ✅ Extrai “itens candidatos” de qualquer JSON (array direto ou aninhado)
 */
function extractCandidateItems(json) {
  const asArray = (v) => (Array.isArray(v) ? v : []);
  if (Array.isArray(json)) return json;

  if (!json || typeof json !== "object") return [];

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

function toNumberOrNull(value) {
  if (value === null || value === undefined) return null;

  if (typeof value === "string") {
    const normalized = value.replace(",", ".").trim();
    const n = Number(normalized);
    return Number.isFinite(n) ? n : null;
  }

  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

const BETFAIR_ODDS_LADDER = (() => {
  const ranges = [
    [1.01, 2.0, 0.01],
    [2.02, 3.0, 0.02],
    [3.05, 4.0, 0.05],
    [4.1, 6.0, 0.1],
    [6.2, 10.0, 0.2],
    [10.5, 20.0, 0.5],
    [21.0, 30.0, 1.0],
    [32.0, 50.0, 2.0],
    [55.0, 100.0, 5.0],
    [110.0, 1000.0, 10.0]
  ];

  const out = [];
  for (const [start, end, step] of ranges) {
    for (let v = start; v <= end + 1e-9; v += step) {
      out.push(Number(v.toFixed(2)));
    }
  }
  return out;
})();

function findNearestLadderIndex(odd) {
  if (!Number.isFinite(odd)) return -1;

  let bestIdx = 0;
  let bestDist = Infinity;

  for (let i = 0; i < BETFAIR_ODDS_LADDER.length; i += 1) {
    const dist = Math.abs(BETFAIR_ODDS_LADDER[i] - odd);
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }

  return bestIdx;
}

function getTickOddsAround(odd, count) {
  const idx = findNearestLadderIndex(odd);
  if (idx < 0) return { resistanceOdds: [], supportOdds: [], matchedOdd: null };

  const resistanceOdds = [];
  const supportOdds = [];

  for (let i = 1; i <= count; i += 1) {
    const lowerIdx = idx - i;
    const upperIdx = idx + i;

    if (lowerIdx >= 0) resistanceOdds.push(BETFAIR_ODDS_LADDER[lowerIdx]);
    if (upperIdx < BETFAIR_ODDS_LADDER.length) supportOdds.push(BETFAIR_ODDS_LADDER[upperIdx]);
  }

  return {
    resistanceOdds,
    supportOdds,
    matchedOdd: BETFAIR_ODDS_LADDER[idx]
  };
}

/**
 * ✅ runner correto do mercado alvo: MENOS DE / UNDER
 */
function getUnderRunner(market) {
  const runners = Array.isArray(market?.runners) ? market.runners : [];

  return runners.find((runner) => {
    const runnerName = String(runner?.name ?? "").trim().toUpperCase();
    return runnerName.startsWith("MENOS DE") || runnerName.startsWith("UNDER");
  }) || null;
}

function isFirstHalfStatus(inPlayMatchStatus) {
  return inPlayMatchStatus === "KickOff";
}

function isSecondHalfStatus(inPlayMatchStatus) {
  return inPlayMatchStatus === "SecondHalfKickOff" || inPlayMatchStatus === "SecondHalfExtraTimeKickOff";
}

function marketNameLooksFirstHalf(market) {
  const name = String(market?.name ?? "").toUpperCase();
  const original = String(market?.["name-original"] ?? "").toUpperCase();
  return (
    name.includes("1º TEMPO") ||
    name.includes("1O TEMPO") ||
    name.includes("1ST HALF") ||
    original.includes("1ST HALF") ||
    original.includes("1º TEMPO") ||
    original.includes("1O TEMPO")
  );
}

/**
 * ✅ mercado alvo:
 * - market-type = total
 * - status = open
 * - menor handicap maior que o total de gols
 * - 1º tempo => usa mercado de 1º tempo
 * - 2º tempo => usa mercado do jogo inteiro
 * - mantém volume do runner e também captura volume total do mercado
 * - captura last-matched-odds do runner
 * - usa o NAME do runner como nome exibido
 */
function getTargetUnderMarket(markets, totalGoals, inPlayMatchStatus) {
  if (!Array.isArray(markets) || !markets.length) return null;

  const lookingFirstHalf = isFirstHalfStatus(inPlayMatchStatus);
  const lookingSecondHalf = isSecondHalfStatus(inPlayMatchStatus);

  const candidates = markets
    .map((market) => {
      const handicap = toNumberOrNull(market?.handicap);
      if (handicap === null) return null;
      if (handicap <= totalGoals) return null;

      const marketType = String(
        market?.["market-type"] ??
        market?.marketType ??
        market?.type ??
        ""
      ).toLowerCase();

      if (marketType !== "total") return null;

      const marketStatus = String(market?.status ?? "").toLowerCase();
      if (marketStatus !== "open") return null;

      const isFirstHalfMarket = marketNameLooksFirstHalf(market);

      if (lookingFirstHalf && !isFirstHalfMarket) return null;
      if (lookingSecondHalf && isFirstHalfMarket) return null;

      const underRunner = getUnderRunner(market);
      if (!underRunner) return null;

      return {
        name: String(underRunner?.name ?? "").trim(),
        handicap,
        runnerVolume: toNumberOrNull(underRunner?.volume),
        marketVolume: toNumberOrNull(market?.volume),
        lastMatchedOdds: toNumberOrNull(underRunner?.["last-matched-odds"]),
        raw: market,
        rawRunner: underRunner
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.handicap - b.handicap);

  return candidates[0] || null;
}

async function getEventUnderMarketByScore(eventId, totalGoals, inPlayMatchStatus) {
  if (!eventId) return null;

  const cacheKey = `${eventId}:${totalGoals}:${inPlayMatchStatus || "unknown"}`;
  const cached = homeMarketCache.get(cacheKey);

  if (cached && (Date.now() - cached.ts) < HOME_MARKET_CACHE_TTL_MS) {
    return cached.value;
  }

  try {
    const url = `https://mexchange-api.bolsadeaposta.bet.br/api/events/${eventId}`;
    const json = await requestLoggedJson(url);
    const markets = Array.isArray(json?.markets) ? json.markets : [];
    const target = getTargetUnderMarket(markets, totalGoals, inPlayMatchStatus);

    homeMarketCache.set(cacheKey, {
      ts: Date.now(),
      value: target
    });

    return target;
  } catch (err) {
    console.log(`Erro ao buscar mercado do evento ${eventId}:`, err.message);
    return null;
  }
}

function createStartupWindows() {
  // 🔹 JANELA LAYBACK (login)
  laybackWindow = new BrowserWindow({
    show: false,
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
}

function ensurePainelWindow() {
  if (painel && !painel.isDestroyed()) return painel;
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
  return painel;
}

function ensureGraficoWindow() {
  if (graficoWindow && !graficoWindow.isDestroyed()) return graficoWindow;
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
  return graficoWindow;
}

function ensureVolumeWindow() {
  if (volumeWindow && !volumeWindow.isDestroyed()) return volumeWindow;
  // 🔹 ZONAS (SUPORTE/RESISTÊNCIA)
  volumeWindow = new BrowserWindow({
    width: 520,
    height: 760,
    title: "Zonas - Under",
    webPreferences: {
      preload: path.join(__dirname, "preload_volume.js"),
      contextIsolation: true
    }
  });
  volumeWindow.loadFile(path.join(__dirname, "volume.html"));
  volumeWindow.on("closed", () => (volumeWindow = null));
  attachContextMenu(volumeWindow);
  return volumeWindow;
}

function ensureCaptureWindows() {
  ensurePainelWindow();
  ensureGraficoWindow();
  ensureVolumeWindow();
}

function openLaybackLoginWindow() {
  if (!laybackWindow || laybackWindow.isDestroyed()) return false;
  laybackWindow.show();
  laybackWindow.focus();
  return true;
}

app.whenReady().then(() => {
  setupAppMenu();
  createStartupWindows();
});

/**
 * ✅ HOME: retornar somente jogos ao vivo
 * ✅ inclui mercado alvo de under baseado no total de gols
 * ✅ 1º tempo usa mercado de 1º tempo
 * ✅ 2º tempo usa mercado do jogo todo
 * ✅ nome exibido vem do runner.name
 */
ipcMain.handle("home-get-inplay", async () => {
  const url = "https://bolsadeaposta.bet.br/client/api/jumper/feedSports/inplay-info";
  const json = await requestLoggedJson(url);

  const items = extractCandidateItems(json);

  const baseGames = items
    .filter((it) => {
      const st = String(it?.status ?? "").toUpperCase();
      return st === "IN_PLAY" || isInPlay(it);
    })
    .map((it) => {
      const h = it?.score?.home ?? it?.home ?? {};
      const a = it?.score?.away ?? it?.away ?? {};

      const homeName = String(h?.name ?? "").trim();
      const awayName = String(a?.name ?? "").trim();

      const homeScore = Number(h?.score ?? 0) || 0;
      const awayScore = Number(a?.score ?? 0) || 0;

      const id = it?.eventId ?? it?.id ?? it?.event_id ?? null;
      const inPlayMatchStatus = it?.inPlayMatchStatus ?? it?.inplayMatchStatus ?? "";

      return {
        id,
        league:
          it?.competition?.name ??
          it?.league?.name ??
          it?.tournament?.name ??
          it?.competitionName ??
          "",
        startTime: it?.startTime ?? it?.start_time ?? it?.kickoff ?? "",
        clock: it?.timeElapsed ?? it?.clock ?? it?.time ?? it?.matchTime ?? "",
        inPlayMatchStatus,
        home: { name: homeName, score: homeScore },
        away: { name: awayName, score: awayScore },
        raw: it
      };
    })
    .filter(x => x.home.name && x.away.name && x.id);

  const gamesWithMarket = await Promise.all(
    baseGames.map(async (game) => {
      const totalGoals = (Number(game.home.score) || 0) + (Number(game.away.score) || 0);
      const targetMarket = await getEventUnderMarketByScore(
        game.id,
        totalGoals,
        game.inPlayMatchStatus
      );

      return {
        ...game,
        lastMatchedOdds: targetMarket?.lastMatchedOdds ?? null,
        market: targetMarket
          ? {
              id: targetMarket.raw?.id ?? null,
              name: game.inPlayMatchStatus === "KickOff"
                ? `1º Tempo ${targetMarket.name}`
                : targetMarket.name,
              runnerVolume: targetMarket.runnerVolume,
              marketVolume: targetMarket.marketVolume
            }
          : null
      };
    })
  );

  return gamesWithMarket.filter((g) => {
    const runnerVol = Number(g?.market?.runnerVolume);
    return Number.isFinite(runnerVol) && runnerVol >= 40000;
  });
});

// 🔹 INICIAR CAPTURA
ipcMain.on("iniciar-captura", async (_event, payload) => {
  await startCaptureFromPayload(payload);
});

ipcMain.handle("home-start-capture", async (_event, payload) => {
  return await startCaptureFromPayload(payload, { source: "home" });
});

ipcMain.handle("home-open-layback-login", async () => {
  const ok = openLaybackLoginWindow();
  if (!ok) return { ok: false, message: "Janela do Layback não está disponível." };
  return { ok: true };
});

async function startCaptureFromPayload(payload, opts = {}) {
  const { eventId, marketId, urlTempo, acrescimos, tempoBase, inPlayMatchStatus } = payload || {};
  const source = opts.source || "generic";

  acrescimosGlobal = parseInt(acrescimos, 10) || 5;
  if (tempoBase !== undefined && tempoBase !== null && tempoBase !== "") {
    tempoBaseGlobal = parseInt(tempoBase, 10) || 90;
  } else {
    tempoBaseGlobal = inPlayMatchStatus === "KickOff" ? 45 : 90;
  }

  ensureCaptureWindows();

  historicoPorMinuto = {};
  historicoPercentual = [];
  ultimoPercentual = null;

  lastRunnerVolume = null;
  lastOdd = null;
  matchedBackTotal = 0;
  matchedLayTotal = 0;
  matchedNeutroTotal = 0;
  matchedByMinute = {};

  if (graficoWindow && !graficoWindow.isDestroyed()) graficoWindow.webContents.send("grafico-reset");
  if (volumeWindow && !volumeWindow.isDestroyed()) volumeWindow.webContents.send("book-reset");

  if (!eventId || !marketId) {
    if (painel && !painel.isDestroyed()) {
      painel.webContents.send("erro", "Informe event_id e market_id para iniciar a captura.");
    }
    return source === "home" ? { ok: false, message: "eventId/marketId inválidos." } : undefined;
  }

  if (!urlTempo) {
    if (painel && !painel.isDestroyed()) {
      painel.webContents.send("erro", "Informe a URL do tempo para iniciar a captura.");
    }
    return source === "home" ? { ok: false, message: "URL do tempo é obrigatória." } : undefined;
  }

  try {
    await tempoWindow.loadURL(urlTempo);
    iniciarCaptura(eventId, marketId);

    if (painel && !painel.isDestroyed()) {
      painel.show();
      painel.focus();
    }
    if (graficoWindow && !graficoWindow.isDestroyed()) graficoWindow.show();
    if (volumeWindow && !volumeWindow.isDestroyed()) volumeWindow.show();

    if (source === "home") {
      clipboard.writeText(String(eventId));
      return { ok: true };
    }
  } catch (err) {
    const msg = err?.message || "Falha ao abrir URL do tempo.";
    if (painel && !painel.isDestroyed()) {
      painel.webContents.send("erro", msg);
    }
    if (source === "home") return { ok: false, message: msg };
  }
}

// 🔹 ATUALIZAR ACRÉSCIMOS
ipcMain.on("atualizar-acrescimos", (_event, novoValor) => {
  acrescimosGlobal = parseInt(novoValor, 10) || 5;
});

function iniciarCaptura(eventId, marketId) {
  if (intervalId) clearInterval(intervalId);

  intervalId = setInterval(async () => {
    try {
      const [data, tempoTxt] = await Promise.all([
        laybackWindow.webContents.executeJavaScript(`
          fetch("https://mexchange-api.bolsadeaposta.bet.br/api/events/${eventId}?market-ids=${marketId}&price-depth=350", {
            credentials: "include"
          }).then(r => r.json())
        `),

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

            let t = xpathToString(document);
            if (t) return Promise.resolve(t);

            const a = document.querySelector(".eventTime");
            if (a && a.innerText) return Promise.resolve(a.innerText.trim());

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

      const prices = Array.isArray(underRunner.prices) ? underRunner.prices : [];
      const availableByOdd = new Map();

      for (const p of prices) {
        const odds = toNumberOrNull(p?.odds);
        const amount = toNumberOrNull(p?.["available-amount"]);
        if (odds === null || amount === null) continue;
        const key = Number(odds).toFixed(2);
        availableByOdd.set(key, (availableByOdd.get(key) || 0) + amount);
      }

      const { resistanceOdds, supportOdds, matchedOdd } = getTickOddsAround(oddAtual, 3);

      const resistanceTicks = resistanceOdds.map((odds) => {
        const key = Number(odds).toFixed(2);
        return { odds, amount: availableByOdd.get(key) || 0 };
      });

      const supportTicks = supportOdds.map((odds) => {
        const key = Number(odds).toFixed(2);
        return { odds, amount: availableByOdd.get(key) || 0 };
      });

      const resistanceSum = resistanceTicks.reduce((acc, x) => acc + x.amount, 0);
      const supportSum = supportTicks.reduce((acc, x) => acc + x.amount, 0);

      let zoneAdvantage = "equilibrado";
      if (supportSum > resistanceSum) zoneAdvantage = "suporte";
      else if (resistanceSum > supportSum) zoneAdvantage = "resistencia";

      const zoneDiff = Math.abs(supportSum - resistanceSum);

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

      if (volumeWindow && !volumeWindow.isDestroyed()) {
        volumeWindow.webContents.send("book-dados", {
          tempo: tempoTxt || null,
          minuto: minutoAtual,
          odd: oddAtual,
          matchedOdd,
          resistanceTicks,
          supportTicks,
          resistanceSum,
          supportSum,
          zoneAdvantage,
          zoneDiff
        });
      }

      console.log(
        "odd:", oddAtual,
        "| tempo:", tempoTxt,
        "| resistencia:", resistanceSum,
        "| suporte:", supportSum,
        "| vantagem:", zoneAdvantage
      );

    } catch (err) {
      console.log("Erro:", err.message);
    }
  }, 3000);
}

app.on("window-all-closed", () => app.quit());
