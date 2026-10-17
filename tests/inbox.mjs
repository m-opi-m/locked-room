// Room.inbox: عدّ الرسايل الجديدة + تعليم "وصلت" (unit، من غير سيرفر)
import { readFileSync, writeFileSync } from 'node:fs';
const src = readFileSync('./src/worker.js', 'utf8').replace("import { DurableObject } from 'cloudflare:workers';", 'class DurableObject{constructor(ctx,env){this.ctx=ctx;this.env=env;}}').replace("import { connect } from 'cloudflare:sockets';", 'const connect=()=>{};');
writeFileSync('./src/.w-inbox.mjs', src);
const W = await import('../src/.w-inbox.mjs');
const m = new Map();
const sent = [];
const ctx = { storage: { get: async (k) => Array.isArray(k) ? new Map(k.filter((x) => m.has(x)).map((x) => [x, m.get(x)])) : m.get(k), put: async (k, v) => { if (typeof k === 'object') for (const [a, b] of Object.entries(k)) m.set(a, b); else m.set(k, v); }, delete: async (k) => m.delete(k) }, blockConcurrencyWhile: (f) => f(), getWebSockets: () => [{ deserializeAttachment: () => ({ d: 'A' }), send: (x) => sent.push(x) }] };
const room = new W.Room(ctx, {});
let fails = 0; const t = (n, c) => { console.log((c ? 'PASS' : 'FAIL') + '  ' + n); if (!c) fails++; };
const mid = (i) => i.toString(16).padStart(32, '0');
m.set('members', { A: { d: 'A' }, B: { d: 'B' } });
const N = 130;
for (let i = 0; i < N; i++) { m.set('history:' + i, { iv: 'x', ct: 'y', mid: mid(i), fromDid: i < 5 ? 'B' : 'A', delivered: false, read: i < 5 }); m.set('mid:' + mid(i), i); }
m.set('historyCount', N);
t('غير عضو = null', (await room.inbox('Z')) === null);
t('A: مفيش رسايل من B غير مقروءة', (await room.inbox('A')).n === 0);
// B بعتله A 125 رسالة (متقراش منها حاجة)
t('B: العدّاد بيقف عند 100', (await room.inbox('B')).n === 100);
t('B: اللي اتعدّ اتعلّم وصل', m.get('history:129').delivered === true && m.get('history:30').delivered === true);
t('A اتبلّغ بالوصول', sent.length >= 100 && JSON.parse(sent[0]).state === 'delivered');
for (let i = 5; i < N; i++) { const it = m.get('history:' + i); it.read = true; m.set('history:' + i, it); }
t('بعد القراءة العدّاد صفر', (await room.inbox('B')).n === 0);
m.set('history:' + N, { iv: 'x', ct: 'y', mid: mid(N), fromDid: 'A', delivered: false, read: false }); m.set('mid:' + mid(N), N); m.set('historyCount', N + 1);
t('رسالة جديدة = 1', (await room.inbox('B')).n === 1);
m.set('deleted', true);
t('غرفة ممسوحة = null', (await room.inbox('B')) === null);
console.log(fails ? fails + ' FAILED' : 'ALL OK'); process.exit(fails ? 1 : 0);
