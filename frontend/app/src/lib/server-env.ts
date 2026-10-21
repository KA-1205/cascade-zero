import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Parse dotenv file contents into key/value pairs. Shared by the Next config
 * and the server routes so both read .env files exactly the same way.
 * Surrounding quotes are stripped per dotenv convention; comments and lines
 * without `=` are skipped.
 */
export function parseEnvFile(contents: string): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  for (const line of contents.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const key = trimmed.slice(0, trimmed.indexOf('=')).trim();
    let value = trimmed.slice(trimmed.indexOf('=') + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"'))
        || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && value) entries.push([key, value]);
  }
  return entries;
}

let loaded = false;

/**
 * Load the repo-root .env into process.env for server routes. Called by the
 * approval/backtest proxies so the sandbox token works regardless of how the
 * dev server was started. Values already in the environment win.
 */
export function loadRootEnv(): void {
  if (loaded) return;
  loaded = true;
  for (const candidate of [resolve(process.cwd(), '../../.env'), resolve(process.cwd(), '.env')]) {
    if (!existsSync(candidate)) continue;
    for (const [key, value] of parseEnvFile(readFileSync(candidate, 'utf8'))) {
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}
