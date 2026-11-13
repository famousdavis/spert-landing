// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.
// See LICENSE file in the project root for full license text.

import {
  AddedNotificationEmail,
  InvitationEmail,
} from "../emailTemplates";
import * as old from "./fixtures/emailTemplates.b6c9a14";
import {
  APP_NAMES_BY_APP_ID,
  HEADINGS_BY_APP_ID,
  SUPPORTED_APP_IDS,
  getHeadings,
} from "../invitationMailer";

// Story Map's appId, found by its brand name rather than retyped.
const STORY_MAP = Object.keys(APP_NAMES_BY_APP_ID)
  .find((id) => APP_NAMES_BY_APP_ID[id] === "SPERT Story Map") as string;

/**
 * Walk a React element tree and collect every `href` prop value.
 * @param {unknown} node React element, array, or primitive.
 * @return {string[]} All href strings found in the subtree.
 */
function collectHrefs(node: unknown): string[] {
  const out: string[] = [];
  const visit = (n: unknown): void => {
    if (n === null || n === undefined) return;
    if (Array.isArray(n)) {
      n.forEach(visit);
      return;
    }
    if (typeof n !== "object") return;
    const el = n as { props?: Record<string, unknown> };
    const props = el.props ?? {};
    if (typeof props.href === "string") {
      out.push(props.href);
    }
    visit(props.children);
  };
  visit(node);
  return out;
}

/**
 * Walk a React element tree and concatenate every string child it encounters.
 * Used to assert that the resolved app brand name (heading, button label,
 * body sentence) appears in the rendered output. Concatenation is done with
 * empty join so that adjacent JSX text fragments render the same way the
 * email template emits them (whitespace is preserved inside each fragment).
 *
 * @param {unknown} node React element, array, or primitive.
 * @return {string} All string children concatenated in encounter order.
 */
function collectText(node: unknown): string {
  const parts: string[] = [];
  const visit = (n: unknown): void => {
    if (n === null || n === undefined) return;
    if (typeof n === "string") {
      parts.push(n);
      return;
    }
    if (Array.isArray(n)) {
      n.forEach(visit);
      return;
    }
    if (typeof n !== "object") return;
    const el = n as { props?: Record<string, unknown> };
    visit(el.props?.children);
  };
  visit(node);
  return parts.join("");
}

describe("InvitationEmail urlBase", () => {
  it("substitutes the prod urlBase into the claim link", () => {
    const tree = InvitationEmail({
      ownerName: "Alice",
      ownerEmail: "alice@example.com",
      modelName: "MyModel",
      tokenId: "tok123",
      expirationDays: 30,
      urlBase: "https://ahp.spertsuite.com",
      appName: "SPERT AHP",
    });
    const hrefs = collectHrefs(tree);
    expect(hrefs).toContain("https://ahp.spertsuite.com/?invite=tok123");
    expect(hrefs.every((h) => !h.startsWith("http://localhost"))).toBe(true);
  });

  it("substitutes a localhost urlBase into the claim link", () => {
    const tree = InvitationEmail({
      ownerName: "Alice",
      ownerEmail: "alice@example.com",
      modelName: "MyModel",
      tokenId: "tok123",
      expirationDays: 30,
      urlBase: "http://localhost:5176",
      appName: "SPERT AHP",
    });
    const hrefs = collectHrefs(tree);
    expect(hrefs).toContain("http://localhost:5176/?invite=tok123");
    expect(hrefs.every((h) => !h.startsWith("https://ahp.spertsuite.com")))
      .toBe(true);
  });

  it("renders the URL in both Button and anchor positions", () => {
    const tree = InvitationEmail({
      ownerName: "Alice",
      ownerEmail: "alice@example.com",
      modelName: "MyModel",
      tokenId: "tok123",
      expirationDays: 30,
      urlBase: "http://localhost:5176",
      appName: "SPERT AHP",
    });
    const hrefs = collectHrefs(tree);
    const matches = hrefs.filter(
      (h) => h === "http://localhost:5176/?invite=tok123",
    );
    expect(matches.length).toBe(2);
  });
});

