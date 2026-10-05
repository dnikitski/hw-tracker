import assert from 'node:assert/strict';
import { test } from 'node:test';
import { summaryFor } from '../src/calendar.js';
import { courseCode } from '../src/sites/brightspace.js';
import { parseRows } from '../src/sites/page.js';
import { idFor, merge } from '../src/store.js';

const now = new Date(2026, 9, 4, 12, 0); // Sun Oct 4 2026, local time
const site = { source: 'webassign', course: 'PHY 203' };

test('table row: name, then a full due date and time', () => {
  const [item] = parseRows([{ text: 'HW 4\tFri, Oct 9, 2026 10:00 PM EDT', href: 'https://x/hw4' }], site, now);
  assert.equal(item.title, 'HW 4');
  assert.equal(item.allDay, false);
  assert.equal(item.due.toISOString(), '2026-10-10T02:00:00.000Z');
  assert.equal(item.url, 'https://x/hw4');
});

test('card: prefers the date labelled "due" over the available date', () => {
  const [item] = parseRows([{ text: 'Chapter 3 Homework\nAvailable Oct 1, 2026\nDue Oct 14, 2026 11:30 PM', href: null }], site, now);
  assert.equal(item.title, 'Chapter 3 Homework');
  assert.deepEqual([item.due.getMonth(), item.due.getDate(), item.due.getHours(), item.due.getMinutes()], [9, 14, 23, 30]);
});

test('date without a time becomes an all-day item due at 11:59 PM', () => {
  const [item] = parseRows([{ text: 'Quiz 2 — due 10/20/2026', href: null }], site, now);
  assert.equal(item.title, 'Quiz 2');
  assert.equal(item.allDay, true);
  assert.deepEqual([item.due.getDate(), item.due.getHours(), item.due.getMinutes()], [20, 23, 59]);
});

test('a date with no year that would be long past rolls into next year', () => {
  const december = new Date(2026, 11, 10, 12, 0);
  const [item] = parseRows([{ text: 'HW 13\tJan 15 11:59 PM', href: null }], site, december);
  assert.equal(item.due.getFullYear(), 2027);
});

test('a number in the name is not swallowed by the date after it', () => {
  const [item] = parseRows([{ text: 'HW 13 Oct 15 11:59 PM', href: null }], site, now);
  assert.equal(item.title, 'HW 13');
  assert.deepEqual([item.due.getFullYear(), item.due.getMonth(), item.due.getDate(), item.due.getHours()], [2026, 9, 15, 23]);
});

test('a time in its own cell is joined to the date before it', () => {
  const [item] = parseRows([{ text: 'Reading 6\tDue Date\tOct 21, 2026\t11:30 PM', href: null }], site, now);
  assert.equal(item.title, 'Reading 6');
  assert.equal(item.allDay, false);
  assert.deepEqual([item.due.getDate(), item.due.getHours(), item.due.getMinutes()], [21, 23, 30]);
});

test('rows without a date or without a name are dropped; duplicates collapse', () => {
  const rows = [
    { text: 'Welcome to the course', href: null },
    { text: 'Due Oct 9, 2026 at 10:00 PM', href: null },
    { text: 'HW 5\tOct 16, 2026 10:00 PM', href: null },
    { text: 'HW 5\tOct 16, 2026 10:00 PM', href: null },
  ];
  assert.deepEqual(parseRows(rows, site, now).map((item) => item.title), ['HW 5']);
});

test('calendar title follows "<course> <name> due" without doubling up', () => {
  assert.equal(summaryFor({ course: 'PHY 203', title: 'HW 4' }), 'PHY 203 HW 4 due');
  assert.equal(summaryFor({ course: 'PHY 203', title: 'PHY203 HW 4 due' }), 'PHY203 HW 4 due');
});

test('course code is pulled out of a Brightspace course name', () => {
  assert.equal(courseCode('EGR101 0005 Fall 2026 Intro to Engineering'), 'EGR 101');
  assert.equal(courseCode('EGR 316G Engineering Ethics'), 'EGR 316G');
  assert.equal(courseCode('Student Resources'), null);
});

test('merge reports new and moved items and keeps one entry per assignment', () => {
  const state = { items: {} };
  const hw = { source: 'webassign', course: 'PHY 203', title: 'HW 4', due: new Date(2026, 9, 9, 22), allDay: false, url: null };
  assert.equal(merge(state, [hw], now).added.length, 1);

  const moved = { ...hw, due: new Date(2026, 9, 11, 22) };
  const second = merge(state, [moved], now);
  assert.equal(second.added.length, 0);
  assert.equal(second.changed.length, 1);
  assert.equal(Object.keys(state.items).length, 1);
  assert.equal(state.items[idFor(hw)].due, moved.due.toISOString());
});

test('a site reporting a submission ticks the item, and a later run never unticks it', () => {
  const state = { items: {} };
  const hw = { source: 'wileyplus', key: '42', course: 'MTH 243', title: 'Sect-13.3', due: new Date(2026, 9, 9, 23), allDay: false, url: null };
  merge(state, [{ ...hw, done: true }], now);
  assert.equal(state.items[idFor(hw)].done, true);
  merge(state, [{ ...hw, done: false }], now);
  assert.equal(state.items[idFor(hw)].done, true);
});
