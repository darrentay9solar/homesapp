import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Surfaces type and lint errors at build time rather than letting a broken
  // deploy reach production looking healthy.
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: false },
};

export default nextConfig;