describe("InvitationEmail appName branding", () => {
  // Regression: prior to this, the heading and button label were hardcoded
  // to "SPERT AHP" in the template body, so every other app's invitation
  // emails (CFD, Forecaster, GanttApp, Story Map) said "SPERT AHP" in the
  // body even though the From line and subject were correctly branded.
  it("renders the appName in heading and button for SPERT Story Map",
    () => {
      const tree = InvitationEmail({
        ownerName: "William W Davis",
        ownerEmail: "wdavis@example.com",
        modelName: "Virtual Art Museum",
        tokenId: "tok123",
        expirationDays: 30,
        urlBase: "https://storymap.spertsuite.com",
        appName: "SPERT Story Map",
        heading: getHeadings(STORY_MAP)?.invited("William W Davis"),
      });
      const text = collectText(tree);
      expect(text).toContain(
        "William W Davis invited you to collaborate in SPERT Story Map");
      expect(text).not.toMatch(/project|product owner/i);
      expect(text).toContain("Open SPERT Story Map");
      // No leakage of any other app's brand string.
      expect(text).not.toContain("SPERT AHP");
      expect(text).not.toContain("SPERT CFD");
      expect(text).not.toContain("SPERT Forecaster");
      expect(text).not.toContain("GanttApp");
    });

  it("renders the appName in heading and button for SPERT Scheduler",
    () => {
      const tree = InvitationEmail({
        ownerName: "William W Davis",
        ownerEmail: "wdavis@example.com",
        modelName: "Q3 Construction Schedule",
        tokenId: "tok123",
        expirationDays: 30,
        urlBase: "https://scheduler.spertsuite.com",
        appName: "SPERT Scheduler",
      });
      const text = collectText(tree);
      expect(text).toContain("invited you to a SPERT Scheduler project");
      expect(text).toContain("Open SPERT Scheduler");
      // No leakage of any other app's brand string.
      expect(text).not.toContain("SPERT AHP");
      expect(text).not.toContain("SPERT CFD");
      expect(text).not.toContain("SPERT Forecaster");
      expect(text).not.toContain("SPERT Story Map");
      expect(text).not.toContain("GanttApp");
    });

  it("renders the appName in the heading and button for SPERT CFD", () => {
    // Second case — confirms the rebrand isn't accidentally hardcoded to
    // any single app's name.
    const tree = InvitationEmail({
      ownerName: "Alice",
      ownerEmail: "alice@example.com",
      modelName: "MyCfdModel",
      tokenId: "tok123",
      expirationDays: 30,
      urlBase: "https://cfd.spertsuite.com",
      appName: "SPERT CFD",
    });
    const text = collectText(tree);
    expect(text).toContain("invited you to a SPERT CFD project");
    expect(text).toContain("Open SPERT CFD");
    expect(text).not.toContain("SPERT AHP");
    expect(text).not.toContain("SPERT Story Map");
  });
});

describe("AddedNotificationEmail urlBase", () => {
  it("substitutes the prod urlBase into the CTA without a token", () => {
    const tree = AddedNotificationEmail({
      ownerName: "Alice",
      ownerEmail: "alice@example.com",
      modelName: "MyModel",
      role: "editor",
      urlBase: "https://ahp.spertsuite.com",
      appName: "SPERT AHP",
    });
    const hrefs = collectHrefs(tree);
    expect(hrefs).toContain("https://ahp.spertsuite.com");
    expect(hrefs.every((h) => !h.includes("?invite="))).toBe(true);
  });

  it("substitutes a localhost urlBase into the CTA", () => {
    const tree = AddedNotificationEmail({
      ownerName: "Alice",
      ownerEmail: "alice@example.com",
      modelName: "MyModel",
      role: "viewer",
      urlBase: "http://localhost:5176",
      appName: "SPERT AHP",
    });
    const hrefs = collectHrefs(tree);
    expect(hrefs).toContain("http://localhost:5176");
    expect(hrefs.every((h) => !h.startsWith("https://ahp.spertsuite.com")))
      .toBe(true);
  });
});

