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
