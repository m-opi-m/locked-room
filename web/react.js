/* ---------- 1.28: تفاعلات الإيموجي على الرسايل (بيتضم جوه closure بتاع app.js وقت الـ build) ----------
   الضغط المطوّل على رسالة ← شريط إيموجي فوقها + زرار "+" لباقي الإيموجي (اللي تختاره بيتحفظ في الشريط).
   التفاعل رسالة مشفّرة ومتخزّنة {k:"react",m:mid,e:"❤️"} (e فاضي = شيل التفاعل) فبتوصل حتى لو الطرف التاني أوفلاين،
   وكل شخص ليه تفاعل واحد على الرسالة (آخر واحد هو اللي بيتحسب). */
const LR_RX_BASE=["👍","❤️","😂","😮","😢","🙏"];
const lrRx=new Map();           // mid -> {me:"",them:""}
let lrRxBar=null,lrRxSheet=null,lrRxMid="",lrRxY0=0,lrRxAt=0;
function lrRxReset(){try{lrRx.clear();lrRxClose()}catch{}}
function lrRxCustom(){try{const a=JSON.parse(localStorage.getItem("lr.rxCustom")||"[]");return Array.isArray(a)?a.filter(x=>typeof x==="string"&&x.length<=16).slice(0,24):[]}catch{return[]}}
function lrRxRemember(e){
  if(LR_RX_BASE.includes(e))return;
  const a=lrRxCustom().filter(x=>x!==e);a.unshift(e);
  try{localStorage.setItem("lr.rxCustom",JSON.stringify(a.slice(0,24)))}catch{}
}
function lrRxValid(r){return r&&typeof r.m==="string"&&/^[a-f0-9]{32}$/.test(r.m)&&typeof r.e==="string"&&r.e.length<=16}
/* استقبال (حي / سجل / كاش) */
function lrRxRecv(r,who){
  if(!lrRxValid(r))return;
  const s=lrRx.get(r.m)||{me:"",them:""};s[who]=r.e;lrRx.set(r.m,s);lrRxPaint(r.m);
}
function lrRxPaint(mid){
  const el=Je.get(mid);if(!el)return;
  el.querySelector(":scope > .rxBadge")?.remove();
  const s=lrRx.get(mid);
  if(!s||(!s.me&&!s.them)){el.classList.remove("hasRx");return}
  const list=[s.me,s.them].filter(Boolean),uniq=[...new Set(list)];
  const b=document.createElement("button");b.type="button";b.className="rxBadge";b.setAttribute("data-nolang","");
  b.setAttribute("aria-label",lrEn()?"Reactions":"التفاعلات");
  uniq.forEach(e=>{const i=document.createElement("span");i.textContent=e;b.appendChild(i)});
  if(list.length>1&&uniq.length===1){const c=document.createElement("em");c.textContent="2";b.appendChild(c)}
  if(s.me)b.classList.add("mine");
  /* الضغط على الشارة = شيل تفاعلي (لو عامل واحد) */
  b.addEventListener("click",ev=>{ev.stopPropagation();ev.preventDefault();if(lrRx.get(mid)?.me)lrRxSend(mid,"")});
  b.addEventListener("pointerdown",ev=>ev.stopPropagation());
  el.classList.add("hasRx");el.appendChild(b);
}
async function lrRxSend(mid,emo){
  if(!/^[a-f0-9]{32}$/.test(mid))return;
  if(!u||u.readyState!==1||!te){lrToast(lrEn()?"Not connected to the room.":"مفيش اتصال بالغرفة دلوقتي.");return}
  const cur=(lrRx.get(mid)||{}).me||"";
  if(emo&&emo===cur)emo="";               // نفس الإيموجي تاني = شيله
  if(!emo&&!cur)return;
  try{
    const enc=await Ee({k:"react",m:mid,e:emo}),nm=ze(crypto.getRandomValues(new Uint8Array(16)));
    u.send(JSON.stringify({...enc,p:1,mid:nm}));
    lrPutOwn(nm,enc,false,"react");
    lrRxRecv({m:mid,e:emo},"me");
    emo&&lrRxRemember(emo);
  }catch{}
}
/* ===== واجهة الاختيار ===== */
function lrRxClose(){
  lrRxBar&&lrRxBar.classList.add("hidden");lrRxSheet&&lrRxSheet.classList.add("hidden");
  lrRxMid="";
}
function lrRxEnsureBar(){
  if(lrRxBar)return lrRxBar;
  lrRxBar=document.createElement("div");lrRxBar.className="rxPicker hidden";lrRxBar.setAttribute("role","toolbar");lrRxBar.setAttribute("data-nolang","");
  lrRxBar.addEventListener("click",e=>e.stopPropagation());
  lrRxBar.addEventListener("pointerdown",e=>e.stopPropagation());
  document.body.appendChild(lrRxBar);
  document.addEventListener("click",e=>{if(Date.now()-lrRxAt<500)return;if(!e.target.closest(".rxPicker,.rxSheet"))lrRxClose()});
  document.addEventListener("keydown",e=>{if(e.key==="Escape")lrRxClose()});
  t("log")?.addEventListener("scroll",()=>{if(Math.abs(t("log").scrollTop-lrRxY0)>14)lrRxBar.classList.add("hidden")},{passive:true});
  return lrRxBar;
}
function lrRxShow(mid){
  const el=Je.get(mid);if(!el)return;
  const bar=lrRxEnsureBar();lrRxMid=mid;lrRxAt=Date.now();lrRxY0=t("log").scrollTop;
  const cur=(lrRx.get(mid)||{}).me||"";
  bar.textContent="";
  const plus=document.createElement("button");plus.type="button";plus.className="rxPlus";
  plus.setAttribute("aria-label",lrEn()?"More reactions":"المزيد من التفاعلات");plus.textContent="+";
  plus.onclick=()=>lrRxOpenSheet(mid);
  bar.appendChild(plus);
  const strip=document.createElement("div");strip.className="rxStrip";
  [...LR_RX_BASE,...lrRxCustom()].forEach(e=>{
    const b=document.createElement("button");b.type="button";b.textContent=e;b.className=e===cur?"on":"";
    b.onclick=()=>{lrRxSend(mid,e);lrRxClose();t("messageActionMenu").classList.add("hidden")};
    strip.appendChild(b);
  });
  bar.appendChild(strip);
  bar.classList.remove("hidden");
  const r=el.getBoundingClientRect(),w=bar.getBoundingClientRect();
  let top=r.top-w.height-8;if(top<8)top=Math.min(r.bottom+8,innerHeight-w.height-8);
  const mine=el.classList.contains("me");
  const rtl=document.documentElement.dir==="rtl";
  /* نحاذي الشريط مع جنب الرسالة (جوه الشاشة) */
  let left=(mine!==rtl)?r.left:r.right-w.width;
  left=Math.max(8,Math.min(left,innerWidth-w.width-8));
  bar.style.top=Math.max(8,top)+"px";bar.style.left=left+"px";
  strip.scrollLeft=0;
}
function lrRxOpenSheet(mid){
  if(!lrRxSheet){
    lrRxSheet=document.createElement("div");lrRxSheet.className="rxSheet hidden";lrRxSheet.setAttribute("data-nolang","");
    lrRxSheet.innerHTML='<div class="rxSheetBox"><div class="rxTabs"></div><div class="rxGrid"></div></div>';
    lrRxSheet.addEventListener("click",e=>{if(e.target===lrRxSheet)lrRxClose()});
    document.body.appendChild(lrRxSheet);
  }
  const tabs=lrRxSheet.querySelector(".rxTabs"),grid=lrRxSheet.querySelector(".rxGrid");
  const draw=k=>{
    tabs.querySelectorAll("button").forEach(b=>b.classList.toggle("on",b.textContent===k));
    grid.textContent="";
    Dt[k].split(" ").forEach(e=>{
      const b=document.createElement("button");b.type="button";b.textContent=e;
      b.onclick=()=>{lrRxSend(lrRxMid||mid,e);lrRxClose();t("messageActionMenu").classList.add("hidden")};
      grid.appendChild(b);
    });
  };
  tabs.textContent="";
  Object.keys(Dt).forEach(k=>{const b=document.createElement("button");b.type="button";b.textContent=k;b.onclick=()=>draw(k);tabs.appendChild(b)});
  draw(Object.keys(Dt)[0]);
  lrRxBar&&lrRxBar.classList.add("hidden");
  t("messageActionMenu").classList.add("hidden");
  lrRxSheet.classList.remove("hidden");
}
