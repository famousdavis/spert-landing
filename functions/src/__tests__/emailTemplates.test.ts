import {
  AddedNotificationEmail,
  InvitationEmail,
} from "../emailTemplates";

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
    // eslint-disable-next-line new-cap
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
    // eslint-disable-next-line new-cap
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
    // eslint-disable-next-line new-cap
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
      // eslint-disable-next-line new-cap
      const tree = InvitationEmail({
        ownerName: "William W Davis",
        ownerEmail: "wdavis@example.com",
        modelName: "Virtual Art Museum",
        tokenId: "tok123",
        expirationDays: 30,
        urlBase: "https://storymap.spertsuite.com",
        appName: "SPERT Story Map",
      });
      const text = collectText(tree);
      expect(text).toContain("invited you to a SPERT Story Map project");
      expect(text).toContain("Open SPERT Story Map");
      // No leakage of any other app's brand string.
      expect(text).not.toContain("SPERT AHP");
      expect(text).not.toContain("SPERT CFD");
      expect(text).not.toContain("SPERT Forecaster");
      expect(text).not.toContain("GanttApp");
    });

  it("renders the appName in heading and button for SPERT Scheduler",
    () => {
      // eslint-disable-next-line new-cap
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
    // eslint-disable-next-line new-cap
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
    // eslint-disable-next-line new-cap
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
    // eslint-disable-next-line new-cap
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
    // eslint-disable-next-line new-cap
    const tree = AddedNotificationEmail({
      ownerName: "William W Davis",
      ownerEmail: "wdavis@example.com",
      modelName: "Virtual Art Museum",
      role: "editor",
      urlBase: "https://storymap.spertsuite.com",
      appName: "SPERT Story Map",
    });
    const text = collectText(tree);
    // Heading
    expect(text).toContain("added to a SPERT Story Map project");
    // Body sentence
    expect(text).toContain("Open SPERT Story Map to participate");
    // Button label
    expect(text).toContain("Open SPERT Story Map");
    expect(text).not.toContain("SPERT AHP");
    expect(text).not.toContain("SPERT CFD");
  });

  it("renders the appName in heading, body, and button for Scheduler", () => {
    // eslint-disable-next-line new-cap
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
    // eslint-disable-next-line new-cap
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
      // eslint-disable-next-line new-cap
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
      // eslint-disable-next-line new-cap
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
