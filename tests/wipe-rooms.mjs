// مسح الحساب: Account.noteRooms/wipeAccount بيرجّعوا الغرف، وRoomPasswords.purgeRoom بتحرّر باسورد الغرفة (unit)
import { readFileSync, writeFileSync } from 'node:fs';
const src = readFileSync('./src/worker.js', 'utf8').replace("import { DurableObject } from 'cloudflare:workers';", 'class DurableObject{constructor(ctx,env){this.ctx=ctx;this.env=env;}}').replace("import { connect } from 'cloudflare:sockets';", 'const connect=()=>{};');
writeFileSync('./src/.w-wipe.mjs', src);
const W = await import('../src/.w-wipe.mjs');
const mk = () => { const m = new Map(); return { m, ctx: { storage: {
  get: async (k) => Array.isArray(k) ? new Map(k.filter((x) => m.has(x)).map((x) => [x, m.get(x)])) : m.get(k),
  put: async (k, v) => { if (typeof k === 'object') for (const [a, b] of Object.entries(k)) m.set(a, b); else m.set(k, v); },
  delete: async (k) => { if (Array.isArray(k)) k.forEach((x) => m.delete(x)); else m.delete(k); },
  list: async () => new Map(m) }, blockConcurrencyWhile: (f) => f() } }; };
let fails = 0; const t = (n, c) => { console.log((c ? 'PASS' : 'FAIL') + '  ' + n); if (!c) fails++; };
const R1 = 'a'.repeat(64), R2 = 'b'.repeat(64);
const a = mk(); const acc = new W.Account(a.ctx, { SESSION_SECRET: 'x'.repeat(40) });
await acc.noteRooms([R1, R2, 'bad', R1]);
t('noteRooms: بيسجّل الصالح بس ومن غير تكرار', JSON.stringify(a.m.get('rooms')) === JSON.stringify([R1, R2]));
a.m.set('pw', { s: 's', h: 'h', i: 1 }); a.m.set('recOk', { d: 'D1', exp: Date.now() + 1e5 }); a.m.set('vault', { salt: 'x' });
const r = await acc.wipeAccount('D1');
t('wipeAccount بيرجّع الغرف', r.ok && r.rooms.length === 2 && r.rooms[0] === R1);
t('وبيمسح بيانات الحساب (الـ vault والغرف)', !a.m.has('vault') && !a.m.has('rooms') && !a.m.has('pw'));
const b = mk(); const reg = new W.RoomPasswords(b.ctx, {});
await reg.reserve('FP', 'RID');
t('الباسورد مستخدم', await reg.isUsed('FP'));
await reg.purgeRoom('RID');
t('بعد المسح الباسورد اتحرّر والغرفة مش فعّالة', !(await reg.isUsed('FP')) && !(await reg.isActive('RID')));
t('وتتعلّم ممسوحة', (await reg.reserve('FP2', 'RID')) === 'deleted');
console.log(fails ? fails + ' FAILED' : 'ALL OK');
import('node:fs').then((fs) => fs.unlinkSync('./src/.w-wipe.mjs')); process.exit(fails ? 1 : 0);
