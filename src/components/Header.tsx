// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.
// See LICENSE file in the project root for full license text.

import Link from 'next/link';
import { ThemeToggle } from '@/components/ThemeToggle';

interface HeaderProps {
  /** When true, the title becomes a link back to "/". Use on subpages. */
  linkHome?: boolean;
}

/**
 * The title's two words, SPERT and Suite, each drawn as a gradient in the suite's navy: the favicon's
 * #1e3a8a (HDR26, v2.14.2). Every point of each gradient is at least 3 : 1 on the page behind it, in
 * both themes. The title is bold and at least 24 px at every width, so 3 : 1 is its bar.
 *
 * In print, and when the system asks for more contrast, the title falls back to the page's own solid
 * text colors (`--foreground` in globals.css). Print comes last, so it wins.
 *
 * One literal string, never assembled: Tailwind only generates CSS for class names it finds whole in
 * the source, and a gradient that failed to generate would leave the title see-through. The
 * subpages' title links carry no fade on pointer-over, because faded, the dark ramp would drop under
 * its bar. Guarded by src/guards/header-title-gradient.test.ts.
 */
const TITLE_GRADIENT =
  'bg-gradient-to-r from-[#3c589e] to-[#0a1f69] dark:from-[#7494e0] dark:to-[#3b5aa8] bg-clip-text text-transparent print:bg-none print:text-[#171717] contrast-more:bg-none contrast-more:text-[#171717] dark:contrast-more:text-[#ededed]';

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
                className={TITLE_GRADIENT}
              >
                SPERT
              </Link>
              <span className="text-zinc-400 dark:text-zinc-500 font-normal text-xs align-top">&reg;</span>
              {' '}
              <Link
                href="/"
                className={TITLE_GRADIENT}
              >
                Suite
              </Link>
            </>
          ) : (
            <>
              <span className={TITLE_GRADIENT}>
                SPERT
              </span>
              <span className="text-zinc-400 dark:text-zinc-500 font-normal text-xs align-top">&reg;</span>
              {' '}
              <span className={TITLE_GRADIENT}>
                Suite
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
