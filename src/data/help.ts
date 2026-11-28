// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.
// See LICENSE file in the project root for full license text.

/**
 * The Help Center's guide list: the single source for the /help pages, the
 * sitemap, and the two daily checks in .github/workflows/help-guides.yml.
 *
 * ⚠️ THIS FILE HAS NO IMPORTS, ON PURPOSE. scripts/check-help-guides.mjs imports
 * it directly under Node's type stripping, which cannot resolve the `@/` alias
 * or follow imports into .tsx. Keep it plain data and plain functions.
 *
 * Guards: src/guards/help-center.test.ts (G1–G7, G12) holds this file to the
 * homepage tiles, the pinned slugs and repos, and the description rules.
 *
 * ADDING A GUIDE an app repo has published in public/: add a HelpGuide to that
 * app, with a description William approves. Until then the daily check "Guide
 * list matches the app repos" is red, by design. It ships as a patch release.
 */

export interface HelpGuide {
  /** The PDF's filename in the app repo's public/ folder. The URL is derived from it (guideUrl). */
  file: string;
  /** The guide's own title, as printed on its first page, without the app name. */
  title: string;
  /** What the guide is for. No numbers, versions or revisions: they would drift from the PDF (G5). */
  description: string;
  /** At most one per app (G4). */
  startHere?: true;
}

export interface HelpApp {
  /** The app's subdomain, and its address under /help (/help/<slug>). Pinned in G1. */
  slug: string;
  /** Equals the homepage tile's name, where the app has a tile (G2). */
  name: string;
  /** 'https://<slug>.spertsuite.com/'. Equals the tile's url (G2, G3). */
  appUrl: string;
  /** Equals the tile's description, where the app has a tile (G2). */
  summary: string;
  /** GitHub 'owner/name'. Pinned in G1. Never derived from a folder name: two of them differ. */
  repo: string;
  /** True exactly when the app has a homepage tile (G2). Unlisted: no hub card, no sitemap entry, noindex. */
  listed: boolean;
  guides: readonly HelpGuide[];
  /** Shown in place of the guide list. Present exactly when `guides` is empty (G3). */
  noGuideNote?: string;
  /** PDFs in the repo's public/ folder that are deliberately not listed here, each with its reason. */
  notListed?: readonly { file: string; reason: string }[];
}

