// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.
// See LICENSE file in the project root for full license text.

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      // Stable, permanent legal-doc URLs — referenced by the Privacy Policy,
      // ToS, and the Connect AI consent modal in the SPERT apps. Do not remove.
      { source: "/ai-privacy", destination: "/AI-PRIVACY.pdf" },
      { source: "/ai-consent-notice", destination: "/AI-CONSENT.pdf" },
      // Compatibility alias. Privacy Policy editions before v1.1 cited the
      // unhyphenated /aiprivacy, which never resolved. v1.1 corrected the text,
      // but copies of the older PDF are already in circulation and cannot be
      // recalled, so this keeps their link working. Do not remove.
      { source: "/aiprivacy", destination: "/AI-PRIVACY.pdf" },
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
