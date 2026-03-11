import { apps } from '@/data/apps';
import { AppTile } from '@/components/AppTile';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';

export default function Home() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-12 sm:px-8 md:py-16">
      <Header />

      <main id="main-content">
        <p className="mb-8 max-w-2xl text-zinc-600 dark:text-zinc-400">
          Free, browser-based tools for project managers, Scrum Masters, and all other project practitioners. No sign-up required
          to get started.
        </p>

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {apps.map((app) => (
            <AppTile key={app.url} app={app} />
          ))}
        </div>
      </main>

      <Footer />
    </div>
  );
}
