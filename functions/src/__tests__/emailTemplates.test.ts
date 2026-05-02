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
    });
    const hrefs = collectHrefs(tree);
    const matches = hrefs.filter(
      (h) => h === "http://localhost:5176/?invite=tok123",
    );
    expect(matches.length).toBe(2);
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
    });
    const hrefs = collectHrefs(tree);
    expect(hrefs).toContain("http://localhost:5176");
    expect(hrefs.every((h) => !h.startsWith("https://ahp.spertsuite.com")))
      .toBe(true);
  });
});
