// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { compile } from '@tailwindcss/node';
import { describe, it, expect } from 'vitest';

/**
 * The header's SPERT® Suite is drawn as a gradient in the suite's navy, the favicon's #1e3a8a (HDR26,
 * 2.14.2), and every point of it stays readable on the page behind it, in both themes.
 *
 * ⚠️ This suite runs in Node, with no browser and no paint, so nothing here is measured from a render.
 * The end colors are read from `Header.tsx`'s source, the page's background and text colors from
 * `globals.css`, and the contrast is computed here from the WCAG 2.x definition. The rendered pages
 * (`/` and `/help`) were measured in headless Chrome when this was written: the first opaque
 * background behind the title is the `<body>`, at 1,024 and 800 px, in both themes; the theme was
 * switched live both ways; print and increased contrast were checked.
 *
 * The bar is 3 : 1 at every point of each ramp. The title is bold and at least 24 px at every width
 * (`text-2xl`, up to 33.6 px), which is large text everywhere (18.66 px bold is the threshold), and
 * 3 : 1 is the owner's bar for a title that stays large (WCAG exempts logotypes). The light ramp
 * clears it easily (6.81); the dark ramp clears it by hundredths (3.02), on purpose. So the
 * backgrounds and the ends are pinned below: a change to any of them has to come through here.
 *
 * The title appears in two shapes: on the home page as two spans, and on every subpage as two links
 * back to "/". Both carry the one gradient string, so four elements are counted. The subpage links
 * have no fade on pointer-over: faded, the dark ramp would fall to about 2.3 : 1.
 *
 * Known and accepted (the owner's standing ruling): a dark-theme print with the browser's
 * "Background graphics" option on puts the near-black print fallback on the page's #0a0a0a. With
 * that option off, the default, the title prints in solid near-black, where the old gradient printed
 * blank.
 *
 * ⚠️ Tailwind scans every file under src/ for class names, this one included. The only class strings
 * written here are ones `Header.tsx` itself carries, so this file adds no CSS. When it was written,
 * the compiled CSS was compared with main's, and Tailwind's own scanner was run over this file.
 *
 * The color maths is the HDR26 plan's Appendix A, typed. It is copied from the other SPERT® apps'
 * guards, not shared. `@tailwindcss/node` is not a dependency of this repo of its own: it arrives
 * with the pinned `@tailwindcss/postcss`. If that ever stops, the import fails loudly.
 */
const ROOT = process.cwd();
const HEADER = join(ROOT, 'src', 'components', 'Header.tsx');
const GLOBALS_CSS = join(ROOT, 'src', 'app', 'globals.css');
const LAYOUT = join(ROOT, 'src', 'app', 'layout.tsx');

const BAR = 3;
/** The page's background in each theme, measured in Chrome (`getComputedStyle` on the `<body>`). */
const PREMISE = { light: '#ffffff', dark: '#0a0a0a' } as const;
/** The approved ends (HDR26 plan §2), light end first. A change to any of them goes back to the owner. */
const ENDS = { light: ['#3c589e', '#0a1f69'], dark: ['#7494e0', '#3b5aa8'] } as const;
/** The page's own near-black and near-white, `--foreground` in globals.css: the title's fallbacks. */
const FOREGROUND = { light: '#171717', dark: '#ededed' } as const;
/** SPERT and Suite, in each of the title's two shapes. */
const GRADIENT_ELEMENTS = 4;
/** The pages that render the header. A new one must be checked for a background of its own. */
const CALL_SITES = 7;

/** The `<h1>`'s own classes, the ®'s, and the gradient string: each exactly as `Header.tsx` carries it. */
const H1_CLASSES = 'text-2xl font-bold sm:text-3xl md:text-[2.1rem]';
const REG_CLASSES = 'text-zinc-400 dark:text-zinc-500 font-normal text-xs align-top';
const TITLE_CLASSES =
  'bg-gradient-to-r from-[#3c589e] to-[#0a1f69] dark:from-[#7494e0] dark:to-[#3b5aa8] bg-clip-text text-transparent print:bg-none print:text-[#171717] contrast-more:bg-none contrast-more:text-[#171717] dark:contrast-more:text-[#ededed]';

