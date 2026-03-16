export interface AppInfo {
  name: string;
  description: string;
  url: string;
  icon: string;
  color: string;
  external?: boolean; // defaults to true; set false for internal pages
  linkLabel?: string; // defaults to "Open App"
  category?: 'app' | 'support'; // defaults to 'app'
}

export const apps: AppInfo[] = [
  {
    name: 'SPERT® Story Map',
    description: 'Agile user story mapping for release planning',
    url: 'https://spert-story-map.vercel.app/',
    icon: '\uD83D\uDDFA\uFE0F',
    color: '#0891b2',
  },
  {
    name: 'SPERT® Forecaster',
    description: 'Monte Carlo simulation for agile release forecasting',
    url: 'https://spert-forecaster.vercel.app/',
    icon: '\uD83C\uDFAF',
    color: '#0070f3',
  },
  {
    name: 'GanttApp™',
    description: 'Split-bar Gantt charts for visualizing release uncertainty',
    url: 'https://gantt-app-wwd.vercel.app/',
    icon: '\uD83D\uDCCA',
    color: '#6366f1',
  },
  {
    name: 'SPERT® Scheduler',
    description: 'Probabilistic project scheduling with three-point estimation',
    url: 'https://spert-scheduler.vercel.app/',
    icon: '\uD83D\uDCC5',
    color: '#10b981',
  },
  {
    name: 'SPERT® CFD',
    description: 'Cumulative flow diagrams and flow metrics for agile teams',
    url: 'https://spert-cfd.vercel.app/',
    icon: '\uD83D\uDCC8',
    color: '#f59e0b',
  },
  {
    name: 'MyScrumBudget™',
    description: 'Scrum project budget forecasting and cost tracking',
    url: 'https://myscrumbudget.vercel.app/',
    icon: '\uD83D\uDCB0',
    color: '#f43f5e',
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
