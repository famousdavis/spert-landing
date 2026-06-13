import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      // Stable, permanent legal-doc URLs — referenced by the Privacy Policy,
      // ToS, and the Connect AI consent modal in the SPERT apps. Do not remove.
      { source: "/ai-privacy", destination: "/AI-PRIVACY.pdf" },
      { source: "/ai-consent-notice", destination: "/AI-CONSENT.pdf" },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "X-DNS-Prefetch-Control", value: "on" },
        ],
      },
    ];
  },
};

export default nextConfig;
