import { apps } from '@/data/apps';
import { AppTile } from '@/components/AppTile';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';

export default function Home() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-12 sm:px-8 md:py-16">
      <Header />

      <main id="main-content">
        <h2 className="mb-3 text-2xl font-bold text-zinc-900 dark:text-zinc-100 sm:text-3xl">
          Give stakeholders forecasts you can defend — not single-point guesses.
        </h2>
        <p className="mb-2 max-w-2xl text-zinc-700 dark:text-zinc-300">
          Simulation-based forecasting for schedules, delivery, and budgets — you bring the judgment, the math is already done.
        </p>
        <p className="mb-8 text-sm text-zinc-500 dark:text-zinc-400">
          No sign-up required to get started.
        </p>

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {apps
            .filter((app) => (app.category ?? 'app') === 'app')
            .map((app) => (
              <AppTile key={app.url} app={app} />
            ))}
        </div>

        <section className="mt-12">
          <h2 className="mb-4 text-lg font-bold text-zinc-900 dark:text-zinc-100">
            Support
          </h2>
          <div className="grid gap-6 sm:grid-cols-3">
            {apps
              .filter((app) => app.category === 'support')
              .map((app) => (
                <AppTile key={app.url} app={app} />
              ))}
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
