# ARCHITECTURE — SPERT Landing Page

## Purpose

The hub of the SPERT® Suite of free, browser-based project management tools: it links to each app, hosts the Help Center for their guides, and serves the suite's legal documents. Deployed on Vercel as its own project.

## Tech Stack

- **Framework:** Next.js 16.2.11 (App Router, Turbopack)
- **Language:** TypeScript 6.0.3
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
│   │   ├── robots.ts          # /robots.txt (allows all; names the sitemap)
│   │   ├── sitemap.ts         # /sitemap.xml (site pages + listed Help Center pages)
│   │   ├── help/
│   │   │   ├── page.tsx       # Help Center hub (/help)
│   │   │   └── [app]/
│   │   │       └── page.tsx   # One page per app (/help/<slug>), built at build time
│   │   ├── approval-kit/
│   │   │   └── page.tsx       # Approval Kit documents
│   │   ├── contact/
│   │   │   └── page.tsx       # Contact form (Formspree)
│   │   ├── training/
│   │   │   └── page.tsx       # Training inquiry form (Formspree)
│   │   ├── security/
│   │   │   └── page.tsx       # Security policy and reporting
│   │   └── changelog/
│   │       └── page.tsx       # Version history
│   ├── components/
│   │   ├── AppCheckboxGroup.tsx # App selection checkboxes for support forms
│   │   ├── AppTile.tsx        # Reusable app tile card
│   │   ├── Footer.tsx         # Shared footer (version, copyright, legal links)
│   │   ├── FormPageShell.tsx  # Shared form page layout and Formspree submission
│   │   ├── formatName.tsx     # Renders ® / ™ small in product names
│   │   ├── Header.tsx         # Shared header (gradient title, theme toggle)
│   │   ├── HelpSections.tsx   # Help Center parts (PDF links, privacy, "Still stuck?")
│   │   ├── textStyles.ts      # Shared body text and link classes
│   │   └── ThemeToggle.tsx    # Light/Dark/System segmented toggle
│   ├── config.ts              # App-wide constants (APP_VERSION)
│   ├── data/
│   │   ├── apps.tsx          # App definitions array (add new apps here)
│   │   ├── approvalKit.ts    # Approval Kit documents
│   │   ├── changelog.ts      # Version history entries
│   │   └── help.ts           # Help Center guide list (one entry per app)
│   ├── guards/               # Vitest guards that hold data and config to their contracts
│   └── hooks/
│       └── useTheme.ts       # Three-state theme hook with SSR safety
├── scripts/
│   └── check-help-guides.mjs # The Help Center's daily link and guide-list checks
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

### Pages
The site's pages are the homepage (`page.tsx`), the Help Center (`help/page.tsx` and one `help/[app]/page.tsx` page per app), the Approval Kit (`approval-kit/page.tsx`), the contact and training forms (`contact/page.tsx`, `training/page.tsx`), the security page (`security/page.tsx`) and the changelog (`changelog/page.tsx`). All are static, and all share the `Header` and `Footer` components. The two form pages use a shared `FormPageShell` component for layout and Formspree submission logic.

Retired addresses redirect permanently (`redirects()` in `next.config.ts`): `/bug-report` (2.6.0) and `/request` (2.8.0) go to `/contact`, and `/support` (2.13.0) goes to `/help`.

### Help Center
`/help` lists every app's guide PDFs, and `/help/<slug>` gives each app its own page, where `<slug>` is the app's subdomain. The guides stay in the app repositories and are linked where each app serves them; this repo keeps no copies. Everything comes from one data module, `src/data/help.ts`, which also drives the sitemap. An app is listed on the hub and in the sitemap exactly when it has a homepage tile; an unlisted app's page is still built, but carries `noindex`.

Two daily checks in `.github/workflows/help-guides.yml` keep the list true, as separate jobs because their failures mean different things: one fetches every guide link, and one compares the list with each app repository's `public/` folder over the GitHub API.

### Data-Driven Tiles
App tiles are driven by a simple array in `src/data/apps.tsx`. Each tile has an optional `category` field (`'app'` or `'support'`). The homepage filters by category to render the main app grid and a separate Support section. Adding a new app or support tile means adding one object to the array — no component changes needed. A tile may also set `labelColor` and `labelColorDark`, used for its link label only when its brand color is under 4.5:1 against the light or dark tile background; `src/guards/tile-contrast.test.ts` holds every tile to WCAG AA in both themes.

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
