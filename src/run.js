// Entry point for one sync pass.
//   node src/run.js            sync the sites marked "verified"
//   node src/run.js --dry-run  scrape everything, print it, change nothing (npm run check)
//   --only=webassign,connect   limit to some sites
//   --headless                 hide the browser window
//
// The work is in sync.js. This wrapper exists so that a crash or a hang, which
// sync.js cannot report about itself, still reaches Discord.
import { log } from './config.js';
import { post } from './discord.js';
import { loadSecrets } from './secrets.js';

const HANG_MINUTES = 15;

async function alarm(heading, detail) {
  log(`${heading}: ${detail}`);
  try {
    await post(loadSecrets().discordWebhook, `💥 **hw-tracker ${heading}**`, [detail]);
  } catch (error) {
    log(`discord: FAILED ${error.message}`);
  }
  process.exit(1);
}

setTimeout(
  () => alarm('hung', `no result after ${HANG_MINUTES} minutes; the run was stopped`),
  HANG_MINUTES * 60_000,
).unref();

try {
  await import('./sync.js');
} catch (error) {
  await alarm('crashed', error.message);
}
