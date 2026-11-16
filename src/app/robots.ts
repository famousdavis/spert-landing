// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.
// See LICENSE file in the project root for full license text.

import type { MetadataRoute } from 'next';

/**
 * /robots.txt (2.13.0). Every crawler is allowed, as it was when the site served
 * no robots.txt at all; this adds only the sitemap's address (decision D3,
 * 2026-11-16).
 *
 * It governs spertsuite.com alone. The guide PDFs are served from the app
 * subdomains, each of which answers for its own /robots.txt, so nothing here
 * can allow or block them.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/' },
    sitemap: 'https://spertsuite.com/sitemap.xml',
  };
}