/** A value the guard needs, or a loud failure naming it. */
function req<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`not found: ${what}`);
  return value;
}

// ---- Appendix A (HDR26 plan v7), typed ------------------------------------------------------------

type Triple = [number, number, number];

const lin = (c: number) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const delin = (v: number) =>
  Math.round(255 * Math.min(1, Math.max(0, v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)));
const rgb = (h: string): Triple => [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16)) as Triple;
const hex = (a: number[]) => '#' + a.map((v) => v.toString(16).padStart(2, '0')).join('');
const luminance = (h: string) => {
  const [r, g, b] = rgb(h).map(lin) as Triple;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
/** A contrast ratio to two decimals, truncated: never rounded up across a bar. */
const trunc = (n: number) => (Math.floor(n * 100) / 100).toFixed(2);

const toOklab = (h: string): Triple => {
  const [r, g, b] = rgb(h).map(lin) as Triple;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
};
const linFromOklab = ([lk, a, b]: Triple): Triple => {
  const l = (lk + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lk - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lk - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
};
const fromOklab = (lab: Triple) => hex(linFromOklab(lab).map(delin));
const toLch = (h: string): Triple => {
  const [lk, a, b] = toOklab(h);
  return [lk, Math.hypot(a, b), ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360];
};
const lab = ([lk, c, h]: Triple): Triple => [lk, c * Math.cos((h * Math.PI) / 180), c * Math.sin((h * Math.PI) / 180)];
const inGamut = (lch: Triple) => linFromOklab(lab(lch)).every((v) => v >= -1e-6 && v <= 1 + 1e-6);
/** Fit to sRGB by cutting chroma at fixed lightness and hue; never by clamping channels, which turns the hue. */
const fromLch = ([lk, c, h]: Triple) => {
  let fit = c;
  if (!inGamut([lk, c, h])) {
    let lo = 0;
    let hi = c;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut([lk, mid, h])) lo = mid;
      else hi = mid;
    }
    fit = lo;
  }
  return fromOklab(lab([lk, fit, h]));
};

/** A color as a stylesheet writes it: `#rgb`, `#rrggbb`, or `oklch(L% C H)` with H possibly `none`. */
function parseCssColor(value: string): string {
  const v = value.trim();
  const short = /^#([0-9a-f]{3})$/i.exec(v);
  if (short) return '#' + Array.from(req(short[1], 'short hex')).map((c) => c + c).join('').toLowerCase();
  const long = /^#([0-9a-f]{6})$/i.exec(v);
  if (long) return '#' + req(long[1], 'hex').toLowerCase();
  const ok = /^oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+|none)\s*\)$/i.exec(v);
  if (ok) return fromOklab(lab([Number(ok[1]) / 100, Number(ok[2]), ok[3] === 'none' ? 0 : Number(ok[3])]));
  throw new Error('unreadable color: ' + v);
}

/**
 * The weakest contrast along a ramp, 41 samples. `oklab` is how Tailwind 4's `bg-gradient-to-r`
 * interpolates (`to right in oklab`); `srgb` is a plain gradient's. Both are checked, so a change of
 * interpolation cannot pass.
 */
function weakest(e1: string, e2: string, ground: string, space: 'oklab' | 'srgb'): number {
  const [a, b] = [toOklab(e1), toOklab(e2)];
  const [p, q] = [rgb(e1), rgb(e2)];
  const mix = (x: number[], y: number[], t: number) => x.map((v, k) => v + (req(y[k], 'channel') - v) * t);
  let min = Infinity;
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    const c = space === 'oklab' ? fromOklab(mix(a, b, t) as Triple) : hex(mix(p, q, t).map(Math.round));
    min = Math.min(min, contrast(c, ground));
  }
  return min;
}

