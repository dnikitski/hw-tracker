import ical from 'node-ical';
import { reach } from '../browser.js';

const DAY = 86_400_000;

// "EGR101 0005 Fall 2026 Intro to Engineering" -> "EGR 101"
export function courseCode(text) {
  const match = /\b([A-Z]{2,4})[\s-]?(\d{3}[A-Z]?)\b/.exec(text ?? '');
  return match ? `${match[1]} ${match[2]}` : null;
}

// Brightspace lists the same item several times ("- Available", "- Due").
// Only the deadline matters here.
function cleanTitle(title) {
  if (/ - (Available|Availability Starts)$/i.test(title)) return null;
  return title.replace(/ - (Due|Availability Ends)$/i, '').trim();
}

// Opens Brightspace and signs in if needed. Also used by publisher sites that
// are launched from a Brightspace link.
export async function signIn(context, site, secrets) {
  const whoami = `${site.host}/d2l/api/lp/1.0/users/whoami`;
  const page = await context.newPage();
  await page.goto(`${site.host}/d2l/home`, { waitUntil: 'domcontentloaded' });
  await reach(context, {
    what: 'brightspace',
    creds: secrets.logins?.brightspace,
    ready: async (p) => p.url().startsWith(`${site.host}/d2l/`) && (await context.request.get(whoami)).ok(),
  });
  return page;
}

async function fromFeed(site) {
  const events = await ical.async.fromURL(site.icalUrl);
  const items = [];
  for (const event of Object.values(events)) {
    if (event.type !== 'VEVENT') continue;
    const title = cleanTitle(String(event.summary ?? ''));
    if (!title) continue;
    const allDay = event.datetype === 'date';
    const due = new Date(event.end ?? event.start);
    if (allDay) due.setHours(23, 59, 0, 0);
    items.push({
      source: 'brightspace',
      key: event.uid,
      course: courseCode(event.location) ?? courseCode(event.description) ?? 'Brightspace',
      title,
      due,
      allDay,
      url: event.url ?? null,
    });
  }
  return items;
}

// Brightspace's own REST API answers a signed-in browser session, no API key needed.
async function fromApi(site, ctx) {
  const context = await ctx.browser();
  const page = await signIn(context, site, ctx.secrets);
  const get = async (path) => {
    const response = await context.request.get(site.host + path);
    if (!response.ok()) throw new Error(`Brightspace API ${response.status()} for ${path.split('?')[0]}`);
    return response.json();
  };

  const versions = await get('/d2l/api/versions/');
  const latest = (code) => versions.find((v) => v.ProductCode === code).LatestVersion;

  const courses = new Map();
  let bookmark = '';
  do {
    const batch = await get(`/d2l/api/lp/${latest('lp')}/enrollments/myenrollments/?orgUnitTypeId=3&bookmark=${bookmark}`);
    for (const { OrgUnit, Access } of batch.Items) {
      const ended = Access?.EndDate && new Date(Access.EndDate) < ctx.now;
      if (Access?.CanAccess && !ended) courses.set(OrgUnit.Id, OrgUnit.Name);
    }
    bookmark = batch.PagingInfo?.HasMoreItems ? batch.PagingInfo.Bookmark : '';
  } while (bookmark);
  if (!courses.size) return [];

  const query = new URLSearchParams({
    orgUnitIdsCSV: [...courses.keys()].join(','),
    startDateTime: new Date(ctx.now - 7 * DAY).toISOString(),
    endDateTime: new Date(+ctx.now + ctx.lookaheadDays * DAY).toISOString(),
  });
  const result = await get(`/d2l/api/le/${latest('le')}/calendar/events/myEvents/?${query}`);
  const events = Array.isArray(result) ? result : (result.Objects ?? result.Items ?? []);
  await page.close();

  const items = [];
  for (const event of events) {
    const title = cleanTitle(event.Title ?? '');
    if (!title) continue;
    const due = new Date(event.EndDateTime ?? event.StartDateTime);
    if (event.IsAllDayEvent) due.setHours(23, 59, 0, 0);
    const link = event.AssociatedEntity?.Link ?? event.CalendarEventViewUrl;
    items.push({
      source: 'brightspace',
      key: String(event.CalendarEventId),
      course: courseCode(courses.get(event.OrgUnitId)) ?? courses.get(event.OrgUnitId) ?? 'Brightspace',
      title,
      due,
      allDay: Boolean(event.IsAllDayEvent),
      url: link ? new URL(link, site.host).href : null,
    });
  }
  return items;
}

export function brightspace(site, ctx) {
  return site.icalUrl ? fromFeed(site) : fromApi(site, ctx);
}
