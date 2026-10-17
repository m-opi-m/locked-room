/* ---------- 1.19: عدّاد الرسايل الجديدة + وصول الرسايل للجهاز من غير ما يفتح الشات ----------
   (بيتضم جوه closure بتاع app.js وقت الـ build زي call-ui.js)
   المحتوى مشفّر بباسورد الغرفة فالجهاز مبيفكّوش من برا الشات، لكن السيرفر بيعدّ الرسايل الجديدة
   وبيعلّمها "وصلت" (ويبلّغ المرسل) أول ما الجهاز يبقى أونلاين. بنسأله كل 12 ثانية والتطبيق مفتوح. */
var lrUnread=lrJ("unread",{}),lrInboxBusy=!1; /* var عشان re() ممكن تتنادى قبل ما السطر ده يتنفّذ */
const lrBadgeText=n=>n>99?"99+":String(n);
function lrBadge(card,code){
  const n=Number((lrUnread||{})[code])||0;if(n<1)return;
  const b=document.createElement("span");b.className="roomUnread";b.textContent=lrBadgeText(n);
  b.setAttribute("aria-label",(lrEn()?"New messages: ":"رسايل جديدة: ")+lrBadgeText(n));
  card.classList.add("hasUnread");card.insertBefore(b,card.querySelector(".roomLock"));
}
function lrUnreadClear(code){
  if(!lrUnread||!lrUnread[code])return;delete lrUnread[code];d.set("unread",JSON.stringify(lrUnread));
}
async function lrInboxPoll(){
  if(lrInboxBusy||!he||navigator.onLine===!1||document.visibilityState!=="visible")return;
  const map=lrJ("roomIds",{}),mine=ie(),rids=Object.keys(map).filter(r=>mine.includes(map[r])).slice(0,60);
  if(!rids.length)return;
  lrInboxBusy=!0;
  try{
    const{status:st,data:j}=await C("/api/inbox",{rooms:rids});
    if(st!==200||!j||typeof j.unread!=="object")return;
    const inChat=!t("chat").classList.contains("hidden"),next={};
    for(const rid of rids){
      const code=map[rid],n=Math.min(100,Number(j.unread[rid])||0);
      if(n>0&&!(inChat&&code===L))next[code]=n;
    }
    if(JSON.stringify(next)!==JSON.stringify(lrUnread)){
      lrUnread=next;d.set("unread",JSON.stringify(next));
      re();
    }
  }catch{}finally{lrInboxBusy=!1}
}
setInterval(lrInboxPoll,12e3);
addEventListener("online",()=>setTimeout(lrInboxPoll,600));
document.addEventListener("visibilitychange",()=>{document.visibilityState==="visible"&&setTimeout(lrInboxPoll,300)});
setTimeout(lrInboxPoll,2500);