describe("AddedNotificationEmail appName branding", () => {
  it("renders the appName in heading, body, and button for Story Map", () => {
    const tree = AddedNotificationEmail({
      ownerName: "William W Davis",
      ownerEmail: "wdavis@example.com",
      modelName: "Virtual Art Museum",
      role: "editor",
      urlBase: "https://storymap.spertsuite.com",
      appName: "SPERT Story Map",
      heading: getHeadings(STORY_MAP)?.added,
    });
    const text = collectText(tree);
    // Heading
    expect(text).toContain(
      "You've been added as a collaborator in SPERT Story Map");
    expect(text).not.toMatch(/project|product owner/i);
    // Body sentence
    expect(text).toContain("Open SPERT Story Map to participate");
    // Button label
    expect(text).toContain("Open SPERT Story Map");
    expect(text).not.toContain("SPERT AHP");
    expect(text).not.toContain("SPERT CFD");
  });

  it("renders the appName in heading, body, and button for Scheduler", () => {
    const tree = AddedNotificationEmail({
      ownerName: "William W Davis",
      ownerEmail: "wdavis@example.com",
      modelName: "Q3 Construction Schedule",
      role: "editor",
      urlBase: "https://scheduler.spertsuite.com",
      appName: "SPERT Scheduler",
    });
    const text = collectText(tree);
    // Heading
    expect(text).toContain("added to a SPERT Scheduler project");
    // Body sentence
    expect(text).toContain("Open SPERT Scheduler to participate");
    // Button label
    expect(text).toContain("Open SPERT Scheduler");
    expect(text).not.toContain("SPERT AHP");
    expect(text).not.toContain("SPERT CFD");
    expect(text).not.toContain("SPERT Forecaster");
    expect(text).not.toContain("SPERT Story Map");
    expect(text).not.toContain("GanttApp");
  });

  it("renders the appName in heading, body, and button for SPERT CFD", () => {
    const tree = AddedNotificationEmail({
      ownerName: "Alice",
      ownerEmail: "alice@example.com",
      modelName: "MyCfdModel",
      role: "viewer",
      urlBase: "https://cfd.spertsuite.com",
      appName: "SPERT CFD",
    });
    const text = collectText(tree);
    expect(text).toContain("added to a SPERT CFD project");
    expect(text).toContain("Open SPERT CFD to participate");
    expect(text).not.toContain("SPERT AHP");
    expect(text).not.toContain("SPERT Story Map");
  });
});

describe("AddedNotificationEmail role article (regression: \"a editor\")", () => {
  // Prior bug: the body hardcoded the indefinite article — "added you as a
  // {role}" — so every editor notification read "added you as a editor".
  // Found in a live production email, July 28 2026. The article is now
  // derived from the role, which is exhaustively "editor" | "viewer".
  const base = {
    ownerName: "William W Davis",
    ownerEmail: "wdavis@example.com",
    modelName: "Virtual Art Museum",
    urlBase: "https://storymap.spertsuite.com",
    appName: "SPERT Story Map",
  };

  it("uses \"an\" for the editor role", () => {
    const text = collectText(
      AddedNotificationEmail({...base, role: "editor"}),
    );
    expect(text).toContain("added you as an editor on");
    expect(text).not.toContain("as a editor");
  });

  it("uses \"a\" for the viewer role", () => {
    const text = collectText(
      AddedNotificationEmail({...base, role: "viewer"}),
    );
    expect(text).toContain("added you as a viewer on");
    expect(text).not.toContain("as an viewer");
  });
});

