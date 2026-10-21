import { readFile } from 'node:fs/promises';

const appUrl = process.argv[2];
if (!appUrl || !/^https:\/\/[^\s/]+(?:\/[^\s]*)?$/.test(appUrl)) {
  console.error('Usage: node scripts/configure-telegram.mjs https://your-worker.workers.dev');
  process.exit(1);
}

const vars = Object.fromEntries((await readFile(new URL('../.dev.vars', import.meta.url), 'utf8'))
  .split(/\r?\n/).filter(line => line && !line.startsWith('#'))
  .map(line => { const at = line.indexOf('='); return [line.slice(0, at).trim(), line.slice(at + 1).trim()]; }));
const token = vars.BOT_TOKEN;
const secret = vars.WEBHOOK_SECRET;
if (!token || token.startsWith('demo-') || !/^[A-Za-z0-9_-]{16,256}$/.test(secret || '') || secret === 'local-demo-secret') {
  console.error('Set the real BOT_TOKEN and a long random WEBHOOK_SECRET in .dev.vars first.');
  process.exit(1);
}

async function call(method, payload) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: payload ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json' },
    body: payload ? JSON.stringify(payload) : undefined
  });
  const data = await response.json();
  if (!data.ok) throw new Error(`${method}: ${data.description || 'Telegram API error'}`);
  return data.result;
}

const bot = await call('getMe');
if (bot.username?.toLowerCase() !== 'kezek_mezek_bot') throw new Error('The token belongs to a different bot.');
const url = appUrl.replace(/\/$/, '');
await call('setWebhook', {
  url: `${url}/telegram/webhook`, secret_token: secret,
  allowed_updates: ['message', 'business_message', 'business_connection'],
  drop_pending_updates: false
});
await call('setChatMenuButton', { menu_button: { type: 'web_app', text: 'Open App', web_app: { url } } });
const webhook = await call('getWebhookInfo');
if (webhook.url !== `${url}/telegram/webhook`) throw new Error('Webhook URL was not saved.');
console.log(`Bot @${bot.username} connected. Webhook and Open App menu are active.`);
