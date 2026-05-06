import type { ReactNode } from 'react';

export interface AppInfo {
  name: string;
  description: string;
  url: string;
  icon: string;
  iconNode?: ReactNode;
  color: string;
  external?: boolean; // defaults to true; set false for internal pages
  linkLabel?: string; // defaults to "Open App"
  category?: 'app' | 'support'; // defaults to 'app'
}

function GanttIcon() {
  return (
    <svg
      width="36"
      height="36"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      role="img"
    >
      <rect x="2" y="5" width="14" height="4" rx="1" fill="#0891b2" />
      <rect x="6" y="11" width="12" height="4" rx="1" fill="#0891b2" />
      <rect x="10" y="17" width="10" height="4" rx="1" fill="#0891b2" />
    </svg>
  );
}

export const apps: AppInfo[] = [
  {
    name: 'SPERT® Story Map',
    description: 'Map and size your release scope before the first sprint begins.',
    url: 'https://storymap.spertsuite.com/',
    icon: '\uD83D\uDDFA\uFE0F',
    color: '#4f46e5',
    linkLabel: 'Map Your Releases',
  },
  {
    name: 'SPERT® Forecaster',
    description: 'Forecast your release dates and how confident you should be in them.',
    url: 'https://forecaster.spertsuite.com/',
    icon: '\uD83C\uDFAF',
    color: '#0070f3',
    linkLabel: 'Forecast Your Releases',
  },
  {
    name: 'GanttApp™',
    description: 'Build and share a clear project timeline with uncertainty included.',
    url: 'https://ganttapp.spertsuite.com/',
    icon: '\uD83D\uDCCA',
    iconNode: <GanttIcon />,
    color: '#0891b2',
    linkLabel: 'Build Your Timeline',
  },
  {
    name: 'SPERT® Scheduler',
    description: 'Build and maintain a project schedule that accounts for uncertainty.',
    url: 'https://scheduler.spertsuite.com/',
    icon: '\uD83D\uDCC5',
    color: '#f75b2b',
    linkLabel: 'Schedule Your Project',
  },
  {
    name: 'SPERT® CFD',
    description: 'See where work is piling up before it becomes a missed deadline.',
    url: 'https://cfd.spertsuite.com/',
    icon: '\uD83D\uDCC8',
    color: '#7c3aed',
    linkLabel: 'Analyze Your Flow',
  },
  {
    name: 'MyScrumBudget™',
    description: 'Plan and reforecast your budget for any project, any team.',
    url: 'https://myscrumbudget.spertsuite.com/',
    icon: '\uD83D\uDCB0',
    color: '#16a34a',
    linkLabel: 'Plan Your Budget',
  },
  {
    name: 'Contact Me',
    description: 'Have a question, suggestion, or feedback? Send me a message',
    url: '/contact',
    icon: '\u2709\uFE0F',
    color: '#8b5cf6',
    external: false,
    linkLabel: 'Send Message',
    category: 'support',
  },
  {
    name: 'I Have a Request',
    description: 'Have a feature idea or improvement suggestion? Let me know',
    url: '/request',
    icon: '\uD83D\uDCA1',
    color: '#ea580c',
    external: false,
    linkLabel: 'Make a Request',
    category: 'support',
  },
  {
    name: 'I Found a Bug',
    description: 'Found something that isn\u2019t working right? Please let me know',
    url: '/bug-report',
    icon: '\uD83D\uDC1B',
    color: '#dc2626',
    external: false,
    linkLabel: 'Report Bug',
    category: 'support',
  },
];

export const externalAppNames = apps
  .filter((a) => a.external !== false)
  .map((a) => a.name);
