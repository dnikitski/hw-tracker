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

const USER_FIELD =
  'input[type=email], input[name=loginfmt], input[autocomplete=username], ' +
  'input[name*=user i], input[id*=user i], input[name*=email i], input[id*=email i]';

// Fills a login form if the frame shows one. Each host gets one attempt per
// field, so a wrong password can never loop into an account lockout.
async function fillLogin(frame, creds, attempted) {
  const host = new URL(frame.url()).host;
  const visible = (selector) => frame.locator(selector).filter({ visible: true });
  const password = visible('input[type=password]');
  const user = visible(USER_FIELD).first();
  const passwordFields = await password.count();

  // Exactly one password field means a sign-in form; two means a sign-up form.
  if (passwordFields === 1 && !attempted.has(`${host}:password`)) {
    attempted.add(`${host}:password`);
    if ((await user.count()) && !(await user.inputValue())) await user.fill(creds.user);
    await password.fill(creds.password);
    await password.press('Enter');
    return true;
  }
  if (passwordFields === 0 && (await user.count()) && !attempted.has(`${host}:user`)) {
    attempted.add(`${host}:user`);
    await user.fill(creds.user);
    await user.press('Enter');
    return true;
  }
  return false;
}

// Waits until some tab satisfies `ready`, typing credentials into any login
// form that shows up on the way. Anything it cannot handle (an MFA push, a
// captcha) can be finished by hand in the open window before the timeout.
export async function reach(context, { ready, creds, what, timeoutMs = 180_000 }) {
  const attempted = new Set();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const page of context.pages()) {
      if (await ready(page).catch(() => false)) return page;
      if (!creds) continue;
      for (const frame of page.frames()) {
        if (await fillLogin(frame, creds, attempted).catch(() => false)) break;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error(
    `${what}: not signed in after ${timeoutMs / 1000}s. A login or MFA prompt probably needs a human; ` +
      'run "npm run check" and finish it in the browser window.',
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
