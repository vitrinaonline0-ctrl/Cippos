# 🛒 POS System — Casa de marcat pentru web

Sistem **POS (Point of Sale)** complet, profesional și responsive, scris în **HTML5 + CSS3 + JavaScript vanilla**,
fără dependențe externe. Gata de încărcat pe **Netlify** (sau orice hosting static).

Include **două interfețe sincronizate în timp real**:

| Interfață | Țintă | Rezoluție optimizată |
|---|---|---|
| **Ecran operator** | laptop / terminal de casă | 1920 × 1080 (grid 3 coloane 25% / 50% / 25%) |
| **Ecran client** | telefon montat la casă | 540 × 960 (full width, vertical) |

---

## 🚀 Pornire rapidă (60 secunde)

Aplicația este 100 % statică — **nu are nevoie de build, npm sau backend**.

```bash
# varianta 1 — server local inclus în Python
cd pos-system
python3 -m http.server 8080
# → http://localhost:8080

# varianta 2 — Node
npx serve .

# varianta 3 — PHP
php -S 0.0.0.0:8080
```

> ⚠️ **Nu deschide `index.html` direct din fișier (`file://`).**
> Încărcarea `data/*.json`, Service Worker-ul și Web Crypto (hash parole) au nevoie de un server HTTP.

### Conturi demo (create automat la prima rulare)

| Rol | Utilizator | Parolă | Acces |
|---|---|---|---|
| 👑 Administrator | `admin` | `admin123` | tot (produse, operatori, rapoarte, setări) |
| 📊 Manager | `manager` | `manager123` | vânzări, produse, rapoarte, setări |
| 🛒 Operator | `operator` | `operator123` | doar vânzare |
| 👁 Vizualizare | `viewer` | `viewer123` | doar rapoarte (fără export) |

La prima deschidere aplicația face *seed* cu **22 produse**, **7 categorii**, **3 vouchere** și **6 operatori**
din `data/sample-products.json` și `data/sample-operators.json`.

---

## ☁️ Deploy pe Netlify

