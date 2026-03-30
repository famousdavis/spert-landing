# ARCHITECTURE — SPERT Landing Page

## Purpose

Single-page hub linking to the SPERT® Suite ecosystem of free, browser-based project management tools. Deployed on Vercel as its own project.

## Tech Stack

- **Framework:** Next.js 16.1.6 (App Router, Turbopack)
- **Language:** TypeScript 5.x
- **Styling:** Tailwind CSS 4.x with `@theme inline` custom tokens
- **Fonts:** Geist Sans + Geist Mono (via `next/font/google`)
- **Hosting:** Vercel (auto-deploy from `main` branch)
- **License:** GNU GPL v3

## File Structure

```
spert-landing-page/
├── src/
│   ├── app/
│   │   ├── globals.css        # Tailwind + dark mode CSS variables
│   │   ├── layout.tsx         # Root layout (fonts, anti-flash script, metadata)
│   │   ├── page.tsx           # Homepage (app grid + support section)
│   │   ├── contact/
│   │   │   └── page.tsx       # Contact form (Formspree)
│   │   ├── request/
│   │   │   └── page.tsx       # Feature request form (Formspree)
│   │   ├── bug-report/
│   │   │   └── page.tsx       # Bug report form (Formspree)
│   │   └── changelog/
│   │       └── page.tsx       # Version history
│   ├── components/
│   │   ├── AppCheckboxGroup.tsx # App selection checkboxes for support forms
│   │   ├── AppTile.tsx        # Reusable app tile card
│   │   ├── Footer.tsx         # Shared footer (version, copyright, legal links)
│   │   ├── FormPageShell.tsx  # Shared form page layout and Formspree submission
│   │   ├── Header.tsx         # Shared header (gradient title, theme toggle)
│   │   └── ThemeToggle.tsx    # Light/Dark/System segmented toggle
│   ├── config.ts              # App-wide constants (APP_VERSION)
│   ├── data/
│   │   ├── apps.ts           # App definitions array (add new apps here)
│   │   └── changelog.ts      # Version history entries
│   └── hooks/
│       └── useTheme.ts       # Three-state theme hook with SSR safety
├── public/
│   ├── TOS.pdf              # Canonical Terms of Service (shared across all SPERT apps)
│   └── PRIVACY.pdf          # Canonical Privacy Policy (shared across all SPERT apps)
├── package.json
├── tsconfig.json
├── eslint.config.mjs
├── postcss.config.mjs
└── next.config.ts
```

## Key Design Decisions

### Canonical Legal Documents
`public/TOS.pdf` and `public/PRIVACY.pdf` are the canonical versions of the Terms of Service and Privacy Policy shared across all six SPERT® web apps. Other apps link directly to these URLs — do not rename or relocate.

### Five-Page App
The site has five pages: homepage (`page.tsx`), contact form (`contact/page.tsx`), feature request form (`request/page.tsx`), bug report form (`bug-report/page.tsx`), and changelog (`changelog/page.tsx`). All share `Header` and `Footer` components. The three form pages use a shared `FormPageShell` component for layout and Formspree submission logic.

### Data-Driven Tiles
App tiles are driven by a simple array in `src/data/apps.ts`. Each tile has an optional `category` field (`'app'` or `'support'`). The homepage filters by category to render the main app grid and a separate Support section. Adding a new app or support tile means adding one object to the array — no component changes needed.

### Theme System
Three-state (Light/Dark/System) toggle matching the pattern used across all SPERT ecosystem apps:
- Anti-flash `<script>` in `<head>` reads localStorage before React hydrates
- `useTheme` hook manages state with `useSyncExternalStore` for SSR hydration safety
- CSS uses `@custom-variant dark` with `.dark` class on `<html>`
- localStorage key: `spert-hub:theme`

### Brand Consistency
Visual language matches the SPERT ecosystem:
- Blue gradient heading: `#0099ff` → `#0051cc`
- Geist font family
- Centered footer: `© [Year] William W. Davis, MSPM, PMP | Version X.X | Licensed under GNU GPL v3`
- Italic tagline

## Security

HTTP security headers are configured in `next.config.ts` and applied to all routes:
- `X-Content-Type-Options: nosniff` — prevents MIME-type sniffing
- `X-Frame-Options: DENY` — prevents clickjacking
- `Referrer-Policy: strict-origin-when-cross-origin` — limits referrer leakage
- `Permissions-Policy: camera=(), microphone=(), geolocation=()` — disables unused browser APIs

## Commands

```bash
npm run dev      # Development server
npm run build    # Production build
npm run lint     # ESLint
```
