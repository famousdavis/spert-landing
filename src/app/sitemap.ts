// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.
// See LICENSE file in the project root for full license text.

import type { MetadataRoute } from 'next';
// Relative, not '@/data/help': Vitest has no '@/' alias, and G6 in
// src/guards/help-center.test.ts imports and calls this function.
import { HELP_APPS } from '../data/help';
import { CONNECT_AI_PATH } from '../data/connectAi';

const ORIGIN = 'https://spertsuite.com';

/**
 * /sitemap.xml (2.13.0): the site's pages, and a Help Center page for each
 * LISTED app. An unlisted app's page (AHP, decision D2) is left out, and is
 * noindex. No lastModified: nothing here knows when a page last changed, and a
 * guessed date is worse than none. The guide PDFs live on the app subdomains,
 * so they are not listed here either.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const pages = ['/', '/help', CONNECT_AI_PATH, '/approval-kit', '/contact', '/training', '/security', '/changelog'];
  const help = HELP_APPS.filter((a) => a.listed).map((a) => `/help/${a.slug}`);
  return [...pages, ...help].map((path) => ({ url: `${ORIGIN}${path}` }));
}
