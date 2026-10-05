import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const at = (...parts) => path.join(ROOT, ...parts);

export function loadConfig() {
  const file = at('config.json');
  if (!existsSync(file)) {
    throw new Error('config.json not found. Copy config.example.json to config.json and fill it in.');
  }
  return JSON.parse(readFileSync(file, 'utf8'));
}

// Task Scheduler throws console output away, so every line also goes to logs/.
export function log(...args) {
  const line = args.join(' ');
  console.log(line);
  mkdirSync(at('logs'), { recursive: true });
  const now = new Date();
  appendFileSync(at('logs', `${now.toISOString().slice(0, 7)}.log`), `${now.toISOString()} ${line}\n`);
}
