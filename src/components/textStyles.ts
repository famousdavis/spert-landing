// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.
// See LICENSE file in the project root for full license text.

/**
 * Body text styles shared by the Approval Kit and the Help Center pages.
 *
 * ⚠️ TWO PAGES STILL KEEP THEIR OWN COPIES of some of these strings, byte for
 * byte: src/app/security/page.tsx (all four) and src/app/contact/page.tsx
 * (LINK_CLASS). A restyle made here does not reach them. Moving them onto this
 * module was deferred in 2.13.0 to keep that release's style move to the two
 * pages it measured; do it on the next edit to either page.
 */

/**
 * Body links are underlined so they don't rely on colour alone, and use the
 * 600/400 blues, which meet WCAG AA on these pages' light and dark backgrounds.
 */
export const LINK_CLASS =
  'text-blue-600 underline underline-offset-2 transition-colors hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300';

export const SECTION_HEADING_CLASS = 'mt-8 mb-2 text-lg font-semibold text-spert-blue';
export const TEXT_CLASS = 'text-sm leading-relaxed text-zinc-600 dark:text-zinc-400';
export const LIST_CLASS = 'list-disc pl-6 space-y-1 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400';
