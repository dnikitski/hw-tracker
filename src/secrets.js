import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { at } from './config.js';

const FILE = at('secrets.json');

// Windows DPAPI: the blob can only be decrypted by the same Windows user on the
// same machine, so secrets.json is useless if it is copied or leaked.
function dpapi(operation, base64) {
  if (process.platform !== 'win32') {
    throw new Error('Secret storage uses Windows DPAPI; other platforms are not supported yet.');
  }
  const script =
    'Add-Type -AssemblyName System.Security; ' +
    '$b = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()); ' +
    `[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::${operation}($b, $null, 'CurrentUser'))`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    input: base64,
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(`DPAPI ${operation} failed: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

export function loadSecrets() {
  if (!existsSync(FILE)) return {};
  const { blob } = JSON.parse(readFileSync(FILE, 'utf8'));
  return JSON.parse(Buffer.from(dpapi('Unprotect', blob), 'base64').toString('utf8'));
}

export function saveSecrets(secrets) {
  const blob = dpapi('Protect', Buffer.from(JSON.stringify(secrets), 'utf8').toString('base64'));
  writeFileSync(FILE, JSON.stringify({ blob }, null, 2));
}
