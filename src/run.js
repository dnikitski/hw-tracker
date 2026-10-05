// One sync pass: scrape every enabled site, then update the calendar, the note and Discord.
//   node src/run.js            sync the sites marked "verified"
//   node src/run.js --dry-run  scrape everything, print it, change nothing (npm run check)
//   --only=webassign,connect   limit to some sites
//   --headless                 hide the browser window
import { openBrowser } from './browser.js';
import { calendarClient, syncCalendar } from './calendar.js';
import { loadConfig, log } from './config.js';
import { itemLine, post } from './discord.js';
import { when, writeNote } from './note.js';
import { loadSecrets } from './secrets.js';
import { brightspace } from './sites/brightspace.js';
import { page } from './sites/page.js';
import { loadState, merge, saveState } from './store.js';

const DAY = 86_400_000;
const flags = process.argv.slice(2);
const dryRun = flags.includes('--dry-run');
const only = flags.find((flag) => flag.startsWith('--only='))?.slice(7).split(',');

const config = loadConfig();
const secrets = loadSecrets();
const state = loadState();
const now = new Date();
const errors = [];

let context;
const ctx = {
  config,
  secrets,
  now,
  capture: dryRun,
  lookaheadDays: config.lookaheadDays ?? 120,
  // Opened on first use, so a run that only reads an iCal feed never starts a browser.
  browser: async () => (context ??= await openBrowser({ headless: flags.includes('--headless') || config.headless })),
};

const found = [];
for (const [name, site] of Object.entries(config.sites)) {
  if (!site.enabled || (only && !only.includes(name))) continue;
  // An unverified site is only ever scraped by `npm run check`, never synced.
  if (!dryRun && !site.verified) continue;
  try {
    const items = site.type === 'brightspace' ? await brightspace(site, ctx) : await page(name, site, ctx);
    log(`${name}: ${items.length} item(s)${site.verified ? '' : ' (not verified, will not be synced)'}`);
    if (dryRun) console.table(items.map((item) => ({ course: item.course, title: item.title, due: when({ ...item, due: item.due.toISOString() }) })));
    if (site.verified) found.push(...items);
  } catch (error) {
    errors.push(`${name}: ${error.message}`);
    log(`${name}: FAILED ${error.message}`);
  }
}
await context?.close();

if (dryRun) {
  console.log('\nDry run: nothing was written. Pages are saved under captures/.');
  console.log('If a site\'s list looks right, set "verified": true for it in config.json.');
  process.exit(errors.length ? 1 : 0);
}

const { added, changed } = merge(state, found, now);

if (config.calendar?.enabled) {
  try {
    const cal = await calendarClient(secrets, config.calendar.calendarId ?? 'primary');
    if (cal) {
      const { created, moved } = await syncCalendar(cal, config.calendar, state, now);
      log(`calendar: ${created} created, ${moved} moved`);
    } else {
      log('calendar: not connected (run "npm run setup google")');
    }
  } catch (error) {
    errors.push(`calendar: ${error.message}`);
    log(`calendar: FAILED ${error.message}`);
  }
}

if (config.note?.path) {
  try {
    writeNote(config.note.path, state, now);
  } catch (error) {
    errors.push(`note: ${error.message}`);
    log(`note: FAILED ${error.message}`);
  }
}

try {
  const webhook = secrets.discordWebhook;
  if (added.length) await post(webhook, `📚 **${added.length} new assignment(s)**`, added.map(itemLine));
  if (changed.length) {
    await post(webhook, '🔁 **Due date changed**', changed.map(({ item, was }) => `${itemLine(item)} (was ${when({ ...item, due: was })})`));
  }

  // One digest a day, on the first run after digestHour.
  const today = now.toLocaleDateString('sv-SE');
  const digest = config.discord ?? {};
  if (state.lastDigest !== today && now.getHours() >= (digest.digestHour ?? 8)) {
    const soon = Object.values(state.items)
      .filter((item) => !item.done && new Date(item.due) > now && new Date(item.due) - now < (digest.digestDays ?? 3) * DAY)
      .sort((a, b) => a.due.localeCompare(b.due));
    if (soon.length) await post(webhook, `⏰ **Due in the next ${digest.digestDays ?? 3} days**`, soon.map(itemLine));
    state.lastDigest = today;
  }

  // Only speak up when the set of failures changes, not on every run while a login stays broken.
  const failure = errors.join('\n');
  if (failure && failure !== state.lastFailure) await post(webhook, '⚠️ **hw-tracker needs attention**', errors);
  if (!failure && state.lastFailure) await post(webhook, '✅ hw-tracker is working again');
  state.lastFailure = failure;
} catch (error) {
  log(`discord: FAILED ${error.message}`);
}

saveState(state);
log(`done: ${added.length} new, ${changed.length} changed, ${errors.length} error(s)`);
process.exit(errors.length ? 1 : 0);
