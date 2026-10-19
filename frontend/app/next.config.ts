import type { NextConfig } from "next";

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
