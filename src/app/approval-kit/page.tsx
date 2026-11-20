// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.
// See LICENSE file in the project root for full license text.

import type { Metadata } from 'next';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { APPROVAL_KIT, APPROVAL_KIT_BASE, type KitDocument } from '@/data/approvalKit';
import { LINK_CLASS, LIST_CLASS, SECTION_HEADING_CLASS, TEXT_CLASS } from '@/components/textStyles';

export const metadata: Metadata = {
  title: 'Approval Kit | SPERT® Suite',
};

const USE_LABEL: Record<KitDocument['use'], string> = {
  template: 'Yes: a template to fill in, then save as PDF',
  forward: 'No: no placeholders, forward the PDF as it is',
  read: 'No. Start here: your plan to get approval',
  example: 'No: an invented example of a finished request',
};

const ZIP_MEGABYTES = (APPROVAL_KIT.zip.bytes / 1_000_000).toFixed(1);

export default function ApprovalKitPage() {
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
          Approval Kit
        </h2>
        <p className={TEXT_CLASS}>
          {APPROVAL_KIT.documents.length} documents that help a project manager get the SPERT&reg;
          Suite approved for use at work. They support your organization&rsquo;s approval process; they are not legal,
          compliance or security advice.
        </p>

        <h3 className={SECTION_HEADING_CLASS}>Start here</h3>
        <ul className={LIST_CLASS}>
          <li>
            <strong className="font-semibold text-zinc-800 dark:text-zinc-200">
              Project managers:
            </strong>{' '}
            read the Guide first. It explains the approval process and gives the smallest set of
            documents for each kind of request.
          </li>
          <li>
            <strong className="font-semibold text-zinc-800 dark:text-zinc-200">Reviewers:</strong>{' '}
            start with the two-page Reviewer Summary, which points to the rest.
          </li>
        </ul>
        <p className={`mt-3 ${TEXT_CLASS}`}>
          Every document comes as a PDF and as a Word file. Templates are for you to complete: fill
          in the highlighted [PLACEHOLDERS] in the Word file, then save it as PDF. Their PDFs are
          reference copies. The other documents have no placeholders, so you can forward their PDFs
          as they are. This page always lists the current version, so check it before you submit.
        </p>

        <h3 className={SECTION_HEADING_CLASS}>The documents</h3>
        <ol className="space-y-3">
          {APPROVAL_KIT.documents.map((doc) => (
            <li
              key={doc.file}
              className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-700"
            >
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {doc.name}
                {doc.use === 'template' && (
                  <span className="ml-2 rounded bg-zinc-100 px-1.5 py-0.5 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                    Template
                  </span>
                )}
                <span className="ml-2 text-xs font-normal text-zinc-500 dark:text-zinc-400">
                  {doc.pages} pages
                </span>
              </p>
              <p className={`mt-1 ${TEXT_CLASS}`}>{doc.description}</p>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm text-zinc-600 dark:text-zinc-400">
                <dt className="font-medium text-zinc-700 dark:text-zinc-300">For</dt>
                <dd>{doc.audience}</dd>
                <dt className="font-medium text-zinc-700 dark:text-zinc-300">Fill it in?</dt>
                <dd>{USE_LABEL[doc.use]}</dd>
              </dl>
              {/* Static files, not routes, so plain links rather than next/link. Files the
                  browser displays open in a new tab, like the footer's PDFs; Word files and
                  the zip download, so they need none. */}
              <p className="mt-2 flex gap-4 text-sm">
                <a
                  href={`${APPROVAL_KIT_BASE}/${doc.file}.pdf`}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`${doc.name}, PDF`}
                  className={`${LINK_CLASS} font-semibold`}
                >
                  PDF
                </a>
                <a
                  href={`${APPROVAL_KIT_BASE}/${doc.file}.docx`}
                  aria-label={`${doc.name}, Word`}
                  className={`${LINK_CLASS} font-semibold`}
                >
                  Word
                </a>
              </p>
            </li>
          ))}
        </ol>

        <h3 className={SECTION_HEADING_CLASS}>The whole kit</h3>
        <p className={TEXT_CLASS}>
          All {APPROVAL_KIT.documents.length * 2} files, with a README and checksums:{' '}
          <a
            href={`${APPROVAL_KIT_BASE}/${APPROVAL_KIT.zip.file}`}
            className={`${LINK_CLASS} font-semibold`}
          >
            {APPROVAL_KIT.zip.file}
          </a>{' '}
          ({ZIP_MEGABYTES} MB).
        </p>
        <p className={`mt-3 ${TEXT_CLASS}`}>
          Its SHA-256 checksum is{' '}
          <code className="font-mono text-xs break-all">{APPROVAL_KIT.zip.sha256}</code>. The
          checksums of the individual files are in{' '}
          <a
            href={`${APPROVAL_KIT_BASE}/checksums.txt`}
            target="_blank"
            rel="noopener noreferrer"
            className={LINK_CLASS}
          >
            checksums.txt
          </a>
          .
        </p>

        <h3 className={SECTION_HEADING_CLASS}>Version and contact</h3>
        <p className={TEXT_CLASS}>
          Approval Kit v{APPROVAL_KIT.version} &middot; content reviewed {APPROVAL_KIT.reviewed}
        </p>
        <p className={`mt-3 ${TEXT_CLASS}`}>
          Earlier versions stay at their own addresses, so links in documents already sent keep
          working: {APPROVAL_KIT.earlier.map((v, i) => (
            <span key={v}>
              {i > 0 && ', '}
              <a
                href={`/approval-kit/v${v}/SPERT-Suite-Approval-Kit-v${v}.zip`}
                className={LINK_CLASS}
              >
                v{v} (zip)
              </a>
            </span>
          ))}
          .
        </p>
        <p className={`mt-3 ${TEXT_CLASS}`}>
          Questions about the kit:{' '}
          <a href="mailto:contact@spertsuite.com" className={`${LINK_CLASS} font-semibold`}>
            contact@spertsuite.com
          </a>
          . To report a security issue, see{' '}
          <Link href="/security" className={LINK_CLASS}>
            Security
          </Link>
          .
        </p>
      </main>

      <Footer />
    </div>
  );
}
