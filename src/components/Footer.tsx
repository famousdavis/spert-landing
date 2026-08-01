// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.
// See LICENSE file in the project root for full license text.

import Link from 'next/link';
import { APP_VERSION } from '@/config';

interface FooterProps {
  /** When true, the version text links to /changelog. Default: true. Set false on the changelog page. */
  linkVersion?: boolean;
}

export function Footer({ linkVersion = true }: FooterProps) {
  const versionText = `Version ${APP_VERSION}`;

  return (
    <footer className="mt-16 border-t-2 border-zinc-100 pt-8 pb-6 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
      &copy; {new Date().getFullYear()} William W. Davis, MSPM, PMP
      {' | '}
      {linkVersion ? (
        <Link
          href="/changelog"
          className="text-blue-500 hover:text-blue-600 transition-colors"
        >
          {versionText}
        </Link>
      ) : (
        versionText
      )}
      {' | '}Licensed under GNU GPL v3
      <div className="mt-2">
        <a
          href="/TOS.pdf"
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-500 hover:text-blue-600 transition-colors"
        >
          Terms of Service
        </a>
        {' | '}
        <a
          href="/PRIVACY.pdf"
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-500 hover:text-blue-600 transition-colors"
        >
          Privacy Policy
        </a>
        {' | '}
        <a
          href="/ai-privacy"
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-500 hover:text-blue-600 transition-colors"
        >
          AI Privacy Notice
        </a>
        {' | '}
        <a
          href="https://github.com/famousdavis/spert-landing/blob/main/LICENSE"
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-500 hover:text-blue-600 transition-colors"
        >
          License
        </a>
      </div>
    </footer>
  );
}
