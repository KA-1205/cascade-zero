import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
