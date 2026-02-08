# ARCHITECTURE — SPERT Landing Page

## Purpose

Single-page hub linking to the Statistical PERT® ecosystem of free, browser-based project management tools. Deployed on Vercel as its own project.

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
│   │   └── page.tsx           # Main page (header, tile grid, footer)
│   ├── components/
│   │   ├── AppTile.tsx        # Reusable app tile card
│   │   └── ThemeToggle.tsx    # Light/Dark/System segmented toggle
│   ├── data/
│   │   └── apps.ts           # App definitions array (add new apps here)
│   └── hooks/
│       └── useTheme.ts       # Three-state theme hook with SSR safety
├── public/                    # Static assets (currently empty)
├── package.json
├── tsconfig.json
├── eslint.config.mjs
├── postcss.config.mjs
└── next.config.ts
```

## Key Design Decisions

### Single-Page App
The entire site is one page (`page.tsx`). No routing, no navigation. Just a hero header, tile grid, and footer.

### Data-Driven Tiles
App tiles are driven by a simple array in `src/data/apps.ts`. Adding a new app means adding one object to the array — no component changes needed.

### Theme System
Three-state (Light/Dark/System) toggle matching the pattern used across all SPERT ecosystem apps:
- Anti-flash `<script>` in `<head>` reads localStorage before React hydrates
- `useTheme` hook manages state with a `mounted` guard for SSR safety
- CSS uses `@custom-variant dark` with `.dark` class on `<html>`
- localStorage key: `spert-hub:theme`

### Brand Consistency
Visual language matches the SPERT ecosystem:
- Blue gradient heading: `#0099ff` → `#0051cc`
- Geist font family
- Centered footer: `© [Year] William W. Davis, MSPM, PMP | Version X.X | Licensed under GNU GPL v3`
- Italic tagline

## Commands

```bash
npm run dev      # Development server
npm run build    # Production build
npm run lint     # ESLint
```
