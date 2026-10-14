# تفعيل تسجيل الدخول بجوجل

1. في Google Cloud Console → APIs & Services → Credentials → Create OAuth client ID (Web application).
2. في Authorized redirect URIs ضيف:
   - `https://<الدومين-بتاعك>/auth/callback`
   - `http://localhost:8787/auth/callback` (للتجربة المحلية)
3. حط الـ Client ID في `wrangler.toml` مكان `PUT_YOUR_CLIENT_ID_HERE...`
4. الأسرار:
   ```
   npx wrangler secret put GOOGLE_CLIENT_SECRET
   npx wrangler secret put SESSION_SECRET     # أي نص عشوائي 32 حرف أو أكتر
   ```
   وللتجربة المحلية انسخ `.dev.vars.example` إلى `.dev.vars`.
5. `npm install && npm run deploy`
