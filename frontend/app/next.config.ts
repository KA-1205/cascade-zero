import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { NextConfig } from "next";
import { parseEnvFile } from "./src/lib/server-env";

// Load the repo-root .env (GEMINI_API_KEY docs, approval token, API origin)
// into the server process so the dev server needs no extra shell env. Values
// already present in the environment win. A fresh clone without .env must
// still boot, hence the existence check.
const rootEnv = resolve(__dirname, '../../.env');
if (existsSync(rootEnv)) {
  for (const [key, value] of parseEnvFile(readFileSync(rootEnv, 'utf8'))) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: '/:path*', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Referrer-Policy', value: 'same-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
    ] }];
  },
  // Cascade Zero is an always-dynamic SRE operator console.
  // cacheComponents + partialPrefetching caused prerender conflicts with
  // runtime values (Date.now(), usePathname) — disabled intentionally.
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
