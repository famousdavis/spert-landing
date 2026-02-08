import type { AppInfo } from '@/data/apps';

const MARK_STYLE = "text-xs font-normal text-zinc-400 dark:text-zinc-500 align-super";

function formatName(name: string) {
  // Split on ® and ™ while keeping the delimiter
  const tokens = name.split(/(®|™)/);
  if (tokens.length === 1) return <>{name}</>;
  return (
    <>
      {tokens.map((token, i) =>
        token === '®' || token === '™' ? (
          <span key={i} className={MARK_STYLE}>{token}</span>
        ) : (
          <span key={i}>{token}</span>
        )
      )}
    </>
  );
}

export function AppTile({ app }: { app: AppInfo }) {
  return (
    <a
      href={app.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group block rounded-xl border border-zinc-200 bg-white shadow-sm transition-all duration-200 hover:-translate-y-1 hover:shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
    >
      <div
        className="h-2 rounded-t-xl"
        style={{ backgroundColor: app.color }}
      />
      <div className="p-6">
        <div className="mb-3 text-4xl">{app.icon}</div>
        <h2 className="mb-1 text-lg font-bold text-zinc-900 dark:text-zinc-100">
          {formatName(app.name)}
        </h2>
        <p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">
          {app.description}
        </p>
        <span
          className="inline-flex items-center gap-1 text-sm font-medium transition-colors"
          style={{ color: app.color }}
        >
          Open App
          <span className="transition-transform duration-200 group-hover:translate-x-1">
            &rarr;
          </span>
        </span>
      </div>
    </a>
  );
}
