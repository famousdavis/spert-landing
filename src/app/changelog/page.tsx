import Link from 'next/link';
import { changelog } from '@/data/changelog';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';

export default function ChangelogPage() {
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
          Changelog
        </h2>
        <p className="mb-8 text-sm text-zinc-500 dark:text-zinc-400">
          Complete version history of the Statistical PERT&reg; Landing Page.
        </p>

        {changelog.map((entry, index) => (
          <div key={entry.version} className={index > 0 ? 'mt-8' : undefined}>
            <h3 className="mb-1 text-lg text-spert-blue">
              <span className="font-semibold">v{entry.version}</span>
              <span className="ml-3 text-sm font-normal text-zinc-400 dark:text-zinc-500">
                {entry.date}
              </span>
            </h3>
            {entry.sections.map((section) => (
              <div key={section.heading} className="mt-2">
                <h4 className="mb-1 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
                  {section.heading}
                </h4>
                <ul className="list-disc pl-6 space-y-1 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                  {section.items.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ))}
      </main>

      <Footer linkVersion={false} />
    </div>
  );
}
