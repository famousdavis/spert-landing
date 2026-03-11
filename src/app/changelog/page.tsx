import Link from 'next/link';
import { ThemeToggle } from '@/components/ThemeToggle';
import { changelog } from '@/data/changelog';

export default function ChangelogPage() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-12 sm:px-8 md:py-16">
      <header className="mb-12 flex items-start justify-between">
        <div>
          <h1 className="mb-1 text-2xl font-bold sm:text-3xl md:text-[2.1rem]">
            <Link
              href="/"
              className="bg-gradient-to-r from-spert-blue-light to-spert-blue-dark bg-clip-text text-transparent hover:opacity-80 transition-opacity"
            >
              Statistical PERT
            </Link>
            <span className="text-zinc-400 dark:text-zinc-500 font-normal text-base sm:text-lg align-top">&reg;</span>
          </h1>
          <p className="text-sm italic text-zinc-500 dark:text-zinc-400">
            Estimation Made Easy&reg;
          </p>
        </div>
        <ThemeToggle />
      </header>

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

      <footer className="mt-16 border-t-2 border-zinc-100 pt-8 pb-6 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
        &copy; {new Date().getFullYear()} William W. Davis, MSPM, PMP
        {' | '}Version 1.2{' | '}Licensed under GNU GPL v3
        <div className="mt-2">
          <a href="/TOS.pdf" target="_blank" rel="noopener noreferrer" className="hover:text-blue-500 transition-colors">Terms of Service</a>
          {' | '}
          <a href="/PRIVACY.pdf" target="_blank" rel="noopener noreferrer" className="hover:text-blue-500 transition-colors">Privacy Policy</a>
        </div>
      </footer>
    </div>
  );
}
