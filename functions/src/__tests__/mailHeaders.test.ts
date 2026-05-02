import {sanitizeDisplayName, sanitizeSubject} from "../mailHeaders";

describe("sanitizeDisplayName", () => {
  it("passes plain ASCII through unchanged", () => {
    expect(sanitizeDisplayName("William Davis")).toBe("William Davis");
  });

  it("quotes a value containing a comma (Microsoft Last, First case)", () => {
    expect(sanitizeDisplayName("Davis, William")).toBe("\"Davis, William\"");
  });

  it("strips CRLF (header injection defense)", () => {
    const out = sanitizeDisplayName("Alice\r\nBcc: x@y.com");
    expect(out).not.toMatch(/[\r\n]/);
    // Result contains specials (':' and '@'), so it should be quoted.
    expect(out.startsWith("\"")).toBe(true);
  });

  it("escapes \" and backslash inside quoted form", () => {
    expect(sanitizeDisplayName("a\"b\\c,")).toBe("\"a\\\"b\\\\c,\"");
  });

  it("handles the brief's adversarial example", () => {
    const out = sanitizeDisplayName("O'Brien, Sean\r\nBcc: x@y");
    expect(out).not.toMatch(/[\r\n]/);
    // Specials ',', ':', '@' present → quoted
    expect(out.startsWith("\"")).toBe(true);
    expect(out.endsWith("\"")).toBe(true);
  });
});

describe("sanitizeSubject", () => {
  it("passes plain ASCII through unchanged", () => {
    expect(sanitizeSubject("Alice invited you to MyModel")).toBe(
      "Alice invited you to MyModel",
    );
  });

  it("strips CRLF", () => {
    expect(sanitizeSubject("Subject\r\nBcc: x@y")).toBe(
      "SubjectBcc: x@y",
    );
  });

  it("preserves specials (no quoting required for subjects)", () => {
    expect(sanitizeSubject("Hello, \"world\" <test@example.com>")).toBe(
      "Hello, \"world\" <test@example.com>",
    );
  });
});
