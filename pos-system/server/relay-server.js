#!/usr/bin/env node
'use strict';

/* ==========================================================================
   relay-server.js — Server combinat PENTRU SINCRONIZAREA
   ECRAN OPERATOR  ↔  ECRAN CLIENT  (pe localhost / rețea locală)

   Un singur proces, un singur port, două roluri:
     1) Servește fișierele statice ale POS-ului (index.html, js/, css/ …)
        → deschizi http://localhost:8080 in browser.
     2) Ține un relay WebSocket pentru sincronizarea operator ↔ client.

   Astfel, pe localhost (sau rețeaua locală) totul merge FĂRĂ configurare:
   sync.js se conectează automat la relay-ul de pe aceeași origine.
   Pentru producție poți găzdui același server pe Render/Railway/Fly.

   • Zero dependențe (doar http, crypto, fs, path din Node).
   • Organizează clienții în „camere” (room) — fiecare magazin folosește o
     cameră proprie, astfel încât magazinele nu se amestecă.
   • Păstrează ULTIMA stare cunoscută a cosului per cameră și o trimite
     imediat oricărui client nou conectat.
   • Nu face echo către expeditor.
   • Heartbeat ping/pong pentru a detecta conexiunile moarte.
   ========================================================================== */

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8080;
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const PING_INTERVAL = 25000;
const MAX_MSG = 1 * 1024 * 1024;

/* Directorul cu fișierele statice = dosarul părinte (pos-system) */
const STATIC_DIR = path.resolve(__dirname, '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json'
};

/* room -> Set<conn> ; room -> ultima stare snapshot */
const rooms = new Map();
const lastState = new Map();

/* --------------------------------------------------------------------------
   Server HTTP (fișiere statice + health-check; upgrade-ul WS altundeva)
   -------------------------------------------------------------------------- */
const server = http.createServer(function (req, res) {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('POS relay + static ok — ' + rooms.size + ' camere active\n');
    return;
  }

  let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';

  // Rezolvă calea și blochează traversarea în afara STATIC_DIR
  const filePath = path.normalize(path.join(STATIC_DIR, urlPath));
  if (filePath !== STATIC_DIR && !filePath.startsWith(STATIC_DIR + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403 Forbidden\n');
    return;
  }

  fs.readFile(filePath, function (err, data) {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found\n');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
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
      if (frame === false) break;
      buffer = frame.rest;
      handleFrame(conn, frame);
      if (socket.destroyed) break;
    }
  });

  socket.on('close', function () { leave(conn); });
  socket.on('error', function () { try { socket.destroy(); } catch (e) {} });

  return conn;
}

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

  if (buf.length < offset + len) return null;
  if (len > MAX_MSG) return false;

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

  if (op === 0x8) {
    try { sendFrame(conn.socket, 0x8, Buffer.alloc(0)); } catch (e) {}
    try { conn.socket.end(); } catch (e) {}
    leave(conn);
    return;
  }
  if (op === 0x9) {
    try { sendFrame(conn.socket, 0xA, frame.payload); } catch (e) {}
    return;
  }
  if (op === 0xA) {
    conn.isAlive = true;
    return;
  }

  const isText = (op === 0x1 || op === 0x2);
  if (isText) {
    conn.frags = [frame.payload];
    conn.fin = frame.fin;
  } else if (op === 0x0) {
    conn.frags = conn.frags || [];
    conn.frags.push(frame.payload);
    conn.fin = frame.fin;
  } else {
    return;
  }

  if (!conn.fin) return;

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

  if (conn.room !== room) {
    if (conn.room) leaveRoom(conn, conn.room);
    joinRoom(conn, room);
    const ls = lastState.get(room);
    if (ls) {
      try { sendFrame(conn.socket, 0x1, Buffer.from(JSON.stringify(ls))); } catch (e) {}
    }
  }

  if (msg.type === 'sync:ping') {
    try {
      sendFrame(conn.socket, 0x1, Buffer.from(JSON.stringify({
        type: 'sync:pong', ts: Date.now(), room: room
      })));
    } catch (e) {}
    return;
  }

  if (!msg.type) return;

  if (SNAPSHOT_TYPES[msg.type]) {
    lastState.set(room, {
      type: msg.type,
      payload: msg.payload || {},
      ts: msg.ts || Date.now()
    });
  }

  broadcast(room, conn, msg);
}

function broadcast(room, fromConn, msg) {
  const set = rooms.get(room);
  if (!set) return;
  let data;
  try { data = Buffer.from(JSON.stringify(msg)); } catch (e) { return; }
  set.forEach(function (c) {
    if (c === fromConn) return;
    try { sendFrame(c.socket, 0x1, data); } catch (e) {}
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
  header[0] = 0x80 | opcode;
  socket.write(Buffer.concat([header, payload]));
}

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
  console.log('[POS] server combinat pe http://localhost:' + PORT +
    '  (relay WebSocket pe aceeasi origine)');
});
