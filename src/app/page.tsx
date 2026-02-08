import { apps } from '@/data/apps';
import { AppTile } from '@/components/AppTile';
import { ThemeToggle } from '@/components/ThemeToggle';

export default function Home() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-12 sm:px-8 md:py-16">
      <header className="mb-12 flex items-start justify-between">
        <div>
          <h1 className="mb-1 text-2xl font-bold sm:text-3xl md:text-[2.1rem]">
            <span className="bg-gradient-to-r from-spert-blue-light to-spert-blue-dark bg-clip-text text-transparent">
              Statistical PERT
            </span>
            <span className="text-zinc-400 dark:text-zinc-500 font-normal text-base sm:text-lg align-top">&reg;</span>
          </h1>
          <p className="text-sm italic text-zinc-500 dark:text-zinc-400">
            Estimation Made Easy&reg;
          </p>
        </div>
        <ThemeToggle />
      </header>

      <main id="main-content">
        <p className="mb-8 max-w-2xl text-zinc-600 dark:text-zinc-400">
          Free, browser-based tools for project managers, Scrum Masters, and all other project practitioners. No sign-up required
          &mdash; your data stays on your device.
        </p>

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {apps.map((app) => (
            <AppTile key={app.url} app={app} />
          ))}
        </div>
      </main>

      <footer className="mt-16 border-t-2 border-zinc-100 pt-8 pb-6 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
        &copy; {new Date().getFullYear()} William W. Davis, MSPM, PMP
        {' | '}Version 1.0{' | '}Licensed under GNU GPL v3
      </footer>
    </div>
  );
}