export const HELP_APPS: readonly HelpApp[] = [
  {
    slug: 'storymap',
    name: 'SPERT® Story Map',
    appUrl: 'https://storymap.spertsuite.com/',
    summary: 'Map and size your release scope before the first sprint begins.',
    repo: 'famousdavis/spert-story-map',
    listed: true,
    guides: [
      {
        file: 'SPERTStoryMap_Quick_Reference_Guide.pdf',
        title: 'Quick Reference Guide',
        description:
          'What Story Map is and how to use it: themes, backbones and rib items, releases, sprints and progress tracking.',
        startHere: true,
      },
      {
        file: 'SPERTStoryMap_Connect_AI_Guide.pdf',
        title: 'Connect AI User Guide',
        description:
          'How to pair an AI assistant with your story map so it can build and edit the map with you.',
      },
    ],
  },
  {
    slug: 'forecaster',
    name: 'SPERT® Forecaster',
    appUrl: 'https://forecaster.spertsuite.com/',
    summary: 'Forecast your release dates and how confident you should be in them.',
    repo: 'famousdavis/spert-forecaster',
    listed: true,
    guides: [
      {
        file: 'SPERTForecaster_Quick_Reference_Guide.pdf',
        title: 'Quick Reference Guide',
        description:
          'What Forecaster is and how it forecasts release dates from your sprint history with Monte Carlo simulation.',
        startHere: true,
      },
      {
        file: 'SPERTForecaster_Connect_AI_Guide.pdf',
        title: 'Connect AI User Guide',
        description:
          'How to pair an AI assistant with a project so it can read your forecast and explain it.',
      },
    ],
  },
  {
    slug: 'ganttapp',
    name: 'GanttApp™',
    appUrl: 'https://ganttapp.spertsuite.com/',
    summary: 'Build and share a clear project timeline with uncertainty included.',
    repo: 'famousdavis/GanttApp',
    listed: true,
    guides: [
      {
        file: 'GanttApp_Quick_Reference_Guide.pdf',
        title: 'Quick Reference Guide',
        description:
          'How GanttApp shows each release as a build phase plus a delivery uncertainty window, and how to set one up.',
        startHere: true,
      },
    ],
  },
  {
    slug: 'scheduler',
    name: 'SPERT® Scheduler',
    appUrl: 'https://scheduler.spertsuite.com/',
    summary: 'Build and maintain a project schedule that accounts for uncertainty.',
    repo: 'famousdavis/spert-scheduler',
    listed: true,
    guides: [
      {
        file: 'SPERTScheduler_Quick_Reference_Guide.pdf',
        title: 'Quick Reference Guide',
        description:
          'What Scheduler is and how it uses three-point estimates and Monte Carlo simulation to show how likely you are to finish by a date.',
        startHere: true,
      },
      {
        file: 'SPERTScheduler_Import_Quick_Reference_Guide.pdf',
        title: 'Import Activities from Spreadsheet',
        description:
          'How to bring an activity list from Excel or Google Sheets into Scheduler, and how each row is checked.',
      },
      {
        file: 'SPERTScheduler_P6_MSProject_Import_Guide.pdf',
        title: 'Import from P6 or MS Project',
        description:
          'How to move a Primavera P6 or Microsoft Project schedule into Scheduler by way of Excel.',
      },
      {
        file: 'SPERTScheduler_Connect_AI_Guide.pdf',
        title: 'Connect AI User Guide',
        description:
          'How to pair an AI assistant with your project so it can build and edit your schedule with you.',
      },
      {
        file: 'CPM_Constraints_Critical_Path_Explainer.pdf',
        title: 'When Scheduling Constraints Override the Critical Path',
        description:
          'A short primer on why a date constraint can drive your finish date while the highlighted critical path shows something else.',
      },
    ],
  },
  {
    slug: 'cfd',
    name: 'SPERT® CFD',
    appUrl: 'https://cfd.spertsuite.com/',
    summary: 'See where work is piling up before it becomes a missed deadline.',
    repo: 'famousdavis/spert-cfd',
    listed: true,
    guides: [
      {
        file: 'SPERT_CFD_Quick_Reference_Guide.pdf',
        title: 'Quick Reference Guide',
        description:
          'What CFD is and how it turns your workflow’s daily item counts into a cumulative flow diagram and flow metrics such as WIP, throughput and lead time.',
        startHere: true,
      },
    ],
  },
  {
    slug: 'myscrumbudget',
    name: 'MyScrumBudget™',
    appUrl: 'https://myscrumbudget.spertsuite.com/',
    summary: 'Plan and reforecast your budget for any project, any team.',
    repo: 'famousdavis/myscrumbudget-web',
    listed: true,
    guides: [
      {
        file: 'MyScrumBudget_Quick_Reference_Guide.pdf',
        title: 'Quick Reference Guide',
        description:
          'What MyScrumBudget is and how it forecasts a project’s labor costs, burn rate and variance from your team’s allocations.',
        startHere: true,
      },
      {
        file: 'MyScrumBudget_Charter_Budget_Guide.pdf',
        title: 'Charter Budget Reference Guide',
        description:
          'How the Charter Budget adds a risk-based contingency to your estimate, giving a budget you can put in a project charter.',
      },
    ],
  },
  {
    // Unlisted (D2, 2026-11-16): AHP has no homepage tile, so its page is built
    // for the apps to link to, but it has no hub card, no sitemap entry, and noindex.
    slug: 'ahp',
    name: 'SPERT® AHP',
    appUrl: 'https://ahp.spertsuite.com/',
    summary: 'Make a complex decision by comparing your options and criteria in pairs.',
    repo: 'spert-suite/spert-ahp',
    listed: false,
    guides: [
      {
        file: 'SPERT_AHP_Quick_Reference_Guide.pdf',
        title: 'Quick Reference Guide',
        description:
          'What AHP is and how it ranks alternatives by comparing your criteria in pairs, then checks your judgments for consistency.',
        startHere: true,
      },
    ],
  },
];

/** Legal copies some app repos serve from public/. They are not guides, and the list check ignores them. */
export const NOT_GUIDES = ['TOS.pdf', 'PRIVACY.pdf'] as const;

export function guideUrl(app: HelpApp, guide: HelpGuide): string {
  return app.appUrl + guide.file;
}

/**
 * The app's Connect AI guide, when it has one. An app has Connect AI exactly
 * when its repo publishes one of these, so the setup page (/help/connect-ai)
 * and the app pages derive the list from here rather than keeping their own
 * (G16 pins which apps that is today).
 */
export function connectAiGuide(app: HelpApp): HelpGuide | undefined {
  return app.guides.find((g) => g.file.endsWith('_Connect_AI_Guide.pdf'));
}

/** D2. The app page's metadata uses this, so the decision lives where a guard can import it (G12). */
export function helpRobots(app: HelpApp): { index: false } | undefined {
  return app.listed ? undefined : { index: false };
}
