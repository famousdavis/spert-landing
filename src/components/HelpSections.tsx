// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.
// See LICENSE file in the project root for full license text.

import Link from 'next/link';
import type { ReactNode } from 'react';
import { LINK_CLASS, SECTION_HEADING_CLASS, TEXT_CLASS, LIST_CLASS } from '@/components/textStyles';

/**
 * Parts shared by the Help Center's hub (/help) and its app pages (/help/<slug>).
 *
 * New-tab rule (2.13.0): every link these pages open in a new tab says so — a
 * visible cue for sighted readers, and visually hidden text that a screen reader
 * announces as part of the link's name. Links between the help pages and the
 * apps stay in the same tab, so a reader never ends up with two copies of an app.
 */

/** A link to a PDF, opened in a new tab, that says so both visibly and to a screen reader. */
export function PdfLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className ?? LINK_CLASS}>
      {children}
      {/* inline-block stops the link's underline running through the cue */}
      <span aria-hidden="true" className="ml-1 inline-block text-xs font-normal">
        (PDF&nbsp;&#8599;)
      </span>
      <span className="sr-only"> (PDF, opens in a new tab)</span>
    </a>
  );
}

/** "Your data and privacy": links only, never a restatement of what the documents say. */
export function DataAndPrivacy() {
  return (
    <section>
      <h3 className={SECTION_HEADING_CLASS}>Your data and privacy</h3>
      <ul className={LIST_CLASS}>
        <li>
          <PdfLink href="/TOS.pdf">Terms of Service</PdfLink>
        </li>
        <li>
          <PdfLink href="/PRIVACY.pdf">Privacy Policy</PdfLink>
        </li>
        <li>
          <PdfLink href="/ai-privacy">AI Privacy Notice</PdfLink>
        </li>
      </ul>
    </section>
  );
}

/** "Still stuck?". On an app page it names the app, so the message arrives saying which one. */
export function StillStuck({ appName }: { appName?: ReactNode }) {
  return (
    <section>
      <h3 className={SECTION_HEADING_CLASS}>Still stuck?</h3>
      <p className={TEXT_CLASS}>
        <Link href="/contact" className={`${LINK_CLASS} font-semibold`}>
          Send me a message
        </Link>
        {appName ? (
          <>. Say you&rsquo;re using {appName} and what you were trying to do.</>
        ) : (
          <>, and say which app you&rsquo;re using and what you were trying to do.</>
        )}
      </p>
    </section>
  );
}
