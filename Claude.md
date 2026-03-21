# Under Pulse — Contexto do Projeto para Claude

## Visão Geral

**Under Pulse** (nome no package.json: `painel-under`) é uma aplicação desktop **Electron** para análise de odds em tempo real no mercado de apostas esportivas ao vivo, focada em mercados **Under** (gols abaixo do handicap) em futebol.

**Plataforma:** Cross-platform (macOS, Windows, Linux)
**Linguagem:** JavaScript (Node.js + Browser)
**Framework:** Electron ^28.3.3
**Exchange:** Bolsa de Aposta (Brasil) — `bolsadeaposta.bet.br`

---

## Estrutura de Arquivos

```
under_pulse/
├── main.js              # Processo principal Electron — toda a lógica de negócio
├── preload.js           # Bridge IPC para janela principal (index.html)
├── preload_home.js      # Bridge IPC para janela de jogos (home.html)
├── preload_grafico.js   # Bridge IPC para janela de gráficos (grafico.html)
├── preload_volume.js    # Bridge IPC para janela de zonas (volume.html)
├── index.html           # Painel principal — exibe odd, tempo, percentual, tendência
├── home.html            # Tela inicial — lista jogos ao vivo da API
├── grafico.html         # Gráficos em tempo real com Chart.js
├── volume.html          # Zonas de suporte e resistência
└── package.json         # name: painel-under, version: 1.0.0
```

---

## Arquitetura — Multi-Window com IPC

O app gerencia **5 janelas simultâneas**:

| Janela | Arquivo | Função |
|--------|---------|--------|
| Home | `home.html` | Lista jogos ao vivo, filtros por fase, busca por time |
| Painel Principal | `index.html` | Exibe odd em tempo real (70px verde), percentual, tendência |
| Gráficos | `grafico.html` | Linha de tendência de odds e percentual por minuto |
| Volume/Zonas | `volume.html` | Zonas de suporte (3 ticks acima) e resistência (3 ticks abaixo) |
| Login Layback | (oculta) | Sessão autenticada via cookies — `laybacksoftware.bolsadeaposta.bet.br` |

**Fluxo de dados:**
1. Home busca jogos ao vivo a cada **20 segundos**
2. Usuário seleciona um jogo
3. Painel inicia polling a cada **3 segundos** na API mexchange
4. Cada ciclo atualiza as 3 janelas via IPC
5. Cálculos no processo principal → enviados ao renderer

---

## APIs Externas

| Endpoint | Uso |
|----------|-----|
| `bolsadeaposta.bet.br/client/api/jumper/feedSports/inplay-info` | Lista jogos ao vivo |
| `mexchange-api.bolsadeaposta.bet.br/api/events/{eventId}` | Mercados, runners, odds, volumes (`price-depth=350`) |
| `laybacksoftware.bolsadeaposta.bet.br/` | Autenticação via sessão persistente |

**Autenticação:** Baseada em cookies via partition Electron `persist:main`

---

## Lógica de Negócio Principal (main.js)

### Cálculo de Percentual
```
percentual = (oddSemPonto - 100) / tempoRestante
```

### Detecção de Tendência
- Compara percentual atual vs. anterior
- Threshold: `0.05`
- Resultado: `↑` subindo, `↓` caindo, `→` estável

### Ladder de Odds (padrão Betfair)
- 1.01–2.0 → incrementos de 0.01
- 2.02–3.0 → 0.02
- 3.05–4.0 → 0.05
- 4.1–6.0 → 0.1
- 6.2–10.0 → 0.2
- 10.5–20.0 → 0.5
- 21.0–30.0 → 1.0
- ... até 1000.0

### Seleção de Mercado
Auto-seleciona mercados "Under" / "Menos De" com base no placar e fase da partida.

### Volume
- Volume exibido = **3x o valor real** (ajuste visual quando deslogado)
- Tracking por minuto com acumuladores em memória

---

## Configurações Chave (main.js)

| Constante | Valor | Descrição |
|-----------|-------|-----------|
| `acrescimosGlobal` | 5 | Acréscimos padrão (minutos) |
| `tempoBaseGlobal` | 90 | Duração padrão da partida |
| `HOME_MARKET_CACHE_TTL_MS` | 8000 | TTL cache mercados home |
| `LOGGED_REQUEST_CACHE_TTL_MS` | 5000 | TTL cache requisições autenticadas |
| `MAX_CONCURRENT_LOGGED_REQUESTS` | 2 | Limite de requisições simultâneas |

---

## Estado em Memória (sem banco de dados)

| Variável | Descrição |
|----------|-----------|
| `homeMarketCache` | Cache de dados de mercado (TTL 8s) |
| `loggedRequestCache` | Cache de respostas da API (TTL 5s) |
| `historicoPorMinuto` | Histórico percentual por minuto |
| `historicoPercentual` | Histórico geral de percentual |
| `matchedByMinute` | Volume matched por minuto |

---

## Segurança (Electron)

- `contextIsolation: true` em todas as janelas
- `nodeIntegration: false`
- Preload scripts para APIs controladas via IPC
- Clipboard nativo para operações de paste (macOS + Windows)

---

## Scripts

```bash
npm start    # electron .
```

Sem build step — Electron executa JS diretamente.

---

## Idioma e Convenções

- Código e comentários misturados: **Português + Inglês**
- Comentários com emojis para navegação (🔹🔥✅)
- Sem JSDoc ou documentação formal
- README.md praticamente vazio

---

## Histórico Recente (Git)

- Ajuste de odd inteira → multiplicar volume por 3x
- Volume exibido como 1/3 para parecer real quando deslogado
- Botão de seleção de jogo removido; placar agora é o gatilho de seleção
- Nova estrutura: abre somente a home, resto carrega sob demanda
- Adição da tela home com jogos ao vivo

---

## Notas para o Desenvolvedor

1. **Não há banco de dados** — todo estado é em memória e perdido ao reiniciar
2. **Polling agressivo** — 3s no painel + 20s na home; cuidado com rate limiting da API
3. **Autenticação frágil** — depende de cookies e re-login manual via janela oculta
4. **Volume x3** — o valor exibido na home é 3x o real; comportamento intencional
5. **Sem .env** — configurações hardcoded no main.js
6. **CDN externo** — Chart.js carregado via jsDelivr; requer internet
