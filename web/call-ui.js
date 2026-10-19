/* ---------- 1.17: واجهة المكالمة الجديدة (بيتضم جوه closure بتاع app.js وقت الـ build زي voice.js) ---------- */
const lrEn=()=>document.documentElement.lang==="en";
let lrToastEl=null,lrToastT=0;
function lrToast(msg){
  if(!lrToastEl){lrToastEl=document.createElement("div");lrToastEl.className="lrToast";lrToastEl.setAttribute("role","status");document.body.appendChild(lrToastEl)}
  lrToastEl.textContent=msg;lrToastEl.classList.add("show");
  clearTimeout(lrToastT);lrToastT=setTimeout(()=>lrToastEl.classList.remove("show"),3800);
}
/* ===== كروت المكالمة في الشات ===== */
function lrCallDur(s){
  const m=Math.floor(s/60),x=s%60;
  return lrEn()?(m?m+" min ":"")+x+" sec":(m?m+" د ":"")+x+" ث";
}
function lrCallCard(r,mine,at){
  const video=r.m==="video",missed=r.s==="missed",theirMiss=missed&&!mine,en=lrEn();
  const d=document.createElement("div");d.className="callLog"+(theirMiss?" missed":"");
  const top=document.createElement("div");top.className="callLogTop";
  const ic=document.createElement("span");ic.className="callLogIc";ic.innerHTML=uiIcon(video?"video":"phone");
  const tx=document.createElement("div");
  const ti=document.createElement("strong"),sb=document.createElement("small");
  const canc=missed&&r.c===1;
  ti.textContent=theirMiss?(canc?(video?(en?"Cancelled video call":"مكالمة فيديو اتلغت"):(en?"Cancelled audio call":"مكالمة صوت اتلغت")):video?(en?"Missed video call":"مكالمة فيديو فايتة"):(en?"Missed audio call":"مكالمة صوت فايتة")):(video?(en?"Video call":"مكالمة فيديو"):(en?"Audio call":"مكالمة صوت"));
  sb.textContent=missed?(mine?(r.c===1?(en?"Cancelled":"لغيت المكالمة"):r.c===2?(en?"Declined":"اترفضت"):(en?"No answer":"محدش رد")):oa(at||Date.now())):lrCallDur(Math.max(1,Number(r.d)||0));
  tx.append(ti,sb);top.append(ic,tx);
  const b=document.createElement("button");b.type="button";
  b.textContent=theirMiss?(en?"Call back":"اتصل بيه"):(en?"Call again":"اتصل تاني");
  b.onclick=()=>{
    if(v!=="idle"||A!==2){lrToast(en?"Can't call right now.":"مينفعش تتصل دلوقتي (الطرف التاني مش موجود أو في مكالمة).");return}
    On(video);
  };
  d.append(top,b);return d;
}
/* المتصل هو اللي بيبعت سجل المكالمة (عشان ميتكررش)، والطرفين بيشوفوه.
   لو الاتصال مقطوع أو الشات مش مفتوح لحظة نهاية المكالمة: السجل بيستنى ويتبعت أول ما الشروط تتحقق (lrCallFlush). */
