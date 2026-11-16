// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// Plain ESM script, no declaration file; `allowJs` infers its shape.
import {
  ACTIONS,
  VERDICTS,
  checkGuide,
  compareInventory,
  exitCode,
  fail,
  listPublic,
  runFailures,
} from '../../scripts/check-help-guides.mjs';
import type { HelpApp } from '../data/help';

/**
 * Proof that scripts/check-help-guides.mjs, the Help Center's two daily checks,
 * tells broken from working — offline, against a node:http server on port 0.
 *
 * The live checks can only ever see today's production, where everything is
 * (one hopes) fine; a check that never sees a failure proves nothing. So each
 * way a guide link or a repo listing can go wrong is staged here, and each must
 * get its own verdict. The short timeouts keep every case well inside Vitest's
 * 5 s default; the CLI uses 30 s and 5 s.
 *
 * G8  link verdicts            checkGuide
 * G9  list verdicts            compareInventory (pure)
 * G10 GitHub API verdicts      listPublic
 * G11 exit codes, action lines exitCode, runFailures, fail, VERDICTS, ACTIONS
 */

const FAST = { timeoutMs: 200, retryDelayMs: 0 };
const PDF = '%PDF-1.7\n% test\n';

let server: Server;
let base = '';
const hits = new Map<string, number>();
const seen: { authorization?: string; ref?: string | null } = {};
/** Every verdict code the G8–G10 cases produced; G11 checks each is in VERDICTS. */
const produced = new Set<string>();

function record<T extends { ok: boolean; code?: string }>(v: T): T {
  if (!v.ok && v.code) produced.add(v.code);
  return v;
}

function route(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', base);
  const n = (hits.get(url.pathname) ?? 0) + 1;
  hits.set(url.pathname, n);
  const listing = JSON.stringify([
    { name: 'Guide.pdf', type: 'file' },
    { name: 'favicon.png', type: 'file' },
    { name: '.well-known', type: 'dir' },
  ]);

  switch (url.pathname) {
    case '/pdf':
      res.writeHead(200, { 'content-type': 'application/pdf' }).end(PDF);
      return;
    case '/html':
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end('<!doctype html><title>App</title>');
      return;
    case '/gone':
      res.writeHead(404, { 'content-type': 'text/html' }).end('not found');
      return;
    case '/redirect':
      res.writeHead(308, { location: '/pdf' }).end();
      return;
    case '/fake-pdf':
      res.writeHead(200, { 'content-type': 'application/pdf' }).end('hello, not a pdf');
      return;
    case '/flaky':
      if (n === 1) res.writeHead(500).end('boom');
      else res.writeHead(200, { 'content-type': 'application/pdf' }).end(PDF);
      return;
    case '/hang':
      return; // never answers
    case '/repos/o/ok/contents/public':
      seen.authorization = req.headers.authorization;
      seen.ref = url.searchParams.get('ref');
      res.writeHead(200, { 'content-type': 'application/json' }).end(listing);
      return;
    case '/repos/o/moved/contents/public':
      // A followed redirect would land on a perfectly good listing: the known-bad this row exists for.
      res.writeHead(301, { location: `${base}/repos/o/ok/contents/public?ref=main` }).end();
      return;
    case '/repos/o/missing/contents/public':
      res.writeHead(404, { 'content-type': 'application/json' }).end('{"message":"Not Found"}');
      return;
    case '/repos/o/limited/contents/public':
      res.writeHead(403, { 'x-ratelimit-remaining': '0' }).end('{"message":"API rate limit exceeded"}');
      return;
    case '/repos/o/flaky/contents/public':
      if (n === 1) res.writeHead(502).end();
      else res.writeHead(200, { 'content-type': 'application/json' }).end(listing);
      return;
    case '/repos/o/down/contents/public':
      res.writeHead(500).end();
      return;
    default:
      res.writeHead(418).end();
  }
}

beforeAll(async () => {
  server = createServer(route);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
});

beforeEach(() => hits.clear());

describe('G8: checkGuide tells a working guide link from every broken one', () => {
  it('passes a 200 application/pdf whose body starts %PDF-', async () => {
    expect(await checkGuide(`${base}/pdf`, FAST)).toEqual({ ok: true });
  });

  it.each([
    ['/html', 'app-page'],
    ['/gone', 'removed'],
    // Node's fetch follows a 308 by default, and the PDF behind it would pass.
    ['/redirect', 'moved'],
    ['/fake-pdf', 'not-pdf'],
  ])('fails %s as %s', async (path, code) => {
    const v = record(await checkGuide(`${base}${path}`, FAST));
    expect(v).toMatchObject({ ok: false, code });
  });

  it('passes a 500 followed by a good PDF, after one retry', async () => {
    expect(await checkGuide(`${base}/flaky`, FAST)).toEqual({ ok: true });
    expect(hits.get('/flaky')).toBe(2);
  });

  it('fails a response that never comes as unreachable, after three attempts', async () => {
    const v = record(await checkGuide(`${base}/hang`, FAST));
    expect(v).toMatchObject({ ok: false, code: 'unreachable' });
    expect(v.detail).toMatch(/timed out .*after 3 attempts/);
    expect(hits.get('/hang')).toBe(3);
  });
});

function app(over: Partial<HelpApp> = {}): HelpApp {
  return {
    slug: 'x',
    name: 'X',
    appUrl: 'https://x.spertsuite.com/',
    summary: 's',
    repo: 'o/x',
    listed: true,
    guides: [{ file: 'Guide.pdf', title: 't', description: 'd' }],
    ...over,
  };
}
const file = (name: string) => ({ name, type: 'file' });
const codes = (r: ReturnType<typeof compareInventory>) => r.failures.map((f) => record(f).code);

