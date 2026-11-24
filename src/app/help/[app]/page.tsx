// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.
// See LICENSE file in the project root for full license text.

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { formatName } from '@/components/formatName';
import { DataAndPrivacy, PdfLink, StillStuck } from '@/components/HelpSections';
import { LINK_CLASS, SECTION_HEADING_CLASS, TEXT_CLASS } from '@/components/textStyles';
import { CONNECT_AI_PATH } from '@/data/connectAi';
import { HELP_APPS, connectAiGuide, guideUrl, helpRobots, type HelpApp, type HelpGuide } from '@/data/help';

/**
 * /help/<slug>: one page per app in HELP_APPS, every one built at build time.
 * The slugs are a published contract (the apps link here); see G1 in
 * src/guards/help-center.test.ts before renaming one.
 */

// An unknown slug is a 404, not a page rendered on demand.
export const dynamicParams = false;

export function generateStaticParams() {
  return HELP_APPS.map((a) => ({ app: a.slug }));
}

type Props = { params: Promise<{ app: string }> };

function findApp(slug: string): HelpApp | undefined {
  return HELP_APPS.find((a) => a.slug === slug);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const app = findApp((await params).app);
  if (!app) return {};
  return {
    title: `${app.name} Help | SPERT® Suite`,
    description: `Guides for ${app.name}, and how to get help when they don’t answer your question.`,
    // Per page, never in layout.tsx, where it would spread to every page.
    alternates: { canonical: `/help/${app.slug}` },
    // D2: an unlisted app's page is noindex. G12 checks the function AND this call.
    robots: helpRobots(app),
  };
}

function GuideItem({ app, guide }: { app: HelpApp; guide: HelpGuide }) {
  return (
    <li className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-700">
      <PdfLink href={guideUrl(app, guide)} className={`${LINK_CLASS} font-semibold`}>
        {guide.title}
      </PdfLink>
      <p className={`mt-1 ${TEXT_CLASS}`}>{guide.description}</p>
    </li>
  );
}

export default async function AppHelpPage({ params }: Props) {
  const app = findApp((await params).app);
  if (!app) notFound();

  const name = formatName(app.name);
  const start = app.guides.find((g) => g.startHere);
  const more = app.guides.filter((g) => g !== start);

  return (
    <div className="mx-auto max-w-5xl px-6 py-12 sm:px-8 md:py-16">
      <Header linkHome />

      <main id="main-content" className="max-w-2xl">
        <Link
          href="/help"
          className="mb-6 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 transition-colors"
        >
          &larr; Help Center
        </Link>

        <h2 className="mb-2 text-xl font-bold text-zinc-900 dark:text-zinc-100">{name} help</h2>
        <p className={TEXT_CLASS}>{app.summary}</p>
        {/* Same tab, on purpose: a second copy of an app in another tab can overwrite its data. */}
        <p className={`mt-3 ${TEXT_CLASS}`}>
          <a href={app.appUrl} className={`${LINK_CLASS} font-semibold`}>
            Open {name}
          </a>
        </p>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Already using it? Switch back to its tab.</p>

        {app.guides.length === 0 ? (
          // The note replaces both the guide list and the About pointer: it points to About itself.
          <p className={`mt-6 ${TEXT_CLASS}`}>{app.noGuideNote}</p>
        ) : (
          <>
            {start && (
              <section>
                <h3 className={SECTION_HEADING_CLASS}>Start here</h3>
                <ul className="space-y-3">
                  <GuideItem app={app} guide={start} />
                </ul>
              </section>
            )}
            {more.length > 0 && (
              <section>
                <h3 className={SECTION_HEADING_CLASS}>{start ? 'More guides' : 'Guides'}</h3>
                <ul className="space-y-3">
                  {more.map((g) => (
                    <GuideItem key={g.file} app={app} guide={g} />
                  ))}
                </ul>
              </section>
            )}
            {connectAiGuide(app) && (
              <p className={`mt-6 ${TEXT_CLASS}`}>
                Using Connect AI for the first time? Start by adding SPERT Suite to your AI assistant:{' '}
                <Link href={CONNECT_AI_PATH} className={LINK_CLASS}>
                  Connect your AI assistant
                </Link>
                .
              </p>
            )}
            <p className={`mt-6 ${TEXT_CLASS}`}>
              Inside {name}, the About page also explains how the app works.
            </p>
          </>
        )}

        <DataAndPrivacy />
        <StillStuck appName={name} />
      </main>

      <Footer />
    </div>
  );
}
