import * as chrono from 'chrono-node';
import { capture, reach } from '../browser.js';
import { signIn } from './brightspace.js';

const DAY = 86_400_000;
const EDGE = '[\\s,:;|\\u2013\\u2014-]*';
const LEADING_LABEL = /^\W*(due( date)?|available|status|score|grade)\b[\s:-]*/i;
const TRAILING_LABEL = new RegExp(`${EDGE}(\\bdue\\b( date| on| by)?)?${EDGE}$`, 'i');

// Runs inside the page. Returns the text of every element that looks like
// "an assignment name next to a date", keeping the innermost such element.
function collectRows(scope) {
  const root = scope ? document.querySelector(scope) : document;
  if (!root) return [];
  const DATE =
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(,?\s+\d{4})?|\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b|\b\d{4}-\d{2}-\d{2}\b/gi;
  const NOISE =
    /\b\d{1,2}:\d{2}\b|\b(due|date|at|on|by|am|pm|e[sd]t|until|available|mon|tue|wed|thu|fri|sat|sun)[a-z]*\b/gi;
  const hits = [];
  for (const el of root.querySelectorAll('tr, li, article, section, div, a, [role=row], [role=listitem]')) {
    const text = (el.innerText || '').trim();
    if (text.length < 8 || text.length > 400 || text.search(DATE) < 0) continue;
    // A date on its own ("Due Oct 9 at 10:00 PM") is not a row; it needs a name next to it.
    const name = text.replace(DATE, '').replace(NOISE, '').replace(/[^a-z0-9]/gi, '');
    if (name.length >= 3) hits.push(el);
  }
  return hits
    .filter((el) => !hits.some((other) => other !== el && el.contains(other)))
    .map((el) => ({
      text: el.innerText.trim(),
      href: (el.closest('a[href]') || el.querySelector('a[href]'))?.href || null,
    }));
}

// Dates in one cell of a row. A number at the end of a name can get glued onto
// the date after it ("HW 13 Jan 15" reads as 13 January 2015), so a date that
// lands outside the school year is re-read without its leading number.
function datesIn(cell, now) {
  const plausible = (d) => Math.abs(d.start.date() - now) <= 400 * DAY;
  let found = chrono.parse(cell, now);
  const glued = found.find((d) => !plausible(d) && /^\d+\s/.test(d.text));
  if (glued) {
    const digits = /^\d+/.exec(glued.text)[0].length;
    found = chrono.parse(cell.slice(0, glued.index) + ' '.repeat(digits) + cell.slice(glued.index + digits), now);
  }
  return found.filter(plausible);
}

function nameIn(cell) {
  const name = cell.replace(LEADING_LABEL, '').replace(TRAILING_LABEL, '').replace(/\s+/g, ' ').trim();
  return name.replace(/[^a-z0-9]/gi, '').length >= 2 && !/^(at|on|by)$/i.test(name) ? name.slice(0, 120) : null;
}

// Turns raw row text into assignments. Exported for tests.
export function parseRows(rows, { source, course }, now = new Date()) {
  const items = new Map();
  for (const { text, href } of rows) {
    // Table cells arrive tab-separated and card lines newline-separated.
    const cells = text
      .split(/[\n\t]+/)
      // "Jan 15 11:59 PM" would otherwise be read as January of the year '15.
      .map((cell) => cell.trim().replace(/\b([a-z]{3,9}\.?\s+\d{1,2})\s+(?=\d{1,2}:\d{2})/gi, '$1, '))
      .filter(Boolean);
    const dates = [];
    let title = null;
    cells.forEach((cell, index) => {
      const found = datesIn(cell, now);
      for (const d of found) {
        const hasDay = d.start.isCertain('day') || d.start.isCertain('weekday');
        const hasTime = d.start.isCertain('hour');
        if (!hasDay) {
          // A time in its own cell belongs to the date in the cell before it.
          const previous = dates.at(-1);
          if (hasTime && previous && !previous.hasTime) {
            previous.date.setHours(d.start.get('hour'), d.start.get('minute') ?? 0, 0, 0);
            previous.hasTime = true;
          }
          continue;
        }
        const labelled =
          /due/i.test(cell.slice(0, d.index)) || (d.index === 0 && /^due( date)?:?$/i.test(cells[index - 1] ?? ''));
        dates.push({ date: d.start.date(), hasTime, hasYear: d.start.isCertain('year'), labelled });
      }
      title ??= nameIn(found.reduce((rest, d) => rest.replace(d.text, ' '), cell));
    });
    if (!dates.length || !title) continue;

    // Rows often carry an "available" date too; prefer the one labelled due, else the last.
    const pick = dates.find((d) => d.labelled) ?? dates.at(-1);
    const due = pick.date;
    if (!pick.hasTime) due.setHours(23, 59, 0, 0);
    // "Jan 15" read in December means next January, not eleven months ago.
    if (!pick.hasYear && now - due > 183 * DAY) due.setFullYear(due.getFullYear() + 1);
    items.set(title.toLowerCase(), { source, course, title, due, allDay: !pick.hasTime, url: href });
  }
  return [...items.values()];
}

// Generic scraper for any site that shows a list of assignments with due dates.
// The site is described entirely by config; see README for the fields.
export async function page(name, site, ctx) {
  const context = await ctx.browser();
  if (site.viaBrightspace) await (await signIn(context, ctx.config.sites.brightspace, ctx.secrets)).close();

  const start = await context.newPage();
  await start.goto(site.startUrl, { waitUntil: 'domcontentloaded' });
  const readyUrl = new RegExp(site.readyUrl, 'i');
  const target = await reach(context, {
    what: name,
    creds: ctx.secrets.logins?.[site.login],
    hops: site.hops,
    ready: async (p) => p.frames().some((frame) => readyUrl.test(frame.url())),
  });
  const settle = () => target.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
  await settle();
  for (const selector of site.steps ?? []) {
    await target.locator(selector).first().click();
    await settle();
  }

  const rows = [];
  for (const frame of target.frames()) rows.push(...(await frame.evaluate(collectRows, site.scope ?? null).catch(() => [])));
  if (ctx.capture) await capture(target, name);
  await target.close();
  if (!start.isClosed()) await start.close();
  const ignore = site.ignore && new RegExp(site.ignore, 'i');
  return parseRows(rows, { source: name, course: site.course }, ctx.now).filter((item) => !ignore?.test(item.title));
}
