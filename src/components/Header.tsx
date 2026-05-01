import Link from 'next/link';
import { ThemeToggle } from '@/components/ThemeToggle';

interface HeaderProps {
  /** When true, the title becomes a link back to "/". Use on subpages. */
  linkHome?: boolean;
}

export function Header({ linkHome = false }: HeaderProps) {
  return (
    <header className="mb-12 flex items-start justify-between">
      <div>
        <div className="mb-1 flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/spert-favicon-landing.png"
            alt=""
            className="mr-2 h-7 w-7 rounded-lg ring-1 ring-white/20 block dark:hidden"
          />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/spert-favicon-landing-dark.png"
            alt=""
            className="mr-2 h-7 w-7 rounded-lg ring-1 ring-white/20 hidden dark:block"
          />
        <h1 className="text-2xl font-bold sm:text-3xl md:text-[2.1rem]">
          {linkHome ? (
            <>
              <Link
                href="/"
                className="bg-gradient-to-r from-spert-blue-light to-spert-blue-dark bg-clip-text text-transparent hover:opacity-80 transition-opacity"
              >
                SPERT
              </Link>
              <span className="text-zinc-400 dark:text-zinc-500 font-normal text-xs align-top">&reg;</span>
              <Link
                href="/"
                className="bg-gradient-to-r from-spert-blue-light to-spert-blue-dark bg-clip-text text-transparent hover:opacity-80 transition-opacity"
              >
                {' '}Suite
              </Link>
            </>
          ) : (
            <>
              <span className="bg-gradient-to-r from-spert-blue-light to-spert-blue-dark bg-clip-text text-transparent">
                SPERT
              </span>
              <span className="text-zinc-400 dark:text-zinc-500 font-normal text-xs align-top">&reg;</span>
              <span className="bg-gradient-to-r from-spert-blue-light to-spert-blue-dark bg-clip-text text-transparent">
                {' '}Suite
              </span>
            </>
          )}
        </h1>
        </div>
        <p className="text-sm italic text-zinc-500 dark:text-zinc-400">
          Estimation Made Easy<span className="text-[0.6em] align-top">&reg;</span>
        </p>
      </div>
      <ThemeToggle />
    </header>
  );
}
