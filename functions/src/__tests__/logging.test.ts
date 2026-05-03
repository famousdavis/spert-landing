import {redactToken} from "../logging";

describe("redactToken", () => {
  it("returns empty string for empty input", () => {
    expect(redactToken("")).toBe("");
  });

  it("truncates to first 8 chars + ellipsis", () => {
    expect(redactToken("0123456789abcdef-1234")).toBe("01234567…");
  });

  it("never exposes the full token", () => {
    const full = "abcdef01-2345-6789-abcd-ef0123456789";
    const out = redactToken(full);
    expect(out).not.toContain(full);
    expect(out.length).toBe(9);
  });
});