// ---- Reading the source -------------------------------------------------------------------------

const read = (file: string) => readFileSync(file, 'utf8');
const classesOf = (raw: string) => raw.split(/\s+/).filter(Boolean);

/** Every `const NAME = '…'` (or "…") in a file, so a `className={NAME}` can be resolved to its classes. */
function stringConstants(text: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const m of Array.from(text.matchAll(/\bconst\s+([A-Za-z_]\w*)\s*=\s*(?:'([^']*)'|"([^"]*)")/g))) {
    found.set(req(m[1], 'name'), req(m[2] ?? m[3], 'value'));
  }
  return found;
}

/** A `className` attribute's classes: `"…"`, `'…'` or `{NAME}`, resolved. Anything else fails loudly. */
function resolveClassName(attrs: string, constants: Map<string, string>, where: string): string[] | null {
  const all = attrs.match(/className=/g) ?? [];
  if (all.length === 0) return null;
  const m = /className=(?:"([^"]*)"|'([^']*)'|\{(\w+)\})/.exec(attrs);
  if (all.length !== 1 || !m) throw new Error(`${where}: a className the guard cannot read: ${attrs.trim()}`);
  const raw = m[1] ?? m[2] ?? constants.get(req(m[3], 'constant name'));
  if (raw === undefined) throw new Error(`${where}: className={${m[3]}} is not a string constant`);
  return classesOf(raw);
}

/** The title: Header's one `<h1 className=…>` element up to its closing tag (comments may name `<h1>`). */
function titleH1(text: string): string {
  const opens = Array.from(text.matchAll(/<h1\s+className=/g), (m) => m.index);
  const start = req(opens[0], 'the title <h1>');
  const end = text.indexOf('</h1>', start);
  if (opens.length !== 1 || end === -1) throw new Error('Header.tsx: not exactly one <h1> element');
  return text.slice(start, end);
}

/** JSX text as rendered: line breaks and their indentation dropped first, then `{' x'}` unwrapped. */
function jsxText(raw: string): string {
  return raw
    .replace(/\s*\n\s*/g, '')
    .replace(/\{'([^']*)'\}|\{"([^"]*)"\}/g, (_, a: string | undefined, b: string | undefined) => a ?? b ?? '')
    .replace(/&reg;/g, '®');
}

/** The title's two shapes: `{linkHome ? (<>…</>) : (<>…</>)}`, exactly once. */
function shapes(text: string): { subpage: string; home: string } {
  const all = Array.from(
    titleH1(text).matchAll(/\{linkHome \? \(\s*<>([\s\S]*?)<\/>\s*\) : \(\s*<>([\s\S]*?)<\/>\s*\)\}/g),
  );
  if (all.length !== 1) throw new Error(`Header.tsx: ${all.length} linkHome branches in the title, expected 1`);
  const [m] = all;
  return { subpage: req(m?.[1], 'the linkHome branch'), home: req(m?.[2], 'the home-page branch') };
}

interface TitleElement {
  tag: string;
  attrs: string;
  classes: string[];
  text: string;
}

const ELEMENT = /<(Link|span)\b([^>]*)>([^<]*)<\/\1>/g;

/** Every element in a stretch of the title, in order, with its classes resolved. */
function elementsIn(jsx: string, constants: Map<string, string>): TitleElement[] {
  return Array.from(jsx.matchAll(ELEMENT), (m) => {
    const [tag, attrs, inner] = [req(m[1], 'tag'), req(m[2], 'attributes'), req(m[3], 'text')];
    return { tag, attrs, classes: resolveClassName(attrs, constants, `<${tag}>`) ?? [], text: jsxText(inner) };
  });
}

/**
 * Every element in the title whose classes clip a background to its text, found by `bg-clip-text` in
 * its classes rather than by the constant's name, so an element given its own literal is counted too.
 * Every `className` in the `<h1>` that clips to text must be one of them: an element with other
 * children, or of another tag, would otherwise escape the census.
 */
