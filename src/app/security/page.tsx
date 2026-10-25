// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.
// See LICENSE file in the project root for full license text.

import type { Metadata } from 'next';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';

export const metadata: Metadata = {
  title: 'Security | SPERT® Suite',
};

/**
 * Body links are underlined so they don't rely on colour alone, and use the
 * 600/400 blues, which meet WCAG AA on this page's light and dark backgrounds.
 */
const LINK_CLASS =
  'text-blue-600 underline underline-offset-2 transition-colors hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300';

const SECTION_HEADING_CLASS = 'mt-8 mb-2 text-lg font-semibold text-spert-blue';
const TEXT_CLASS = 'text-sm leading-relaxed text-zinc-600 dark:text-zinc-400';
const LIST_CLASS = 'list-disc pl-6 space-y-1 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400';

/** Each repository has GitHub's private vulnerability reporting enabled. */
const REPOSITORIES = [
  { app: 'spertsuite.com and the Connect AI server', repo: 'famousdavis/spert-landing' },
  { app: 'SPERT® Scheduler', repo: 'famousdavis/spert-scheduler' },
  { app: 'SPERT® Story Map', repo: 'famousdavis/spert-story-map' },
  { app: 'SPERT® Forecaster', repo: 'famousdavis/spert-forecaster' },
  { app: 'GanttApp™', repo: 'famousdavis/GanttApp' },
  { app: 'SPERT® CFD', repo: 'famousdavis/spert-cfd' },
  { app: 'MyScrumBudget™', repo: 'famousdavis/myscrumbudget-web' },
  { app: 'SPERT® AHP', repo: 'spert-suite/spert-ahp' },
];

export default function SecurityPage() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-12 sm:px-8 md:py-16">
      <Header linkHome />

      <main id="main-content" className="max-w-2xl">
        <Link
          href="/"
          className="mb-6 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 transition-colors"
        >
          &larr; Back to apps
        </Link>

        <h2 className="mb-2 text-xl font-bold text-zinc-900 dark:text-zinc-100">
          Security
        </h2>
        <p className={TEXT_CLASS}>
          If you believe you have found a security vulnerability in spertsuite.com or in any
          SPERT&reg; Suite app, please report it privately. Please don&rsquo;t report it in a
          public issue, discussion or post.
        </p>

        <h3 className={SECTION_HEADING_CLASS}>How to report</h3>
        <p className={TEXT_CLASS}>
          Email{' '}
          <a href="mailto:security@spertsuite.com" className={`${LINK_CLASS} font-semibold`}>
            security@spertsuite.com
          </a>
          .
        </p>
        <p className={`mt-3 ${TEXT_CLASS}`}>
          Or use GitHub&rsquo;s private vulnerability reporting on the repository for the app
          concerned:
        </p>
        <ul className={`mt-2 ${LIST_CLASS}`}>
          {REPOSITORIES.map(({ app, repo }) => (
            <li key={repo}>
              <a
                href={`https://github.com/${repo}/security/advisories/new`}
                target="_blank"
                rel="noopener noreferrer"
                className={LINK_CLASS}
              >
                {app}
              </a>
              {' — '}
              <code className="font-mono text-xs whitespace-nowrap">{repo}</code>
            </li>
          ))}
        </ul>

        <h3 className={SECTION_HEADING_CLASS}>What to include</h3>
        <ul className={LIST_CLASS}>
          <li>which site or app is affected, and the address of the page;</li>
          <li>what the problem is, and what someone could do with it;</li>
          <li>the steps to reproduce it, using your own account and your own data;</li>
          <li>how to reach you, and whether you would like to be credited.</li>
        </ul>
        <p className={`mt-3 ${TEXT_CLASS}`}>
          Please don&rsquo;t include anyone else&rsquo;s personal data in a report.
        </p>

        <h3 className={SECTION_HEADING_CLASS}>What happens next</h3>
        <ul className={LIST_CLASS}>
          <li>We aim to acknowledge your report within 3 business days.</li>
          <li>
            We will keep you informed while we investigate and fix it, and credit you if you wish.
          </li>
          <li>
            When a fixed issue could have affected users&rsquo; data, we publish a short security
            advisory after the fix is deployed.
          </li>
        </ul>
        <p className={`mt-3 ${TEXT_CLASS}`}>
          The SPERT&reg; Suite does not run a paid bug bounty.
        </p>

        <h3 className={SECTION_HEADING_CLASS}>Scope</h3>
        <p className={TEXT_CLASS}>
          In scope: spertsuite.com, the SPERT&reg; Suite apps at spertsuite.com addresses, and the
          SPERT&reg; Suite&rsquo;s own server code, including the Connect AI server.
        </p>
        <p className={`mt-3 ${TEXT_CLASS}`}>Out of scope:</p>
        <ul className={`mt-1 ${LIST_CLASS}`}>
          <li>
            the platforms the suite runs on, such as Google Cloud and Firebase, Vercel, Microsoft,
            GitHub and Resend (please report those to the provider);
          </li>
          <li>testing against other people&rsquo;s accounts or data;</li>
          <li>denial-of-service, load or volume testing;</li>
          <li>social engineering and phishing.</li>
        </ul>

        <h3 className={SECTION_HEADING_CLASS}>Privacy</h3>
        <p className={TEXT_CLASS}>
          For privacy questions, or requests about your data, email{' '}
          <a href="mailto:privacy@spertsuite.com" className={`${LINK_CLASS} font-semibold`}>
            privacy@spertsuite.com
          </a>
          .
        </p>
        <p className={`mt-3 ${TEXT_CLASS}`}>
          This information is also published in machine-readable form at{' '}
          {/* A static file, not a route, so a plain link rather than next/link. */}
          <a href="/.well-known/security.txt" className={LINK_CLASS}>
            /.well-known/security.txt
          </a>{' '}
          (RFC 9116).
        </p>
      </main>

      <Footer />
    </div>
  );
}
