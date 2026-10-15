self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
const TXT={ar:{title:'غرفة مقفولة',body:'هناك من يطرق الباب'},en:{title:'Locked Room',body:'Someone is knocking at the door'}};
self.addEventListener('push',event=>{
  let d={};try{if(event.data)d=event.data.json()}catch{}
  const lang=/^ar/i.test(d.lang||'')?'ar':'en',t=TXT[lang];
  event.waitUntil((async()=>{await self.registration.showNotification(d.title||t.title,{
    body:d.body||t.body,lang,dir:lang==='ar'?'rtl':'ltr',
    icon:d.icon||'/icon-192.png',badge:d.badge||'/badge-96.png',
    tag:d.tag||('locked-room-knock-'+Date.now()),requireInteraction:true,silent:false,
    vibrate:[220,90,220,90,380],timestamp:Date.now(),data:{url:d.url||'/'}
  });
  try{const all=(await self.registration.getNotifications()).filter(n=>(n.tag||'').startsWith('locked-room-knock')).sort((x,y)=>x.timestamp-y.timestamp);all.slice(0,Math.max(0,all.length-6)).forEach(n=>n.close())}catch{}
  })());
});
self.addEventListener('notificationclick',event=>{event.notification.close();const target=new URL(event.notification.data?.url||'/',self.location.origin).href;event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(async clients=>{for(const client of clients){if(new URL(client.url).origin===self.location.origin){if('navigate'in client)await client.navigate(target);return client.focus();}}return self.clients.openWindow(target);}));});
