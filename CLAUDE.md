# قاعدة إلزامية: زوّد رقم الإصدار مع أي تعديل

الرقم اللي بيظهر في **الإعدادات** (`V : x.y.z`) مصدره الوحيد حقل `"version"` في `package.json`
(الـ build بيحطه مكان `{{APP_VERSION}}` في `web/index.html`).

**أي تعديل** في `src/`, `web/`, `build.mjs`, `wrangler.toml` لازم يتبعه زيادة الرقم:
- إصلاح خطأ → `1.0.1 → 1.0.2`
- ميزة جديدة → `1.0.2 → 1.1.0`
- تغيير كبير → `1.1.0 → 2.0.0`

مفيش حاجة تانية تتعدل يدوياً لتغيير الرقم؛ ما تكتبوش جوه `index.html`، وما تعدّلش `public/` مباشرة (بيتولد بـ `npm run build`).

التحقق أوتوماتيك (`check-version.mjs` + `version.lock.json`):
- `npm run build` بيطبع تحذير لو في تعديلات والرقم ما اتزودش.
- `npm run deploy` بيفشل لو الرقم ما اتزودش، وبعد النشر بيسجل الإصدار في `version.lock.json`.

When changing anything in this project, bump `"version"` in `package.json` before finishing, and tell the user the new number.


---

# قاعدة إلزامية: إصدار تطبيق الأندرويد (الإصدار الخارجي)

في **الإعدادات** فيه سطرين: "الإصدار الداخلي" (إصدار الموقع من `package.json`) و"إصدار التطبيق" (إصدار الأندرويد، بيظهر جوه التطبيق بس).

أي تحديث لتطبيق الأندرويد (أي تعديل جوه `app/`) لازم يزوّد في `app/build.gradle.kts`:
- `versionName`: إصلاح `1.5.1 → 1.5.2`، ميزة `1.5.2 → 1.6.0`، تغيير كبير `→ 2.0.0`.
- `versionCode`: +1.

الرقم بيوصل للإعدادات أوتوماتيك (التطبيق بيبعته في الـ User-Agent كـ `LockedRoomApp/<versionName>`)، فمفيش تعديل يدوي في الويب. تعديل الويب لوحده يزوّد "الإصدار الداخلي" بس. بلّغ المستخدم بالرقمين.

When changing the Android app (anything under `app/`), bump `versionName` and `versionCode` in `app/build.gradle.kts` and tell the user the new numbers.
