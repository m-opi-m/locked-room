// زر مكبر الصوت / سماعة الأذن في المكالمة.
// بيتضم جوه public/app.js وقت الـ build (زي image-send.js).
// المتصفح مفيهوش API رسمي لتحويل الصوت بين السماعتين، فبنستخدم setSinkId + enumerateDevices
// (شغّالين على كروم). لو الجهاز مش بيعرض سماعة الأذن كمخرج، بنقول للمستخدم بدل ما الزر يتظاهر إنه اشتغل.
(() => {
  const $ = (id) => document.getElementById(id);
  const btn = $('speakerBtn'), vid = $('remoteVid'), call = $('call');
  if (!btn || !vid || !call) return;
  const en = () => document.documentElement.lang === 'en';
  const TXT = {
    spk: ['مكبر الصوت', 'Speaker'],
    ear: ['سماعة الأذن', 'Earpiece'],
    no: ['جهازك أو المتصفح ما بيسمحش بتحويل الصوت للسماعة من جوه التطبيق. استخدم أزرار الصوت في الموبايل.', 'Your device or browser does not let the app switch the audio output. Use your phone’s sound controls.'],
  };
  const tr = (k) => TXT[k][en() ? 1 : 0];
  let speaker = true, busy = false, toastEl = null, toastT = 0;

  function toast(msg) {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'lrToast'; toastEl.setAttribute('role', 'status'); document.body.appendChild(toastEl); }
    toastEl.textContent = msg; toastEl.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('show'), 4200);
  }
  function render() {
    if (btn.classList.contains('isOn') !== speaker) btn.classList.toggle('isOn', speaker);
    if (btn.getAttribute('aria-pressed') !== String(speaker)) btn.setAttribute('aria-pressed', String(speaker));
    // بنكتب بس لو القيمة اتغيّرت: مترجم التطبيق بيراقب تغييرات النص، والكتابة المتكررة ممكن تعمل حلقة لا نهائية.
    const label = $('speakerLabel'), txt = tr(speaker ? 'spk' : 'ear');
    if (label.textContent !== txt) label.textContent = txt;
    const use = $('speakerIcon').querySelector('use'), href = speaker ? '#i-volume' : '#i-phone';
    if (use && use.getAttribute('href') !== href) use.setAttribute('href', href);
  }
  const isEar = (d) => /earpiece|receiver|handset|سماعة الأذن/i.test(d.label || '');
  const isSpk = (d) => !isEar(d) && /speaker|loud|مكبر/i.test(d.label || '');

  // بيرجّع true لو التحويل اتنفّذ فعلاً.
  async function route(toSpeaker) {
    if (typeof vid.setSinkId !== 'function' || !navigator.mediaDevices?.enumerateDevices) return false;
    let outs = [];
    try { outs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audiooutput'); } catch { return false; }
    const target = toSpeaker ? (outs.find(isSpk) || outs.find((d) => d.deviceId === 'default') || outs[0]) : outs.find(isEar);
    if (!target) return false;
    try { await vid.setSinkId(target.deviceId); return true; } catch { return false; }
  }

  btn.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    const next = !speaker;
    const ok = await route(next);
    busy = false;
    if (!ok) return toast(tr('no'));
    speaker = next; render();
  });

  // كل مكالمة جديدة تبدأ بمكبر الصوت (الوضع الافتراضي) والمخرج الافتراضي للجهاز.
  let wasHidden = call.classList.contains('hidden');
  new MutationObserver(() => {
    const hidden = call.classList.contains('hidden');
    if (hidden === wasHidden) return;
    wasHidden = hidden;
    if (hidden) {
      speaker = true;
      try { vid.setSinkId?.('')?.catch?.(() => {}); } catch {}
    }
    render(); // بيتنادى عند الفتح والقفل بس (مش مع كل تغيير class تاني)، فمفيش حلقة مع مترجم التطبيق
  }).observe(call, { attributes: true, attributeFilter: ['class'] });
  render();
})();