function gradientElements(text: string): TitleElement[] {
  const constants = stringConstants(text);
  const h1 = titleH1(text);
  const found = elementsIn(h1, constants).filter((e) => e.classes.includes('bg-clip-text'));
  const clipping = Array.from(h1.matchAll(/<\w+\b([^>]*)>/g), (m) => resolveClassName(req(m[1], 'attrs'), constants, '<h1>'))
    .filter((c): c is string[] => c !== null && c.includes('bg-clip-text'));
  if (clipping.length !== found.length) {
    throw new Error(`Header.tsx: ${clipping.length} classNames clip to text, ${found.length} read as gradient elements`);
  }
  return found;
}

/** The gradient elements, refusing any count but the expected one, so no row below can loop over nothing. */
function censused(text: string): TitleElement[] {
  const found = gradientElements(text);
  if (found.length !== GRADIENT_ELEMENTS) {
    throw new Error(`Header.tsx: ${found.length} gradient elements, expected ${GRADIENT_ELEMENTS}`);
  }
  return found;
}

/** A shape as rendered, and the `<h1>`'s own text in it: the shape with its elements taken out. */
function rendered(shape: string, constants: Map<string, string>) {
  const elements = elementsIn(shape, constants);
  return {
    elements,
    text: jsxText(shape.replace(ELEMENT, (_, _tag: string, _attrs: string, inner: string) => inner)),
    ownText: jsxText(shape.replace(ELEMENT, '')),
  };
}

/** The one class with this exact variant and utility, e.g. `dark:` + `from-` → `#7494e0`. Exactly one. */
function endColor(classes: string[], variant: '' | 'dark:', utility: 'from' | 'to'): string {
  const pattern = new RegExp(`^${variant}${utility}-\\[(#[0-9a-f]{6})\\]$`, 'i');
  const hits = classes.map((c) => pattern.exec(c)?.[1]).filter((h): h is string => h !== undefined);
  if (hits.length !== 1) throw new Error(`${variant}${utility}-[#…]: found ${hits.length}, expected exactly 1`);
  return req(hits[0], 'end color').toLowerCase();
}

const endsOf = (classes: string[]) => ({
  light: [endColor(classes, '', 'from'), endColor(classes, '', 'to')],
  dark: [endColor(classes, 'dark:', 'from'), endColor(classes, 'dark:', 'to')],
});

/** A custom property in exactly one top-level `:root` or `:root.dark` block of globals.css. */
function rootVar(selector: ':root' | ':root.dark', name: '--background' | '--foreground'): string {
  const css = read(GLOBALS_CSS);
  const blocks = Array.from(css.matchAll(new RegExp(`^${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`, 'gm')));
  if (blocks.length !== 1) throw new Error(`globals.css: ${blocks.length} top-level ${selector} blocks, expected 1`);
  const m = new RegExp(`${name}:\\s*([^;]+);`).exec(req(blocks[0]?.[1], `${selector} block`));
  return parseCssColor(req(m?.[1], `${name} in ${selector}`));
}

/** Every file under src/ that renders `<Header`, but the component's own file. */
function callSites(): string[] {
  const src = join(ROOT, 'src');
  return (readdirSync(src, { recursive: true }) as string[])
    .filter((f) => /\.tsx$/.test(f))
    .map((f) => join(src, f))
    .filter((f) => f !== HEADER && /<Header\b/.test(read(f)));
}

/** Every static `className` in a stretch of JSX. A className of any other shape fails loudly. */
function staticClassNames(jsx: string, where: string): string[][] {
  const all = jsx.match(/className=/g) ?? [];
  const found = Array.from(jsx.matchAll(/className="([^"]*)"/g), (m) => classesOf(req(m[1], 'classes')));
  if (found.length !== all.length) throw new Error(`${where}: a className between the page and the title is not static`);
  return found;
}

