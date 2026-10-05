# hw-tracker

Homework lives in too many places: the LMS, plus a different publisher site for every class. hw-tracker logs into each one for you, reads the due dates, and puts them where you already look:

- **Google Calendar** — one event per assignment, moved automatically when a deadline changes
- **An Obsidian note** — a single to-do list sorted by due date, with checkboxes that stay ticked
- **Discord** — a ping for new assignments, changed deadlines, a daily "due soon" digest, and a warning when a login stops working

It runs on a schedule on any Windows machine that stays on.

> **Status:** early. The Brightspace reader and the generic page reader work against saved test rows, but each site still has to be checked against a real account before it is trusted (see [Check, then trust](#check-then-trust)).

## How it works

```
Brightspace ─┐
WebAssign ───┤  Playwright signs in   ┌─> Google Calendar
WileyPLUS ───┼─> and reads due dates ─┼─> Obsidian note
Connect ─────┘   -> state.json        └─> Discord webhook
```

- **Brightspace** is read through its own REST API using the signed-in browser session, so no API key or admin access is needed. If your school exposes the calendar feed (Calendar > Subscribe), paste that URL into `icalUrl` instead and no browser is used at all.
- **Publisher sites** (WebAssign, WileyPLUS, McGraw Hill Connect, or anything else with a list of assignments) share one generic reader: it finds every row on the page that pairs a name with a date. A site is described in `config.json`, not in code.
- **Logins** are typed in by the program. Passwords are stored encrypted with Windows DPAPI, so `secrets.json` can only be read by your Windows account on that machine. A persistent browser profile keeps cookies, so an MFA "remember this device" prompt is answered once.
- **State** is one JSON file. Each assignment has a stable id, so a re-run updates instead of duplicating.

## Setup

Needs Windows and [Node.js](https://nodejs.org) 20 or newer.

```powershell
git clone https://github.com/<you>/hw-tracker
cd hw-tracker
npm install
npx playwright install chromium
copy config.example.json config.json   # then edit it
npm run setup                          # logins, Discord webhook, Google Calendar
```

`npm run setup` asks for everything in turn. To redo one part: `npm run setup logins`, `npm run setup discord` or `npm run setup google`.

### Google Calendar

Google requires your own OAuth client; it takes about five minutes and is free.

1. Open [console.cloud.google.com](https://console.cloud.google.com), create a project, and enable the **Google Calendar API**.
2. Under **OAuth consent screen**, choose External, add yourself as a user, then **publish the app** ("In production"). Left in "Testing", Google expires the sign-in every 7 days.
3. Under **Credentials**, create an **OAuth client ID** of type **Desktop app**.
4. Paste the client ID and secret into `npm run setup google` and approve the access in the browser tab that opens.

### Discord

In your server: channel settings > Integrations > Webhooks > New Webhook > Copy Webhook URL, then paste it into `npm run setup discord`.

## Check, then trust

Nothing is written anywhere until you have looked at what a site returns.

```powershell
npm run check                       # scrape every enabled site, print it, change nothing
npm run check -- --only=webassign   # just one
```

A browser window opens and signs in. If an MFA prompt appears, approve it; you have three minutes. The run prints a table per site and saves the page under `captures/`. When a site's table matches what you see on the site, set `"verified": true` for it in `config.json`. Only verified sites are synced.

Then:

```powershell
npm run sync                    # one real pass
.\scripts\register-task.ps1     # every 4 hours from now on
```

## Config

| Field | Meaning |
|---|---|
| `sites.<name>.enabled` | Scrape this site at all |
| `sites.<name>.verified` | Allow it to be synced; leave `false` until `npm run check` looks right |
| `sites.brightspace.host` | Your school's Brightspace address |
| `sites.brightspace.icalUrl` | Optional calendar feed URL; used instead of logging in |
| `course` | Label put on every assignment from this site, e.g. `PHY 203` |
| `login` | Which saved login to type in: `brightspace`, `cengage`, `wiley` or `mcgrawhill` |
| `startUrl` | Where to begin. For a site opened from Brightspace, right-click the link in your course and copy its address |
| `viaBrightspace` | Sign into Brightspace first, then open `startUrl` |
| `readyUrl` | Regex that matches the address once you are in and looking at assignments |
| `steps` | Optional selectors to click after that, e.g. `["text=Assignments"]` |
| `scope` | Optional CSS selector; only rows inside it are read, e.g. `"main"` or `"#assignments"` |
| `ignore` | Optional regex; rows whose name matches are dropped, e.g. `"copyright|announcement"` |
| `note.path` | Where to write the to-do note |
| `calendar.*` | Calendar id, event colour, block length and reminder times in minutes |
| `discord.digestHour`, `digestDays` | When the daily digest goes out and how far ahead it looks |

## Good to know

- **Completion is manual for now.** The tool knows when something is due, not whether you submitted it. Tick the box in the note and it stays ticked.
- **Calendar events are never deleted.** If you delete one yourself, the tool leaves it deleted. If you already added an event by hand for the same class and deadline, the tool adopts it instead of making a second one.
- **Sites change.** When a redesign breaks a reader you get a Discord warning; `npm run check` shows what it sees now.
- **Terms of service.** This automates your own account to read your own due dates, a few times a day. Some sites' terms restrict automated access; that call is yours.
- **Windows only** at the moment, because of how secrets are stored.

## Development

```powershell
npm test
```

Tests cover the date/row parser, calendar titles, course-code extraction and state merging. They need no network or logins.

## Roadmap

- Read submitted/graded status from each site so finished work ticks itself
- Site-specific readers where the generic one is not enough
- macOS and Linux secret storage

## License

MIT
