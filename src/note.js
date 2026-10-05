import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const DAY = 86_400_000;

export function when(item) {
  const options = { weekday: 'short', month: 'short', day: 'numeric' };
  if (!item.allDay) Object.assign(options, { hour: 'numeric', minute: '2-digit' });
  return new Date(item.due).toLocaleString('en-US', options);
}

// Rewrites the to-do note. Boxes ticked by hand are read back first (each line
// ends in a hidden %%id%%) and remembered, so a rewrite never unticks anything.
export function writeNote(file, state, now) {
  if (!existsSync(path.dirname(file))) throw new Error(`note folder does not exist: ${path.dirname(file)}`);
  if (existsSync(file)) {
    for (const [, id] of readFileSync(file, 'utf8').matchAll(/^- \[x\] .*%%(\w+)%%\s*$/gim)) {
      if (state.items[id]) state.items[id].done = true;
    }
  }

  const items = Object.values(state.items).sort((a, b) => a.due.localeCompare(b.due));
  const age = (item) => now - new Date(item.due);
  const line = (item) =>
    `- [${item.done ? 'x' : ' '}] **${when(item)}** · ${item.course} · ` +
    `${item.url ? `[${item.title}](${item.url})` : item.title} %%${item.id}%%`;
  const section = (heading, list) => (list.length ? [`## ${heading}`, '', ...list.map(line), ''] : []);

  const open = items.filter((item) => !item.done);
  const body = [
    '---',
    'tags: [homework, auto-generated]',
    `updated: ${now.toLocaleString('sv-SE').slice(0, 16)}`,
    '---',
    '',
    '# Homework Due',
    '',
    '> [!info] Written by hw-tracker',
    '> This note is rebuilt on every sync. Tick a box when something is done and it stays ticked; any other edit is overwritten.',
    '',
    ...section('Past due — tick if done', open.filter((item) => age(item) > 0 && age(item) <= 7 * DAY)),
    ...section('Next 7 days', open.filter((item) => age(item) <= 0 && age(item) > -7 * DAY)),
    ...section('Later', open.filter((item) => age(item) <= -7 * DAY)),
    ...section('Done', items.filter((item) => item.done && age(item) <= 14 * DAY)),
  ];
  if (!open.some((item) => age(item) <= 7 * DAY)) body.push('Nothing due.', '');
  writeFileSync(file, body.join('\n'));
}