/** A class that paints a ground or fades: `bg-…` or `opacity-…`, under any variant. */
const paintsOrFades = (c: string) => /(?:^|:)(?:bg-|opacity-)/.test(c);

/** Where a class's own rule starts in compiled CSS (its selector as Tailwind escapes it, whole), or -1. */
function ruleAt(css: string, cls: string): number {
  const selector = '.' + cls.replace(/[:[\]#@()]/g, (m) => '\\' + m);
  let i = css.indexOf(selector);
  while (i !== -1 && /[\w-]/.test(css.charAt(i + selector.length))) i = css.indexOf(selector, i + 1);
  return i;
}

// ---- The guard ----------------------------------------------------------------------------------

describe("the header's SPERT® Suite: a gradient in the suite's navy, readable in both themes (HDR26)", () => {
  describe('instrument self-checks', () => {
    it('the contrast formula: #767676 on white is 4.54 : 1', () => {
      expect(trunc(contrast('#767676', '#ffffff'))).toBe('4.54');
    });

    it("the OKLCH steps rebuild the suite's old blue gradient from #0070f3, with its hue turns", () => {
      // As Appendix A writes it. Algebraically this is a round trip of #0099ff and #0051cc through
      // OKLCH and the gamut fit, so it checks those conversions, not the steps themselves.
      const [p, g1, g2] = ['#0070f3', '#0099ff', '#0051cc'].map(toLch) as [Triple, Triple, Triple];
      const stepOf = (g: Triple): Triple => [g[0] - p[0], g[1] / p[1], g[2] - p[2]];
      const withTurn = (fav: string, d: Triple) => {
        const [lk, c, h] = toLch(fav);
        return fromLch([lk + d[0], c * d[1], h + d[2]]);
      };
      expect(withTurn('#0070f3', stepOf(g1))).toBe('#0099ff');
      expect(withTurn('#0070f3', stepOf(g2))).toBe('#0051cc');
    });

    it("parseCssColor reads #fff and the 'none'-hue form, and refuses what it cannot read", () => {
      expect(parseCssColor('#fff')).toBe('#ffffff');
      expect(parseCssColor('oklch(98.5% 0 none)')).toBe('#fafafa');
      expect(parseCssColor('oklch(27.8% 0.033 256.848)')).toBe('#1e2939');
      expect(() => parseCssColor('rgb(1, 2, 3)')).toThrow(/unreadable/);
    });

    it('the ramp sampler fails a known-bad: the old blue gradient is 2.99 : 1 on white and 2.87 on #0a0a0a', () => {
      // Vacuity control: a sampler that always passed would pass every row below.
      expect(trunc(weakest('#0099ff', '#0051cc', PREMISE.light, 'oklab'))).toBe('2.99');
      expect(trunc(weakest('#0099ff', '#0051cc', PREMISE.dark, 'oklab'))).toBe('2.87');
    });
  });

  it('the title has exactly four gradient elements: SPERT and Suite, as links on subpages and spans at home', () => {
    // Must-find, and the census: a reader that found nothing would pass every row below.
    const found = gradientElements(read(HEADER));
    expect(found.map((e) => `${e.tag} ${e.text}`)).toEqual(['Link SPERT', 'Link Suite', 'span SPERT', 'span Suite']);
    expect(found).toHaveLength(GRADIENT_ELEMENTS);
  });

  for (const shape of ['subpage', 'home'] as const) {
    it(`${shape}: the title reads "SPERT® Suite", and the space before Suite is the <h1>'s own text`, () => {
      // HDR26 ruling F1: the space is never the start of a gradient element. Inside one, an accessible
      // name loses it, and the second gradient would start on a blank. The <h1> is bold, so the space
      // keeps the words' weight and width.
      const text = read(HEADER);
      const r = rendered(shapes(text)[shape], stringConstants(text));
      expect(r.text).toBe('SPERT® Suite');
      expect(r.ownText).toBe(' ');
      for (const e of r.elements) expect(e.text, `<${e.tag}>${e.text}`).toBe(e.text.trim());
      expect(r.elements.map((e) => e.tag)).toEqual(shape === 'subpage' ? ['Link', 'span', 'Link'] : ['span', 'span', 'span']);
    });
  }

  it('the subpage title words stay links home', () => {
    const text = read(HEADER);
    const links = rendered(shapes(text).subpage, stringConstants(text)).elements.filter((e) => e.tag === 'Link');
    expect(links).toHaveLength(2);
    for (const l of links) expect(l.attrs, l.text).toMatch(/\bhref="\/"/);
  });

  it('all four carry the identical gradient string, and it holds only the gradient and its fallbacks (R5)', () => {
    // No size, weight, fade or other class: the string is exactly this. A fade on pointer-over (D9)
    // or a stray class anywhere in it fails here.
    for (const e of censused(read(HEADER))) expect(e.classes, `${e.tag} ${e.text}`).toEqual(classesOf(TITLE_CLASSES));
  });

  it('every gradient element carries the approved end colors, light end first (D5)', () => {
    for (const e of censused(read(HEADER))) expect(endsOf(e.classes), `${e.tag} ${e.text}`).toEqual(ENDS);
  });

  it("the <h1> and the ® are unchanged, and nothing else in the title fades or paints a ground", () => {
    // The bar's premise: bold, at least text-2xl (24 px), never a smaller size. The ® keeps its own
    // color, size and raised position (R3).
    const text = read(HEADER);
    const h1 = titleH1(text);
    expect(classesOf(req(/^<h1\s+className="([^"]*)"/.exec(h1)?.[1], '<h1> classes'))).toEqual(classesOf(H1_CLASSES));
    const regs = elementsIn(h1, stringConstants(text)).filter((e) => e.text === '®');
    expect(regs).toHaveLength(2);
    for (const r of regs) expect(r.classes).toEqual(classesOf(REG_CLASSES));
    const others = elementsIn(h1, stringConstants(text)).filter((e) => !e.classes.includes('bg-clip-text'));
    expect(others.flatMap((e) => e.classes).filter(paintsOrFades)).toEqual([]);
  });

  it("the page's background in globals.css is the pinned premise in each theme, and it is the body's", () => {
    expect(rootVar(':root', '--background')).toBe(PREMISE.light);
    expect(rootVar(':root.dark', '--background')).toBe(PREMISE.dark);
    expect(req(/^body\s*\{([^}]*)\}/m.exec(read(GLOBALS_CSS))?.[1], 'the body rule')).toMatch(
      /^\s*background:\s*var\(--background\);/m,
    );
  });

  it('nothing between the body and the title paints a ground of its own or fades it', () => {
    // The body is the title's ground only while nothing in between paints one: not the body's own
    // classes, not any page's wrapper around the header, and not the header itself down to the <h1>.
    // A fade would sink a ramp that clears its bar by hundredths.
    const body = req(/<body\s+className=\{`([^`]*)`\}/.exec(read(LAYOUT))?.[1], 'the <body> className');
    expect(classesOf(body).filter(paintsOrFades)).toEqual([]);

    const sites = callSites();
    expect(sites, 'the pages that render the header').toHaveLength(CALL_SITES);
    for (const site of sites) {
      const page = read(site);
      const at = page.search(/<Header\b/);
      const wrapper = staticClassNames(page.slice(page.lastIndexOf('return (', at), at), site);
      expect(wrapper.length, `${site}: the reader found the page's wrapper`).toBeGreaterThan(0);
      expect(wrapper.flat().filter(paintsOrFades), site).toEqual([]);
    }

    const header = read(HEADER);
    const inHeader = staticClassNames(header.slice(header.indexOf('<header className='), header.search(/<h1\s+className=/)), 'Header.tsx');
    expect(inHeader.length).toBeGreaterThan(0);
    expect(inHeader.flat().filter(paintsOrFades)).toEqual([]);
  });

  for (const theme of ['light', 'dark'] as const) {
    it(`${theme}: every point of the ramp meets ${BAR} : 1 on the page, in Oklab and in sRGB`, () => {
      for (const e of censused(read(HEADER))) {
        const [from, to] = endsOf(e.classes)[theme] as [string, string];
        for (const space of ['oklab', 'srgb'] as const) {
          const w = weakest(from, to, PREMISE[theme], space);
          expect(w, `${e.tag} ${e.text} ${theme} ${from} → ${to} on ${PREMISE[theme]} (${space}): ${trunc(w)}`)
            .toBeGreaterThanOrEqual(BAR);
        }
      }
    });
  }

  it("the fallback colors are the page's own foreground in globals.css: #171717 and #ededed", () => {
    expect(rootVar(':root', '--foreground')).toBe(FOREGROUND.light);
    expect(rootVar(':root.dark', '--foreground')).toBe(FOREGROUND.dark);
  });

  it('falls back to that solid foreground in print and under prefers-contrast: more (D10)', () => {
    // Pinned as the literal classes Header.tsx carries; the test above ties their colors to globals.css.
    for (const e of censused(read(HEADER))) {
      expect(e.classes, `${e.tag} ${e.text}`).toEqual(
        expect.arrayContaining([
          'print:bg-none',
          'print:text-[#171717]',
          'contrast-more:bg-none',
          'contrast-more:text-[#171717]',
          'dark:contrast-more:text-[#ededed]',
        ]),
      );
    }
    expect(contrast(FOREGROUND.light, PREMISE.light)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(FOREGROUND.dark, PREMISE.dark)).toBeGreaterThanOrEqual(4.5);
  });

  it('the dark variant is a :where() selector, so print wins by order alone (W2)', () => {
    // With :is(), every dark: utility would outrank a plain print: one, and a dark-theme print under
    // increased contrast would come out near-white on paper. Then each dark: fallback would need a
    // dark:print: twin, and the order test below would not be enough.
    expect(read(GLOBALS_CSS)).toMatch(/^@custom-variant dark \(&:where\(\.dark, \.dark \*\)\);$/m);
  });

  it('compiled, every gradient class produces CSS, and print comes after every other color and ground (W1)', async () => {
    // The title prints here (this repo has no print rules), and a print also matches
    // prefers-contrast: more on a Mac with Increase contrast on. The rules have equal specificity, so
    // the LAST one wins: if a Tailwind upgrade reordered the variants, or a fallback were written with
    // an arbitrary variant (which compiles after print:), a dark-theme print would come out near-white.
    const [first] = censused(read(HEADER));
    const classes = req(first, 'a gradient element').classes;
    const compiler = await compile(read(GLOBALS_CSS), { base: dirname(GLOBALS_CSS), onDependency() {} });
    const css = compiler.build(classes);
    const at = (c: string) => ruleAt(css, c);
    expect(classes.filter((c) => at(c) < 0), 'classes with no CSS of their own').toEqual([]);
    const printColor = req(classes.find((c) => c.startsWith('print:text-')), 'the print text color');
    for (const c of classes.filter((x) => /(?:^|:)text-/.test(x) && x !== printColor)) {
      expect(at(printColor), `${printColor} after ${c}`).toBeGreaterThan(at(c));
    }
    for (const c of classes.filter((x) => /(?:^|:)bg-(?:gradient|none)/.test(x) && x !== 'print:bg-none')) {
      expect(at('print:bg-none'), `print:bg-none after ${c}`).toBeGreaterThan(at(c));
    }
    expect(at('contrast-more:bg-none')).toBeGreaterThan(at('bg-gradient-to-r'));
    expect(at('dark:contrast-more:text-[#ededed]')).toBeGreaterThan(at('contrast-more:text-[#171717]'));
  }, 60_000);
});
