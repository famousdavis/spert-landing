import Link from 'next/link';
import { APP_VERSION } from '@/config';

interface FooterProps {
  /** When true, the version text links to /changelog. Default: true. Set false on the changelog page. */
  linkVersion?: boolean;
}

export function Footer({ linkVersion = true }: FooterProps) {
  const versionText = `Version ${APP_VERSION}`;

  return (
    <footer className="mt-16 border-t-2 border-zinc-100 pt-8 pb-6 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
      &copy; {new Date().getFullYear()} William W. Davis, MSPM, PMP
      {' | '}
      {linkVersion ? (
        <Link
          href="/changelog"
          className="text-blue-500 hover:text-blue-600 transition-colors"
        >
          {versionText}
        </Link>
      ) : (
        versionText
      )}
      {' | '}Licensed under GNU GPL v3
      <div className="mt-2">
        <a
          href="/TOS.pdf"
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-500 hover:text-blue-600 transition-colors"
        >
          Terms of Service
        </a>
        {' | '}
        <a
          href="/PRIVACY.pdf"
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-500 hover:text-blue-600 transition-colors"
        >
          Privacy Policy
        </a>
      </div>
    </footer>
  );
}
