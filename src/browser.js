import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { at } from './config.js';

// A persistent profile keeps cookies between runs, so "remember this device"
// on an MFA prompt only has to be answered once.
export function openBrowser({ headless = false } = {}) {
  return chromium.launchPersistentContext(at('profile'), {
    headless,
    viewport: { width: 1280, height: 900 },
  });
}

const NOT_TEXT = ':not([type=checkbox]):not([type=radio]):not([type=hidden]):not([type=submit]):not([type=button])';
const USER_FIELD = [
  'input[type=email]',
  'input[name=loginfmt]',
  'input[autocomplete=username]',
  'input[name*=user i]',
  'input[id*=user i]',
  'input[name*=email i]',
  'input[id*=email i]',
]
  .map((selector) => selector + NOT_TEXT)
  .join(', ');

// Playwright's "visible" is not enough: Microsoft parks a 10px password field
// in the corner of its email page. Only fields a person could click count.
async function shown(locator) {
  const elements = [];
  for (const element of await locator.filter({ visible: true }).all()) {
    const box = await element.boundingBox();
    if (box && box.width >= 40 && box.height >= 15 && box.x >= 0 && box.y >= 0) elements.push(element);
  }
  return elements;
}

// Clicks the form's submit button when there is exactly one; some sign-in
// pages ignore the Enter key.
async function submit(frame, field) {
  const buttons = await shown(frame.locator('button[type=submit], input[type=submit]'));
  if (buttons.length === 1) await buttons[0].click();
  else await field.press('Enter');
}

// Fills a login form if the frame shows one. Each host gets one attempt per
// field, so a wrong password can never loop into an account lockout.
async function fillLogin(frame, creds, attempted) {
  const host = new URL(frame.url()).host;
  const passwords = await shown(frame.locator('input[type=password]'));
  const [user] = await shown(frame.locator(USER_FIELD));

  // Exactly one password field means a sign-in form; two means a sign-up form.
  if (passwords.length === 1 && !attempted.has(`${host}:password`)) {
    if (user && !(await user.inputValue())) await user.fill(creds.user);
    await passwords[0].fill(creds.password);
    await submit(frame, passwords[0]);
    attempted.add(`${host}:password`);
    return true;
  }
  if (!passwords.length && user && !attempted.has(`${host}:user`)) {
    await user.fill(creds.user);
    await submit(frame, user);
    attempted.add(`${host}:user`);
    return true;
  }
  // Microsoft's "Stay signed in?" page: say yes, so the session outlives this run.
  if (/^login.(microsoftonline|microsoft|live).com$/.test(host) && !attempted.has(`${host}:stay`)) {
    const prompt = frame.locator('#KmsiDescription, #KmsiCheckboxField').or(frame.getByText('Stay signed in?'));
    if (await prompt.count()) {
      await frame.locator('#idSIButton9, [data-testid=primaryButton]').first().click();
      attempted.add(`${host}:stay`);
      return true;
    }
  }
  return false;
}

// Waits until some tab satisfies `ready`, typing credentials into any login
// form that shows up on the way. `hops` are links to click when a sign-in
// lands somewhere else first, e.g. a publisher dashboard: [{ url, click }].
// Anything it cannot handle (an MFA push, a captcha) can be finished by hand
// in the open window before the timeout.
export async function reach(context, { ready, creds, what, hops = [], timeoutMs = 180_000 }) {
  const attempted = new Set();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const page of context.pages()) {
      if (await ready(page).catch(() => false)) return page;
      for (const hop of hops) {
        const link = page.locator(hop.click).first();
        if (attempted.has(`hop:${hop.click}`) || !new RegExp(hop.url, 'i').test(page.url())) continue;
        if (await link.isVisible().catch(() => false)) {
          attempted.add(`hop:${hop.click}`);
          await link.click().catch(() => {});
        }
      }
      if (!creds) continue;
      for (const frame of page.frames()) {
        if (await fillLogin(frame, creds, attempted).catch(() => false)) break;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  const stuck = context.pages().map((page) => page.url().split('?')[0]).join(', ');
  throw new Error(
    `${what}: not signed in after ${timeoutMs / 1000}s (stuck at ${stuck}). A login or MFA prompt probably ` +
      'needs a human; run "npm run check" and finish it in the browser window.',
  );
}

// Saves what the browser saw, for writing or fixing a parser.
export async function capture(page, name) {
  const dir = at('captures', name);
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  await page.screenshot({ path: path.join(dir, `${stamp}.png`), fullPage: true }).catch(() => {});
  let index = 0;
  for (const frame of page.frames()) {
    const html = await frame.content().catch(() => null);
    if (html) writeFileSync(path.join(dir, `${stamp}-frame${index++}.html`), html);
  }
  return dir;
}