### Metoda A — drag & drop (cel mai rapid)
1. Deschide [app.netlify.com/drop](https://app.netlify.com/drop).
2. Trage **folderul `pos-system`** (nu arhiva, nu părintele lui) în fereastră.
3. Gata — primești un URL de tip `https://nume-aleator.netlify.app`.

### Metoda B — Netlify CLI
```bash
npm i -g netlify-cli
cd pos-system
netlify login
netlify deploy --prod --dir=.
```

### Metoda C — Git
1. Împinge folderul `pos-system` într-un repo.
2. Pe Netlify: **Add new site → Import from Git**.
3. Setări build: **Build command** = *(gol)*, **Publish directory** = `.` (sau `/pos-system` dacă repo-ul conține și alte fișiere).

> `netlify.toml` este deja configurat: cache pentru CSS/JS, `no-cache` pentru `sw.js`,
> headere de securitate și redirecturi `/login` și `/client`.

### După deploy — ecranul client pe telefon
1. În ecranul operator apasă **📱 Ecran client** (deschide `client-display.html` într-un tab nou).
2. Pe telefon deschide același URL `https://site-ul-tau.netlify.app/client-display.html`.
3. Ambele pagini trebuie să fie **în același browser, pe același dispozitiv**
   (sincronizarea folosește `BroadcastChannel` + `localStorage`, adică aceeași origine).
   Pentru un telefon separat ai nevoie de un mic server WebSocket — vezi [Limitări](#-limitări-cunoscute).

---

## 📁 Structura proiectului

```
pos-system/
├── index.html              → pagina de login
├── pos.html                → ecranul OPERATOR (vânzare, grid 3 coloane)
├── client-display.html     → ecranul CLIENT (telefon 540x960)
├── products.html           → gestiune produse (Admin/Manager)
├── operators.html          → gestiune operatori (Admin)
├── reports.html            → rapoarte & analitice
├── settings.html           → setări, backup, jurnal audit
├── sw.js                   → Service Worker (offline-first)
├── manifest.webmanifest    → PWA (instalabil pe ecranul de pornire)
├── netlify.toml            → configurare deploy Netlify
│
├── css/
│   ├── style.css           → design system: culori, tipografie, tabele, butoane, modale
│   ├── components.css      → componente: login, POS 3 coloane, ecran client, grafice, setări
│   └── responsive.css      → breakpoints: 480 / 540 / 768 / 1024 / 1440
│
├── js/
│   ├── app.js              → STATE MANAGEMENT: Store (localStorage+IndexedDB), seed,
│   │                          permisiuni pe roluri, sesiune cu timeout, jurnal, header comun
│   ├── utils.js            → formatare RO, SHA-256 + salt, CSV, toast, dialoguri, escape HTML
│   ├── auth.js             → autentificare, validări, protecție la forțarea parolei
│   ├── db.js               → strat IndexedDB (backup rezilient)
│   ├── sync.js             → sincronizare operator ↔ ecran client (BroadcastChannel + storage)
│   ├── pos-handler.js      → logică vânzare: coș, discounturi, TVA, plată, bon, suspendare
│   ├── client-display.js   → randare ecran client + mesaj „Mulțumim!”
│   ├── products.js         → CRUD produse, import/export CSV, imagini base64, categorii
│   ├── operators.js        → CRUD operatori, resetare parolă, matrice de permisiuni
│   ├── reports.js          → KPI-uri, grafice SVG, rapoarte zi/perioadă/operator/stoc, PDF/CSV
│   └── settings.js         → parametri, vouchere, backup/restore, jurnal audit
│
├── data/
│   ├── sample-products.json    → 22 produse + 7 categorii + 3 vouchere
│   └── sample-operators.json   → 6 operatori (parolele se hash-uiesc la seed)
│
└── scripts/
    └── sample-import.csv       → exemplu de fișier pentru import produse
```

---

## 🧩 Module implementate

### 1. Autentificare & control de acces
- Login cu utilizator **sau** email, validări client-side.
- **4 roluri**: Admin / Manager / Operator / Vizualizare, cu matrice de permisiuni în `app.js → ROLE_PERMS`.
- **Sesiune cu timeout automat de 15 minute** (configurabil în Setări), cronometru vizibil în header,
  avertizare în ultimele 60 s, deconectare automată logată în audit.
- **Blocare temporară** după 5 încercări eșuate (60 s).
- **Jurnal de activitate** per utilizator (max. 1000 intrări, exportabil CSV).

### 2. Ecran operator — grid 3 coloane
| Stânga (25 %) | Centru (50 %) | Dreapta (25 %) |
|---|---|---|
| Căutare rapidă (nume / SKU / cod de bare) | Coș: Produs · Cant · Preț unit · Subtotal · Acțiuni | Date operator |
| Suport scaner hardware (tastează + Enter) | Discount fix / procent / voucher | Metode de plată: Numerar, Card, Cec, Bilet valoric |
| Filtru categorii + grilă de produse | Note comandă | Plateste (F2) · Suspenda (F8) · Anuleaza (F4) |
| Istoric comenzi din sesiune | Subtotal → TVA 19 % → **Total** | Mini-raport zi (vânzări, tranzacții, medie coș) |

Extra: recuperare coș după refresh, comenzi suspendate/reluate, alertă stoc minim,
bon fiscal cu previzualizare și tipărire, tastatură numerică pentru numerar, calcul automat rest.

### 3. Ecran client (telefon)
Produse cu imagine/emoji, cantitate și preț pe linie, subtotal, discount, TVA, **total mare**,
metoda de plată și ecran **„Mulțumim!”** cu numărul chitanței și restul de returnat (revine automat după 8 s).

### 4. Gestiune produse
Tabel ID · Cod bare · Nume · Preț · Stoc · Categorie · Status · Acțiuni · CRUD complet ·
**import CSV** (cu previzualizare, creare automată de categorii, upsert pe SKU) · **export CSV** ·
**upload imagine** (redimensionată la 320 px, salvată base64) · categorii dinamice · alertă stoc minim.

### 5. Gestiune operatori
Tabel Nume · Email · Rol · Ultima logare · Status · Acțiuni · creare · **resetare parolă** (cu generator) ·
activare/dezactivare · ștergere (cu protecții: nu te poți șterge/dezactiva singur, trebuie să rămână un admin) ·
matrice de permisiuni · **export CSV**.

### 6. Rapoarte & analitice
- **Dashboard KPI**: vânzări lunare, tranzacții, clienți serviți, rată comenzi anulate, medie coș, TVA colectată.
- **Raport zi**: vânzări, tranzacții, medie coș, TVA, discounturi, top 10 produse, grafic pe ore, listă tranzacții.
- **Raport perioadă**: interval liber + scurtături (azi / 7 / 30 / luna curentă), **grafic bare sau linie**,
  top 10, metode de plată, defalcare pe zile.
- **Raport operator**: tranzacții, produse, medie coș, vânzări, pondere + grafic comparativ.
- **Raport stoc**: valoare stoc total, unități, produse sub minim (cu cantitate de comandat), valoare pe categorii.
- **Export PDF** (prin fereastra de print, cu CSS dedicat) și **CSV** pentru toate rapoartele.

### 7. Setări & configurare
Date firmă, **cotă TVA** și mod de calcul (prețuri cu/fără TVA), **monedă**, **ora început/sfârșit zi de lucru**,
prefix chitanță, timeout sesiune, prag stoc minim, notificări stoc,
**vouchere**, **backup/restore JSON**, restaurare din IndexedDB, informații despre spațiul ocupat,
**jurnal de audit** cu filtru și export, zonă de resetare (doar Admin).

---

## 🎨 Design system

| Element | Valoare |
|---|---|
| Culoare header | `#2c3e50` |
| Culoare succes | `#27ae60` |
| Culoare alertă | `#e74c3c` |
| Font | `'Segoe UI', sans-serif` |
| Unitate de spațiere | `16px` (`--space-4`) |
| Înălțime minimă buton | `44px` (touch-friendly) |
| Tranziții | `200ms ease-in-out` |

Toate variabilele sunt în `:root` din `css/style.css` — schimbi tema dintr-un singur loc.

---

## 💾 Stocarea datelor

| Strat | Rol |
|---|---|
| `localStorage` | sursa primară, sincronă, rapidă |
| `IndexedDB` | backup automat (scriere întârziată 250 ms) — restaurează datele dacă `localStorage` e golit |
| `Service Worker` | cache pentru shell → aplicația pornește **offline** |

Chei folosite: `pos.users`, `pos.products`, `pos.categories`, `pos.vouchers`, `pos.orders`,
`pos.activity`, `pos.settings`, `pos.session`, `pos.cart`, `pos.initialized`, `pos.clientState`, `pos.sync.bus`.

**Backup:** `Setări → Exportă backup (JSON)` → conține tot (setări, utilizatori cu hash, produse, comenzi, jurnal).
**Restore:** din fișier sau din IndexedDB.

---

## 🔒 Securitate

- Parole stocate **doar ca hash SHA-256 cu salt aleator de 16 octeți** (`crypto.subtle.digest`);
  există și un fallback SHA-256 scris în JS pentru contexte non-securizate.
- **Nicio parolă nu iese în clar** — nici în localStorage, nici în backup, nici în jurnal.
- Sesiuni cu expirare, timeout de inactivitate și deconectare automată.
- Toate datele randate în DOM trec prin `Utils.esc()` → **protecție XSS** (testată).
- Validări client-side la fiecare formular (lungimi, email, unicitate SKU / cod de bare / username,
  intervale numerice, coerență program de lucru).
- Control de acces la nivel de pagină **și** de acțiune (`App.can(user, 'products.edit')`).
- Headere de securitate în `netlify.toml` (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`).

> ℹ️ Aceasta este o aplicație **client-side**: datele trăiesc în browserul dispozitivului.
> Pentru multi-utilizator pe mai multe stații și pentru bonuri cu valoare fiscală reală ai nevoie de un backend
> și de integrare cu un serviciu de e-Factura / casă de marcat.

---

## ⚡ Performanță

- **Zero dependențe externe** (fără framework, fără CDN, fără fonturi externe) → nimic de blocat la încărcare.
- Aplicația completă are **270 KB** brut (23 fișiere HTML/CSS/JS) și **~35 KB comprimat (gzip)**
  pentru tot ce încarcă ecranul de vânzare → mult sub bugetul pentru încărcare < 2 s,
  inclusiv pe conexiuni mobile.
- CSS împărțit pe 3 fișiere cu `Cache-Control: immutable`; `sw.js` cu `no-cache`.
- Service Worker cu *stale-while-revalidate* → a doua deschidere e instantanee, inclusiv offline.
- Scrierile în IndexedDB sunt întârziate (debounce 250 ms) și actualizările de sesiune sunt limitate.

---

## 🧪 Teste

În folderul vecin `pos-tests` există o suită de **330 de teste funcționale** care rulează paginile reale
într-un browser simulat (jsdom) și execută fluxurile complete: login, permisiuni, coș, TVA, discounturi,
plată, stoc, ecran client, CRUD produse/operatori, import/export CSV, rapoarte, grafice, setări, backup, jurnal.

```bash
cd pos-tests
npm i jsdom
node run-tests.mjs
```

```
Rezultat: 330 trecute, 0 esuate
```

Suitele acoperă și cazuri de eșec: parolă greșită, cont dezactivat, SKU duplicat, stoc insuficient,
discount peste valoarea coșului, voucher inexistent, TVA invalidă, XSS în numele produsului, JSON corupt,
lipsa IndexedDB.

---

## ⚠️ Limitări cunoscute

1. **Datele sunt locale.** Fiecare browser/dispozitiv are propria bază. Backup/restore JSON este mecanismul
   de mutare a datelor.
2. **Sincronizarea operator ↔ client** funcționează între tab-uri din același browser.
   Pentru un telefon separat (client display pe alt dispozitiv) adaugă un canal WebSocket/Firebase —
   `js/sync.js` este deja izolat, trebuie înlocuit doar transportul.
3. **Imaginile produselor** se stochează base64 în `localStorage` (limita ~5 MB).
   Aplicația redimensionează automat la 320 px/JPEG; pentru cataloage mari folosește emoji + culoare.
4. **Bonul** este o chitanță informativă (HTML → print). Nu substituie integrarea cu o casă de marcat fiscală.
5. **Hash-ul parolei** este client-side — suficient pentru a nu stoca parole în clar,
   dar nu înlocuiește autentificarea server-side într-un sistem multi-utilizator.

---

## 🛠 Personalizare rapidă

| Vrei să schimbi | Unde |
|---|---|
| Culori, font, spațieri | `css/style.css` → blocul `:root` |
| Cotă TVA, monedă, prefix bon, timeout | pagina **Setări** |
| Permisiunile rolurilor | `js/app.js` → `ROLE_PERMS` |
| Produsele inițiale | `data/sample-products.json` |
| Metodele de plată | `js/pos-handler.js` → `PAY_METHODS` |
| Datele firmei de pe bon | pagina **Setări** → „Date firmă & fiscalitate” |
| Resetare la datele demo | **Setări → Zonă periculoasă → Resetează toate datele** |

---

## 📄 Licență

Cod sursă liber pentru utilizare și modificare.
