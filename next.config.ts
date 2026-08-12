import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Playwright must load from node_modules at runtime, not be bundled.
  serverExternalPackages: ["playwright", "playwright-core"],

  async redirects() {
    return [
      // /account was split into /dashboard + /settings. This stays indefinitely:
      // magic-link emails already in people's inboxes carry callbackUrl=/account,
      // as do Stripe sessions created before the split. Do not "clean this up".
      // Order matters — the checkout rule must be matched first. Unmatched query
      // params (checkout, session_id) are forwarded automatically.
      {
        source: "/account",
        has: [{ type: "query", key: "checkout" }],
        destination: "/settings",
        permanent: false,
      },
      { source: "/account", destination: "/dashboard", permanent: false },
    ];
  },
};

export default nextConfig;
