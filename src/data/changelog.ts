export interface ChangelogEntry {
  version: string;
  date: string;
  sections: {
    heading: string;
    items: string[];
  }[];
}

export const changelog: ChangelogEntry[] = [
  {
    version: '2.5.2',
    date: 'July 27, 2026',
    sections: [
      {
        heading: 'Dependencies',
        items: [
          'Moved the server-side linter to ESLint 10, bringing it in line with the rest of the SPERT® Suite. It was the last piece still on ESLint 8.',
          'Retired an unmaintained style configuration that had been holding the linter back, along with two dependencies it required.',
          'Routine maintenance only — nothing changes in the site or the apps.',
        ],
      },
    ],
  },
  {
    version: '2.5.1',
    date: 'July 27, 2026',
    sections: [
      {
        heading: 'Security',
        items: [
          'Patched a denial-of-service advisory in a pattern-matching library used throughout the server-side build and test tooling.',
        ],
      },
      {
        heading: 'Dependencies',
        items: [
          'Updated the server-side test toolchain to Jest 30.',
          'Updated firebase-admin to 13.10, React to 19.2.6, TypeScript ESLint to 8.60, and ts-jest to 29.4.11.',
          'Routine maintenance only — nothing changes in the site or the apps.',
        ],
      },
    ],
  },
  {
    version: '2.5.0',
    date: 'July 26, 2026',
    sections: [
      {
        heading: 'Legal',
        items: [
          'Updated the Terms of Service and the Privacy Policy to Version 1.1.',
          'Account deletion is now described accurately: deletion is requested through the contact form or by email and is carried out by the Operator, and both documents now state plainly that the apps do not yet offer a self-service account-deletion control.',
          'The Privacy Policy now commits to completing a deletion request within 30 days under normal circumstances.',
          'The Privacy Policy now calls out up front that turning on Read Mode uploads a copy of your open project even if you otherwise keep your data in local browser storage only.',
          'The Terms of Service now reflect that some apps offer AI Connectivity in read-only form, where no permission grants an AI assistant the ability to change your content.',
          'Reissued the SPERT® AI Privacy Notice and AI Connectivity Consent Notice with page numbering. The wording is unchanged — both remain Version 2.0.',
        ],
      },
      {
        heading: 'Fixed',
        items: [
          'Corrected a broken link in the Privacy Policy, which pointed at an address for the AI Privacy Notice that did not resolve. Copies of the older document already downloaded will now reach the notice as well.',
        ],
      },
    ],
  },
  {
    version: '2.4.0',
    date: 'July 26, 2026',
    sections: [
      {
        heading: 'Legal',
        items: [
          'Updated the SPERT® AI Privacy Notice to Version 2.0, published at /ai-privacy.',
          'Updated the SPERT® AI Connectivity Consent Notice to Version 2.0, published at /ai-consent-notice.',
          'Both notices now cover every application offering Connect AI — SPERT® Story Map and SPERT® Scheduler (write and read) and SPERT® Forecaster (read-only) — including a table of the modes each application offers.',
          'Clarified that enabling Read Mode uploads a copy of the open project even when an application is configured for local storage only, and added guidance for users connecting AI on behalf of an employer or organization.',
        ],
      },
    ],
  },
  {
    version: '2.1.2',
    date: 'June 28, 2026',
    sections: [
      {
        heading: 'Dependencies',
        items: [
          'Adopted Node.js 24 runtime.',
        ],
      },
    ],
  },
  {
    version: '2.1.1',
    date: 'June 28, 2026',
    sections: [
      {
        heading: 'Security',
        items: [
          'Updated the underlying framework and build tooling to address security advisories.',
        ],
      },
      {
        heading: 'Dependencies',
        items: [
          'Adopted TypeScript 6.0.3.',
          'Updated React, Tailwind CSS, and related build dependencies.',
        ],
      },
    ],
  },
  {
    version: '2.1.0',
    date: 'June 12, 2026',
    sections: [
      {
        heading: 'Legal',
        items: [
          'Updated Terms of Service and Privacy Policy to v06-12-2026 ahead of the upcoming AI Connectivity ("Connect AI") feature.',
          'Published the SPERT® AI Privacy Notice v1.0 at the permanent URL /ai-privacy and added an "AI Privacy Notice" link to the footer legal links.',
          'Published the SPERT® AI Connectivity Consent Notice v1.0 at /ai-consent-notice (background reference document; publicly accessible but not linked in navigation).',
        ],
      },
    ],
  },
  {
    version: '2.0.5',
    date: 'May 3, 2026',
    sections: [
      {
        heading: 'Accessibility',
        items: [
          'Added `autoComplete="name"` and `autoComplete="email"` to the shared form shell so Chrome stops flagging the autocomplete-attribute warning on the Contact, I Found a Bug, and I Have a Request forms — and so password managers and browser autofill recognize the user-name and user-email fields correctly.',
        ],
      },
    ],
  },
  {
    version: '2.0.2',
    date: 'May 1, 2026',
    sections: [
      {
        heading: 'Changed',
        items: [
          'Replaced the generic "Open App →" call-to-action on each of the six tool tiles with action-oriented, tool-specific CTAs: SPERT® Story Map → "Map Your Release"; SPERT® Forecaster → "Forecast Your Release"; GanttApp™ → "Build Your Timeline"; SPERT® Scheduler → "Schedule Your Project"; SPERT® CFD → "Analyze Your Flow"; MyScrumBudget™ → "Plan Your Budget".',
        ],
      },
    ],
  },
  {
    version: '2.0.1',
    date: 'May 1, 2026',
    sections: [
      {
        heading: 'Changed',
        items: [
          'Tightened hero headline to "Give stakeholders forecasts you can defend." — sized down (text-lg/xl, semibold) so it no longer competes with the "SPERT® Suite" brand title and capped at max-w-3xl with text-balance for cleaner wrapping on smaller laptop displays.',
          'Split hero subhead into two sentences (em-dash removed), clarified "delivery" as "product delivery," and added text-balance for cleaner wrapping.',
          'Italicized the "No sign-up required to get started!" line and added an exclamation mark for warmth.',
          'Refined three tile descriptions: SPERT® Story Map → "Map and size your release scope before the first sprint begins."; SPERT® Scheduler → "Build and maintain a project schedule that accounts for uncertainty."; MyScrumBudget™ → "Plan and reforecast your budget for any project, any team."',
        ],
      },
    ],
  },
  {
    version: '2.0.0',
    date: 'May 1, 2026',
    sections: [
      {
        heading: 'Changed',
        items: [
          'Rewrote hero copy: new headline ("Give stakeholders forecasts you can defend — not single-point guesses.") and subhead emphasizing defensibility and user judgment over feature description.',
          'Rewrote all six tool tile descriptions to be outcome-first and action-oriented — answering "when would I use this?" instead of describing the underlying technique.',
          'Trimmed homepage intro to a single "No sign-up required to get started." line below the subhead.',
        ],
      },
      {
        heading: 'Versioning',
        items: [
          'Switched from MAJOR.MINOR to full semver (MAJOR.MINOR.PATCH) starting with this release.',
        ],
      },
    ],
  },
  {
    version: '1.8',
    date: 'May 1, 2026',
    sections: [
      {
        heading: 'Added',
        items: [
          'Branded favicon for the browser tab and a small brand mark in the header beside "SPERT® Suite"; a charcoal dark-mode variant ships alongside the navy original.',
        ],
      },
      {
        heading: 'Changed',
        items: [
          'App tile colors realigned to each app’s official favicon palette: Scheduler orange (#f75b2b), Story Map indigo (#4f46e5), CFD purple (#7c3aed), GanttApp™ teal (#0891b2), MyScrumBudget™ green (#16a34a). Forecaster blue (#0070f3) unchanged.',
        ],
      },
    ],
  },
  {
    version: '1.7',
    date: 'April 5, 2026',
    sections: [
      {
        heading: 'Legal',
        items: [
          'Updated Terms of Service and Privacy Policy to v04-05-2026',
          'Added SPERT\u00AE AHP to list of covered apps',
          'Updated effective date to April 5, 2026',
        ],
      },
    ],
  },
  {
    version: '1.6',
    date: 'March 31, 2026',
    sections: [
      {
        heading: 'Legal',
        items: [
          'Updated Terms of Service and Privacy Policy to v03-31-2026',
          'Updated canonical legal document URLs from spert-landing.vercel.app to spertsuite.com',
          'Added License link to footer (links to GitHub LICENSE file)',
        ],
      },
    ],
  },
  {
    version: '1.5',
    date: 'March 30, 2026',
    sections: [
      {
        heading: 'Improvements',
        items: [
          'Updated all app tile URLs to use the new spertsuite.com subdomains (storymap, forecaster, ganttapp, scheduler, cfd, myscrumbudget)',
        ],
      },
    ],
  },
  {
    version: '1.4',
    date: 'March 30, 2026',
    sections: [
      {
        heading: 'Rebranding',
        items: ['Renamed main title from "Statistical PERT\u00AE" to "SPERT\u00AE Suite"'],
      },
    ],
  },
  {
    version: '1.3',
    date: 'March 16, 2026',
    sections: [
      {
        heading: 'New Features',
        items: [
          'Added "I Have a Request" form for feature ideas and improvement suggestions (Formspree integration)',
          'Added "I Found a Bug" form for bug reports across all SPERT web apps (Formspree integration)',
          'Added "Support" section on the homepage grouping Contact Me, I Have a Request, and I Found a Bug tiles',
          'Both new forms include an optional multi-select checkbox for specifying which app(s) the submission relates to',
        ],
      },
      {
        heading: 'Improvements',
        items: [
          'Extracted shared FormPageShell component to eliminate duplication across all three form pages',
          'Added category field to app data for separating main apps from support tiles',
        ],
      },
    ],
  },
  {
    version: '1.2.3',
    date: 'March 11, 2026',
    sections: [
      {
        heading: 'Infrastructure',
        items: [
          'Pinned Vercel deployment target to Node.js 22 LTS ahead of Node 20 EOL (April 30, 2026)',
          'Added engines field to package.json requiring Node >= 22',
          'Added .nvmrc for consistent Node version across environments',
          'Updated @types/node from ^20 to ^22',
        ],
      },
    ],
  },
  {
    version: '1.2.2',
    date: 'March 11, 2026',
    sections: [
      {
        heading: 'Improvements',
        items: [
          'Extracted shared form input styling constant to reduce duplication in contact form',
        ],
      },
      {
        heading: 'Dependencies',
        items: [
          'Updated react and react-dom to 19.2.4',
          'Updated devDependencies to latest compatible versions (tailwindcss 4.2, eslint 9.39)',
        ],
      },
    ],
  },
  {
    version: '1.2.1',
    date: 'March 11, 2026',
    sections: [
      {
        heading: 'Improvements',
        items: [
          'Extracted reusable Header and Footer components to reduce duplication across pages',
          'Centralized app version constant in src/config.ts',
          'Fixed duplicate ThemeMode type definition',
          'Fixed pre-existing lint error in useTheme hook (replaced useState mounted pattern with useSyncExternalStore)',
          'Updated README with correct app names and URLs',
          'Upgraded @types/react-dom and typescript to latest stable versions',
        ],
      },
      {
        heading: 'Security',
        items: [
          'Added HTTP security headers (X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy)',
          'Patched transitive dependency vulnerabilities (minimatch, ajv) via npm audit fix',
        ],
      },
    ],
  },
  {
    version: '1.2',
    date: 'March 11, 2026',
    sections: [
      {
        heading: 'New Features',
        items: [
          'Added Terms of Service and Privacy Policy as canonical PDFs served from this site',
          'Added legal document links (Terms of Service, Privacy Policy) to footer on all pages',
        ],
      },
    ],
  },
  {
    version: '1.1.3',
    date: 'March 10, 2026',
    sections: [
      {
        heading: 'Changes',
        items: [
          'Renamed "CFD Laboratory" tile to "SPERT\u00AE CFD"',
          'Added changelog page with version history',
          'Footer version number now links to changelog',
        ],
      },
    ],
  },
  {
    version: '1.1.2',
    date: 'March 10, 2026',
    sections: [
      {
        heading: 'Changes',
        items: [
          'Renamed "SPERT\u00AE Release Forecaster" tile to "SPERT\u00AE Forecaster"',
          'Updated SPERT Forecaster URL to spert-forecaster.vercel.app',
        ],
      },
    ],
  },
  {
    version: '1.1.1',
    date: 'March 10, 2026',
    sections: [
      {
        heading: 'Changes',
        items: [
          'Updated intro blurb to remove local-only data claim for cloud storage compatibility',
        ],
      },
    ],
  },
  {
    version: '1.1',
    date: 'March 10, 2026',
    sections: [
      {
        heading: 'New Features',
        items: [
          'Added SPERT\u00AE Story Map tile (agile user story mapping for release planning)',
        ],
      },
    ],
  },
  {
    version: '1.0',
    date: 'March 8, 2026',
    sections: [
      {
        heading: 'New Features',
        items: [
          'Initial release with five app tiles: SPERT\u00AE Release Forecaster, GanttApp\u2122, SPERT\u00AE Scheduler, CFD Laboratory, MyScrumBudget\u2122',
          'Contact Me tile with Formspree-powered contact form',
          'Dark/light/system theme toggle with anti-flash script',
          'Responsive tile grid (1 column mobile, 2 tablet, 3 desktop)',
          'Branded header with blue gradient and "Estimation Made Easy\u00AE" tagline',
        ],
      },
    ],
  },
];
