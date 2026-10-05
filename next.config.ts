import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Surfaces type errors at build time rather than letting a broken deploy
  // reach production looking healthy. (Next 16 dropped the `eslint` key —
  // linting is now a separate step, not part of `next build`.)
  typescript: { ignoreBuildErrors: false },

  // The Python API. On Vercel, vercel.json routes /api/py/* to the Python
  // function before Next.js sees the request. Locally there is no such
  // layer, so `next dev` forwards to uvicorn (`npm run dev:api`, port 8000).
  async rewrites() {
    if (process.env.NODE_ENV !== "development") return [];
    return [{ source: "/api/py/:path*", destination: "http://127.0.0.1:8000/api/py/:path*" }];
  },
};

export default nextConfig;
