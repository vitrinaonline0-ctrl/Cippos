#!/usr/bin/env node
'use strict';

/* ==========================================================================
   relay-server.js — Server WebSocket de releu PENTRU SINCRONIZAREA
   ECRAN OPERATOR  ↔  ECRAN CLIENT (dispozitive diferite, ex: laptop + telefon)

   • Zero dependențe (doar modulul standard `http` + `crypto` din Node).
   • Rulează pe PORT (Render/Railway/Fly injectează PORT automat).
   • Organizează clienții în „camere” (room) — fiecare magazin folosește o
     cameră proprie, astfel încât magazinele nu se amestecă.
   • Păstrează ULTIMA stare cunoscută a cosului per cameră și o trimite
     imediat oricărui client nou conectat (telefonul deschis mai târziu
     afișează imediat comanda curentă).
   • Nu face echo către expeditor (operatorul nu-și primește propriul mesaj).
   • Heartbeat ping/pong pentru a detecta conexiunile moarte.

   Protocol mesaje (JSON):
     { "type": "cart:update" | "payment:select" | "payment:done" |
              "cart:clear" | "client:hello" | "sync:ping",
       "payload": { ... }, "ts": 1234567890, "room": "magazin-1" }
   ========================================================================== */

const http = require('http');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const PING_INTERVAL = 25000;          // ms — heartbeat
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_MSG = 1 * 1024 * 1024;      // 1 MB — plafon de siguranță

/* room -> Set<conn> ; room -> ultima stare snapshot */
const rooms = new Map();
const lastState = new Map();

/* --------------------------------------------------------------------------
   Server HTTP (doar pentru health-check; upgrade-ul WS se face separat)
   -------------------------------------------------------------------------- */
const server = http.createServer(function (req, res) {
  if (req.url === '/healthz' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('POS relay ok — ' + rooms.size + ' camere active\n');
    return;
  }
  res.writeHead(426, { 'Content-Type': 'text/plain' });
  res.end('Upgrade Required (folosește ws:// sau wss://)\n');
});

/* --------------------------------------------------------------------------
   Handshake WebSocket (RFC 6455)
   -------------------------------------------------------------------------- */
function acceptKey(key) {
  return crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
}

server.on('upgrade', function (req, socket, head) {
  const key = req.headers['sec-websocket-key'];
  const upgrade = (req.headers['upgrade'] || '').toLowerCase();
  if (!key || upgrade !== 'websocket') { socket.destroy(); return; }

  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + acceptKey(key) + '\r\n\r\n'
  );

  createConnection(socket, head);
});

/* --------------------------------------------------------------------------
   Conexiune / frame parsing
   -------------------------------------------------------------------------- */
function createConnection(socket, head) {
  let buffer = Buffer.isBuffer(head) && head.length ? Buffer.from(head) : Buffer.alloc(0);
  const conn = { socket: socket, room: null, isAlive: true, frags: null, fin: false };

  socket.on('data', function (chunk) {
    buffer = Buffer.concat([buffer, chunk]);
    let frame;
    while ((frame = parseFrame(buffer)) !== null) {
      if (frame === false) break;        // date insuficiente → așteaptă
      buffer = frame.rest;
      handleFrame(conn, frame);
      if (socket.destroyed) break;
    }
  });

  socket.on('close', function () { leave(conn); });
  socket.on('error', function () { try { socket.destroy(); } catch (e) {} });

  return conn;
}

/* Întoarce null = așteaptă mai multe date, false = neverosimil, sau frame-ul */
function parseFrame(buf) {
  if (buf.length < 2) return null;
  const b0 = buf[0];
  const b1 = buf[1];
  const fin = (b0 & 0x80) !== 0;
  const opcode = b0 & 0x0f;
  const masked = (b1 & 0x80) !== 0;
  let len = b1 & 0x7f;
  let offset = 2;

  if (len === 126) {
    if (buf.length < offset + 2) return null;
    len = buf.readUInt16BE(offset);
    offset += 2;
  } else if (len === 127) {
    if (buf.length < offset + 8) return null;
    len = Number(buf.readBigUInt64BE(offset));
    offset += 8;
  }

  let maskKey = null;
  if (masked) {
    if (buf.length < offset + 4) return null;
    maskKey = buf.slice(offset, offset + 4);
    offset += 4;
  }

  if (buf.length < offset + len) return null;     // payload incomplet
  if (len > MAX_MSG) { return false; }            // prea mare → ignoră

  let payload = buf.slice(offset, offset + len);
  if (masked) {
    const out = Buffer.allocUnsafe(len);
    for (let i = 0; i < len; i++) out[i] = payload[i] ^ maskKey[i & 3];
    payload = out;
  }

  return { fin: fin, opcode: opcode, payload: payload, rest: buf.slice(offset + len) };
}

