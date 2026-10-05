import { mkdirSync, writeFileSync } from 'node:fs';
import { reach } from '../browser.js';
import { at } from '../config.js';
import { courseCode } from './brightspace.js';

// Canvas, and sites built on it such as the new WileyPLUS, answer their REST
// API to a signed-in browser session, so no API token is needed.
export async function canvas(name, site, ctx) {
  const context = await ctx.browser();
  const start = await context.newPage();
  await start.goto(site.startUrl, { waitUntil: 'domcontentloaded' });
  const readyUrl = new RegExp(site.readyUrl, 'i');
  const target = await reach(context, {
    what: name,
    creds: ctx.secrets.logins?.[site.login],
    hops: site.hops,
    ready: async (p) => readyUrl.test(p.url()),
  });
  const origin = new URL(target.url()).origin;
  const get = async (path) => {
    const response = await context.request.get(origin + path);
    if (!response.ok()) throw new Error(`${name} API ${response.status()} for ${path.split('?')[0]}`);
    // Canvas prefixes cookie-authenticated JSON with a guard that has to be cut off.
    return JSON.parse((await response.text()).replace(/^while\(1\);/, ''));
  };

  const courses = await get('/api/v1/courses?enrollment_state=active&per_page=100');
  const raw = [];
  const items = [];
  for (const course of courses) {
    const assignments = await get(`/api/v1/courses/${course.id}/assignments?per_page=100&include[]=submission`);
    raw.push({ course: course.name, assignments });
    for (const assignment of assignments) {
      if (!assignment.due_at) continue;
      items.push({
        source: name,
        key: String(assignment.id),
        course: site.course ?? courseCode(course.name) ?? course.name,
        title: assignment.name,
        due: new Date(assignment.due_at),
        allDay: false,
        url: assignment.html_url,
        done: Boolean(assignment.submission?.submitted_at),
      });
    }
  }
  if (ctx.capture) {
    mkdirSync(at('captures', name), { recursive: true });
    writeFileSync(at('captures', name, 'assignments.json'), JSON.stringify(raw, null, 2));
  }
  await target.close();
  if (!start.isClosed()) await start.close();
  return items;
}
