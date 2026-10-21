const encoder = new TextEncoder();

function hex(bytes) {
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hmac(keyBytes, message) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', key, encoder.encode(message));
}

function equalHex(a, b) {
  if (!/^[a-f0-9]{64}$/i.test(a) || !/^[a-f0-9]{64}$/i.test(b)) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyTelegramInitData(raw, token, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!raw || !token || raw.length > 8192) return null;
  const params = new URLSearchParams(raw);
  const hash = params.get('hash');
  const authDate = Number(params.get('auth_date'));
  if (!hash || !Number.isSafeInteger(authDate) || Math.abs(nowSeconds - authDate) > 86400) return null;
  params.delete('hash');
  const check = [...params.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, value]) => `${key}=${value}`).join('\n');
  const secret = await hmac(encoder.encode('WebAppData'), token);
  const computed = hex(await hmac(secret, check));
  if (!equalHex(computed, hash)) return null;
  try {
    const user = JSON.parse(params.get('user') || '{}');
    return Number.isSafeInteger(user.id) && user.id > 0 ? user : null;
  } catch {
    return null;
  }
}

export async function getIdentity(request, env) {
  if (env.DEV_AUTH === '1' && request.headers.get('X-Demo-User')) {
    const id = Number(request.headers.get('X-Demo-User'));
    if (Number.isSafeInteger(id) && id > 0) return { id, first_name: id === 1001 ? 'Aruzhan' : 'Elnur', username: 'demo' + id };
  }
  return verifyTelegramInitData(request.headers.get('X-Telegram-Init-Data'), String(env.BOT_TOKEN || '').trim());
}
