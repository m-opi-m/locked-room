/* لودو بشكل Ludo Club — بيتضم جوه closure بتاع app.js وقت الـ build (build.mjs) عشان يشوف currentGame/ludoState/t/k/sendGamePacket.
   الحالة (state) بتتبعت للطرف التاني مع كل حركة. pos: -1 = في البيت، 0..50 = المسار، 51..55 = طريق النهاية، 56 = وصل. */
const LUDO_TRACK=(()=>{const p=[],a=(x,y)=>p.push([x,y]);
for(let x=1;x<=5;x++)a(x,6);for(let y=5;y>=0;y--)a(6,y);a(7,0);a(8,0);
for(let y=1;y<=5;y++)a(8,y);for(let x=9;x<=14;x++)a(x,6);a(14,7);a(14,8);
for(let x=13;x>=9;x--)a(x,8);for(let y=9;y<=14;y++)a(8,y);a(7,14);a(6,14);
for(let y=13;y>=9;y--)a(6,y);for(let x=5;x>=0;x--)a(x,8);a(0,7);a(0,6);return p})();
const LUDO_SAFE=new Set([0,8,13,21,26,34,39,47]),LUDO_OFF={red:0,blue:26},
LUDO_COL={red:"#e8363d",green:"#1fb52f",yellow:"#ffb200",blue:"#1478f0"},
LUDO_PIPS=[[],[4],[0,8],[0,4,8],[0,2,6,8],[0,2,4,6,8],[0,2,3,5,6,8]];
let ludoShown=null,ludoBuilt="",ludoRidSeen=0,ludoMvSeen=0,ludoBusy=false,ludoAnimT=0,ludoApplyT=0,ludoDiceT=0,ludoAutoT=0,ludoAutoKey="";
try{Object.assign(St,{"بانتظار حركة الطرف الآخر":"Waiting for the other player","جاري الرمي...":"Rolling...","دور الطرف الآخر":"Other player's turn"})}catch{}

/* ---------- منطق اللعبة (نقي، بيتجرّب في node) ---------- */
const ludoOpp=c=>c==="red"?"blue":"red";
function ludoNew(){return{turn:"red",dice:0,rolled:0,rid:0,sx:0,mv:0,last:null,red:[-1,-1,-1,-1],blue:[-1,-1,-1,-1],winner:""}}
const ludoVer=q=>q.rid+q.mv;
function ludoCan(q,c,i,d){const p=q[c][i];return p<0?d===6:p+d<=56}
function ludoValid(q){const I=(x,a,b)=>Number.isInteger(x)&&x>=a&&x<=b;
if(!q||typeof q!=="object"||!["red","blue"].includes(q.turn)||!["","red","blue"].includes(q.winner))return null;
for(const c of["red","blue"])if(!Array.isArray(q[c])||q[c].length!==4||!q[c].every(x=>I(x,-1,56)))return null;
if(!I(q.dice,0,6)||!I(q.rolled,0,6)||!I(q.rid,0,1e6)||!I(q.mv,0,1e6)||!I(q.sx,0,2))return null;
let l=null;if(q.last){const L=q.last;if(!["red","blue"].includes(L.c)||!I(L.i,0,3)||!I(L.f,-1,56)||!I(L.t,0,56))return null;l={c:L.c,i:L.i,f:L.f,t:L.t}}
return{turn:q.turn,dice:q.dice,rolled:q.rolled,rid:q.rid,sx:q.sx,mv:q.mv,last:l,red:q.red.slice(),blue:q.blue.slice(),winner:q.winner}}
function ludoDoRoll(q,c,d){q.rolled=d;q.rid++;q.last=null;if(d===6)q.sx++;
if(q.sx>=3||![0,1,2,3].some(i=>ludoCan(q,c,i,d))){q.dice=0;q.sx=0;q.turn=ludoOpp(c);return}q.dice=d}
function ludoDoMove(q,c,i){const d=q.dice,old=q[c][i],next=old<0?0:old+d,op=ludoOpp(c);let cap=false;q[c][i]=next;
if(next<=50){const cell=(LUDO_OFF[c]+next)%52;if(!LUDO_SAFE.has(cell))q[op]=q[op].map(p=>{if(p>=0&&p<=50&&(LUDO_OFF[op]+p)%52===cell){cap=true;return-1}return p})}
q.last={c,i,f:old,t:next};q.mv++;q.dice=0;if(d!==6)q.sx=0;
if(q[c].every(x=>x===56)){q.winner=c;return}
if(!(d===6||cap||next===56)){q.turn=op;q.sx=0}}

