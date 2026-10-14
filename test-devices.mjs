import { readFileSync, writeFileSync } from 'node:fs';
let src = readFileSync('./src/worker.js','utf8')
  .replace("import { DurableObject } from 'cloudflare:workers';","class DurableObject{constructor(ctx,env){this.ctx=ctx;this.env=env;}}");
writeFileSync('./.w-test.mjs', src);
const W = await import('./.w-test.mjs');
const SECRET = 'x'.repeat(40);
const accounts = new Map();
const mkCtx = () => { const m = new Map(); return { storage: {
  get: async (k) => Array.isArray(k) ? new Map(k.filter(x=>m.has(x)).map(x=>[x,m.get(x)])) : m.get(k),
  put: async (k,v) => { if (typeof k==='object') for (const [a,b] of Object.entries(k)) m.set(a,b); else m.set(k,v); },
  delete: async (k) => m.delete(k) }, blockConcurrencyWhile: (f) => f() }; };
const env = { SESSION_SECRET: SECRET,
  ACCOUNT: { idFromName: (n)=>n, get: (n)=>{ if(!accounts.has(n)) accounts.set(n,new W.Account(mkCtx(),env)); return accounts.get(n);} },
  ROOM: null, ASSETS: null };
const enc = new TextEncoder();
const b64u = (b)=>btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
async function pending(sub, did){ // نفس اللي بيعمله googleCallback
  const body = b64u(enc.encode(JSON.stringify({sub,email:'a@b.c',name:'T',did,ok:false,v:'',rs:false,exp:Date.now()+9e5})));
  const k = await crypto.subtle.importKey('raw',enc.encode(SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return body+'.'+b64u(await crypto.subtle.sign('HMAC',k,enc.encode(body)));
}
class Dev { constructor(name,did,ua){this.name=name;this.did=did;this.ua=ua;this.sid='';}
  async call(path, body, method){
    const h = { Cookie: `did=${this.did}; sid=${this.sid}`, 'User-Agent': this.ua, Origin:'http://localhost' };
    if (body) h['Content-Type']='application/json';
    const r = await W.default.fetch(new Request('http://localhost'+path,{method:method||(body?'POST':'GET'),headers:h,body:body?JSON.stringify(body):undefined}),env);
    for (const c of r.headers.getSetCookie?.()||[]) { const m=c.match(/^sid=([^;]*)/); if(m) this.sid=m[1]; }
    return { status:r.status, data: await r.json().catch(()=>({})) };
  }}
let fails=0; const t=(n,c)=>{ console.log((c?'PASS':'FAIL')+'  '+n); if(!c) fails++; };
const A = new Dev('A','a'.repeat(24),'Mozilla/5.0 (Linux; Android 14; SM-S918B) Chrome/120 Mobile Safari/537.36');
const B = new Dev('B','b'.repeat(24),'Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537.36');
A.sid = await pending('u1',A.did); B.sid = await pending('u1',B.did);
t('A new user -> s=new', (await A.call('/api/me')).data.s==='new');
t('A setup ok', (await A.call('/api/setup',{pw:'password-1'})).status===200);
t('A me ok', (await A.call('/api/me')).data.s==='ok');
t('B (pending) me -> unlock', (await B.call('/api/me')).data.s==='unlock');
t('B wrong pw -> 401', (await B.call('/api/login',{pw:'nope-nope'})).status===401);
t('B right pw -> 200', (await B.call('/api/login',{pw:'password-1'})).status===200);
t('B me ok', (await B.call('/api/me')).data.s==='ok');
const ka = (await A.call('/api/me')).data;
t('A now kicked', ka.s==='kicked');
t('kicked shows device name + time', /Windows/.test(ka.by.n) && ka.by.t>0);
// كان أنا
t('A ack -> 200', (await A.call('/api/ack',{})).status===200);
t('A after ack -> unlock (needs pw)', (await A.call('/api/me')).data.s==='unlock');
t('A login again ok', (await A.call('/api/login',{pw:'password-1'})).status===200);
t('B now kicked (A took it back)', (await B.call('/api/me')).data.s==='kicked');
// مش أنا
t('B notme', (await B.call('/api/notme',{})).status===200);
t('B state = reset', (await B.call('/api/me')).data.s==='reset');
// B بيحاول يعمل reset وهو الحقيقي في الاختبار ده، نعمل سيناريو مظبوط: A يطلع "مش أنا"
t('B login (take account back)... skip', true);
// سيناريو حقيقي: B (المهاجم) يدخل، A يقول مش أنا
const B2 = new Dev('B2','c'.repeat(24),'Mozilla/5.0 (iPhone) Safari/604.1'); B2.sid = await pending('u1',B2.did);
t('B2 logs in with old pw', (await B2.call('/api/login',{pw:'password-1'})).status===200);
t('A kicked by B2', (await A.call('/api/me')).data.s==='kicked');
t('A notme -> reset', (await A.call('/api/notme',{})).status===200 && (await A.call('/api/me')).data.s==='reset');
t('A cannot reset with short pw', (await A.call('/api/reset',{pw:'123'})).status===400);
t('A reset to new pw', (await A.call('/api/reset',{pw:'brand-new-pw'})).status===200);
t('A ok after reset', (await A.call('/api/me')).data.s==='ok');
t('B2 now blocked', (await B2.call('/api/me')).data.s==='blocked');
B2.sid = await pending('u1',B2.did);
t('B2 relogin w/ NEW pw blocked 403', (await B2.call('/api/login',{pw:'brand-new-pw'})).status===403);
B2.sid = await pending('u1',B2.did);
t('B2 old pw blocked too', (await B2.call('/api/login',{pw:'password-1'})).status===403);
// مش أنا بدون ما حد يكون اخد الحساب
t('reset w/o being kicked -> 409', (await A.call('/api/reset',{pw:'another-pw-1'})).status===409);
// ws: جلسة قديمة تتقفل
const mkWs=()=>({sent:[],closed:null,att:null,send(x){this.sent.push(x)},close(c,r){this.closed=[c,r]},serializeAttachment(a){this.att=a},deserializeAttachment(){return this.att}});
const socks=[]; const room = new W.Room({getWebSockets:()=>socks,acceptWebSocket:()=>{}},env);
const acc = env.ACCOUNT.get('u1'); const v = (await acc.ctx.storage.get('cur')).v;
const wa = mkWs(), wb = mkWs();
wa.att={c:0,reset:Date.now()+1e4,sub:'u1',v,d:A.did,ok:false,until:0};
wb.att={c:0,reset:Date.now()+1e4,sub:'u1',v:'stale-session',d:B.did,ok:false,until:0};
socks.push(wa,wb);
await room.webSocketMessage(wa, JSON.stringify({t:'msg',iv:'i',ct:'c'}));
t('valid sender not closed', wa.closed===null);
t('stale receiver closed 4001 + not sent msg', wb.closed?.[0]===4001 && !wb.sent.some(x=>x.includes('"msg"')));
const wc = mkWs(); wc.att={c:0,reset:Date.now()+1e4,sub:'u1',v:'stale',d:B.did,ok:false,until:0}; socks.length=0; socks.push(wa,wc);
await room.webSocketMessage(wc, JSON.stringify({t:'msg',iv:'i',ct:'c'}));
t('stale sender closed 4001, msg not relayed', wc.closed?.[0]===4001 && !wa.sent.some(x=>x.includes('"msg"')));
console.log(fails?`\n${fails} FAILED`:'\nALL PASSED');
