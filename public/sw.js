self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
const TXT={ar:{title:'غرفة مقفولة',body:'هناك من يطرق الباب'},en:{title:'Locked Room',body:'Someone is knocking at the door'}};
// لو الطرق وصل متأخر (الجهاز كان أوفلاين) نكتب وقت الطرق الحقيقي بتوقيت جهازك.
function knockBody(at,lang){
  const ar=lang==='ar',d=new Date(at),n=new Date(),loc=ar?'ar-EG':'en-US';
  const tm=d.toLocaleTimeString(loc,{hour:'numeric',minute:'2-digit'});
  const y=new Date(n);y.setDate(y.getDate()-1);
  let day='';
  if(d.toDateString()===n.toDateString())day='';
  else if(d.toDateString()===y.toDateString())day=ar?'أمس':'yesterday';
  else day=d.toLocaleDateString(loc,{day:'numeric',month:'short'});
  return ar?'هناك من طرق الباب '+(day?day+' ':'')+'الساعة '+tm:'Someone knocked at the door '+(day?day+' ':'')+'at '+tm;
}
// بنسجّل الطرق (رقم الغرفة + الوقت) في IndexedDB عشان التطبيق يعرض صورة اللي طرق في قايمة المحادثات حتى لو كان مقفول.
function saveKnock(rid,at){return new Promise(res=>{try{const r=indexedDB.open('lr-knocks',1);r.onupgradeneeded=()=>r.result.createObjectStore('k');r.onerror=()=>res();r.onsuccess=()=>{const db=r.result,tx=db.transaction('k','readwrite');tx.objectStore('k').put(at,rid);tx.oncomplete=()=>{db.close();res()};tx.onerror=()=>{db.close();res()}}}catch{res()}})}
self.addEventListener('push',event=>{
  let d={};try{if(event.data)d=event.data.json()}catch{}
  if(d.kind!=='update'&&typeof d.rid==='string'&&/^[0-9a-f]{64}$/.test(d.rid)){event.waitUntil(saveKnock(d.rid,d.at||Date.now()).then(()=>self.clients.matchAll({type:'window',includeUncontrolled:true})).then(cs=>cs.forEach(c=>c.postMessage({lrKnock:1}))))}
  if(d.kind==='update'){try{self.registration.update()}catch{}}
  const lang=/^ar/i.test(d.lang||'')?'ar':'en',t=TXT[lang];
  event.waitUntil((async()=>{await self.registration.showNotification(d.title||t.title,{
    body:(d.at&&d.kind!=='update'&&Date.now()-d.at>30000)?knockBody(d.at,lang):(d.body||t.body),lang,dir:lang==='ar'?'rtl':'ltr',
    icon:d.icon||'/icon-192.png',badge:d.badge||'/badge-96.png',
    tag:d.tag||('locked-room-knock-'+Date.now()),requireInteraction:true,silent:false,
    vibrate:[220,90,220,90,380],timestamp:d.at||Date.now(),data:{url:d.url||'/'}
  });
  try{const all=(await self.registration.getNotifications()).filter(n=>(n.tag||'').startsWith('locked-room-knock')).sort((x,y)=>x.timestamp-y.timestamp);all.slice(0,Math.max(0,all.length-6)).forEach(n=>n.close())}catch{}
  })());
});
self.addEventListener('notificationclick',event=>{event.notification.close();const target=new URL(event.notification.data?.url||'/',self.location.origin).href;event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(async clients=>{for(const client of clients){if(new URL(client.url).origin===self.location.origin){if('navigate'in client)await client.navigate(target);return client.focus();}}return self.clients.openWindow(target);}));});

// ===== فتح التطبيق من غير إنترنت + سرعة على النت الضعيف (1.31.4) =====
// - app.js و style.css بيتطلبوا بـ ?v=رقم-الإصدار (بيتغير مع كل نشر) فبنحفظهم ونقدّمهم من الكاش على طول من غير تحميل تاني.
// - اللوجو والأيقونات: من الكاش على طول وبنجدّدهم في الخلفية.
// - الصفحة (/): الشبكة الأول عشان التحديثات توصل فوراً، ولو بطيئة نرجع للمحفوظة، ولو وصلت متأخر نحفظها للمرة الجاية.
const SHELL = 'lr-shell-v2';
const PAGE_PATHS = new Set(['/', '/index.html']);
const CODE_PATHS = new Set(['/app.js', '/style.css']);
const ICON_PATHS = new Set(['/logo.png', '/icon-192.png', '/app-icon.png', '/apple-touch-icon.png', '/badge-96.png']);
self.addEventListener('activate', e => e.waitUntil((async () => {
  try { for (const k of await caches.keys()) if (k.startsWith('lr-shell-') && k !== SHELL) await caches.delete(k); } catch {}
})()));
async function networkFirst(p, req) {
  const cache = await caches.open(SHELL);
  const key = new Request(p === '/index.html' ? '/' : p);
  const net = fetch(req, { cache: 'no-store' });
  net.then(res => { if (res && res.ok) cache.put(key, res.clone()).catch(() => {}); }, () => {});
  try {
    return await Promise.race([net, new Promise((_, rej) => setTimeout(() => rej(new Error('slow')), 4000))]);
  } catch {
    const hit = await cache.match(key, { ignoreSearch: true });
    return hit || fetch(req);
  }
}
async function versioned(url, req) {
  const cache = await caches.open(SHELL);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res && res.ok) {
      cache.put(req, res.clone()).then(async () => {
        for (const k of await cache.keys()) { const u = new URL(k.url); if (u.pathname === url.pathname && u.search !== url.search) cache.delete(k); }
      }).catch(() => {});
    }
    return res;
  } catch {
    return (await cache.match(url.pathname, { ignoreSearch: true })) || Response.error();
  }
}
async function iconFirst(event, p, req) {
  const cache = await caches.open(SHELL);
  const hit = await cache.match(p);
  if (hit) {
    event.waitUntil(fetch(req, { cache: 'no-cache' }).then(res => { if (res && res.ok) return cache.put(p, res); }).catch(() => {}));
    return hit;
  }
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(p, res.clone()).catch(() => {});
    return res;
  } catch { return Response.error(); }
}
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url), p = url.pathname;
  if (url.origin !== self.location.origin) return;
  if (PAGE_PATHS.has(p)) return event.respondWith(networkFirst(p, req));
  if (CODE_PATHS.has(p)) return event.respondWith(url.searchParams.has('v') ? versioned(url, req) : networkFirst(p, req));
  if (ICON_PATHS.has(p)) return event.respondWith(iconFirst(event, p, req));
  // /api و /ws و /auth دايماً من الشبكة
});
