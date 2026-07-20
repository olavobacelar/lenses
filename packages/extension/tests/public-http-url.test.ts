import { describe, expect, it } from "vitest";
import {
  isPublicHostname,
  normalizePublicHttpUrl,
} from "../src/lib/public-http-url.js";

describe("public HTTP URL policy", () => {
  it("accepts ordinary public HTTP and HTTPS URLs", () => {
    expect(normalizePublicHttpUrl("https://example.com/report#section")).toBe(
      "https://example.com/report"
    );
    expect(isPublicHostname("subdomain.example.org")).toBe(true);
  });

  it.each([
    "http://localhost/admin",
    "http://127.0.0.1/",
    "http://10.0.0.8/",
    "http://169.254.169.254/latest/meta-data/",
    "http://192.168.1.1/",
    "http://[::1]/",
    "http://[fd00::1]/",
    "http://printer.local/",
  ])("rejects private or special-use target %s", (url) => {
    expect(normalizePublicHttpUrl(url)).toBeNull();
  });

  it("rejects embedded credentials and non-HTTP schemes", () => {
    expect(normalizePublicHttpUrl("https://user:pass@example.com/")).toBeNull();
    expect(normalizePublicHttpUrl("file:///etc/passwd")).toBeNull();
  });
});
