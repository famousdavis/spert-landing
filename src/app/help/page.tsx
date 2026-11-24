// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.
// See LICENSE file in the project root for full license text.

import type { Metadata } from 'next';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { formatName } from '@/components/formatName';
import { DataAndPrivacy, StillStuck } from '@/components/HelpSections';
import { LINK_CLASS, SECTION_HEADING_CLASS, TEXT_CLASS, LIST_CLASS } from '@/components/textStyles';
import { apps } from '@/data/apps';
import { CONNECT_AI_PATH } from '@/data/connectAi';
import { HELP_APPS, connectAiGuide } from '@/data/help';

export const metadata: Metadata = {
  title: 'Help Center | SPERT® Suite',
  description: 'Guides for each SPERT® Suite app, and how to get help when they don’t answer your question.',
  // Per page, never in layout.tsx, where it would spread to every page.
  alternates: { canonical: '/help' },
};

/** "2 guides", or, for an app with none, where its explanation lives instead (G3 keeps the two in step). */
function guideCount(count: number): string {
  if (count === 0) return 'Explained in the app';
  return count === 1 ? '1 guide' : `${count} guides`;
}

export default function HelpCenterPage() {
  const listed = HELP_APPS.filter((a) => a.listed);
  // Short names ("Story Map"), from the apps that publish a Connect AI guide.
  const connectAiApps = HELP_APPS.filter((a) => connectAiGuide(a)).map((a) => a.name.replace(/^SPERT® /, ''));
  const connectAiNames =
    connectAiApps.length > 1
      ? `${connectAiApps.slice(0, -1).join(', ')} and ${connectAiApps[connectAiApps.length - 1]}`
      : connectAiApps.join('');
  const training = apps.find((a) => a.url === '/training');
  const approvalKit = apps.find((a) => a.url === '/approval-kit');

  return (
    <div className="mx-auto max-w-5xl px-6 py-12 sm:px-8 md:py-16">
      <Header linkHome />

      <main id="main-content" className="max-w-3xl">
        <Link
          href="/"
          className="mb-6 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 transition-colors"
        >
          &larr; Back to apps
        </Link>

        <h2 className="mb-2 text-xl font-bold text-zinc-900 dark:text-zinc-100">Help Center</h2>
        <p className={TEXT_CLASS}>
          Guides for each SPERT&reg; Suite app. If they don&rsquo;t answer your question,{' '}
          <Link href="/contact" className={LINK_CLASS}>
            send me a message
          </Link>
          .
        </p>

        <Link
          href={CONNECT_AI_PATH}
          className="mt-6 block rounded-lg border border-zinc-300 bg-zinc-50 p-4 transition-colors hover:border-zinc-500 dark:border-zinc-600 dark:bg-zinc-900 dark:hover:border-zinc-400"
        >
          <span className="block text-base font-semibold text-zinc-900 dark:text-zinc-100">
            Connect your AI assistant
          </span>
          <span className={`mt-1 block ${TEXT_CLASS}`}>
            Using Connect AI? Add SPERT Suite to Claude, ChatGPT, Gemini, Grok or Copilot once, then use it in{' '}
            {connectAiNames}.
          </span>
        </Link>

        <ul className="mt-4 grid gap-4 sm:grid-cols-2">
          {listed.map((app) => (
            <li key={app.slug}>
              <Link
                href={`/help/${app.slug}`}
                className="block h-full rounded-lg border border-zinc-200 p-4 transition-colors hover:border-zinc-400 dark:border-zinc-700 dark:hover:border-zinc-500"
              >
                <span className="block text-base font-semibold text-zinc-900 dark:text-zinc-100">
                  {formatName(app.name)}
                </span>
                <span className={`mt-1 block ${TEXT_CLASS}`}>{app.summary}</span>
                <span className="mt-2 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  {guideCount(app.guides.length)}
                </span>
              </Link>
            </li>
          ))}
        </ul>

        <DataAndPrivacy />
        <StillStuck />

        {training && approvalKit && (
          <section>
            <h3 className={SECTION_HEADING_CLASS}>Training and approval</h3>
            <ul className={LIST_CLASS}>
              <li>
                <Link href={training.url} className={LINK_CLASS}>
                  {training.linkLabel}
                </Link>
                : {training.description}
              </li>
              <li>
                <Link href={approvalKit.url} className={LINK_CLASS}>
                  {approvalKit.name}
                </Link>
                : {formatName(approvalKit.description)}
              </li>
            </ul>
          </section>
        )}
      </main>

      <Footer />
    </div>
  );
}
