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
self.addEventListener('push',event=>{
  let d={};try{if(event.data)d=event.data.json()}catch{}
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

// ===== فتح التطبيق من غير إنترنت: نحفظ شكل التطبيق (الصفحة والـ js والـ css والأيقونات) ونرجعله لو مفيش نت =====
const SHELL = 'lr-shell-v1';
const SHELL_PATHS = new Set(['/', '/index.html', '/app.js', '/style.css', '/logo.png', '/icon-192.png', '/app-icon.png', '/apple-touch-icon.png', '/badge-96.png']);
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !SHELL_PATHS.has(url.pathname)) return; // /api و /ws و /auth دايماً من الشبكة
  event.respondWith((async () => {
    const cache = await caches.open(SHELL);
    const key = new Request(url.pathname === '/index.html' ? '/' : url.pathname);
    try {
      // الشبكة الأول (عشان التحديثات توصل فوراً)، ولو بطيئة قوي نرجع للنسخة المحفوظة
      const net = fetch(req, { cache: 'no-store' });
      const res = await Promise.race([net, new Promise((_, rej) => setTimeout(() => rej(new Error('slow')), 6000))]);
      if (res && res.ok) cache.put(key, res.clone()).catch(() => {});
      return res;
    } catch {
      const hit = await cache.match(key, { ignoreSearch: true });
      if (hit) return hit;
      return fetch(req);
    }
  })());
});