describe("model name quoting (regression: v0.29 double-quote bug)", () => {
  // Prior bug: sanitizeDisplayName was applied to modelName upstream
  // (which RFC 5322-quotes commas), then the body templates wrapped the
  // already-quoted value in &quot;…&quot; again, producing
  // ""Virtual Art Museum - Thomas, Jenny"". The upstream now passes the
  // raw display string; the templates remain the sole source of visible
  // quotes. Lock that in for both templates and several name shapes so
  // future changes either upstream or in the template trip a test.
  const adversarialNames = [
    "Virtual Art Museum - Thomas, Jenny",
    "MyProject",
    "Project: Q3, 2026",
    "a\"b",
  ];

  for (const name of adversarialNames) {
    it(`InvitationEmail wraps modelName="${name}" in exactly one pair of ` +
      "quotes", () => {
      const tree = InvitationEmail({
        ownerName: "William W Davis",
        ownerEmail: "wdavis@example.com",
        modelName: name,
        tokenId: "tok123",
        expirationDays: 30,
        urlBase: "https://storymap.spertsuite.com",
        appName: "SPERT Story Map",
      });
      const text = collectText(tree);
      expect(text).toContain(`"${name}"`);
      expect(text).not.toContain(`""${name}""`);
    });

    it(`AddedNotificationEmail wraps modelName="${name}" in exactly one ` +
      "pair of quotes", () => {
      const tree = AddedNotificationEmail({
        ownerName: "William W Davis",
        ownerEmail: "wdavis@example.com",
        modelName: name,
        role: "editor",
        urlBase: "https://storymap.spertsuite.com",
        appName: "SPERT Story Map",
      });
      const text = collectText(tree);
      expect(text).toContain(`"${name}"`);
      expect(text).not.toContain(`""${name}""`);
    });
  }
});

describe("other apps' emails are unchanged since b6c9a14 (v2.12.0)", () => {
  const others = Object.entries(APP_NAMES_BY_APP_ID)
    .filter(([id]) => id !== STORY_MAP);
  const invite = (appName: string) => ({ownerName: "Alice, Q",
    ownerEmail: "a@x.com", modelName: "M", tokenId: "t", expirationDays: 30,
    urlBase: "https://x.spertsuite.com", appName});
  const added = (appName: string) => ({ownerName: "Alice, Q",
    ownerEmail: "a@x.com", modelName: "M", role: "viewer" as const,
    urlBase: "https://x.spertsuite.com", appName});

  test("six apps are compared", () => {
    expect(others).toHaveLength(6);
  });
  test.each(others)("%s: both element trees equal b6c9a14's", (_, appName) => {
    expect(InvitationEmail(invite(appName)))
      .toEqual(old.InvitationEmail(invite(appName)));
    expect(AddedNotificationEmail(added(appName)))
      .toEqual(old.AddedNotificationEmail(added(appName)));
  });
  test("control: one string with the same visible text is NOT equal", () => {
    const p = invite("SPERT AHP");
    const same = InvitationEmail({...p,
      heading: "Alice, Q invited you to a SPERT AHP project"});
    expect(collectText(same)).toBe(collectText(old.InvitationEmail(p)));
    expect(same).not.toEqual(old.InvitationEmail(p));
  });
});

describe("only Story Map's emails get their own heading (v2.12.0)", () => {
  // The six-app trees above call the templates without the mailer, so they
  // cannot see a heading the mailer gives another app. This reads the mailer.
  test("the mailer gives a heading to Story Map and to no other app", () => {
    expect(STORY_MAP).toBe("spertstorymap");
    expect(Object.keys(HEADINGS_BY_APP_ID)).toEqual([STORY_MAP]);
    // The real list of supported apps, not a copy. Must-find: it holds
    // Story Map and other apps, so the filter below has something to check.
    const ids = [...SUPPORTED_APP_IDS];
    expect(ids).toContain(STORY_MAP);
    expect(ids.length).toBeGreaterThan(1);
    expect(ids.filter((id) => getHeadings(id) !== undefined))
      .toEqual([STORY_MAP]);
    // An inherited key is not a heading.
    expect(getHeadings("toString")).toBeUndefined();
    expect(getHeadings("__proto__")).toBeUndefined();
  });
});
