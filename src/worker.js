import { DurableObject } from 'cloudflare:workers';

const PAGES = new Set(['/', '/app.js', '/style.css']);
const MAX_MSG = 6 * 1024 * 1024;

function secHeaders(url, type) {
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  const conn = `'self' wss://${url.host}` + (local ? ` ws://${url.host}` : '');
  return {
    'Content-Type': type,
    'Content-Security-Policy': `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src ${conn}; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cache-Control': 'no-store',
  };
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    if (url.pathname === '/ws') {
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected websocket', { status: 426 });
      if (req.headers.get('Origin') !== url.origin) return new Response('Forbidden', { status: 403 });
      const r = url.searchParams.get('r') || '';
      if (!/^[0-9a-f]{64}$/.test(r)) return new Response('Bad request', { status: 400 });
      return env.ROOM.get(env.ROOM.idFromName(r)).fetch(req); // كل غرفة = Durable Object لوحدها
    }

    if (req.method !== 'GET' || !PAGES.has(url.pathname)) return new Response('Not found', { status: 404 });
    const res = await env.ASSETS.fetch(new Request(new URL(url.pathname, url)));
    return new Response(res.body, { status: res.status, headers: secHeaders(url, res.headers.get('Content-Type') || 'text/plain') });
  },
};

// الغرفة: بتحوّل رسايل مشفرة بين اتنين بس، ومفيش تخزين ولا لوج.
export class Room extends DurableObject {
  async fetch() {
    const { 0: client, 1: server } = new WebSocketPair();

    if (this.ctx.getWebSockets().length >= 2) {
      server.accept();
      server.send(JSON.stringify({ t: 'full' }));
      server.close(1008, 'full');
      return new Response(null, { status: 101, webSocket: client });
    }

    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ c: 0, reset: Date.now() + 10000 });
    const all = this.ctx.getWebSockets();
    server.send(JSON.stringify({ t: 'joined', n: all.length }));
    for (const p of all) if (p !== server) p.send(JSON.stringify({ t: 'peer', n: all.length }));
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws, data) {
    if (typeof data !== 'string' || data.length > MAX_MSG) return ws.close(1009, 'bad');
    const a = ws.deserializeAttachment() || { c: 0, reset: 0 };
    const now = Date.now();
    if (now > a.reset) { a.c = 0; a.reset = now + 10000; }
    if (++a.c > 40) return ws.close(1008, 'flood');
    ws.serializeAttachment(a);

    let m;
    try { m = JSON.parse(data); } catch { return ws.close(1003, 'bad'); }
    if (!m || m.t !== 'msg' || typeof m.iv !== 'string' || m.iv.length > 64 || typeof m.ct !== 'string') return;
    const out = JSON.stringify({ t: 'msg', iv: m.iv, ct: m.ct });
    for (const p of this.ctx.getWebSockets()) if (p !== ws) p.send(out);
  }

  webSocketClose(ws) { this.left(ws); }
  webSocketError(ws) { this.left(ws); }

  left(ws) {
    try { ws.close(1000, 'bye'); } catch {}
    const rest = this.ctx.getWebSockets().filter((s) => s !== ws);
    for (const p of rest) p.send(JSON.stringify({ t: 'peer', n: rest.length }));
  }
}
