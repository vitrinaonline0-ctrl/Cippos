# 🔌 Relay WebSocket pentru ecranul client (cross-dispozitiv)

Acest mic server face ca **produsele scanate în ecranul operator** (laptop)
să ajungă **pe telefonul client** (ecranul client), chiar dacă cele două
dispozitive sunt pe rețele diferite. Netlify e hosting static și nu poate ține
un server, de aceea relay-ul se găzduiește separat (gratuit).

- **Zero dependențe** — doar `http` + `crypto` din Node.js (nimic de instalat).
- Organizează clienții în **camere** (`room`): fiecare magazin folosește o
  cameră proprie, astfel încât magazinele nu se amestecă.
- Păstrează **ultima stare a coșului** per cameră și o trimite imediat
  oricărui client nou conectat (telefonul deschis mai târziu afișează imediat
  comanda curentă).
- Nu face echo către expeditor și are heartbeat ping/pong.

## Rulare locală (test)

```bash
cd server
node relay-server.js
# ascultă pe PORT (implicit 3000)
# health-check: http://localhost:3000/healthz
```

## Găzduire gratuită (alege una)

### 1) Render
1. Creează un **New Web Service** din repo (sau „Upload").
2. Root directory: `pos-system/server`.
3. **Build Command:** (gol) · **Start Command:** `node relay-server.js`.
4. În *Environment*, setează `PORT` = `10000` (Render îl injectează automat).
5. După deploy obții un URL de forma `https://pos-relay-xxxx.onrender.com`.
   În Setările POS pui **URL relay = `wss://pos-relay-xxxx.onrender.com`**.

> Render „adormește" serviciul gratuit după idle; prima conectare poate dura
> câteva secunde (se trezește). E suficient pentru un ecran client.

### 2) Railway
1. „New Project” → „Deploy from GitHub” (sau „Empty Project” + `railway up`).
2. Root: `pos-system/server`, start `node relay-server.js`.
3. Obții un URL `https://<slug>.up.railway.app`. Pui `wss://<slug>.up.railway.app`.

### 3) Fly.io
```bash
cd pos-system/server
fly launch --no-deploy   # alege regiunea; editează apoi fly.toml: internal_port = 3000
fly deploy
```

## Configurare în POS

În aplicație → **Setări → „Ecran client pe telefon"**:
- **URL relay:** `wss://<url-obtinut>` (atenție la `wss://`, nu `https://`).
- **Camera:** un ID scurt, unic pe magazin (ex: `magazin-1`). Toate ecranele
  operator + client care folosesc aceeași cameră se sincronizează între ele.

Apasă **🔌 Testează conexiunea** — dacă scrie „conectat", mergi pe telefon la
`…/client-display.html` și vei vedea imediat produsele adăugate la casă.

## Protocol (pentru referință)

Mesaje JSON peste WebSocket:

```json
{ "type": "cart:update" | "payment:select" | "payment:done" | "cart:clear" | "client:hello" | "sync:ping",
  "payload": { }, "ts": 1690000000000, "room": "magazin-1" }
```

Serverul difuzează fiecare mesaj către **celelalte** conexiuni din aceeași
`room` și păstrează ultimul snapshot (`cart:update` / `payment:*` / `cart:clear`)
pentru clienții ce se conectează ulterior.