/* ---------- الرسم ---------- */
function ludoUnit(c,pos,i){if(pos<0){const b=c==="red"?2.5:11.5;return[b+(i%2?.9:-.9),b+(i>1?.9:-.9)]}
if(pos<=50)return LUDO_TRACK[(LUDO_OFF[c]+pos)%52];
if(pos<=55){const j=pos-51;return c==="red"?[1+j,7]:[13-j,7]}
return[c==="red"?6.45:7.55,7+(i-1.5)*.2]}
function ludoStar(cx,cy,r){let s="";for(let k=0;k<10;k++){const a=Math.PI*k/5-Math.PI/2,rr=k%2?r*.45:r;s+=(cx+rr*Math.cos(a)).toFixed(1)+","+(cy+rr*Math.sin(a)).toFixed(1)+" "}return s}
function ludoBuild(svg){const C=40,cl={};let h='<rect width="600" height="600" rx="18" fill="#fff"/>';
for(const[c,x,y]of[["red",0,0],["green",9,0],["yellow",0,9],["blue",9,9]]){const on=c==="red"||c==="blue",f=LUDO_COL[c];
h+='<g opacity="'+(on?1:.3)+'"><rect x="'+x*C+'" y="'+y*C+'" width="240" height="240" fill="'+f+'"/><rect x="'+(x+1)*C+'" y="'+(y+1)*C+'" width="160" height="160" rx="26" fill="#fff"/>';
for(let i=0;i<4;i++)h+='<circle cx="'+((x+2.5+(i%2?.9:-.9)+.5)*C)+'" cy="'+((y+2.5+(i>1?.9:-.9)+.5)*C)+'" r="19" fill="'+f+'" opacity=".9"/>';h+='</g>'}
const cells=LUDO_TRACK.slice();
for(let j=0;j<5;j++){for(const[k,c]of[[[1+j,7],"red"],[[13-j,7],"blue"],[[7,1+j],"green"],[[7,13-j],"yellow"]]){cl[k]=LUDO_COL[c];cells.push(k)}}
for(const[i,c]of[[0,"red"],[13,"green"],[26,"blue"],[39,"yellow"]])cl[LUDO_TRACK[i]]=LUDO_COL[c];
for(const p of cells)h+='<rect x="'+p[0]*C+'" y="'+p[1]*C+'" width="'+C+'" height="'+C+'" fill="'+(cl[p]||"#fff")+'" stroke="#c9ced4" stroke-width="1.5"/>';
for(const i of[8,21,34,47]){const[x,y]=LUDO_TRACK[i];h+='<polygon points="'+ludoStar((x+.5)*C,(y+.5)*C,13)+'" fill="#fff" stroke="#8d96a0" stroke-width="2" stroke-linejoin="round"/>'}
const M="300,300";h+='<polygon points="240,240 240,360 '+M+'" fill="'+LUDO_COL.red+'"/><polygon points="240,240 360,240 '+M+'" fill="'+LUDO_COL.green+'"/><polygon points="360,240 360,360 '+M+'" fill="'+LUDO_COL.blue+'"/><polygon points="240,360 360,360 '+M+'" fill="'+LUDO_COL.yellow+'"/>';
h+='<rect x="1" y="1" width="598" height="598" rx="18" fill="none" stroke="#9aa3ad" stroke-width="2"/>';
for(const c of["red","blue"])for(let i=0;i<4;i++)h+='<g class="lt" data-p="'+c+'-'+i+'"><ellipse cy="12" rx="12" ry="5" fill="#0005"/><circle class="ring" r="22" fill="none" stroke="#111" stroke-width="3.5"/><circle r="15.5" fill="'+LUDO_COL[c]+'" stroke="#fff" stroke-width="3.5"/><circle r="8" fill="#fff" opacity=".3"/><circle cx="-5" cy="-6" r="3.2" fill="#fff" opacity=".8"/></g>';
svg.innerHTML=h}
function ludoPlace(){const svg=t("ludoBoard"),items=[],m=new Map;
for(const c of["red","blue"])for(let i=0;i<4;i++){const p=ludoShown[c][i],[ux,uy]=ludoUnit(c,p,i),x=(ux+.5)*40,y=(uy+.5)*40,k=p<0||p>=56?c+i:Math.round(x)+","+Math.round(y);items.push({c,i,x,y,k});m.set(k,(m.get(k)||[]).concat(items.length-1))}
const O=[[-8,-8],[8,8],[-8,8],[8,-8]];
items.forEach((o,n)=>{const g=m.get(o.k);let s=1,dx=0,dy=0;if(g.length>1){s=.72;const f=O[g.indexOf(n)%4];dx=f[0];dy=f[1]}
const el=svg.querySelector('[data-p="'+o.c+'-'+o.i+'"]');if(el)el.style.transform="translate("+(o.x+dx)+"px,"+(o.y+dy)+"px) scale("+s+")"})}
function ludoFace(n){const d=t("ludoDie");if(d)d.innerHTML=Array.from({length:9},(_,k)=>"<i"+(LUDO_PIPS[n]&&LUDO_PIPS[n].includes(k)?' class="on"':"")+"></i>").join("")}
function ludoRollAnim(n){clearInterval(ludoDiceT);const d=t("ludoDie");if(!d)return;let c=0;d.classList.add("rolling");
ludoDiceT=setInterval(()=>{if(++c>7){clearInterval(ludoDiceT);d.classList.remove("rolling");ludoFace(n);return}ludoFace(1+Math.floor(Math.random()*6))},85)}
function ludoUi(){const q=ludoState;if(!q)return;const my=currentGame?.role||"red",mine=q.turn===my,btn=t("ludoRoll"),svg=t("ludoBoard");
if(!t("ludoDie").classList.contains("rolling"))ludoFace(q.rolled);
const nm={red:t("redPlayerName"),blue:t("bluePlayerName")};
nm.red.textContent=gameMsg(my==="red"?"أنت":"الطرف الآخر");nm.blue.textContent=gameMsg(my==="blue"?"أنت":"الطرف الآخر");
for(const c of["red","blue"]){const sm=nm[c].nextElementSibling;if(sm){sm.dataset.b=sm.dataset.b||sm.textContent;sm.textContent=sm.dataset.b+" · "+q[c].filter(x=>x===56).length+"/4"}
document.querySelector("."+c+"Player")?.classList.toggle("on",q.turn===c&&!q.winner)}
t("ludoTurnBadge").textContent=q.winner?gameMsg(q.winner===my?"فزت!":"انتهت اللعبة"):gameMsg(mine?"دورك":"دور الطرف الآخر");
btn.dataset.t=q.turn;btn.disabled=ludoBusy||!!q.winner||!mine||q.dice>0;
const can=!ludoBusy&&!q.winner&&mine&&q.dice>0;
t("ludoDiceValue").textContent=q.winner?gameMsg("انتهت اللعبة"):q.dice?gameMsg("قيمة النرد")+": "+q.dice:gameMsg(mine?"ارمِ النرد":"دور الطرف الآخر");
t("ludoHint").textContent=q.winner?gameMsg("اضغط رجوع للعودة إلى الشات"):can?gameMsg("اختار الحجر اللي هتحركه"):mine?gameMsg("اضغط على النرد لبدء اللعب."):gameMsg("بانتظار حركة الطرف الآخر");
for(const c of["red","blue"])for(let i=0;i<4;i++){const el=svg.querySelector('[data-p="'+c+'-'+i+'"]');if(!el)continue;const ok=can&&c===my&&ludoCan(q,c,i,q.dice);el.classList.toggle("can",ok);el.onclick=ok?()=>moveLudo(c+"-"+i):null}
if(can){const mv=[0,1,2,3].filter(i=>ludoCan(q,my,i,q.dice)),key=q.rid+"-"+q.mv;
if(new Set(mv.map(i=>q[my][i])).size===1&&ludoAutoKey!==key){ludoAutoKey=key;clearTimeout(ludoAutoT);ludoAutoT=setTimeout(()=>moveLudo(my+"-"+mv[0]),500)}}}
function ludoApply(){const q=ludoState,svg=t("ludoBoard");if(!q||!svg||!ludoShown)return;clearTimeout(ludoApplyT);clearTimeout(ludoAnimT);
const fin=()=>{ludoShown={red:q.red.slice(),blue:q.blue.slice()};ludoPlace();ludoBusy=false;ludoUi()};
if(q.last&&q.mv!==ludoMvSeen){ludoMvSeen=q.mv;const{c,i,t:to}=q.last,from=ludoShown[c][i];
const path=from<0?[0]:to>from&&to-from<=6?Array.from({length:to-from},(_,n)=>from+n+1):[to];
const el=svg.querySelector('[data-p="'+c+'-'+i+'"]');if(el)svg.appendChild(el);ludoBusy=true;ludoUi();let n=0;
const tick=()=>{if(n<path.length){ludoShown[c][i]=path[n++];ludoPlace();ludoAnimT=setTimeout(tick,path.length>1?130:0)}else ludoAnimT=setTimeout(fin,220)};tick();return}
fin()}
function renderLudo(){if(!ludoState)return;t("ludoLobby").classList.add("hidden");t("ludoPlay").classList.remove("hidden");const svg=t("ludoBoard");if(!svg)return;
const gid=currentGame?.id||"";
if(ludoBuilt!==gid){clearTimeout(ludoAnimT);clearTimeout(ludoApplyT);clearTimeout(ludoAutoT);ludoBuild(svg);ludoBuilt=gid;ludoShown={red:[-1,-1,-1,-1],blue:[-1,-1,-1,-1]};ludoPlace();ludoRidSeen=0;ludoMvSeen=0;ludoBusy=false;ludoAutoKey=""}
if(ludoState.rid>0&&ludoState.rid!==ludoRidSeen){ludoRidSeen=ludoState.rid;ludoRollAnim(ludoState.rolled);ludoBusy=true;ludoUi();clearTimeout(ludoApplyT);ludoApplyT=setTimeout(ludoApply,650);return}
if(ludoBusy&&ludoApplyT&&!ludoState.last)return;
ludoApply()}
async function syncLudo(){renderLudo();if(currentGame?.id)await sendGamePacket({a:"state",id:currentGame.id,state:ludoState})}
async function rollLudo(){const q=ludoState;if(!currentGame||!q||ludoBusy||q.turn!==currentGame.role||q.dice||q.winner)return;
ludoDoRoll(q,currentGame.role,1+Math.floor(Math.random()*6));await syncLudo()}
async function moveLudo(key){const q=ludoState;if(!currentGame||!q||ludoBusy||!q.dice||q.winner)return;const[c,s]=String(key).split("-"),i=Number(s);
if(c!==currentGame.role||!Number.isInteger(i)||i<0||i>3||!ludoCan(q,c,i,q.dice))return;ludoDoMove(q,c,i);await syncLudo()}
