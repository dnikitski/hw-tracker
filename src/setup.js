// Interactive setup: `npm run setup` asks for everything, or name the parts you
// want, e.g. `npm run setup logins` / `discord` / `google`.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import { post } from './discord.js';
import { loadSecrets, saveSecrets } from './secrets.js';

const LOGINS = {
  brightspace: 'Brightspace (school login)',
  cengage: 'Cengage / WebAssign',
  wiley: 'WileyPLUS',
  mcgrawhill: 'McGraw Hill Connect',
};

// Reads one line from the terminal; with `hidden`, nothing typed is echoed.
function ask(label, { hidden = false } = {}) {
  const { stdin, stdout } = process;
  if (!stdin.isTTY) throw new Error('Setup needs a real terminal window (it reads passwords without echoing them).');
  return new Promise((resolve, reject) => {
    let value = '';
    stdout.write(label);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const finish = (result) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off('data', onData);
      stdout.write('\n');
      // Passwords are kept exactly as typed.
      result instanceof Error ? reject(result) : resolve(hidden ? value : value.trim());
    };
    const onData = (chunk) => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') return finish();
        if (char === '\u0003') return finish(new Error('cancelled'));
        if (char === '\b' || char === '\u007f') {
          if (value && !hidden) stdout.write('\b \b');
          value = value.slice(0, -1);
        } else {
          value += char;
          if (!hidden) stdout.write(char);
        }
      }
    };
    stdin.on('data', onData);
  });
}

async function logins(secrets) {
  secrets.logins ??= {};
  console.log('\nSite logins. Leave the email blank to skip a site or keep what is saved.');
  for (const [key, label] of Object.entries(LOGINS)) {
    const saved = secrets.logins[key] ? ` [saved: ${secrets.logins[key].user}]` : '';
    const user = await ask(`${label} email/username${saved}: `);
    if (!user) continue;
    const password = await ask(`${label} password (hidden): `, { hidden: true });
    secrets.logins[key] = { user, password };
  }
}

async function discord(secrets) {
  console.log('\nDiscord. In your server: channel settings > Integrations > Webhooks > New Webhook > Copy URL.');
  const url = await ask(`Webhook URL${secrets.discordWebhook ? ' [saved, blank keeps it]' : ' (blank to skip)'}: `, { hidden: true });
  if (!url.trim()) return;
  secrets.discordWebhook = url.trim();
  await post(secrets.discordWebhook, '👋 hw-tracker is connected. Alerts and the daily digest will show up here.');
  console.log('Sent a test message; check the channel.');
}

async function google(secrets) {
  console.log('\nGoogle Calendar. Needs an OAuth client of type "Desktop app"; the README walks through creating one.');
  const clientId = (await ask(`Client ID${secrets.google ? ' [saved, blank keeps it]' : ' (blank to skip)'}: `)) || secrets.google?.clientId;
  if (!clientId) return;
  const clientSecret = (await ask('Client secret (hidden, blank keeps saved): ', { hidden: true })) || secrets.google?.clientSecret;

  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const redirectUri = `http://127.0.0.1:${server.address().port}`;
  const state = randomBytes(16).toString('hex');
  const consentUrl =
    'https://accounts.google.com/o/oauth2/v2/auth?' +
    new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/calendar.events',
      access_type: 'offline',
      prompt: 'consent',
      state,
    });
  console.log(`Opening your browser to approve calendar access. If nothing opens, go to:\n${consentUrl}`);
  spawn('rundll32', ['url.dll,FileProtocolHandler', consentUrl], { detached: true, stdio: 'ignore' }).unref();

  const code = await new Promise((resolve, reject) => {
    server.on('request', (request, response) => {
      const params = new URL(request.url, redirectUri).searchParams;
      if (params.get('state') !== state) return response.end();
      response.end('hw-tracker is connected. You can close this tab.');
      params.has('code') ? resolve(params.get('code')) : reject(new Error(`Google said: ${params.get('error')}`));
    });
  });
  server.close();

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  if (!response.ok) throw new Error(`Google token exchange failed: ${response.status} ${await response.text()}`);
  const { refresh_token: refreshToken } = await response.json();
  secrets.google = { clientId, clientSecret, refreshToken };
  console.log('Google Calendar connected.');
}

const parts = { logins, discord, google };
const wanted = process.argv.slice(2);
const unknown = wanted.filter((name) => !parts[name]);
if (unknown.length) {
  console.error(`Unknown setup part: ${unknown.join(', ')}. Choose from: ${Object.keys(parts).join(', ')}`);
  process.exit(1);
}

const secrets = loadSecrets();
try {
  for (const name of wanted.length ? wanted : Object.keys(parts)) {
    await parts[name](secrets);
    saveSecrets(secrets);
  }
  console.log('\nSaved (encrypted for this Windows account) to secrets.json.');
} catch (error) {
  console.error(`\n${error.message}`);
  process.exit(1);
}
