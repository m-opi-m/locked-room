// FCM HTTP v1 لتطبيق Android الأصلي. المفتاح بييجي من Cloudflare Secret باسم FCM_SERVICE_ACCOUNT_JSON فقط.
// وحدة نقية (من غير cloudflare:*) عشان تتختبر لوحدها.
const enc = new TextEncoder();
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

export const fcmConfigured = (env) => typeof env.FCM_SERVICE_ACCOUNT_JSON === 'string' && env.FCM_SERVICE_ACCOUNT_JSON.length > 0;
export const validFcmToken = (t) => typeof t === 'string' && t.length >= 20 && t.length <= 4096 && /^[A-Za-z0-9_\-:.]+$/.test(t);

let parsed = null, cachedToken = null;

function account(env) {
  const raw = env.FCM_SERVICE_ACCOUNT_JSON;
  if (parsed && parsed.raw === raw) return parsed.sa;
  const sa = JSON.parse(raw);
  if (!sa || typeof sa.client_email !== 'string' || typeof sa.private_key !== 'string' || typeof sa.project_id !== 'string') throw new Error('fcm_bad_service_account');
  parsed = { raw, sa };
  return sa;
}

async function accessToken(env, fetchFn, now) {
  const sa = account(env);
  if (cachedToken && cachedToken.email === sa.client_email && cachedToken.exp - 120000 > now) return cachedToken.token;
  const der = Uint8Array.from(atob(sa.private_key.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '')), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const iat = Math.floor(now / 1000), aud = sa.token_uri || 'https://oauth2.googleapis.com/token';
  const part = (o) => b64u(enc.encode(JSON.stringify(o)));
  const unsigned = part({ alg: 'RS256', typ: 'JWT' }) + '.' + part({ iss: sa.client_email, scope: SCOPE, aud, iat, exp: iat + 3600 });
  const jwt = unsigned + '.' + b64u(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(unsigned)));
  const r = await fetchFn(aud, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + jwt });
  if (!r.ok) throw new Error('fcm_oauth_' + r.status);
  const j = await r.json();
  if (!j || typeof j.access_token !== 'string') throw new Error('fcm_oauth_bad');
  cachedToken = { email: sa.client_email, token: j.access_token, exp: now + (Number(j.expires_in) || 3600) * 1000 };
  return cachedToken.token;
}

// data-only عشان onMessageReceived في التطبيق يشتغل وهو في الخلفية. القيم لازم تبقى نصوص.
export function fcmData(payload) {
  const d = {};
  for (const k of ['title', 'body', 'kind', 'lang', 'url', 'at', 'rid']) if (payload && payload[k] != null) d[k] = String(payload[k]);
  return d;
}

// بيرجّع { ok, status, gone } — gone=true يعني التوكن مات والمفروض يتمسح.
export async function sendFcm(env, token, payload, fetchFn = fetch, now = Date.now()) {
  const sa = account(env);
  const body = JSON.stringify({ message: { token, data: fcmData(payload), android: { priority: 'HIGH', ttl: payload && payload.kind === 'update' ? '86400s' : '604800s' } } });
  for (let attempt = 0; attempt < 2; attempt++) {
    const at = await accessToken(env, fetchFn, now);
    const r = await fetchFn('https://fcm.googleapis.com/v1/projects/' + encodeURIComponent(sa.project_id) + '/messages:send', { method: 'POST', headers: { Authorization: 'Bearer ' + at, 'Content-Type': 'application/json' }, body });
    if (r.status === 401 && attempt === 0) { cachedToken = null; continue; }
    if (r.ok) return { ok: true, status: r.status, gone: false };
    const txt = await r.text().catch(() => '');
    const gone = r.status === 404 || /UNREGISTERED/.test(txt);
    return { ok: false, status: r.status, gone, detail: gone ? '' : txt.slice(0, 200) };
  }
  return { ok: false, status: 401, gone: false };
}

export const _resetFcmCache = () => { parsed = null; cachedToken = null; };
