'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const enc = new TextEncoder(), dec = new TextDecoder();
  let ws = null, key = null, peers = 0, newCode = '', curCode = '', pendingCode = '', badShown = false, creatorCode = '', codeAnnounced = false, pendingCodePacket = null;
  let callState = 'idle', callId = '', pc = null, stream = null, pendingOffer = null, callTimer = null, callStatsTimer = 0, callClockTimer = 0, callStartedAt = 0, renegotiating = false, remoteCameraOn = false, previousStats = { received: 0, lost: 0 };
  let recorder = null, recordingStream = null, recordingParts = [], typingTimer = 0, peerActivityTimer = 0, presenceSent = '', lastTypingSent = 0;
  let peerName = '', peerUrl = '', tmpAv = null, tmpBg = null, recentRoom = null, recentRoomTimer = 0;
  const messageNodes = new Map(), receiptStates = new Map(), readSent = new Set();

  // ---------- أدوات ----------
  const genCode = () => Array.from(crypto.getRandomValues(new Uint8Array(24)), (x) => ALPHA[x & 31]).join('');
  const fmt = (c) => c.match(/.{1,4}/g).join('-');
  const norm = (s) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const valid = (c) => c.length === 24 && [...c].every((ch) => ALPHA.includes(ch));
  const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
  function b64(buf) {
    const u = new Uint8Array(buf); let s = '';
    for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
    return btoa(s);
  }
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const blobUrl = (b, type = 'image/jpeg') => URL.createObjectURL(new Blob([unb64(b)], { type }));
  const store = {
    get: (k) => { try { return localStorage.getItem('lr.' + k) || ''; } catch { return ''; } },
    set: (k, v) => { try { v ? localStorage.setItem('lr.' + k, v) : localStorage.removeItem('lr.' + k); } catch {} },
  };
  let prefDbPromise, customKnockBlob = null;
  function prefDb() {
    if (!('indexedDB' in window)) return Promise.reject(new Error('IndexedDB unavailable'));
    if (!prefDbPromise) prefDbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open('locked-room-preferences', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('sounds');
      req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
    });
    return prefDbPromise;
  }
  async function saveCustomKnock(blob) {
    const db = await prefDb();
    await new Promise((resolve, reject) => { const tx = db.transaction('sounds', 'readwrite'); tx.objectStore('sounds').put(blob, 'knock'); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
  }
  async function loadCustomKnock() {
    try { const db = await prefDb(); return await new Promise((resolve, reject) => { const req = db.transaction('sounds').objectStore('sounds').get('knock'); req.onsuccess = () => resolve(req.result || null); req.onerror = () => reject(req.error); }); } catch { return null; }
  }
  async function clearCustomKnock() {
    try { const db = await prefDb(); await new Promise((resolve, reject) => { const tx = db.transaction('sounds', 'readwrite'); tx.objectStore('sounds').delete('knock'); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); }); } catch {}
    customKnockBlob = null; store.set('knockName', ''); updateKnockSettings();
  }
  const deviceArabic = /^ar/i.test(navigator.language || '');
  const knockText = () => deviceArabic ? { title: 'غرفة مقفولة', body: 'هناك من يطرق الباب' } : { title: 'Locked Room', body: 'Someone is knocking at the door' };
  const KNOWN_TONES = ['wood','bell','digital'];
  async function playKnockSound() {
    if (customKnockBlob) {
      try { const a = new Audio(URL.createObjectURL(customKnockBlob)); a.volume = .9; a.onended = () => URL.revokeObjectURL(a.src); await a.play(); } catch {}
      return;
    }
    const kind = KNOWN_TONES.includes(store.get('knockTone')) ? store.get('knockTone') : 'wood';
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext; if (!Ctx) return;
      const ctx = new Ctx(), notes = kind === 'bell' ? [880, 1175] : kind === 'digital' ? [660, 990, 660] : [145, 115, 145];
      notes.forEach((frequency, i) => {
        const osc = ctx.createOscillator(), gain = ctx.createGain(), at = ctx.currentTime + i * (kind === 'wood' ? .24 : .17);
        osc.type = kind === 'bell' ? 'sine' : 'triangle'; osc.frequency.setValueAtTime(frequency, at);
        gain.gain.setValueAtTime(.0001, at); gain.gain.exponentialRampToValueAtTime(kind === 'wood' ? .55 : .3, at + .012); gain.gain.exponentialRampToValueAtTime(.0001, at + (kind === 'wood' ? .13 : .34));
        osc.connect(gain); gain.connect(ctx.destination); osc.start(at); osc.stop(at + (kind === 'wood' ? .14 : .36));
      });
      setTimeout(() => ctx.close().catch(() => {}), 1400);
    } catch {}
  }
  const seenKnocks = new Set();
  function showKnockNotification(id) {
    if (id && seenKnocks.has(id)) return;
    if (id) { seenKnocks.add(id); if (seenKnocks.size > 100) seenKnocks.delete(seenKnocks.values().next().value); }
    const text = knockText(); playKnockSound();
    if (navigator.vibrate) navigator.vibrate([100, 70, 100]);
    if ('Notification' in window && Notification.permission === 'granted') {
      try { const notice = new Notification(text.title, { body: text.body, icon: '/logo.png', tag: 'locked-room-knock', renotify: true }); notice.onclick = () => { window.focus(); notice.close(); }; } catch {}
    }
  }
    function roomEntries() {
    try {
      const list = JSON.parse(store.get('rooms') || '[]');
      return Array.isArray(list) ? list.filter((c) => typeof c === 'string' && valid(c)) : [];
    } catch { return []; }
  }
  function forgetRoom(code) {
    store.set('rooms', JSON.stringify(roomEntries().filter((c) => c !== code)));
    renderRooms();
  }
  function saveRoom(code) {
    const list = roomEntries().filter((c) => c !== code);
    list.unshift(code);
    store.set('rooms', JSON.stringify(list.slice(0, 100)));
    renderRooms();
  }
  function openSavedRoom(code) {
    if (recentRoom && recentRoom.code === code && recentRoom.until > Date.now()) {
      const pw = recentRoom.pw;
      clearTimeout(recentRoomTimer);
      recentRoom = { code, pw, until: 0 };
      enterRoom(code, pw).catch(() => askPw(code));
      return;
    }
    recentRoom = null; clearTimeout(recentRoomTimer);
    askPw(code);
  }
  function renderRooms() {
    const list = $('roomList');
    if (!list) return;
    list.textContent = '';
    const rooms = roomEntries();
    $('roomEmpty').classList.toggle('hidden', rooms.length > 0);
    rooms.forEach((code, index) => {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'roomCard';
      button.setAttribute('aria-label', (lang === 'ar' ? 'فتح محادثة خاصة ' : 'Open private chat ') + (index + 1));
      const avatar = document.createElement('span'); avatar.className = 'roomAvatar'; avatar.textContent = '🔒';
      const info = document.createElement('span'); info.className = 'roomInfo';
      const title = document.createElement('strong'); title.textContent = (lang === 'ar' ? 'محادثة خاصة ' : 'Private chat ') + (index + 1);
      const hint = document.createElement('small'); hint.textContent = lang === 'ar' ? 'محتوى مشفّر · اضغط لإدخال كلمة المرور' : 'Encrypted · Open with its password';
      const lockIcon = document.createElement('span'); lockIcon.className = 'roomLock'; lockIcon.textContent = '🔐';
      info.append(title, hint); button.append(avatar, info, lockIcon);
      button.onclick = () => openSavedRoom(code);
      list.appendChild(button);
    });
  }
  // تصغير الصورة وإعادة رسمها (بيشيل بيانات الموقع EXIF). square = قص مربع للصورة الشخصية
  async function shrink(file, max, q, square) {
    const bmp = await createImageBitmap(file);
    const c = document.createElement('canvas'), x = c.getContext('2d');
    if (square) {
      const m = Math.min(bmp.width, bmp.height);
      c.width = c.height = max;
      x.drawImage(bmp, (bmp.width - m) / 2, (bmp.height - m) / 2, m, m, 0, 0, max, max);
    } else {
      const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
      c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
      x.drawImage(bmp, 0, 0, c.width, c.height);
    }
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', q));
    return b64(await blob.arrayBuffer());
  }

  const translations = {
    'غرفة مقفولة':'Locked Room','🔒 غرفة مقفولة':'🔒 Locked Room','محادثة مشفرة بين اتنين بس. سجّل دخولك الأول عشان تكمل.':'A private, encrypted chat for two. Sign in to continue.',
    'هناك من يطرق الباب':'Someone is knocking at the door','إيقاظ':'Knock','تفعيل إشعارات الطرق':'Enable knock notifications','إشعارات الطرق مفعلة':'Knock notifications are enabled','اسمح بإشعارات المتصفح لاستقبال الطرق':'Allow browser notifications to receive knocks','المتصفح لا يدعم الإشعارات':'This browser does not support notifications','نغمة الطرق':'Knock sound','دق الباب':'Knock','جرس هادئ':'Soft bell','نغمة إلكترونية':'Digital tone','تجربة النغمة':'Preview sound','إضافة نغمة من الجهاز':'Add a sound from this device','حذف النغمة المضافة':'Remove custom sound','اختار ملف صوت أقل من 8 ميجابايت':'Choose an audio file under 8 MB','تعذر حفظ ملف الصوت':'Could not save the audio file','لم تتم إضافة نغمة':'No custom sound added','سجل الاتصالات':'Connection history','تحديث السجل':'Refresh history','تسجيل الخروج':'Sign out','الجهاز':'Device','المكان':'Location','بدأت':'Started','المدة':'Duration','آخر نشاط':'Last activity','نشط الآن':'Active now','لا توجد جلسات مسجلة':'No recorded sessions','تم تسجيل الخروج':'Signed out','تم استبدال الجلسة بجهاز آخر':'Replaced by another device',
    'تسجيل الدخول بجوجل':'Sign in with Google','في انتظار موافقة جهازك الحالي':'Waiting for approval from your current device','افتح التطبيق على الجهاز المسجل ووافق على طلب تسجيل الدخول قبل المتابعة.':'Approve this sign-in from your active device before continuing.','تحقق الآن':'Check status','تسجيل دخول من جهاز جديد':'Sign-in from a new device','جهاز جديد سجّل الدخول بحسابك. هل كنت أنت؟':'A new device signed in to your account. Was this you?','لأ، ارفض واحظر الجهاز':'No, reject and block device','تمت الموافقة. سيُطلب من الجهاز كلمة مرور الحساب.':'Approved. The device will still need your account password.','تم رفض تسجيل الدخول وحظر هذا الجهاز.':'Sign-in rejected and this device has been blocked.','لم يصل طلب تسجيل الدخول أو انتهت صلاحيته. سجّل دخول Google مرة أخرى.':'The sign-in request expired. Sign in with Google again.','تعذر تسجيل القرار. حاول مرة أخرى.':'Could not save your decision. Try again.','جارٍ إرسال الرد...':'Sending response…','جاري تسجيل الدخول بجوجل...':'Opening Google sign-in…','اللغة':'Language','كلمة مرور الغرفة لا يجوز أن تكون كلمة مرور الحساب.':'Room password cannot be the same as the account password.','كلمة المرور مستخدمة في غرفة أخرى؛ اختر كلمة مختلفة.':'This password is already used for another room. Choose a different one.','الباسورد لازم يختلف عن باسورد الحساب.':'The room password must differ from your account password.',
    'أهلاً بيك':'Welcome','أهلاً بيك تاني':'Welcome back','أول مرة تدخل هنا. اعمل باسورد لحسابك، وهتحتاجه كل مرة تسجل فيها دخول.':'This is your first visit. Create an account password; you will need it each time you sign in.',
    'الباسورد (8 حروف على الأقل)':'Password (at least 8 characters)','الباسورد الجديد (8 حروف على الأقل)':'New password (at least 8 characters)','اكتب الباسورد تاني':'Re-enter password','إنشاء الباسورد والدخول':'Create password and sign in','استخدم حساب تاني':'Use another account',
    'اكتب الباسورد اللي عملته لحسابك.':'Enter the password you created for your account.','الباسورد':'Password','دخول':'Sign in','الحساب اتفتح على جهاز تاني':'Your account was opened on another device','الجلسة على الجهاز ده اتقفلت.':'This device session has been signed out.','الجهاز':'Device','الوقت':'Time','المكان التقريبي':'Approximate location','هل ده كان أنت؟':'Was this you?','أيوه، كان أنا':'Yes, that was me','لأ، مش أنا':'No, it was not me',
    'اعمل باسورد جديد':'Create a new password','الجهاز ده هيتحظر نهائياً من حسابك، والباسورد القديم هيتلغي.':'This device will be permanently blocked from your account, and your old password will be revoked.','الجهاز اللي هيتحظر':'Device to be blocked','تغيير الباسورد وحظر الجهاز':'Change password and block device','الجهاز ده محظور':'This device is blocked','الجهاز ده اتمنع نهائياً من الدخول على الحساب ده.':'This device has been permanently blocked from this account.',
    'تغيير باسورد الحساب':'Change account password','الباسورد الحالي':'Current password','تغيير الباسورد':'Change password','الباسورد الجديد (8 حروف على الأقل)':'New password (at least 8 characters)','تم تغيير الباسورد.':'Password changed.','الباسورد الحالي غلط.':'Current password is incorrect.','تعذر تغيير الباسورد. حاول مرة أخرى.':'Could not change the password. Try again.',
    'تسجيل خروج':'Sign out','الإعدادات':'Settings','محادثة بين اتنين بس. كل حاجة بتتشفر على جهازك، والسيرفر مبيشوفش غير حروف مش مفهومة.':'A private chat for two. Everything is encrypted on your device; the server only sees unreadable data.',
    'إنشاء غرفة جديدة':'Create a new room','دخول بكود':'Join with a code','متابعة':'Continue','إلغاء':'Cancel','المحادثات':'Chats','إرسال صورة أو ملف':'Send image or file','تسجيل رسالة صوتية':'Record a voice message','بيكتب...':'Typing…','بيسجل رسالة صوتية...':'Recording a voice message…','بيبعت مرفق...':'Sending an attachment…','الملف كبير قوي. الحد الأقصى 2.5 ميجابايت.':'File is too large. Maximum size is 2.5 MB.','التسجيل طويل قوي. أقصى حجم للتسجيل 2.5 ميجابايت.':'Voice recording is too large. Maximum size is 2.5 MB.','التسجيل الصوتي غير مدعوم على هذا الجهاز.':'Voice recording is not supported on this device.','معرفتش أفتح المايك. اتأكد إنك سمحت بالإذن.':'Could not open the microphone. Check microphone permission.','فتح محادثة خاصة ':'Open private chat ','محادثة خاصة ':'Private chat ','تم حذف المحادثة من الطرفين نهائياً.':'This chat was permanently deleted for both sides.','هل تريد حذف المحادثة نهائياً لكلا الطرفين؟ لا يمكن التراجع عن هذا الإجراء.':'Delete this chat for both sides permanently? This cannot be undone.','تعذر حذف المحادثة. حاول مرة أخرى.':'Could not delete this chat. Try again.','🗑️ حذف المحادثة نهائياً للطرفين':'🗑️ Permanently delete chat for both sides','كلمة مرور المحادثة غير صحيحة.':'Incorrect chat password.','المحادثة محذوفة نهائياً.':'This chat was permanently deleted.','محادثاتك الخاصة هتظهر هنا.':'Your private chats will appear here.','محادثة خاصة ':'Private chat ','محتوى مشفّر · اضغط لإدخال كلمة المرور':'Encrypted · Open with its password','ابعت الكود للشخص التاني، وهتتفقوا على الباسورد بعيد عن الكود.':'Share the code with the other person. Choose a password separately from the code.','نسخ الكود':'Copy code','نسخ الرابط':'Copy link','معايا كود':'I have a code',
    'اكتب الباسورد':'Enter password','لازم تكتبوا نفس الباسورد انتم الاتنين، لو اختلف مش هتقدروا تفكوا رسايل بعض.':'Both of you must enter the same password, or you will not be able to read each other’s messages.','الباسورد (6 حروف على الأقل)':'Password (at least 6 characters)','دخول الشات':'Open chat','رجوع':'Back',
    'الطرف التاني':'The other person','متصل':'Connected','مستني الطرف التاني':'Waiting for the other person','بيتصل...':'Connecting…','مكالمة صوت':'Voice call','مكالمة فيديو':'Video call','القائمة':'Menu',
    'كود الغرفة':'Room code','🔑 كود الغرفة':'🔑 Room code','البروفايل والخلفية':'Profile and background','👤 البروفايل والخلفية':'👤 Profile and background','إنهاء ومسح':'Leave and clear','🚪 إنهاء ومسح':'🚪 Leave and clear','إيموجي':'Emoji','اكتب رسالة':'Type a message','صورة':'Image','إرسال':'Send',
    'الرابط بيحتوي الكود بس، مش الباسورد.':'The link contains the code only, not the password.','إغلاق':'Close','البروفايل':'Profile','👤 البروفايل':'👤 Profile','اسمك':'Your name','صورة شخصية':'Profile photo','حذف':'Remove','خلفية الشات':'Chat background','🖼️ خلفية الشات':'🖼️ Chat background','صورة من الجهاز':'Choose an image','حفظ':'Save','رد':'Answer','رفض':'Decline','إنهاء':'End call',
    'الرسايل والصور متشفرة بالباسورد على جهازك. المتصفح مبيقدرش يمنع سكرين شوت بالكامل، النسخة بتاعة التطبيق هي اللي بتمنعه فعلاً.':'Messages and photos are encrypted on your device. Browsers cannot fully prevent screenshots.',
    'الطرف التاني خرج.':'The other person left.','الغرفة دي فيها شخصين بالفعل.':'This room already has two people.','وصلت رسالة مش قادر يفك تشفيرها. غالباً الباسورد مش نفس باسورد الطرف التاني.':'A message could not be decrypted. The other person may have entered a different password.',
    'الباسورد لازم 6 حروف على الأقل.':'Password must be at least 6 characters.','جاري التحقق...':'Checking…','حصل خطأ، جرب تاني.':'Something went wrong. Please try again.','الصورة كبيرة قوي.':'The image is too large.','معرفتش أقرأ الصورة دي.':'Could not read this image.',
    'وصلت للسيرفر، الطرف الآخر غير متصل':'Sent to server; the other person is offline','وصلت للطرف الآخر، لم يشاهدها':'Delivered, not seen','شاهدها الطرف الآخر':'Seen',
    'قوة الإشارة':'Signal strength','جاري القياس':'Measuring…','ضعيف':'Weak','متوسط':'Fair','جيد':'Good','ممتاز':'Excellent','كتم الميكروفون':'Mute microphone','تشغيل الميكروفون':'Unmute microphone','تشغيل الكاميرا':'Turn on camera','إيقاف الكاميرا':'Turn off camera','إنهاء المكالمة':'End call','جاري الاتصال':'Connecting','الاتصال ضعيف...':'Poor connection…','تعذر تشغيل الكاميرا':'Could not start camera','معرفتش أفتح الكاميرا':'Could not open the camera','المكالمة معرفتش تتوصل. ممكن الشبكة مش بتسمح بالاتصال المباشر.':'Could not connect the call. The network may block direct connections.','🎤 كتم':'🎤 Mute','🎤 تشغيل':'🎤 Unmute','📷 إيقاف':'📷 Turn off','📷 تشغيل':'📷 Turn on','معرفتش أفتح المايك أو الكاميرا. اتأكد إنك سمحت بالإذن.':'Could not access the microphone or camera. Check the app permissions.','بيرن...':'Ringing…','محدش رد.':'No one answered.','معرفتش أبدأ المكالمة.':'Could not start the call.','معرفتش أرد على المكالمة.':'Could not answer the call.','🎥 مكالمة فيديو جاية':'🎥 Incoming video call','📞 مكالمة صوت جاية':'📞 Incoming voice call','معرفتش أوصل المكالمة.':'Could not connect the call.','الطرف التاني في مكالمة تانية.':'The other person is on another call.','المكالمة انتهت.':'The call ended.','اتنسخ ✓':'Copied ✓','الشاشة محمية. اضغط هنا للمتابعة.':'Screen protected. Tap here to continue.','الكود مش صح. لازم 24 حرف ورقم.':'Invalid code. It must contain 24 letters and numbers.',
    'لازم توافق على تسجيل الدخول بجوجل عشان تكمل.':'You must allow Google sign-in to continue.','تسجيل الدخول فشل، جرب تاني.':'Sign-in failed. Please try again.','إيميل جوجل ده مش متأكد منه. استخدم حساب تاني.':'This Google email is not verified. Use another account.','تسجيل الدخول بجوجل لسه مش متظبط على السيرفر.':'Google sign-in is not configured on the server yet.','الجهاز ده محظور من الحساب ده.':'This device is blocked from this account.',
    'جاري الإنشاء...':'Creating…','الباسورد لازم 8 حروف على الأقل.':'Password must be at least 8 characters.','الباسورد مش متطابق في الخانتين.':'The passwords do not match.','الجلسة خلصت، سجل دخولك تاني.':'Your session expired. Please sign in again.','الباسورد لازم يكون من 8 لـ 200 حرف.':'Password must be between 8 and 200 characters.','اكتب الباسورد.':'Enter your password.','الباسورد غلط':'Incorrect password','جاري التغيير...':'Updating…','جهاز غير معروف':'Unknown device',
    'أهلاً بيك يا ':'Welcome, ','أهلاً بيك تاني يا ':'Welcome back, ','خلفية ':'Background '
  };
  const translationEntries = Object.entries(translations).sort((a,b) => b[0].length - a[0].length);
  const reverseTranslations = Object.fromEntries(translationEntries.map(([ar,en]) => [en,ar]));
  let lang = localStorage.getItem('lr.lang') || (/^ar/i.test(navigator.language || '') ? 'ar' : 'en'); lang = lang === 'en' ? 'en' : 'ar';
  const translate = (value) => {
    if (lang === 'ar') return reverseTranslations[value] || value;
    if (translations[value]) return translations[value];
    let match = value.match(/^محاولات كتير غلط\. استنى (\d+) دقيقة وجرب تاني\.$/);
    if (match) return 'Too many incorrect attempts. Wait ' + match[1] + ' minutes and try again.';
    match = value.match(/^الباسورد غلط \(باقي (\d+) محاولات\)\.$/);
    if (match) return 'Incorrect password (' + match[1] + ' attempts left).';
    for (const [ar,en] of translationEntries) if (ar.length > 4 && value.startsWith(ar)) return en + value.slice(ar.length);
    return value;
  };
  const originals = new WeakMap(), shown = new WeakMap(), attrOriginals = new WeakMap(), attrShown = new WeakMap();
  function applyLanguage() {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (node.parentElement?.closest('[data-lang-switch]')) continue;
      if (!originals.has(node) || (shown.has(node) && node.nodeValue !== shown.get(node))) originals.set(node, node.nodeValue);
      const next = translate(originals.get(node));
      if (node.nodeValue !== next) node.nodeValue = next;
      shown.set(node, next);
    }
    for (const el of document.querySelectorAll('input[placeholder],[aria-label],[title]')) {
      const old = attrOriginals.get(el) || {}, displayed = attrShown.get(el) || {};
      for (const name of ['placeholder','aria-label','title']) if (el.hasAttribute(name)) {
        const current = el.getAttribute(name);
        if (!(name in old) || (name in displayed && current !== displayed[name])) old[name] = current;
        const next = translate(old[name]);
        if (current !== next) el.setAttribute(name, next);
        displayed[name] = next;
      }
      attrOriginals.set(el, old); attrShown.set(el, displayed);
    }
    const switchText = lang === 'ar' ? 'English' : 'العربية';
    for (const id of ['langLogin','langSettings']) if ($(id) && $(id).textContent !== switchText) $(id).textContent = switchText;
    const googleText = lang === 'ar' ? 'تسجيل الدخول بجوجل' : 'Sign in with Google';
    if ($('gLabel').textContent !== googleText) $('gLabel').textContent = googleText;
    const pageTitle = lang === 'ar' ? 'غرفة مقفولة' : 'Locked Room';
    if (document.title !== pageTitle) document.title = pageTitle;
    try { localStorage.setItem('lr.lang', lang); } catch {}
  }
  function setLanguage(next) { lang = next === 'en' ? 'en' : 'ar'; applyLanguage(); renderRooms(); }
  const languageObserver = new MutationObserver(() => applyLanguage());
  languageObserver.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['placeholder','aria-label'] });
  document.addEventListener('click', (event) => {
    if (event.target.closest('#langLogin,#langSettings')) setLanguage(lang === 'ar' ? 'en' : 'ar');
  });
  // ---------- التشفير ----------
  // رقم الغرفة من الكود بس. مفتاح التشفير من الكود + الباسورد (PBKDF2 ثم HKDF)
  async function derive(code, pw) {
    const salt = enc.encode('locked-room-v2');
    const base = await crypto.subtle.importKey('raw', enc.encode(code), 'HKDF', false, ['deriveBits']);
    const idBits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode('room-id') }, base, 256);
    const pwKey = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
    const pwBits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode('pw:' + code), iterations: 310000 }, pwKey, 256));
    const ikm = new Uint8Array([...enc.encode(code), ...pwBits]);
    const base2 = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveKey']);
    const k = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode('enc-key') }, base2,
      { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    return { roomId: hex(idBits), key: k };
  }
  async function seal(obj) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj)));
    return { t: 'msg', iv: b64(iv), ct: b64(ct) };
  }
  async function open(m) {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(m.iv) }, key, unb64(m.ct));
    return JSON.parse(dec.decode(pt));
  }

  // ---------- الواجهة ----------
  const show = (id) => { for (const s of ['login', 'welcome', 'unlock', 'kicked', 'reset', 'blocked', 'waiting', 'home', 'lock', 'chat']) $(s).classList.toggle('hidden', s !== id); closeAll(); };
  const time = (at = Date.now()) => new Date(at).toLocaleTimeString(lang === 'ar' ? 'ar-EG' : 'en-US', { hour: '2-digit', minute: '2-digit' });
  const scrollDown = () => { $('log').scrollTop = $('log').scrollHeight; };
  function receiptIcon(state) {
    const span = document.createElement('span'); span.className = 'receipt ' + state;
    const labels = { sent: 'وصلت للسيرفر، الطرف الآخر غير متصل', delivered: 'وصلت للطرف الآخر، لم يشاهدها', read: 'شاهدها الطرف الآخر' };
    span.title = translate(labels[state] || labels.sent); span.setAttribute('aria-label', span.title);
    const svg = document.createElementNS('http://www.w3.org/2000/svg','svg'); svg.setAttribute('viewBox','0 0 28 22'); svg.setAttribute('aria-hidden','true');
    const lock = document.createElementNS('http://www.w3.org/2000/svg','path');
    lock.setAttribute('d', state === 'read' ? 'M10 9V6.5a4.5 4.5 0 0 1 8.7-1.7M8 9h14v11H8z' : 'M8 9V6.5a4.5 4.5 0 0 1 9 0V9M6 9h14v11H6z');
    lock.setAttribute('fill','none'); lock.setAttribute('stroke','currentColor'); lock.setAttribute('stroke-width','1.8'); lock.setAttribute('stroke-linecap','round'); lock.setAttribute('stroke-linejoin','round'); svg.appendChild(lock);
    if (state === 'delivered') {
      const key = document.createElementNS('http://www.w3.org/2000/svg','path'); key.setAttribute('d','M22 6.5a2.5 2.5 0 1 0-2.5 2.5H22v2h2V9h1V7h-3'); key.setAttribute('fill','none'); key.setAttribute('stroke','currentColor'); key.setAttribute('stroke-width','1.4'); key.setAttribute('stroke-linecap','round'); key.setAttribute('stroke-linejoin','round'); svg.appendChild(key);
    }
    span.appendChild(svg); return span;
  }
  function updateReceipt(mid, state) {
    if (typeof mid !== 'string' || !/^[a-f0-9]{32}$/.test(mid) || !['sent','delivered','read'].includes(state)) return;
    const rank = { sent: 0, delivered: 1, read: 2 }, current = receiptStates.get(mid);
    if (current && rank[current] > rank[state]) return;
    receiptStates.set(mid, state);
    const node = messageNodes.get(mid); if (!node) return;
    const old = node.querySelector('.receipt'); if (old) old.remove();
    node.querySelector('.messageMeta')?.appendChild(receiptIcon(state));
  }
  function addMsg(who, node, sentAt = Date.now(), mid = '', state = 'sent') {
    const d = document.createElement('div'); d.className = 'm ' + who;
    if (mid) { d.dataset.mid = mid; messageNodes.set(mid, d); }
    d.appendChild(node);
    const meta = document.createElement('small'); meta.className = 'messageMeta';
    const stamp = document.createElement('span'); stamp.textContent = time(sentAt); meta.appendChild(stamp);
    if (who === 'me') meta.appendChild(receiptIcon(state));
    d.appendChild(meta); $('log').appendChild(d); scrollDown();
    if (mid && who === 'me' && receiptStates.has(mid)) updateReceipt(mid, receiptStates.get(mid));
    return d;
  }
  function markRead(mid) {
    if (typeof mid !== 'string' || !/^[a-f0-9]{32}$/.test(mid) || readSent.has(mid) || !ws || ws.readyState !== 1) return;
    readSent.add(mid); ws.send(JSON.stringify({ t: 'read', mid }));
  }  const textNode = (s) => { const p = document.createElement('p'); p.textContent = s; return p; };
  const sysNote = (s) => { const d = document.createElement('div'); d.className = 'sys'; d.textContent = s; $('log').appendChild(d); scrollDown(); };
  function setStatus() {
    const ok = peers === 2;
    $('wakeBtn').disabled = !ok;
    $('status').textContent = ok ? 'متصل' : 'مستني الطرف التاني';
    $('status').classList.toggle('on', ok);
    $('sendBtn').disabled = $('attach').disabled = $('recordBtn').disabled = !ok;
    $('callA').disabled = $('callV').disabled = !ok || callState !== 'idle';
  }
  function imgNode(data) {
    const i = document.createElement('img');
    i.src = blobUrl(data); i.alt = 'صورة'; i.draggable = false;
    i.addEventListener('load', scrollDown);
    return i;
  }
  function audioNode(data, type) {
    const a = document.createElement('audio'); a.controls = true; a.preload = 'metadata'; a.src = blobUrl(data, type || 'audio/webm');
    a.addEventListener('loadedmetadata', scrollDown); return a;
  }
  function fileNode(name, type, data) {
    const wrap = document.createElement('div'); wrap.className = 'fileMessage';
    const link = document.createElement('a'); link.href = blobUrl(data, type || 'application/octet-stream'); link.download = name || 'attachment';
    link.textContent = '📄 ' + (name || 'attachment'); link.title = name || 'attachment'; wrap.appendChild(link); return wrap;
  }
  function setPeerActivity(value) {
    const labels = { typing: 'بيكتب...', recording: 'بيسجل رسالة صوتية...', sending: 'بيبعت مرفق...' };
    $('activity').textContent = labels[value] || '';
    clearTimeout(peerActivityTimer);
    if (value) peerActivityTimer = setTimeout(() => { $('activity').textContent = ''; }, value === 'typing' ? 3500 : 60000);
  }
  async function sendPresence(value) {
    if (!ws || ws.readyState !== 1 || peers !== 2) return;
    presenceSent = value || '';
    try { ws.send(JSON.stringify(await seal({ k: 'presence', v: value || '' }))); } catch {}
  }
  function stopPresence() { clearTimeout(typingTimer); typingTimer = 0; sendPresence(''); }
  function setAv(el, url, name) {
    el.style.backgroundImage = url ? `url(${url})` : '';
    el.textContent = url ? '' : ((name || '').trim()[0] || '👤');
  }

  // ---------- البروفايل والخلفية ----------
  const BGS = ['', 'linear-gradient(160deg,#0f2027,#2c5364)', 'linear-gradient(160deg,#1a1a2e,#3a1c71)',
    'linear-gradient(160deg,#134e5e,#3d7a58)', 'linear-gradient(160deg,#42275a,#734b6d)', '#000'];
  let bgUrl = '';
  function applyBg() {
    const v = store.get('b'); let css = '';
    if (v.startsWith('i:')) { if (bgUrl) URL.revokeObjectURL(bgUrl); bgUrl = blobUrl(v.slice(2)); css = `url(${bgUrl})`; }
    else if (v.startsWith('p:')) css = BGS[+v.slice(2)] || '';
    document.documentElement.style.setProperty('--bgimg', css || '#0b141a');
  }
  let myUrl = '';
  function applyMine() {
    const a = store.get('a'); if (myUrl) URL.revokeObjectURL(myUrl);
    myUrl = a ? blobUrl(a) : '';
    setAv($('myAv'), myUrl, store.get('n'));
  }
  function durationLabel(seconds) {
    let n = Math.max(0, Math.floor(seconds || 0)); const h = Math.floor(n / 3600); n %= 3600; const m = Math.floor(n / 60); const sec = n % 60;
    return [h ? h + (lang === 'ar' ? ' س' : ' hr') : '', m ? m + (lang === 'ar' ? ' د' : ' min') : '', (!h && !m) || sec ? sec + (lang === 'ar' ? ' ث' : ' sec') : ''].filter(Boolean).join(' ');
  }
  async function loadSessionLog() {
    if (!$('sessionLogs')) return;
    $('sessionStatus').textContent = ''; $('sessionLogs').textContent = '';
    const { status, data } = await api('/api/sessions');
    if (status !== 200) { $('sessionStatus').textContent = status === 401 ? 'الجلسة خلصت، سجل دخولك تاني.' : 'حصل خطأ، جرب تاني.'; return; }
    const entries = Array.isArray(data.sessions) ? data.sessions : [];
    if (!entries.length) { $('sessionLogs').textContent = 'لا توجد جلسات مسجلة'; return; }
    for (const entry of entries) {
      const card = document.createElement('article'); card.className = 'sessionEntry';
      const title = document.createElement('strong'); title.textContent = entry.device || 'جهاز غير معروف'; card.appendChild(title);
      const details = document.createElement('div'); details.className = 'sessionDetails';
      const started = new Date(entry.started).toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-US', { dateStyle:'medium', timeStyle:'short' });
      const last = new Date(entry.lastSeen).toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-US', { dateStyle:'medium', timeStyle:'short' });
      const ended = entry.active ? 'نشط الآن' : entry.reason === 'logout' ? 'تم تسجيل الخروج' : entry.reason === 'replaced' ? 'تم استبدال الجلسة بجهاز آخر' : '';
      const labels = lang === 'ar' ? { started:'بدأت', duration:'المدة', last:'آخر نشاط' } : { started:'Started', duration:'Duration', last:'Last activity' };
      details.textContent = (entry.location ? entry.location + ' · ' : '') + labels.started + ': ' + started + ' · ' + labels.duration + ': ' + durationLabel(entry.duration) + ' · ' + labels.last + ': ' + last + (ended ? ' · ' + ended : '');
      card.appendChild(details); $('sessionLogs').appendChild(card);
    }
  }
  function openSettings() {
    closeAll(); tmpAv = null; tmpBg = null;
    $('nameIn').value = store.get('n'); applyMine();
    $('swatches').textContent = '';
    BGS.forEach((css, i) => {
      const b = document.createElement('button');
      b.style.background = css || '#0b141a'; b.setAttribute('aria-label', 'خلفية ' + (i + 1));
      b.onclick = () => { tmpBg = 'p:' + i; document.querySelectorAll('#swatches button').forEach((x) => x.classList.toggle('on', x === b)); };
      $('swatches').appendChild(b);
    });
    $('setSheet').classList.remove('hidden');
    updateKnockSettings(); loadSessionLog(); loadCustomKnock().then((blob) => { customKnockBlob = blob; updateKnockSettings(); });
  }
  async function saveSettings() {
    store.set('n', $('nameIn').value.trim());
    if (tmpAv !== null) store.set('a', tmpAv);
    if (tmpBg !== null) store.set('b', tmpBg === 'p:0' ? '' : tmpBg);
    applyMine(); applyBg(); closeAll(); sendProfile();
  }
  async function sendProfile() {
    if (!ws || ws.readyState !== 1 || peers !== 2) return;
    ws.send(JSON.stringify(await seal({ k: 'prof', n: store.get('n'), a: store.get('a') })));
  }
  function onProfile(p) {
    const n = typeof p.n === 'string' ? p.n.slice(0, 30) : '';
    peerName = n; $('peerName').textContent = n || 'الطرف التاني';
    if (peerUrl) URL.revokeObjectURL(peerUrl);
    peerUrl = typeof p.a === 'string' && p.a.length > 0 && p.a.length < 60000 ? blobUrl(p.a) : '';
    setAv($('peerAv'), peerUrl, n);
  }

  // ---------- إيموجي ----------
  const EMO = {
    '😀': '😀 😃 😄 😁 😆 😅 😂 🤣 😊 😇 🙂 🙃 😉 😍 🥰 😘 😗 😋 😛 😜 🤪 😎 🤩 🥳 😏 😒 😞 😔 😟 😕 🙁 😣 😖 😫 😩 🥺 😢 😭 😤 😠 😡 🤬 🤯 😳 🥵 🥶 😱 😨 😰 😥 😓 🤗 🤔 🤭 🤫 🙄 😬 😴 🤤 😷 🤒 🤕 🤢 🤮 🥴 😈 💀 👻 🤡',
    '👍': '👍 👎 👌 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ ✋ 🖐️ 🖖 👋 🤝 🙏 ✍️ 💪 👏 🙌 👐 🤲 🫶 🫡 🤌 👀 👅 👄 🧠',
    '❤️': '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💯 ✨ 🔥 ⭐ 🌟 💥 💫 🎉 🎊 🎁 🏆',
    '🐶': '🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🙈 🙉 🙊 🐔 🐧 🐦 🦅 🦉 🐴 🦄 🐝 🦋 🐢 🐍 🐬 🐳 🐟 🌹 🌸 🌻 🌴 🌍 🌙 ☀️ ⛅ ⚡ ❄️ 🌈',
    '🍕': '🍎 🍌 🍉 🍇 🍓 🍒 🍑 🥭 🍍 🥑 🍅 🥕 🌽 🍞 🧀 🍗 🍖 🍔 🍟 🍕 🌭 🌮 🥙 🍝 🍜 🍣 🍩 🍪 🎂 🍰 🍫 🍬 🍦 ☕ 🍵 🥤 🍺',
    '⚽': '⚽ 🏀 🏈 ⚾ 🎾 🏐 🏓 🥊 🎯 🎮 🎲 🎵 🎶 🎤 🎧 🎬 📷 📱 💻 ⌚ 💡 📚 ✏️ 💰 🔑 🔒 🚗 ✈️ 🚀 🏠 ⏰ 🕌',
  };
  function emojiTab(k) {
    document.querySelectorAll('#eTabs button').forEach((b) => b.classList.toggle('on', b.textContent === k));
    $('eGrid').textContent = '';
    EMO[k].split(' ').forEach((e) => {
      const b = document.createElement('button'); b.textContent = e;
      b.onclick = () => {
        const i = $('msg'), s = i.selectionStart ?? i.value.length, t = i.selectionEnd ?? s;
        i.value = i.value.slice(0, s) + e + i.value.slice(t);
        i.selectionStart = i.selectionEnd = s + e.length; i.focus();
      };
      $('eGrid').appendChild(b);
    });
  }
  Object.keys(EMO).forEach((k) => { const b = document.createElement('button'); b.textContent = k; b.onclick = () => emojiTab(k); $('eTabs').appendChild(b); });

  // ---------- القوائم ----------
  function closeAll() { for (const i of ['menu', 'emoji', 'codeSheet', 'setSheet', 'joinSheet']) $(i).classList.add('hidden'); }
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#menu,#menuBtn')) $('menu').classList.add('hidden');
    if (e.target.classList.contains('sheet') || e.target.classList.contains('close')) closeAll();
  });

  // ---------- حماية الشاشة (أقصى ما يقدر المتصفح يعمله) ----------
  let hold = 0;
  const shieldCheck = () => document.body.classList.toggle('shield', document.hidden || !document.hasFocus() || Date.now() < hold);
  const shieldFor = (ms) => { hold = Date.now() + ms; shieldCheck(); setTimeout(shieldCheck, ms + 50); };
  ['visibilitychange', 'blur', 'focus', 'pagehide', 'pageshow', 'resize'].forEach((ev) => addEventListener(ev, shieldCheck));
  setInterval(shieldCheck, 400);
  $('shield').onclick = () => { window.focus(); shieldCheck(); };
  addEventListener('keyup', (e) => {
    if (e.key === 'PrintScreen') { shieldFor(3000); try { navigator.clipboard.writeText(''); } catch {} }
  });
  addEventListener('keydown', (e) => {
    const k = (e.key || '').toLowerCase();
    if (((e.ctrlKey || e.metaKey) && ['p', 's', 'u'].includes(k)) || (e.metaKey && e.shiftKey) || (e.key === 'Meta' || e.key === 'OS')) { shieldFor(2500); if (k.length === 1) e.preventDefault(); }
  });
  ['contextmenu', 'dragstart', 'copy', 'cut'].forEach((ev) => addEventListener(ev, (e) => { if (!e.target.closest('input')) e.preventDefault(); }));

  // ---------- الاتصال ----------
  async function enterRoom(code, pw) {
    const d = await derive(code, pw);
    key = d.key; curCode = code; badShown = false;
    show('chat'); $('log').textContent = ''; peers = 0; setStatus();
    onProfile({}); peerName = '';
    sysNote('الرسايل والصور متشفرة بالباسورد على جهازك. المتصفح مبيقدرش يمنع سكرين شوت بالكامل، النسخة بتاعة التطبيق هي اللي بتمنعه فعلاً.');
    if (creatorCode && creatorCode === code) {
      const line = 'كود الغرفة: ' + fmt(code);
      codeAnnounced = true; creatorCode = '';
      const mid = hex(crypto.getRandomValues(new Uint8Array(16)));
      pendingCodePacket = JSON.stringify({ ...await seal({ k: 'text', v: line }), p: 1, mid });
      addMsg('me', textNode(line), Date.now(), mid, 'sent');
    }
    ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws?r=' + d.roomId);
    ws.onmessage = async (e) => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'joined' || m.t === 'peer') {
        const was = peers; peers = m.n;
        if (peers < 2 && callState !== 'idle') endCall(null, false);
        setStatus();
        if (peers === 2) {
          sendProfile();
          if (pendingCodePacket && ws && ws.readyState === 1) {
            ws.send(pendingCodePacket);
            pendingCodePacket = null;
          }
        }
        if (m.t === 'peer' && was === 2 && peers < 2) sysNote('الطرف التاني خرج.');
      } else if (m.t === 'receipt') {
        updateReceipt(m.mid, m.state);
      } else if (m.t === 'deleted') {
        const deletedCode = curCode;
        forgetRoom(deletedCode);
        leave('تم حذف المحادثة من الطرفين نهائياً.');
      } else if (m.t === 'full') { leave('الغرفة دي فيها شخصين بالفعل.'); }
      else if (m.t === 'kicked') { watch(); }
      else if (m.t === 'msg') {
        try {
          const p = await open(m);
          if (p.k === 'presence') { setPeerActivity(p.v); return; }
          if (p.k === 'call') { await onCall(p); return; }
          let rendered = false; const who = m.fromSelf ? 'me' : 'them', receipt = m.receipt || 'sent';
          if (p.k === 'prof') onProfile(p);
          else if (p.k === 'text' && typeof p.v === 'string') { addMsg(who, textNode(p.v), m.sentAt, m.mid, receipt); rendered = true; }
          else if (p.k === 'img' && typeof p.v === 'string') { addMsg(who, imgNode(p.v), m.sentAt, m.mid, receipt); rendered = true; }
          else if (p.k === 'audio' && typeof p.d === 'string') { addMsg(who, audioNode(p.d, p.t), m.sentAt, m.mid, receipt); rendered = true; }
          else if (p.k === 'file' && typeof p.d === 'string') { addMsg(who, fileNode(p.n, p.t, p.d), m.sentAt, m.mid, receipt); rendered = true; }
          if (rendered && !m.fromSelf) markRead(m.mid);
        } catch {
          if (!badShown) { badShown = true; sysNote('وصلت رسالة مش قادر يفك تشفيرها. غالباً الباسورد مش نفس باسورد الطرف التاني.'); }
        }
      }
    };
    ws.onclose = (ev) => { endCall(null, false); if (ev && ev.code === 4001) watch(); if (key) { peers = 0; setStatus(); $('status').textContent = 'الاتصال اتقطع'; } };
  }
  function leave(err) {
    clearTimeout(recentRoomTimer); recentRoom = null;
    clearTimeout(typingTimer); clearTimeout(peerActivityTimer); $('activity').textContent = ''; presenceSent = '';
    if (recorder && recorder.state !== 'inactive') { recorder.onstop = null; try { recorder.stop(); } catch {} }
    if (recordingStream) recordingStream.getTracks().forEach((t) => t.stop()); recordingStream = null; recorder = null; recordingParts = [];
    $('recordBtn').textContent = '🎙️'; $('recordBtn').classList.remove('recording');
    endCall(null, true);
    const w = ws; ws = null; key = null; curCode = '';
    if (w) w.close();
    $('log').textContent = ''; $('msg').value = ''; newCode = ''; pendingCode = ''; $('pw').value = '';
    $('codeIn').value = ''; pendingCodePacket = null;
    $('homeErr').textContent = err || '';
    show('home');
  }
  async function deleteCurrentRoom() {
    if (!curCode || !recentRoom || recentRoom.code !== curCode) return sysNote('تعذر حذف المحادثة. حاول مرة أخرى.');
    const prompt = lang === 'ar' ? 'هل تريد حذف المحادثة نهائياً لكلا الطرفين؟ لا يمكن التراجع عن هذا الإجراء.' : 'Delete this chat for both sides permanently? This cannot be undone.';
    if (!window.confirm(prompt)) return;
    const code = curCode, pw = recentRoom.pw;
    $('deleteRoom').disabled = true;
    const { status } = await api('/api/room/delete', { code, pw });
    $('deleteRoom').disabled = false;
    if (status === 200 || status === 410) {
      forgetRoom(code);
      if (curCode === code) leave('تم حذف المحادثة من الطرفين نهائياً.');
      return;
    }
    sysNote('تعذر حذف المحادثة. حاول مرة أخرى.');
  }
  function backToChats() {
    const saved = recentRoom && recentRoom.code === curCode ? { ...recentRoom, until: Date.now() + 5000 } : null;
    leave();
    syncRooms();
    if (saved) {
      recentRoom = saved;
      clearTimeout(recentRoomTimer);
      recentRoomTimer = setTimeout(() => { if (recentRoom === saved) recentRoom = null; }, 5000);
    }
  }
  function askPw(code) {
    pendingCode = code; $('pw').value = ''; $('pwErr').textContent = '';
    show('lock'); $('pw').focus();
  }
  async function submitPw() {
    const pw = $('pw').value;
    if (pw.length < 6) { $('pwErr').textContent = 'الباسورد لازم 6 حروف على الأقل.'; return; }
    $('pwGo').disabled = true; $('pwErr').textContent = 'جاري التحقق...';
    try {
      const { status: checkStatus, data: check } = await api('/api/room-password/check', { pw, code: pendingCode });
      if (checkStatus !== 200) {
        if (check.e === 'deleted') { forgetRoom(pendingCode); $('pwErr').textContent = 'المحادثة محذوفة نهائياً.'; }
        else if (check.e === 'account_password') $('pwErr').textContent = 'الباسورد لازم يختلف عن باسورد الحساب.';
        else if (check.e === 'duplicate_password') $('pwErr').textContent = 'كلمة المرور مستخدمة في غرفة أخرى؛ اختر كلمة مختلفة.';
        else if (check.e === 'room_password') $('pwErr').textContent = 'كلمة مرور المحادثة غير صحيحة.';
        else $('pwErr').textContent = checkStatus === 401 ? 'الجلسة خلصت، سجل دخولك تاني.' : 'حصل خطأ، جرب تاني.';
        return;
      }
      saveRoom(pendingCode);
      recentRoom = { code: pendingCode, pw, until: 0 };
      await enterRoom(pendingCode, pw); $('pw').value = '';
    } catch { $('pwErr').textContent = 'حصل خطأ، جرب تاني.'; }
    finally { $('pwGo').disabled = false; }
  }

  async function sendObj(o, node, who, activity = '') {
    if (!ws || ws.readyState !== 1 || peers !== 2) return;
    if (activity) await sendPresence(activity);
    try {
      const mid = hex(crypto.getRandomValues(new Uint8Array(16)));
      const packet = JSON.stringify({ ...await seal(o), p: 1, mid });
      if (packet.length > 6 * 1024 * 1024) { sysNote('الملف كبير قوي. الحد الأقصى 2.5 ميجابايت.'); return; }
      if (!ws || ws.readyState !== 1) return;
      ws.send(packet); addMsg(who, node, Date.now(), mid, 'sent');
    } finally { if (activity) await sendPresence(''); }
  }
  async function sendText() {
    const v = $('msg').value.trim();
    if (!v) return;
    $('msg').value = ''; stopPresence();
    await sendObj({ k: 'text', v }, textNode(v), 'me');
  }
  async function sendImage(file) {
    if (!file || !file.type.startsWith('image/')) return;
    try {
      const data = await shrink(file, 1600, 0.85);
      if (data.length > 4e6) return sysNote('الصورة كبيرة قوي.');
      await sendObj({ k: 'img', v: data }, imgNode(data), 'me', 'sending');
    } catch { sysNote('معرفتش أقرأ الصورة دي.'); }
  }
  async function sendFile(file) {
    if (!file) return;
    if (file.type.startsWith('image/')) return sendImage(file);
    if (file.size > 2.5 * 1024 * 1024) return sysNote('الملف كبير قوي. الحد الأقصى 2.5 ميجابايت.');
    try {
      const data = b64(await file.arrayBuffer()), name = file.name.slice(0, 180), type = file.type || 'application/octet-stream';
      await sendObj({ k: 'file', n: name, t: type, d: data }, fileNode(name, type, data), 'me', 'sending');
    } catch { sysNote('حصل خطأ، جرب تاني.'); }
  }
  async function toggleRecording() {
    if (recorder && recorder.state === 'recording') { recorder.stop(); return; }
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return sysNote('التسجيل الصوتي غير مدعوم على هذا الجهاز.');
    try {
      recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ['audio/webm;codecs=opus','audio/ogg;codecs=opus','audio/webm'].find((x) => MediaRecorder.isTypeSupported(x)) || '';
      recorder = new MediaRecorder(recordingStream, mime ? { mimeType: mime } : undefined); recordingParts = [];
      recorder.ondataavailable = (e) => { if (e.data?.size) recordingParts.push(e.data); };
      recorder.onstop = async () => {
        const type = recorder?.mimeType || mime || 'audio/webm';
        recordingStream?.getTracks().forEach((t) => t.stop()); recordingStream = null;
        $('recordBtn').textContent = '🎙️'; $('recordBtn').classList.remove('recording'); await sendPresence('');
        const blob = new Blob(recordingParts, { type }); recordingParts = [];
        if (!blob.size) return;
        if (blob.size > 2.5 * 1024 * 1024) return sysNote('التسجيل طويل قوي. أقصى حجم للتسجيل 2.5 ميجابايت.');
        const data = b64(await blob.arrayBuffer());
        await sendObj({ k: 'audio', t: type, d: data }, audioNode(data, type), 'me', 'sending');
      };
      recorder.start(500); $('recordBtn').textContent = '⏹️'; $('recordBtn').classList.add('recording'); await sendPresence('recording');
    } catch { recordingStream?.getTracks().forEach((t) => t.stop()); recordingStream = null; sysNote('معرفتش أفتح المايك. اتأكد إنك سمحت بالإذن.'); }
  }
  // ---------- المكالمات (WebRTC مباشر بين الجهازين) ----------
  const ICE = [{ urls: 'stun:stun.cloudflare.com:3478' }];
  async function sendSig(o, id) {
    const w = ws; if (!w || w.readyState !== 1) return;
    try { w.send(JSON.stringify(await seal({ k: 'call', id: id || callId, ts: Date.now(), ...o }))); } catch {}
  }
  const getMedia = (video) => navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true },
    video: video ? { width: { ideal: 1280 }, height: { ideal: 720 } } : false });
  function gathered() {
    return new Promise((res) => {
      if (pc.iceGatheringState === 'complete') return res();
      const f = () => { if (pc.iceGatheringState === 'complete') { pc.removeEventListener('icegatheringstatechange', f); res(); } };
      pc.addEventListener('icegatheringstatechange', f);
      setTimeout(res, 4000);
    });
  }
  function updateCallMediaMode() {
    const remoteVideo = !!$('remoteVid').srcObject?.getVideoTracks().some((t) => t.readyState === 'live' && !t.muted);
    const localVideo = !!stream?.getVideoTracks().some((t) => t.readyState === 'live' && t.enabled);
    $('call').classList.toggle('audio', !remoteVideo);
    $('call').classList.toggle('camera-off', !localVideo);
    $('camIcon').textContent = localVideo ? '📷' : '🚫';
    $('camLabel').textContent = localVideo ? 'إيقاف الكاميرا' : 'تشغيل الكاميرا';
    $('camBtn').classList.toggle('isOff', !localVideo);
  }
  function updateElapsed() {
    if (!callStartedAt) return;
    const seconds = Math.floor((Date.now() - callStartedAt) / 1000), mm = String(Math.floor(seconds / 60)).padStart(2, '0'), ss = String(seconds % 60).padStart(2, '0');
    $('callElapsed').textContent = mm + ':' + ss;
  }
  function startCallClock() {
    if (!callStartedAt) callStartedAt = Date.now();
    clearInterval(callClockTimer); updateElapsed(); callClockTimer = setInterval(updateElapsed, 1000);
  }
  function setSignal(level) {
    $('signalMeter').dataset.level = String(level);
    $('signalLabel').textContent = ['جاري القياس','ضعيف','متوسط','جيد','ممتاز'][level] || 'جاري القياس';
  }
  async function updateSignal(me) {
    if (pc !== me) return;
    try {
      const stats = await me.getStats(); let received = 0, lost = 0, rtt = 0;
      stats.forEach((report) => {
        if (report.type === 'inbound-rtp' && !report.isRemote) { received += report.packetsReceived || 0; lost += Math.max(0, report.packetsLost || 0); }
        if (report.type === 'candidate-pair' && (report.selected || (report.nominated && report.state === 'succeeded'))) rtt = report.currentRoundTripTime || rtt;
      });
      const deltaReceived = Math.max(0, received - previousStats.received), deltaLost = Math.max(0, lost - previousStats.lost);
      previousStats = { received, lost };
      const loss = deltaReceived + deltaLost ? deltaLost / (deltaReceived + deltaLost) : 0;
      const level = me.connectionState === 'connected' ? (rtt > .65 || loss > .12 ? 1 : rtt > .38 || loss > .06 ? 2 : rtt > .22 || loss > .025 ? 3 : 4) : me.connectionState === 'disconnected' ? 1 : 0;
      setSignal(level);
    } catch { setSignal(me.connectionState === 'connected' ? 3 : 1); }
  }
  function newPc() {
    const me = pc = new RTCPeerConnection({ iceServers: ICE });
    stream.getTracks().forEach((t) => me.addTrack(t, stream));
    me.ontrack = (e) => {
      if (e.streams[0]) $('remoteVid').srcObject = e.streams[0];
      if (e.track.kind === 'video') { remoteCameraOn = true; e.track.onmute = () => { remoteCameraOn = false; updateCallMediaMode(); }; e.track.onunmute = () => { remoteCameraOn = true; updateCallMediaMode(); }; }
      $('remoteVid').play().catch(() => {}); updateCallMediaMode();
    };
    me.onconnectionstatechange = () => {
      if (pc !== me) return;
      if (me.connectionState === 'connected') { callState = 'active'; $('callStatus').textContent = 'متصل'; startCallClock(); updateSignal(me); }
      else if (me.connectionState === 'failed') endCall('المكالمة معرفتش تتوصل. ممكن الشبكة مش بتسمح بالاتصال المباشر.', true);
      else if (me.connectionState === 'disconnected') { $('callStatus').textContent = 'الاتصال ضعيف...'; setSignal(1); }
    };
    previousStats = { received: 0, lost: 0 }; clearInterval(callStatsTimer); callStatsTimer = setInterval(() => updateSignal(me), 2000); updateSignal(me);
  }
  function showCall(video, status) {
    $('call').classList.add('audio');
    $('localVid').srcObject = stream;
    $('callPeerLabel').textContent = $('callName').textContent = peerName || 'الطرف التاني';
    $('callAvatar').style.backgroundImage = $('peerAv').style.backgroundImage;
    $('callAvatar').textContent = $('peerAv').textContent || '👤';
    $('callStatus').textContent = status; $('callElapsed').textContent = 'جاري الاتصال';
    $('muteIcon').textContent = '🎙️'; $('muteLabel').textContent = 'كتم الميكروفون'; $('muteBtn').classList.remove('isOff');
    $('call').classList.remove('hidden'); setSignal(0); updateCallMediaMode(); startCallClock(); setStatus();
  }  async function startCall(video) {
    if (callState !== 'idle' || peers !== 2) return;
    callState = 'calling'; callId = hex(crypto.getRandomValues(new Uint8Array(8))); setStatus();
    try { stream = await getMedia(video); }
    catch { callState = 'idle'; callId = ''; setStatus(); return sysNote('معرفتش أفتح المايك أو الكاميرا. اتأكد إنك سمحت بالإذن.'); }
    showCall(video, 'بيرن...');
    try {
      newPc();
      await pc.setLocalDescription(await pc.createOffer());
      await gathered();
      if (callState !== 'calling') return;
      await sendSig({ a: 'offer', video, sdp: pc.localDescription.sdp });
      callTimer = setTimeout(() => endCall('محدش رد.', true), 45000);
    } catch { endCall('معرفتش أبدأ المكالمة.', true); }
  }
  async function acceptCall() {
    const p = pendingOffer; pendingOffer = null; $('incoming').classList.add('hidden');
    if (!p || callState !== 'ringing') return;
    try { stream = await getMedia(p.video); }
    catch { await sendSig({ a: 'end' }); callState = 'idle'; callId = ''; setStatus(); return sysNote('معرفتش أفتح المايك أو الكاميرا. اتأكد إنك سمحت بالإذن.'); }
    showCall(p.video, 'بيتصل...');
    try {
      newPc();
      await pc.setRemoteDescription({ type: 'offer', sdp: p.sdp });
      await pc.setLocalDescription(await pc.createAnswer());
      await gathered();
      await sendSig({ a: 'answer', sdp: pc.localDescription.sdp });
    } catch { endCall('معرفتش أرد على المكالمة.', true); }
  }
  async function onCall(p) {
    if (typeof p.id !== 'string' || p.id.length > 32 || typeof p.ts !== 'number') return;
    if (p.a === 'offer') {
      if (Math.abs(Date.now() - p.ts) > 60000 || typeof p.sdp !== 'string' || p.sdp.length > 60000) return;
      if (callState !== 'idle') return sendSig({ a: 'end', why: 'busy' }, p.id);
      callState = 'ringing'; callId = p.id; pendingOffer = { video: !!p.video, sdp: p.sdp }; setStatus();
      $('incomingText').textContent = p.video ? '🎥 مكالمة فيديو جاية' : '📞 مكالمة صوت جاية';
      $('incoming').classList.remove('hidden');
    } else if (p.id !== callId) {
      return;
    } else if (p.a === 'answer' && callState === 'calling' && pc && !pc.currentRemoteDescription && typeof p.sdp === 'string' && p.sdp.length <= 60000) {
      clearTimeout(callTimer);
      try { await pc.setRemoteDescription({ type: 'answer', sdp: p.sdp }); } catch { endCall('معرفتش أوصل المكالمة.', true); }
    } else if (p.a === 'renegotiate' && callState === 'active' && pc && typeof p.sdp === 'string' && p.sdp.length <= 60000) {
      try { await pc.setRemoteDescription({ type: 'offer', sdp: p.sdp }); await pc.setLocalDescription(await pc.createAnswer()); await gathered(); await sendSig({ a: 'renegotiate-answer', sdp: pc.localDescription.sdp }); } catch {}
    } else if (p.a === 'renegotiate-answer' && pc && typeof p.sdp === 'string' && p.sdp.length <= 60000) {
      try { await pc.setRemoteDescription({ type: 'answer', sdp: p.sdp }); } catch {}
    } else if (p.a === 'camera' && typeof p.on === 'boolean') {
      remoteCameraOn = p.on; updateCallMediaMode();
    } else if (p.a === 'end') {
      endCall(p.why === 'busy' ? 'الطرف التاني في مكالمة تانية.' : 'المكالمة انتهت.', false);
    }
  }
  function endCall(msg, notify) {
    if (callState === 'idle') return;
    if (notify) sendSig({ a: 'end' });
    clearTimeout(callTimer); clearInterval(callStatsTimer); clearInterval(callClockTimer);
    callStatsTimer = callClockTimer = 0; callStartedAt = 0; remoteCameraOn = false; renegotiating = false; previousStats = { received: 0, lost: 0 };
    const c = pc; pc = null;
    if (c) c.close();
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null; pendingOffer = null; callState = 'idle'; callId = '';
    $('remoteVid').srcObject = null; $('localVid').srcObject = null;
    $('call').classList.add('hidden','audio','camera-off'); $('incoming').classList.add('hidden');
    $('callElapsed').textContent = 'جاري الاتصال'; $('muteBtn').disabled = $('camBtn').disabled = true;
    $('muteBtn').classList.remove('isOff'); $('camBtn').classList.remove('isOff');
    $('muteIcon').textContent = '🎙️'; $('muteLabel').textContent = 'كتم الميكروفون';
    $('camIcon').textContent = '📷'; $('camLabel').textContent = 'تشغيل الكاميرا'; setSignal(0);
    if (msg) sysNote(msg);
    setStatus();
  }
  function toggleTracks(kind) {
    if (!stream) return;
    const tracks = kind === 'audio' ? stream.getAudioTracks() : stream.getVideoTracks();
    if (!tracks.length) return;
    const enabled = !tracks.every((t) => t.enabled);
    tracks.forEach((t) => { t.enabled = enabled; });
    if (kind === 'audio') {
      $('muteIcon').textContent = enabled ? '🎙️' : '🔇'; $('muteLabel').textContent = enabled ? 'كتم الميكروفون' : 'تشغيل الميكروفون';
      $('muteBtn').classList.toggle('isOff', !enabled);
    } else {
      $('camIcon').textContent = enabled ? '📷' : '🚫'; $('camLabel').textContent = enabled ? 'إيقاف الكاميرا' : 'تشغيل الكاميرا';
      $('camBtn').classList.toggle('isOff', !enabled); sendSig({ a: 'camera', on: enabled }); updateCallMediaMode();
    }
  }
  async function renegotiateVideo() {
    if (!pc || callState !== 'active' || renegotiating) return;
    renegotiating = true;
    try {
      await pc.setLocalDescription(await pc.createOffer()); await gathered();
      await sendSig({ a: 'renegotiate', sdp: pc.localDescription.sdp });
    } catch { $('callStatus').textContent = 'تعذر تشغيل الكاميرا'; }
    finally { renegotiating = false; }
  }
  async function toggleCamera() {
    if (!stream || renegotiating) return;
    const existing = stream.getVideoTracks();
    if (existing.length) return toggleTracks('video');
    if (callState !== 'active') return;
    try {
      const camera = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      const tracks = camera.getVideoTracks();
      tracks.forEach((track) => { stream.addTrack(track); pc.addTrack(track, stream); });
      $('localVid').srcObject = stream; $('call').classList.remove('camera-off');
      $('camIcon').textContent = '📷'; $('camLabel').textContent = 'إيقاف الكاميرا'; $('camBtn').classList.remove('isOff');
      await renegotiateVideo(); sendSig({ a: 'camera', on: true });
    } catch { $('callStatus').textContent = 'معرفتش أفتح الكاميرا'; }
  }  // ---------- أحداث ----------
  const copy = (t, btn) => navigator.clipboard.writeText(t).then(() => { const o = btn.textContent; btn.textContent = 'اتنسخ ✓'; setTimeout(() => btn.textContent = o, 1200); });
  $('create').onclick = () => {
    closeAll();
    newCode = genCode(); creatorCode = newCode;

    $('homeErr').textContent = '';
    askPw(newCode);
  };
  $('joinOpen').onclick = () => { closeAll(); $('joinErr').textContent = ''; $('codeIn').value = ''; $('joinSheet').classList.remove('hidden'); $('codeIn').focus(); };
  $('join').onclick = () => {
    const c = norm($('codeIn').value);
    if (!valid(c)) { $('joinErr').textContent = 'الكود مش صح. لازم 24 حرف ورقم.'; return; }
    $('joinErr').textContent = '';
    askPw(c);
  };
  $('codeIn').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('join').click(); });
  $('pwGo').onclick = submitPw;
  $('homeChat').onclick = backToChats;
  $('deleteRoom').onclick = deleteCurrentRoom;
  $('pw').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitPw(); });
  $('pwBack').onclick = () => show('home');
  $('sendBtn').onclick = sendText;
  $('msg').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendText(); });
  $('attach').onclick = () => $('file').click();
  $('file').onchange = (e) => { sendFile(e.target.files[0]); e.target.value = ''; };
  $('recordBtn').onclick = toggleRecording;
  $('msg').addEventListener('input', () => {
    if (!$('msg').value.trim()) return stopPresence();
    if (Date.now() - lastTypingSent > 1200) { lastTypingSent = Date.now(); sendPresence('typing'); }
    clearTimeout(typingTimer); typingTimer = setTimeout(stopPresence, 2400);
  });
  $('msg').addEventListener('blur', stopPresence);  $('emojiBtn').onclick = () => { const h = $('emoji').classList.toggle('hidden'); if (!h) emojiTab(Object.keys(EMO)[0]); };
  $('menuBtn').onclick = () => $('menu').classList.toggle('hidden');
  $('mCode').onclick = () => { closeAll(); $('curCode').textContent = fmt(curCode); $('codeSheet').classList.remove('hidden'); };
  $('copyCode2').onclick = (e) => copy(fmt(curCode), e.target);
  $('copyLink2').onclick = (e) => copy(location.origin + '/#' + curCode, e.target);
  $('mSet').onclick = openSettings;
  function updateKnockSettings() {
    if (!$('knockTone')) return;
    $('knockTone').value = KNOWN_TONES.includes(store.get('knockTone')) ? store.get('knockTone') : 'wood';
    $('knockFileName').textContent = store.get('knockName') || 'لم تتم إضافة نغمة';
    $('notifStatus').textContent = !('Notification' in window) ? 'المتصفح لا يدعم الإشعارات' : Notification.permission === 'granted' ? (lang === 'ar' ? 'التنبيه يظهر أثناء تشغيل الموقع، ويُعرض عند فتحه إذا كان مغلقاً.' : 'Knocks appear while the site is running, or when you reopen it.') : 'اسمح بإشعارات المتصفح لاستقبال الطرق';
    $('notifEnable').textContent = !('Notification' in window) ? 'المتصفح لا يدعم الإشعارات' : Notification.permission === 'granted' ? 'إشعارات الطرق مفعلة' : 'تفعيل إشعارات الطرق';
  }
  $('notifEnable').onclick = async () => {
    if (!('Notification' in window)) return updateKnockSettings();
    try { await Notification.requestPermission(); } catch {}
    updateKnockSettings();
  };
  $('knockTone').onchange = async () => { store.set('knockTone', $('knockTone').value); await clearCustomKnock(); };
  $('knockPreview').onclick = async () => { customKnockBlob = customKnockBlob || await loadCustomKnock(); await playKnockSound(); };
  $('knockFileBtn').onclick = () => $('knockFile').click();
  $('knockFile').onchange = async (event) => {
    const file = event.target.files[0]; event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('audio/') || file.size > 8 * 1024 * 1024) { $('notifStatus').textContent = 'اختار ملف صوت أقل من 8 ميجابايت'; return; }
    try { await saveCustomKnock(file); customKnockBlob = file; store.set('knockName', file.name.slice(0, 80)); updateKnockSettings(); }
    catch { $('notifStatus').textContent = 'تعذر حفظ ملف الصوت'; }
  };
  $('knockFileClear').onclick = clearCustomKnock;
  $('refreshSessions').onclick = loadSessionLog;
  $('settingsLogout').onclick = signOut;
  $('setHome').onclick = openSettings;
  $('avBtn').onclick = () => $('avFile').click();
  $('avFile').onchange = async (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    try { tmpAv = await shrink(f, 128, 0.8, true); setAv($('myAv'), blobUrl(tmpAv), $('nameIn').value); } catch {}
  };
  $('avDel').onclick = () => { tmpAv = ''; setAv($('myAv'), '', $('nameIn').value); };
  $('bgBtn').onclick = () => $('bgFile').click();
  $('bgFile').onchange = async (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    try { tmpBg = 'i:' + await shrink(f, 1080, 0.7); document.querySelectorAll('#swatches button').forEach((x) => x.classList.remove('on')); } catch {}
  };
  $('changeAccountPw').onclick = async () => {
    const current = $('accountPwCurrent').value, next = $('accountPwNext').value;
    $('accountPwStatus').textContent = '';
    if (!current || next.length < 8) { $('accountPwStatus').textContent = 'الباسورد لازم 8 حروف على الأقل.'; return; }
    $('changeAccountPw').disabled = true;
    const { status, data } = await api('/api/change-password', { current, next });
    $('changeAccountPw').disabled = false;
    if (status === 200) { $('accountPwCurrent').value = $('accountPwNext').value = ''; $('accountPwStatus').textContent = 'تم تغيير الباسورد.'; }
    else if (status === 401) $('accountPwStatus').textContent = 'الباسورد الحالي غلط.';
    else if (status === 409) $('accountPwStatus').textContent = 'الباسورد لازم يختلف عن باسورد الحساب.';
    else $('accountPwStatus').textContent = 'تعذر تغيير الباسورد. حاول مرة أخرى.';
  };  $('saveSet').onclick = saveSettings;
  $('leave').onclick = () => leave();
  $('wakeBtn').onclick = () => {
    if (!ws || ws.readyState !== 1 || peers !== 2) return;
    ws.send(JSON.stringify({ t: 'knock' })); $('wakeBtn').classList.remove('knocking'); void $('wakeBtn').offsetWidth; $('wakeBtn').classList.add('knocking');
    if (navigator.vibrate) navigator.vibrate(35); setTimeout(() => $('wakeBtn').classList.remove('knocking'), 1100);
  };
  $('callA').onclick = () => startCall(false);
  $('callV').onclick = () => startCall(true);
  $('acceptBtn').onclick = acceptCall;
  $('declineBtn').onclick = () => { sendSig({ a: 'end' }); endCall(null, false); };
  $('hangBtn').onclick = () => endCall('المكالمة انتهت.', true);
  $('muteBtn').onclick = () => toggleTracks('audio');
  $('camBtn').onclick = toggleCamera;

  // ---------- الحساب: جوجل ثم الباسورد ----------
  let loggedIn = false, syncingRooms = false; // true لما الجلسة كاملة وصالحة على الجهاز ده
  let pendingRoom = ''; // كود غرفة جاي من رابط دعوة، بنحتفظ بيه لحد ما المستخدم يخلص دخول
  const MSG = {
    denied: 'لازم توافق على تسجيل الدخول بجوجل عشان تكمل.',
    failed: 'تسجيل الدخول فشل، جرب تاني.',
    unverified: 'إيميل جوجل ده مش متأكد منه. استخدم حساب تاني.',
    config: 'تسجيل الدخول بجوجل لسه مش متظبط على السيرفر.',
    blocked: 'الجهاز ده محظور من الحساب ده.',
  };
  async function api(path, body) {
    try {
      const r = await fetch(path, { method: body ? 'POST' : 'GET', cache: 'no-store', credentials: 'same-origin',
        headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
      return { status: r.status, data: await r.json().catch(() => ({})) };
    } catch { return { status: 0, data: {} }; }
  }
  async function syncRooms() {
    if (!loggedIn || syncingRooms) return;
    const codes = roomEntries();
    if (!codes.length) return;
    syncingRooms = true;
    try {
      const { status, data } = await api('/api/room/status', { codes });
      if (status === 200 && Array.isArray(data.deleted) && data.deleted.length) {
        const removed = new Set(data.deleted);
        store.set('rooms', JSON.stringify(roomEntries().filter((code) => !removed.has(code))));
        renderRooms();
      }
    } finally { syncingRooms = false; }
  }
  function enterApp() {
    $('homeErr').textContent = '';
    let c = pendingRoom;
    if (!c) { try { c = sessionStorage.getItem('lr.pc') || ''; } catch {} }
    pendingRoom = '';
    try { sessionStorage.removeItem('lr.pc'); } catch {}
    renderRooms();
    syncRooms();
    if (c && valid(c)) askPw(c); else show('home');
  }
  function route(me, err) {
    for (const id of ['wPw', 'wPw2', 'uPw', 'rPw', 'rPw2']) $(id).value = '';
    for (const id of ['wErr', 'uErr', 'kErr', 'rErr']) $(id).textContent = '';
    loggedIn = me.s === 'ok';
    if (me.s === 'ok') return enterApp();
    if (me.s === 'blocked') return show('blocked');
    if (me.s === 'waiting') return show('waiting');
    if (me.s === 'request-expired') {
      $('loginErr').textContent = 'لم يصل طلب تسجيل الدخول أو انتهت صلاحيته. سجّل دخول Google مرة أخرى.';
      return show('login');
    }
    if (me.s === 'kicked' || me.s === 'reset') {
      const by = me.by || {};
      const when = by.t ? new Date(by.t).toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' }) : '';
      if (me.s === 'kicked') {
        $('kDev').textContent = by.n || 'جهاز غير معروف'; $('kTime').textContent = when;
        $('kLoc').textContent = by.l || ''; $('kLocRow').classList.toggle('hidden', !by.l);
        show('kicked'); $('kMe').focus();
      } else {
        $('rDev').textContent = by.n || 'جهاز غير معروف'; $('rTime').textContent = when;
        show('reset'); $('rPw').focus();
      }
      return;
    }
    if (me.s === 'new' || me.s === 'unlock') {
      const first = (me.name || '').split(' ')[0];
      if (me.s === 'new') {
        $('wName').textContent = first ? 'أهلاً بيك يا ' + first : 'أهلاً بيك';
        $('wMail').textContent = me.email || '';
        show('welcome'); $('wPw').focus();
      } else {
        $('uName').textContent = first ? 'أهلاً بيك تاني يا ' + first : 'أهلاً بيك تاني';
        $('uMail').textContent = me.email || '';
        show('unlock'); $('uPw').focus();
      }
      return;
    }
    $('loginErr').textContent = err || '';
    show('login');
  }
  async function boot(err) {
    const { data } = await api('/api/me');
    if (data && Array.isArray(data.notices)) data.notices.forEach((x) => showKnockNotification(x.id));
    route(data && data.s ? data : { s: 'anon' }, err);
  }
  async function submitWelcome() {
    const a = $('wPw').value, b = $('wPw2').value;
    if (a.length < 8) { $('wErr').textContent = 'الباسورد لازم 8 حروف على الأقل.'; return; }
    if (a !== b) { $('wErr').textContent = 'الباسورد مش متطابق في الخانتين.'; return; }
    $('wGo').disabled = true; $('wErr').textContent = 'جاري الإنشاء...';
    const { status, data } = await api('/api/setup', { pw: a });
    $('wGo').disabled = false;
    if (status === 200) { $('wPw').value = $('wPw2').value = ''; return boot(); }
    if (status === 409 && data.e === 'duplicate_room') { $('wErr').textContent = 'الباسورد لازم يختلف عن باسورد الحساب.'; return; }
    if (status === 409 || status === 403) return boot(); // الحساب اتعمل قبل كده، أو الجهاز محظور
    if (status === 401) return boot('الجلسة خلصت، سجل دخولك تاني.');
    $('wErr').textContent = status === 400 ? 'الباسورد لازم يكون من 8 لـ 200 حرف.' : 'حصل خطأ، جرب تاني.';
  }
  async function submitUnlock() {
    const pw = $('uPw').value;
    if (!pw) { $('uErr').textContent = 'اكتب الباسورد.'; return; }
    $('uGo').disabled = true; $('uErr').textContent = 'جاري التحقق...';
    const { status, data } = await api('/api/login', { pw });
    $('uGo').disabled = false;
    if (status === 200) { $('uPw').value = ''; return boot(); }
    if (status === 401 && data.e === 'session') return boot('الجلسة خلصت، سجل دخولك تاني.');
    if (status === 403) return boot();
    $('uPw').value = '';
    if (status === 429) $('uErr').textContent = 'محاولات كتير غلط. استنى ' + Math.ceil((data.wait || 900) / 60) + ' دقيقة وجرب تاني.';
    else if (status === 401) $('uErr').textContent = 'الباسورد غلط' + (data.left ? ` (باقي ${data.left} محاولات).` : '.');
    else $('uErr').textContent = 'حصل خطأ، جرب تاني.';
  }
  async function signOut() {
    await api('/auth/logout', {});
    leave(); // بيقفل أي غرفة ويمسح الشاشة
    boot();
  }
  $('gBtn').addEventListener('click', (event) => {
    if ($('gBtn').getAttribute('aria-busy') === 'true') { event.preventDefault(); return; }
    $('gBtn').classList.add('loading');
    $('gBtn').setAttribute('aria-busy', 'true');
    $('gSpinner').classList.remove('hidden');
    $('gLabel').textContent = lang === 'ar' ? 'جاري تسجيل الدخول بجوجل...' : 'Opening Google sign-in…';
  }, { capture: true });
  $('gBtn').addEventListener('click', () => { // الرابط بيخرج من الصفحة، فبنحفظ كود الدعوة مؤقتاً في التبويب ده بس
    if (pendingRoom) { try { sessionStorage.setItem('lr.pc', pendingRoom); } catch {} }
  });
  async function chooseDevice(path, btn) { // كان أنا / مش أنا
    $('kMe').disabled = $('kNot').disabled = true; $('kErr').textContent = '';
    const { status } = await api(path, {});
    $('kMe').disabled = $('kNot').disabled = false;
    if (status === 200) return boot();
    if (status === 401) return boot('الجلسة خلصت، سجل دخولك تاني.');
    if (status === 403) return boot();
    $('kErr').textContent = 'حصل خطأ، جرب تاني.';
  }
  async function submitReset() {
    const a = $('rPw').value, b = $('rPw2').value;
    if (a.length < 8) { $('rErr').textContent = 'الباسورد لازم 8 حروف على الأقل.'; return; }
    if (a !== b) { $('rErr').textContent = 'الباسورد مش متطابق في الخانتين.'; return; }
    $('rGo').disabled = true; $('rErr').textContent = 'جاري التغيير...';
    const { status } = await api('/api/reset', { pw: a });
    $('rGo').disabled = false;
    if (status === 200) { $('rPw').value = $('rPw2').value = ''; return boot(); }
    if (status === 401) return boot('الجلسة خلصت، سجل دخولك تاني.');
    if (status === 409 || status === 403) return boot(); // الحالة اتغيرت
    $('rErr').textContent = status === 400 ? 'الباسورد لازم يكون من 8 لـ 200 حرف.' : 'حصل خطأ، جرب تاني.';
  }
  let activeLoginRequest = null;
  function hideLoginPrompt() {
    activeLoginRequest = null;
    $('loginRequest').classList.add('hidden');
  }
  function showLoginPrompt(request) {
    activeLoginRequest = request;
    $('requestDevice').textContent = request.n || 'جهاز غير معروف';
    $('requestTime').textContent = request.t ? new Date(request.t).toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '';
    $('requestLocation').textContent = request.l || '';
    $('requestLocationRow').classList.toggle('hidden', !request.l);
    $('requestError').textContent = '';
    $('loginRequest').classList.remove('hidden');
  }
  async function decideLoginRequest(allow) {
    if (!activeLoginRequest) return;
    $('requestAllow').disabled = $('requestDeny').disabled = true;
    $('requestError').textContent = 'جارٍ إرسال الرد...';
    const { status } = await api('/api/login-request/respond', { did: activeLoginRequest.did, allow });
    $('requestAllow').disabled = $('requestDeny').disabled = false;
    if (status !== 200) { $('requestError').textContent = 'تعذر تسجيل القرار. حاول مرة أخرى.'; return; }
    hideLoginPrompt();
    const note = allow ? 'تمت الموافقة. سيُطلب من الجهاز كلمة مرور الحساب.' : 'تم رفض تسجيل الدخول وحظر هذا الجهاز.';
    if (!$('chat').classList.contains('hidden')) sysNote(note);
    else $('homeErr').textContent = note;
    watch();
  }

  // فحص الموافقات كل ثانيتين، مع فحص فوري عند عودة التطبيق للمقدمة.
  let watching = false;
  async function watch() {
    const waiting = !$('waiting').classList.contains('hidden');
    if ((!loggedIn && !waiting) || watching) return;
    watching = true;
    try {
      const { status, data } = await api('/api/me');
      if (status !== 200 || !data || !data.s) return;
      if (Array.isArray(data.notices)) data.notices.forEach((x) => showKnockNotification(x.id));
      if (loggedIn) {
        if (data.s !== 'ok') { hideLoginPrompt(); leave(); route(data); return; }
        if (data.requests && data.requests.length) showLoginPrompt(data.requests[0]);
        else hideLoginPrompt();
      } else if (waiting && data.s !== 'waiting') route(data);
    } finally { watching = false; }
  }
  setInterval(watch, 2000);
  setInterval(() => { if (loggedIn && $('home').classList.contains('hidden') === false) syncRooms(); }, 5000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) watch(); });
  window.addEventListener('focus', watch);
  let roomLockTimer = 0, roomHiddenAt = 0;
  function lockRoomAfterAway() {
    const code = curCode;
    roomHiddenAt = 0;
    if (code) { leave(); askPw(code); }
  }
  document.addEventListener('visibilitychange', () => {
    clearTimeout(roomLockTimer);
    if (document.hidden) {
      if (!$('chat').classList.contains('hidden') && curCode) {
        roomHiddenAt = Date.now();
        roomLockTimer = setTimeout(() => {
          if (document.hidden && roomHiddenAt && Date.now() - roomHiddenAt >= 5000 && !$('chat').classList.contains('hidden')) lockRoomAfterAway();
        }, 5000);
      }
      return;
    }
    if (roomHiddenAt && Date.now() - roomHiddenAt >= 5000 && !$('chat').classList.contains('hidden')) lockRoomAfterAway();
    else roomHiddenAt = 0;
  });
  $('requestAllow').onclick = () => decideLoginRequest(true);
  $('requestDeny').onclick = () => decideLoginRequest(false);
  $('waitRefresh').onclick = () => boot();
  $('kMe').onclick = () => chooseDevice('/api/ack');
  $('kNot').onclick = () => chooseDevice('/api/notme');
  $('rGo').onclick = submitReset;
  $('rPw2').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitReset(); });
  $('bOut').onclick = signOut;
  $('wGo').onclick = submitWelcome;
  $('wPw2').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitWelcome(); });
  $('uGo').onclick = submitUnlock;
  $('uPw').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitUnlock(); });
  $('wOut').onclick = $('uOut').onclick = $('logout').onclick = signOut;

  applyLanguage(); applyBg(); applyMine(); shieldCheck();
  // رابط فيه كود الغرفة: بنمسحه من شريط العنوان فوراً ونحتفظ بيه لحد ما يخلص تسجيل الدخول
  const h = norm(location.hash.slice(1));
  if (h) { history.replaceState(null, '', location.pathname); if (valid(h)) pendingRoom = h; }
  // رسالة خطأ راجعة من جوجل (?e=...)
  const qe = new URLSearchParams(location.search).get('e');
  if (qe) history.replaceState(null, '', location.pathname);
  boot(MSG[qe] || '');
})();