function handleFrame(conn, frame) {
  const op = frame.opcode;

  if (op === 0x8) {                               // close
    try { sendFrame(conn.socket, 0x8, Buffer.alloc(0)); } catch (e) {}
    try { conn.socket.end(); } catch (e) {}
    leave(conn);
    return;
  }
  if (op === 0x9) {                               // ping → răspunde pong
    try { sendFrame(conn.socket, 0xA, frame.payload); } catch (e) {}
    return;
  }
  if (op === 0xA) {                               // pong
    conn.isAlive = true;
    return;
  }

  const isText = (op === 0x1 || op === 0x2);
  if (isText) {
    conn.frags = [frame.payload];
    conn.fin = frame.fin;
  } else if (op === 0x0) {                        // continuation (fragmentare)
    conn.frags = conn.frags || [];
    conn.frags.push(frame.payload);
    conn.fin = frame.fin;
  } else {
    return;                                       // opcode necunoscut
  }

  if (!conn.fin) return;                          // așteaptă fragmentele următoare

  const full = Buffer.concat(conn.frags || []);
  conn.frags = null;
  conn.fin = false;

  let msg;
  try { msg = JSON.parse(full.toString('utf8')); } catch (e) { return; }
  onMessage(conn, msg);
}

/* --------------------------------------------------------------------------
   Logică mesaje
   -------------------------------------------------------------------------- */
const SNAPSHOT_TYPES = {
  'cart:update': true,
  'payment:select': true,
  'payment:done': true,
  'cart:clear': true
};

function sanitizeRoom(r) {
  if (typeof r !== 'string') return 'default';
  r = r.trim().slice(0, 64);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(r)) return 'default';
  return r;
}

function onMessage(conn, msg) {
  if (!msg || typeof msg !== 'object') return;
  const room = sanitizeRoom(msg.room);

  // (Re)alocă camera și trimite imediat ultima stare cunoscută
  if (conn.room !== room) {
    if (conn.room) leaveRoom(conn, conn.room);
    joinRoom(conn, room);
    const ls = lastState.get(room);
    if (ls) {
      try { sendFrame(conn.socket, 0x1, Buffer.from(JSON.stringify(ls))); } catch (e) {}
    }
  }

  // Ping de sănătate
  if (msg.type === 'sync:ping') {
    try {
      sendFrame(conn.socket, 0x1, Buffer.from(JSON.stringify({
        type: 'sync:pong', ts: Date.now(), room: room
      })));
    } catch (e) {}
    return;
  }

  if (!msg.type) return;

  // Salvează snapshot-ul pentru clienții ce se conectează ulterior
  if (SNAPSHOT_TYPES[msg.type]) {
    lastState.set(room, {
      type: msg.type,
      payload: msg.payload || {},
      ts: msg.ts || Date.now()
    });
  }

  // Difuzează către CELELALTE conexiuni din aceeași cameră (fără echo)
  broadcast(room, conn, msg);
}

function broadcast(room, fromConn, msg) {
  const set = rooms.get(room);
  if (!set) return;
  let data;
  try { data = Buffer.from(JSON.stringify(msg)); } catch (e) { return; }
  set.forEach(function (c) {
    if (c === fromConn) return;                   // nu trimite înapoi expeditorului
    try { sendFrame(c.socket, 0x1, data); } catch (e) { /* mort */ }
  });
}

function joinRoom(conn, room) {
  if (!rooms.has(room)) rooms.set(room, new Set());
  rooms.get(room).add(conn);
  conn.room = room;
}

function leaveRoom(conn, room) {
  const set = rooms.get(room);
  if (set) {
    set.delete(conn);
    if (!set.size) { rooms.delete(room); lastState.delete(room); }
  }
  if (conn.room === room) conn.room = null;
}

function leave(conn) {
  if (conn.room) leaveRoom(conn, conn.room);
}

/* --------------------------------------------------------------------------
   Trimitere frame (server → client, NEMASCAT)
   -------------------------------------------------------------------------- */
function sendFrame(socket, opcode, payload) {
  if (!socket || socket.destroyed) throw new Error('socket distrus');
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.allocUnsafe(2);
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.allocUnsafe(4);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.allocUnsafe(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  header[0] = 0x80 | opcode;                      // FIN + opcode
  socket.write(Buffer.concat([header, payload]));
}

/* --------------------------------------------------------------------------
   Heartbeat — închide conexiunile care nu răspund la ping
   -------------------------------------------------------------------------- */
setInterval(function () {
  rooms.forEach(function (set) {
    set.forEach(function (c) {
      if (!c.isAlive) {
        try { c.socket.destroy(); } catch (e) {}
        leave(c);
        return;
      }
      c.isAlive = false;
      try { sendFrame(c.socket, 0x9, Buffer.alloc(0)); } catch (e) { try { c.socket.destroy(); } catch (_) {} }
    });
  });
}, PING_INTERVAL);

server.listen(PORT, function () {
  console.log('[POS relay] ascultă pe portul ' + PORT);
});
