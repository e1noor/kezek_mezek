param(
  [string]$AppUrl = 'https://kezek-mezek.kezek-mezek.workers.dev'
)

$ErrorActionPreference = 'Stop'
$AppUrl = $AppUrl.TrimEnd('/')
if ($AppUrl -notmatch '^https://[^/]+$') {
  throw 'AppUrl must be an HTTPS site address.'
}

function Get-CloudflareToken {
  try {
    $raw = & npx wrangler auth token --json 2>$null
    if ($LASTEXITCODE -ne 0) { return $null }
    return ($raw | ConvertFrom-Json).token
  } catch { return $null }
}

$cloudflareToken = Get-CloudflareToken
if (-not $cloudflareToken) {
  Write-Host 'Cloudflare needs to connect this terminal. Approve the browser login when it opens.'
  & npx wrangler login
  if ($LASTEXITCODE -ne 0) { throw 'Cloudflare login did not finish.' }
  $cloudflareToken = Get-CloudflareToken
  if (-not $cloudflareToken) { throw 'Cloudflare login is still unavailable in this terminal.' }
}

Write-Host 'Paste the token from @BotFather. Your input will be hidden.'
$secureToken = Read-Host 'Bot token' -AsSecureString
$token = [System.Net.NetworkCredential]::new('', $secureToken).Password
if ([string]::IsNullOrWhiteSpace($token)) { throw 'No bot token entered.' }

try {
  $bot = Invoke-RestMethod -Uri "https://api.telegram.org/bot$token/getMe" -TimeoutSec 20
  if (-not $bot.ok -or $bot.result.username -ne 'kezek_mezek_bot') {
    throw 'This token does not belong to @kezek_mezek_bot.'
  }
} catch {
  $token = $null
  throw 'Could not verify @kezek_mezek_bot. Check the BotFather token and try again.'
}

$randomGenerator = [Security.Cryptography.RandomNumberGenerator]::Create()
$randomBytes = New-Object byte[] 32
$randomGenerator.GetBytes($randomBytes)
$randomGenerator.Dispose()
$webhookSecret = -join ($randomBytes | ForEach-Object { $_.ToString('x2') })

function Save-WorkerSecret([string]$Name, [string]$Value) {
  $env:CLOUDFLARE_API_TOKEN = $cloudflareToken
  try {
    $Value | & npx wrangler secret put $Name
    if ($LASTEXITCODE -ne 0) { throw "Could not save Cloudflare secret $Name." }
  } finally {
    Remove-Item Env:\CLOUDFLARE_API_TOKEN -ErrorAction SilentlyContinue
  }
}

Save-WorkerSecret 'BOT_TOKEN' $token
Save-WorkerSecret 'WEBHOOK_SECRET' $webhookSecret
Save-WorkerSecret 'APP_URL' $AppUrl

try {
  $webhook = Invoke-RestMethod -Uri "https://api.telegram.org/bot$token/setWebhook" `
    -Method Post -ContentType 'application/json' -TimeoutSec 20 `
    -Body (@{
      url = "$AppUrl/telegram/webhook"
      secret_token = $webhookSecret
      allowed_updates = @('message', 'business_message', 'business_connection')
      drop_pending_updates = $false
    } | ConvertTo-Json -Compress)
  if (-not $webhook.ok) { throw 'Telegram rejected the webhook.' }

  $menu = Invoke-RestMethod -Uri "https://api.telegram.org/bot$token/setChatMenuButton" `
    -Method Post -ContentType 'application/json' -TimeoutSec 20 `
    -Body (@{ menu_button = @{ type = 'web_app'; text = 'Open App'; web_app = @{ url = $AppUrl } } } | ConvertTo-Json -Compress -Depth 5)
  if (-not $menu.ok) { throw 'Telegram rejected the Open App button.' }

  $check = Invoke-RestMethod -Uri "https://api.telegram.org/bot$token/getWebhookInfo" -TimeoutSec 20
  if ($check.result.url -ne "$AppUrl/telegram/webhook") { throw 'Telegram webhook did not save.' }
} catch {
  $token = $null
  $webhookSecret = $null
  throw 'Telegram connection could not be completed. Please report this message without sharing the token.'
}

$token = $null
$webhookSecret = $null
Write-Host 'Bot and Open App button connected.'
Write-Host 'Now send /id to @kezek_mezek_bot in Telegram. It will reply with your numeric ID.'
$adminId = Read-Host 'Enter that numeric ID here (or press Enter to do this later)'
if ($adminId) {
  if ($adminId -notmatch '^[1-9][0-9]{3,19}$') { throw 'Invalid Telegram ID.' }
  Save-WorkerSecret 'ADMIN_TELEGRAM_ID' $adminId
  Write-Host 'Admin access configured. Open the bot and tap Open App.'
} else {
  Write-Host 'Admin ID still needs to be configured before the Admin page will appear.'
}
$cloudflareToken = $null
