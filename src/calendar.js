const API = 'https://www.googleapis.com/calendar/v3';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const MINUTE = 60_000;

// Minimal Google Calendar client over fetch. Returns null when Google is not set up.
export async function calendarClient(secrets, calendarId) {
  const google = secrets.google;
  if (!google?.refreshToken) return null;
  const tokenResponse = await fetch(TOKEN_URL, {
    method: 'POST',
    body: new URLSearchParams({
      client_id: google.clientId,
      client_secret: google.clientSecret,
      refresh_token: google.refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!tokenResponse.ok) {
    throw new Error(`Google sign-in expired (${tokenResponse.status}); run "npm run setup google" again.`);
  }
  const { access_token: accessToken } = await tokenResponse.json();

  const call = async (method, path, { query, body } = {}) => {
    const url = `${API}/calendars/${encodeURIComponent(calendarId)}/events${path}?${new URLSearchParams(query)}`;
    const response = await fetch(url, {
      method,
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: body && JSON.stringify(body),
    });
    if (response.status === 404 || response.status === 410) return null;
    if (!response.ok) throw new Error(`Google Calendar ${method} failed: ${response.status} ${await response.text()}`);
    return response.json();
  };
  return {
    list: (query) => call('GET', '', { query }),
    insert: (body) => call('POST', '', { body }),
    patch: (id, body) => call('PATCH', `/${id}`, { body }),
  };
}

// "PHY 203" + "HW 4" -> "PHY 203 HW 4 due"
export function summaryFor(item) {
  const squash = (text) => text.replace(/\s+/g, '').toLowerCase();
  const named = squash(item.title).startsWith(squash(item.course)) ? item.title : `${item.course} ${item.title}`;
  return /\bdue$/i.test(named) ? named : `${named} due`;
}

const localDay = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

function eventBody(item, cfg) {
  const due = new Date(item.due);
  const reminders = (minutes) => ({
    useDefault: false,
    overrides: minutes.map((m) => ({ method: 'popup', minutes: m })),
  });
  const body = {
    summary: summaryFor(item),
    description: [item.url, `Source: ${item.source}`, 'Added by hw-tracker.'].filter(Boolean).join('\n'),
    colorId: cfg.colorId,
    transparency: 'transparent',
    extendedProperties: { private: { hwTrackerId: item.id } },
  };
  if (item.allDay) {
    const next = new Date(due.getFullYear(), due.getMonth(), due.getDate() + 1);
    return { ...body, start: { date: localDay(due) }, end: { date: localDay(next) }, reminders: reminders(cfg.reminderMinutes.slice(0, 1)) };
  }
  return {
    ...body,
    start: { dateTime: new Date(due - cfg.blockMinutes * MINUTE).toISOString() },
    end: { dateTime: due.toISOString() },
    reminders: reminders(cfg.reminderMinutes),
  };
}

// Looks for an event that already covers this assignment: one this tool made
// earlier, or one added by hand for the same class ending at the same deadline.
async function findExisting(cal, item) {
  const own = await cal.list({ privateExtendedProperty: `hwTrackerId=${item.id}` });
  if (own?.items?.length) return { event: own.items[0], adopted: false };
  if (item.allDay) return null;

  const due = new Date(item.due);
  const nearby = await cal.list({
    timeMin: new Date(due - 120 * MINUTE).toISOString(),
    timeMax: new Date(+due + 120 * MINUTE).toISOString(),
    singleEvents: 'true',
  });
  const squash = (text) => text.replace(/\s+/g, '').toLowerCase();
  const matches = (nearby?.items ?? []).filter(
    (event) =>
      event.status !== 'cancelled' &&
      event.end?.dateTime &&
      Math.abs(new Date(event.end.dateTime) - due) <= 5 * MINUTE &&
      squash(event.summary ?? '').startsWith(squash(item.course)),
  );
  const numbers = item.title.match(/\d+/g) ?? [];
  const sameNumber = matches.find((event) => numbers.some((n) => new RegExp(`\\b${n}\\b`).test(event.summary.slice(item.course.length))));
  const event = sameNumber ?? (matches.length === 1 ? matches[0] : null);
  return event && { event, adopted: true };
}

// Creates an event for each new assignment and moves events whose deadline changed.
// Hand-made events are adopted as-is and only ever have their time moved.
export async function syncCalendar(cal, cfg, state, now) {
  let created = 0;
  let moved = 0;
  for (const item of Object.values(state.items)) {
    if (item.calendarGone) continue;
    const body = eventBody(item, cfg);
    if (!item.eventId) {
      if (new Date(item.due) < now) continue;
      const existing = await findExisting(cal, item);
      if (existing) {
        item.eventId = existing.event.id;
        item.adopted = existing.adopted;
      } else {
        item.eventId = (await cal.insert(body)).id;
        created++;
      }
      item.syncedDue = item.due;
    } else if (item.syncedDue !== item.due) {
      const event = await cal.patch(item.eventId, item.adopted ? { start: body.start, end: body.end } : body);
      // Deleted by hand: respect that and stop tracking it on the calendar.
      if (!event || event.status === 'cancelled') item.calendarGone = true;
      else moved++;
      item.syncedDue = item.due;
    }
  }
  return { created, moved };
}
