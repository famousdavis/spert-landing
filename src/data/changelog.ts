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
