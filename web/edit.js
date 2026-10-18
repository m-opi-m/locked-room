/* ---------- 1.29: تعديل الرسايل (بيتضم جوه closure بتاع app.js وقت الـ build) ----------
   التعديل رسالة مشفّرة ومتخزّنة {k:"edit",m:mid,v:"النص الجديد"} بنفس مسار react/played (p:1 + lrPutOwn)،
   فبتوصل حتى لو الطرف التاني أوفلاين وبترجع من السجل/الكاش. بس صاحب الرسالة يقدر يعدّلها (بنقارن "مين بعت التعديل"
   بـ "مين بعت الأصل")، ولو التعديل وصل قبل ما الأصل يترسم بنحتفظ بيه ونطبّقه أول ما الرسالة تتعمل (R() بتنادي lrEdPaint).
   آخر تعديل (بالوقت) هو اللي بيتحسب. */
const lrEd=new Map();            // mid -> {v,who,at}
let lrEditMid="";
function lrEdReset(){lrEd.clear();try{lrEditCancel(true)}catch{}}
function lrEdValid(r){return r&&typeof r.m==="string"&&/^[a-f0-9]{32}$/.test(r.m)&&typeof r.v==="string"&&r.v.trim().length>0&&r.v.length<=4000}
/* الرسالة تتعدّل لو: بتاعتي، نص عادي (مش صورة/ملف/صوت/كارت كود/مكالمة) */
function lrCanEdit(mid){
  const el=Je.get(mid);
  return !!(el&&el.isConnected&&el.classList.contains("me")&&el.querySelector(":scope > p")&&!el.querySelector(":scope > .codeCard,:scope > .callLog,:scope > .viewOnceMessage"));
}
function lrEdRecv(r,who,at){
  if(!lrEdValid(r))return;
  const old=lrEd.get(r.m);
  if(old&&old.who===who&&old.at>at)return;       // وصل تعديل أقدم بعد أحدث: نتجاهله
  lrEd.set(r.m,{v:r.v,who,at});
  lrEdPaint(r.m);
}
function lrEdPaint(mid){
  const st=lrEd.get(mid),el=Je.get(mid);
  if(!st||!el||!el.isConnected)return;
  if(!el.classList.contains(st.who))return;       // حد بيحاول يعدّل رسالة مش بتاعته
  const p=el.querySelector(":scope > p");
  if(!p||el.querySelector(":scope > .codeCard"))return;
  if(p.textContent!==st.v)p.textContent=st.v;
  const meta=el.querySelector(":scope > .messageMeta");
  if(meta&&!meta.querySelector(".editedTag")){
    const tg=document.createElement("span");tg.className="editedTag";tg.textContent=X("تم تعديلها");
    meta.insertBefore(tg,meta.querySelector(".mt")||meta.firstChild);
  }
  /* لو أنا فاتح التعديل على الرسالة دي وجه تعديل منها من جهاز تاني: بس نحدّث الشريط */
  if(lrEditMid===mid){const x=t("replyText");x&&(x.textContent=st.v)}
}
/* ===== واجهة التعديل ===== */
/* زرار الإرسال بيبقى علامة صح وهو ظاهر دايماً في وضع التعديل (حتى لو الخانة فاضية، من غير ما يظهر المايك) */
function lrEditIcon(on){const u0=document.querySelector("#sendBtn use");u0&&u0.setAttribute("href",on?"#i-check":"#i-send")}
function lrEditBarShow(txt){
  const b=t("replyBar");if(!b)return;
  t("replyWho").textContent=X("تعديل الرسالة");
  t("replyText").textContent=txt;
  b.classList.add("editBar");b.classList.remove("hidden");
  document.body.classList.add("editing");
  lrEditIcon(true);
  Xe();
}
function lrStartEdit(mid){
  if(!lrCanEdit(mid))return;
  try{lrRxClose()}catch{}
  try{lrReply=null}catch{}
  lrEditMid&&lrEditCancel(true);
  const el=Je.get(mid),txt=(el.querySelector(":scope > p").textContent||"");
  lrEditMid=mid;
  el.classList.add("editing");
  lrEditBarShow(txt);
  const m=t("msg");m.value=txt;fitMsg();m.focus();
  try{m.setSelectionRange(txt.length,txt.length)}catch{}
}
function lrEditCancel(keepText){
  if(!lrEditMid&&!document.body.classList.contains("editing"))return;
  const el=Je.get(lrEditMid);el&&el.classList.remove("editing");
  lrEditMid="";
  document.body.classList.remove("editing");
  lrEditIcon(false);
  const b=t("replyBar");b&&(b.classList.remove("editBar"),b.classList.add("hidden"));
  if(!keepText){const m=t("msg");if(m){m.value="";fitMsg()}}
}
async function lrEditSubmit(text){
  const mid=lrEditMid;if(!mid)return false;
  if(!lrCanEdit(mid)){lrEditCancel();return true}
  const el=Je.get(mid),cur=el.querySelector(":scope > p").textContent;
  if(!text)return true;                           // فاضي: فضّل في التعديل (مش بنمسح الرسالة)
  if(text===cur){lrEditCancel();Qe();return true}
  if(!u||u.readyState!==1||!te){lrToast(lrEn()?"Not connected to the room.":"مفيش اتصال بالغرفة دلوقتي.");return true}
  try{
    const enc=await Ee({k:"edit",m:mid,v:text}),nm=ze(crypto.getRandomValues(new Uint8Array(16)));
    u.send(JSON.stringify({...enc,p:1,mid:nm}));
    lrPutOwn(nm,enc,false,"edit");
    lrEdRecv({m:mid,v:text},"me",Date.now());
    lrEditCancel();Qe();
  }catch{lrToast(lrEn()?"Couldn't edit the message.":"معرفتش أعدّل الرسالة.")}
  return true;
}
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&lrEditMid)lrEditCancel()});
