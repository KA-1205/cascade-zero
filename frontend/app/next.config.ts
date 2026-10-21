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
  // Same-origin proxy for the live API (decision D-0039): the backend binds
  // loopback only and sends no CORS headers, so the browser must reach it
  // through the Next server. The live transport calls `/v1/*` on this origin
  // and the rewrite forwards to CASCADE_API_ORIGIN. SSE streams through this
  // proxy unchanged.
  async rewrites() {
    const origin = process.env.CASCADE_API_ORIGIN ?? 'http://127.0.0.1:8000';
    return [
      {
        source: '/v1/:path*',
        destination: `${origin}/v1/:path*`,
      },
    ];
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