describe('G9: compareInventory compares help.ts with a repo listing', () => {
  it('reports a repo PDF that help.ts does not list', () => {
    expect(codes(compareInventory(app(), [file('Guide.pdf'), file('New.pdf')]))).toEqual(['new-guide']);
  });

  it('treats an upper-case .PDF as a PDF', () => {
    expect(codes(compareInventory(app(), [file('Guide.pdf'), file('New.PDF')]))).toEqual(['new-guide']);
  });

  it('reports a listed guide missing from the repo', () => {
    expect(codes(compareInventory(app(), []))).toEqual(['guide-gone']);
  });

  it('accepts a notListed file that is present, and reports one that is gone', () => {
    const a = app({ notListed: [{ file: 'Draft.pdf', reason: 'not ready' }] });
    expect(codes(compareInventory(a, [file('Guide.pdf'), file('Draft.pdf')]))).toEqual([]);
    expect(codes(compareInventory(a, [file('Guide.pdf')]))).toEqual(['stale-notlisted']);
  });

  it('ignores the legal copies, other files and directories', () => {
    const r = compareInventory(app(), [
      file('Guide.pdf'),
      file('TOS.pdf'),
      file('PRIVACY.pdf'),
      file('favicon.png'),
      { name: '.well-known', type: 'dir' },
    ]);
    expect(codes(r)).toEqual([]);
    expect(r.counts).toEqual({ pdfs: 3, listed: 1, notListed: 0, ignored: 2 });
  });
});

describe('G10: listPublic reads a repo listing and never follows a redirect', () => {
  const opts = () => ({ ...FAST, apiBase: base });

  it('returns the entries, asks for main, and sends the token when given one', async () => {
    const v = await listPublic('o/ok', { ...opts(), token: 'test-token' });
    expect(v).toMatchObject({ ok: true });
    expect(v.ok && v.entries).toContainEqual({ name: 'Guide.pdf', type: 'file' });
    expect(seen.authorization).toBe('Bearer test-token');
    expect(seen.ref).toBe('main');
  });

  it.each([
    // Followed, this redirect would return o/ok's good listing.
    ['o/moved', 'repo-moved'],
    ['o/missing', 'repo-missing'],
    ['o/limited', 'rate-limited'],
    ['o/down', 'api-error'],
  ])('fails %s as %s', async (repo, code) => {
    const v = record(await listPublic(repo, opts()));
    expect(v).toMatchObject({ ok: false, code });
  });

  it('returns the entries after a 5xx, on retry', async () => {
    expect(await listPublic('o/flaky', opts())).toMatchObject({ ok: true });
    expect(hits.get('/repos/o/flaky/contents/public')).toBe(2);
  });
});

describe('G11: a run is green only when nothing failed and everything listed was checked', () => {
  const links = (checked: { guides: number; controls: number }, failures: unknown[] = []) => ({
    mode: 'links',
    expected: { guides: 13, hosts: 6 },
    checked,
    failures,
  });
  const inventory = (repos: number, expected = 7, failures: unknown[] = []) => ({
    mode: 'inventory',
    expected: { repos: expected },
    checked: { repos },
    failures,
  });
  const runCodes = (r: Parameters<typeof runFailures>[0]) => runFailures(r).map((f) => record(f).code);

  it('is green when every guide and every host control was checked and nothing failed', () => {
    expect(exitCode(links({ guides: 13, controls: 6 }))).toBe(0);
    expect(exitCode(inventory(7))).toBe(0);
  });

  it('is red on any failure, a control that passed included', () => {
    expect(exitCode(links({ guides: 13, controls: 6 }, [fail('removed', 'x')]))).toBe(1);
    expect(exitCode(links({ guides: 13, controls: 6 }, [fail('control-passed', 'host')]))).toBe(1);
    expect(exitCode(inventory(7, 7, [fail('new-guide', 'x')]))).toBe(1);
  });

  it('is red on a short run: no controls, a skipped guide, a skipped repo', () => {
    expect(runCodes(links({ guides: 13, controls: 0 }))).toEqual(['short-run']);
    expect(exitCode(links({ guides: 13, controls: 0 }))).toBe(1);
    expect(runCodes(links({ guides: 12, controls: 6 }))).toEqual(['short-run']);
    expect(runCodes(inventory(6))).toEqual(['short-run']);
    expect(exitCode(inventory(6))).toBe(1);
  });

  it('is red on an empty run, even when it checked everything there was', () => {
    const empty = { mode: 'links', expected: { guides: 0, hosts: 0 }, checked: { guides: 0, controls: 0 }, failures: [] };
    expect(runCodes(empty)).toEqual(['empty-run']);
    expect(exitCode(empty)).toBe(1);
    expect(runCodes(inventory(0, 0))).toEqual(['empty-run']);
  });

  it('refuses to make a failure outside VERDICTS', () => {
    expect(() => fail('not-a-verdict', 'x')).toThrow(/not in VERDICTS/);
  });

  it('has an action line for every verdict, and no action line without one', () => {
    for (const code of VERDICTS) expect(ACTIONS[code as keyof typeof ACTIONS], code).toMatch(/\S/);
    expect(Object.keys(ACTIONS).sort()).toEqual([...VERDICTS].sort());
  });

  // Declared last: Vitest runs a file's tests in order, so the cases above have all run.
  it('produced only verdicts in VERDICTS above', () => {
    expect(produced.size).toBeGreaterThan(10);
    expect([...produced].filter((c) => !VERDICTS.includes(c))).toEqual([]);
  });
});
