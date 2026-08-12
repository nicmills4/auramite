import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Playwright must load from node_modules at runtime, not be bundled.
  serverExternalPackages: ["playwright", "playwright-core"],
};

export default nextConfig;
