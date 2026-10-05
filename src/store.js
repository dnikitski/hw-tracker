import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { at } from './config.js';

const FILE = at('state.json');

// Stable across due-date changes, so a moved deadline updates the same entry.
export function idFor(item) {
  const key = item.key ?? `${item.course}|${item.title.toLowerCase()}`;
  return createHash('sha1').update(`${item.source}|${key}`).digest('hex').slice(0, 10);
}

export function loadState() {
  return existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : { items: {} };
}

export function saveState(state) {
  writeFileSync(FILE, JSON.stringify(state, null, 2));
}

// Folds freshly scraped assignments into the saved state and reports what is new or moved.
export function merge(state, found, now) {
  const added = [];
  const changed = [];
  for (const scraped of found) {
    const id = idFor(scraped);
    const fresh = {
      source: scraped.source,
      course: scraped.course,
      title: scraped.title,
      due: scraped.due.toISOString(),
      allDay: scraped.allDay,
    };
    const known = state.items[id];
    if (!known) {
      state.items[id] = { id, ...fresh, url: scraped.url, done: false, firstSeen: now.toISOString() };
      if (scraped.due > now) added.push(state.items[id]);
    } else {
      if (known.due !== fresh.due) changed.push({ item: known, was: known.due });
      Object.assign(known, fresh, { url: scraped.url ?? known.url });
    }
    // A site that reports submissions can tick an item; it never unticks one done by hand.
    if (scraped.done) state.items[id].done = true;
    state.items[id].lastSeen = now.toISOString();
  }
  return { added, changed };
}
