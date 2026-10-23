/**
 * Parse dotenv file contents into key/value pairs for next.config.ts.
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
