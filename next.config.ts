import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Surfaces type errors at build time rather than letting a broken deploy
  // reach production looking healthy. (Next 16 dropped the `eslint` key —
  // linting is now a separate step, not part of `next build`.)
  typescript: { ignoreBuildErrors: false },
};

export default nextConfig;
