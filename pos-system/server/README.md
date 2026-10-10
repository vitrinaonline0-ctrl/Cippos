# 🔌 Server combinat POS (static + relay WebSocket)

Un singur proces Node, **zero dependențe**, care face DOUĂ lucruri pe același port:

1. Servește fișierele statice ale POS-ului (`pos-system/`: `index.html`, `js/`, `css/` …).
2. Ține un **relay WebSocket** pentru sincronizarea **ecran operator ↔ ecran client**,
   chiar și pe dispozitive diferite (ex: laptopul + telefonul pe aceeași rețea Wi-Fi).

Avantaj: pe localhost (sau rețeaua locală) **nu configurezi nimic** — `sync.js`
se conectează automat la relay-ul de pe aceeași origine.

---

## 🚀 Rulare locală (cea mai simplă — recomandată)

Din dosarul `pos-system`:

```bash
npm start
# sau direct:
node server/relay-server.js
```

Serverul pornește pe `PORT` (implicit **8080**). Deschide în browser:

- **Ecran operator:** http://localhost:8080/pos.html
- **Ecran client (telefon):** http://localhost:8080/client-display.html

Produsele adăugate la casă apar **instant** pe ecranul client.

### Telefon pe aceeași rețea Wi-Fi (dispozitiv diferit)
1. Găsește IP-ul local al laptopului (ex: `192.168.1.25`).
2. Pe telefon deschide `http://192.168.1.25:8080/client-display.html`.
3. Gata — se sincronizează automat cu operatorul de pe laptop (relay-ul e pe
   același server). Nu e nevoie de conturi, chei sau hosting extern.

> Dacă ai un firewall, permite portul 8080 (sau cel ales în `PORT`).

---

## ⚙️ Setări (opțional)

În aplicație → **Setări → „Ecran client pe telefon"** poți totuși să:
- setezi manual **URL relay** (`ws://localhost:8080/` sau `ws://IP:PORT/`) și
- o **cameră** (ID unic per magazin, dacă ai mai multe case de marcat pe aceeași rețea).

Dacă lași URL-ul gol, `sync.js` folosește automat relay-ul de pe aceeași origine.

---

## ☁️ Găzduire pe internet (alternativă la localhost)

Pentru ca un telefon să se conecteze de oriunde (nu doar din rețeaua locală),
găzduiește același server pe un serviciu gratuit. Fiindcă servește și fișierele
statice, obții **tot POS-ul + relay-ul** la un singur URL.

### Render
1. New Web Service din repo. Root directory: `pos-system/server`.
2. Build Command: (gol) · Start Command: `node relay-server.js`.
3. Obții `https://pos-relay-xxxx.onrender.com`. Relay-ul e accesibil la
   `wss://pos-relay-xxxx.onrender.com/` (pui acest URL în Setări dacă vrei să
   forțezi o origine diferită de cea a POS-ului).

### Railway / Fly.io
La fel: punctul de intrare e `node relay-server.js` (portul e injectat prin `PORT`).

---

## 🔧 Variabile de mediu
| Variabilă | Implicit | Rol |
|---|---|---|
| `PORT` | `8080` | Portul pe care ascultă serverul (HTTP + WebSocket) |

## Protocol (pentru referință)
Mesaje JSON peste WebSocket:
```json
{ "type": "cart:update" | "payment:select" | "payment:done" | "cart:clear" | "client:hello" | "sync:ping",
  "payload": { }, "ts": 1690000000000, "room": "default" }
```
Serverul difuzează fiecare mesaj către **celelalte** conexiuni din aceeași `room`
și păstrează ultimul snapshot (`cart:update` / `payment:*` / `cart:clear`) pentru
clienții ce se conectează ulterior.