let lrPendCall=null;
function lrCallLog(byMe){
  try{
    if(!lrCaller||!lrCRoom)return;
    const sec=window.lrConnAt?Math.max(1,Math.round((Date.now()-window.lrConnAt)/1e3)):0;
    const r={k:"call",m:window.lrWasVideo?"video":"audio",s:sec?"done":"missed",d:sec};
    if(!sec)r.c=window.lrNoAns?0:(byMe?1:2); /* 0=محدش رد · 1=المتصل كنسل · 2=التاني رفض/مشغول */
    window.lrNoAns=0;
    lrPendCall={room:lrCRoom,r,at:Date.now()};
    lrCallFlush();
  }catch{}
}
function lrCallFlush(){
  const q=lrPendCall;if(!q)return;
  if(Date.now()-q.at>6e5){lrPendCall=null;return}
  if(!u||u.readyState!==1||!te||q.room!==L||t("chat").classList.contains("hidden"))return;
  lrPendCall=null;
  Promise.resolve(Pe(q.r,lrCallCard(q.r,!0,Date.now()),"me")).then(ok=>{if(!ok&&!lrPendCall)lrPendCall=q}).catch(()=>{if(!lrPendCall)lrPendCall=q});
}
setInterval(lrCallFlush,1500);
/* ===== تشغيل الفيديو في المكالمة: شاشة اختيار الوضع ===== */
function lrSwapVideo(track){
  if(!g||!m)return;
  const old=g.getVideoTracks()[0];
  if(old){clearInterval(N);N=0;try{Ot(old,!1)}catch{}old.stop()}
  const sender=m.getSenders().find(f=>f.track&&f.track.kind==="video"||f.__lrV);
  if(sender){sender.replaceTrack(track).catch(()=>{});sender.__lrV=!0}
  else{g.addTrack(track);m.addTrack(track,g)}
  try{old&&g.removeTrack(old)}catch{}
  if(!g.getVideoTracks().includes(track))g.addTrack(track);
  track.enabled=!0;
  const lv=t("localVid");lv.srcObject=g;lv.play&&lv.play().catch(()=>{});
  t("call").classList.remove("camera-off");
  t("camIcon").innerHTML=uiIcon("camera");t("camLabel").textContent="إيقاف الكاميرا";t("camBtn").classList.remove("isOff");
  return sender;
}
async function lrStartVideo(track){
  const had=!!(g&&g.getVideoTracks().length&&m.getSenders().some(f=>f.track&&f.track.kind==="video"));
  lrSwapVideo(track);
  if(!had)await Rn();
  P({a:"camera",on:!0});Z();
}
async function lrFrontCam(){
  try{const x=await navigator.mediaDevices.getUserMedia({audio:!1,video:{width:{ideal:960},height:{ideal:540},frameRate:{ideal:24,max:24},facingMode:{ideal:"user"}}});return x.getVideoTracks()[0]||null}catch{return null}
}
async function lrCamPick(){
  if(document.getElementById("camPick"))return;
  const ov=document.createElement("div");ov.id="camPick";
  const vid=document.createElement("video");vid.autoplay=!0;vid.muted=!0;vid.playsInline=!0;
  const back=document.createElement("button");back.className="cpBack";back.type="button";back.setAttribute("aria-label","رجوع");back.innerHTML=uiIcon("arrow-left");
  const share=document.createElement("button");share.className="cpShare";share.type="button";share.textContent="مشاركة الفيديو";
  const tabs=document.createElement("div");tabs.className="cpTabs";
  const modes=[["user","الكاميرا الأمامية"],["environment","الكاميرا الخلفية"]];
  let mode="user",pv=null,gen=0;
  const stopPv=()=>{if(pv){pv.getTracks().forEach(x=>x.stop());pv=null}vid.srcObject=null};
  const close=()=>{gen++;stopPv();ov.remove()};
  const open=async md=>{
    mode=md;const my=++gen;
    tabs.querySelectorAll("button").forEach(b=>b.classList.toggle("on",b.dataset.m===md));
    stopPv();
    let st=null;
    try{st=await navigator.mediaDevices.getUserMedia({audio:!1,video:{width:{ideal:960},height:{ideal:540},frameRate:{ideal:24,max:24},facingMode:{ideal:md}}})}catch(e){if(my===gen)lrToast(mediaError(e,"camera"));return}
    if(my!==gen){st.getTracks().forEach(x=>x.stop());return}
    pv=st;vid.style.transform=md==="user"?"scaleX(-1)":"none";vid.srcObject=st;
  };
  for(const[md,lb]of modes){const b=document.createElement("button");b.type="button";b.dataset.m=md;b.textContent=lb;b.onclick=()=>open(md);tabs.appendChild(b)}
  back.onclick=close;
  share.onclick=async()=>{
    if(v!=="active"||!g||!m){close();return}
    const tr=pv&&pv.getVideoTracks()[0];
    if(!tr)return;
    pv=null;window.lrCamFace=mode;
    const own=tr;ov.remove();gen++;vid.srcObject=null;
    await lrStartVideo(own);
  };
  ov.append(vid,back,share,tabs);document.body.appendChild(ov);
  open("user");
}
/* مكالمة بتخلص أو بتتقفل: اقفل شاشة الاختيار لو كانت مفتوحة */
new MutationObserver(()=>{if(t("call").classList.contains("hidden")){const o=document.getElementById("camPick");if(o){o.querySelector("video").srcObject?.getTracks().forEach(x=>x.stop());o.remove()}}}).observe(t("call"),{attributes:!0,attributeFilter:["class"]});
/* حالة الاتصال: نخفيها إلا لو فيها تحذير (الاتصال ضعيف / خطأ كاميرا ...) */
setInterval(()=>{
  const c=t("callStatus");if(!c)return;
  const s=(c.textContent||"").trim();
  c.classList.toggle("lrShow",!!s&&!["متصل","بيرن...","بيتصل...","جاري الاتصال"].includes(s));
},800);

/* ===== مكالمة شغالة والشاشة اتقفلت / خرجت من التطبيق: المكالمة تكمل والكاميرا بس هي اللي تتقفل ===== */
let lrCamAuto=false;
document.addEventListener("visibilitychange",()=>{
  if(v==="idle"||!g)return;
  const vt=g.getVideoTracks();
  if(document.hidden){
    if(vt.length&&vt.every(x=>x.enabled)){lrCamAuto=true;Nn("video")}
  }else if(lrCamAuto){
    lrCamAuto=false;
    const k=g.getVideoTracks();
    if(k.length&&k.every(x=>!x.enabled&&x.readyState==="live"))Nn("video");
  }
});

/* ===== 1.31.2: الكيبورد لما يفتح الشات ينزل لآخر رسالة (ويفضل مثبّت عليها لو كنت تحت) ===== */
(function(){
  const log=t("log"),msg=t("msg");if(!log||!msg)return;
  let atBottom=true;
  const toEnd=()=>{log.scrollTop=log.scrollHeight};
  log.addEventListener("scroll",()=>{atBottom=log.scrollHeight-log.scrollTop-log.clientHeight<140},{passive:true});
  if(window.ResizeObserver)new ResizeObserver(()=>{if(atBottom)toEnd()}).observe(log);
  msg.addEventListener("focus",()=>{atBottom=true;toEnd();[120,300,600].forEach(d=>setTimeout(()=>{if(document.activeElement===msg&&atBottom)toEnd()},d))});
  if(window.visualViewport)visualViewport.addEventListener("resize",()=>{if(atBottom)toEnd()});
})();
