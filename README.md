# Kezek Mezek

Telegram Mini App for assignment defense queues. The first release is for SE-2514; anyone with the bot link can open it. The interface is in English. Each Telegram account controls only its own place in each defense session. An admin may place a registered student on their behalf.

## What it does

- Saves a student's chosen display name against their verified Telegram ID.
- Shows subjects, assignment titles, one defense week of practical class dates per assignment, optional extra defense days, and 25 numbered places per defense queue.
- Allows one place **per assignment** across all its defense dates. To switch dates, a student releases their current place first.
- Students can take, move, or release a place at any time. Queue dates come from the subject's practical class timetable; there is no Open/Closed control. Database constraints prevent two students taking one number.
- Lets admins add and edit subjects, weekly practical classes, assignments, queue capacity, positions, and additional admins. Admins can permanently delete an assignment after reviewing how many queues and booked spots it contains.
- Imports Lighthouse `New Assignment Posted!` business messages after the admin approves the source once. Its due date is shown as **Moodle submission due**, separate from defense dates. Other Lighthouse messages, including feedback, are ignored.

The weekly starter schedule comes from the supplied image. Monday Operating Systems is corrected to **11:00–13:00**. Saturday's Algorithms lecture is excluded. Admins can add electives and additional practical classes.

The initial Design and Analysis of Algorithms **Assignment 2** has a Moodle submission deadline of October 7, 2026 at 23:59. Its defense queues are initially **October 5 and October 6**. New Lighthouse assignments choose the week of their submission deadline by default; an admin can change the defense week or edit the assignment title. In Admin → Assignments → Edit, an admin can add extra dates with their time and room, even outside the defense week. Adding a practical class creates the corresponding queue for assignments in that subject.

## Local preview

Requires Node.js 20+.

```powershell
npm install
npm run db:local
npm run dev
```

Open `http://127.0.0.1:8787` while the development server is running. This address stops working when the terminal or computer closes; use the deployed HTTPS address for the real app. The ignored `.dev.vars` file can enable a local demo account with `DEV_AUTH=1`; this setting must **never** be added to Cloudflare production secrets. Run `npm test` for identity, notice parsing and schedule checks. With the local server running, `node scripts/smoke.mjs` checks database and API behavior.

## Deployment checklist

The account holder creates a free [Cloudflare account](https://dash.cloudflare.com/sign-up), verifies their email, and signs in. Then:

1. `npx wrangler login` authorizes deployment from this computer.
2. `npx wrangler d1 create kezek-mezek` creates the free database. Copy its `database_id` into `wrangler.jsonc`.
3. `npm run db:remote` creates the tables in that database.
4. In Cloudflare **Workers & Pages**, set up the account's free **Your subdomain** under `workers.dev` if prompted. Then `npm run deploy` gives an HTTPS `*.workers.dev` address. A custom domain is optional.
5. Run `powershell -File scripts/connect-bot.ps1` from this folder. It asks for the BotFather token with hidden input, checks that it belongs to `@kezek_mezek_bot`, saves the required Cloudflare secrets, registers Telegram's webhook, and adds the bot's **Open App** menu button. The token is not written to the project or terminal output. Keep the token out of chat, source code, and screenshots.
6. When the script asks, send `/id` to `@kezek_mezek_bot`. Type the bot's numeric reply into the terminal. The script saves your admin ID, and the Admin page becomes available to you.
7. In @BotFather, open `@kezek_mezek_bot` settings and configure its **Main Mini App** with the same HTTPS URL for the profile Launch App button.
8. Enable the bot's **Secretary Mode / Chat Automation** and **Bot-to-Bot Communication Mode** in @BotFather. In Telegram account settings, connect `@kezek_mezek_bot` under **Chat Automation**, choose **Only Selected Chats**, and select only **X — Lighthouse**. Telegram's labels may vary by client version. You can forward an older Lighthouse assignment notice to your bot from the admin account to import it and identify the original bot. If the connected chat is not identified by the same ID, approve its next notice once on the app's Admin → Lighthouse screen. New notices then publish automatically when Telegram delivers them through the connection.

Telegram's current documentation describes [selected-chat access](https://core.telegram.org/api/bots/connected-business-bots) and [Secretary Mode](https://core.telegram.org/bots/features). Whether this specific Lighthouse bot's messages arrive through the connection needs a live check after deployment. The admin can still add assignments manually while the connection is tested.

The free Cloudflare plan has [daily request and D1 limits](https://developers.cloudflare.com/workers/platform/pricing/). This app is designed for one class; if limits are exhausted, requests can fail until they reset.

## Data and security

`src/auth.js` verifies Telegram Mini App `initData` on the server and rejects old or modified data. Production must set `BOT_TOKEN`; the local demo shortcut works only when `DEV_AUTH=1` is explicitly set. Webhook requests require Telegram's secret header. Lighthouse imports are restricted to the admin-approved chat and bot ID. Database uniqueness enforces one seat per student per session and one student per seat.

The bot token is never sent to browser code. `.dev.vars`, `.wrangler/`, and `node_modules/` are ignored by Git.
