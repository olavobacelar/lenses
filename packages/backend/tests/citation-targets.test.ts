import { describe, expect, it } from "vitest";
import {
  isPublicIpAddress,
  mapWithConcurrency,
} from "../src/citationTargets.js";
import { normalizePublicCitationUrl } from "../src/citationUrl.js";

describe("citation publisher network targets", () => {
  it("rejects private, local, reserved, credentialed, and nonstandard-port targets", () => {
    const blocked = [
      "http://localhost/",
      "http://service.internal/",
      "http://router.local/",
      "http://10.0.0.1/",
      "http://169.254.169.254/latest/meta-data/",
      "http://2130706433/",
      "http://0177.0.0.1/",
      "http://[::1]/",
      "http://[::ffff:127.0.0.1]/",
      "http://[64:ff9b::a00:1]/",
      "http://[2002:0a00:0001::]/",
      "http://[fec0::1]/",
      "https://user:pass@openai.com/",
      "https://openai.com:8443/",
    ];

    for (const url of blocked) {
      expect(normalizePublicCitationUrl(url), url).toBeNull();
    }
  });

  it("keeps ordinary public HTTP(S) URLs and strips fragments", () => {
    expect(normalizePublicCitationUrl("https://openai.com/research#section")).toBe(
      "https://openai.com/research"
    );
    expect(normalizePublicCitationUrl("ftp://openai.com/file")).toBeNull();
    expect(normalizePublicCitationUrl("https://bad_host.openai.com/")).toBeNull();
  });

  it("classifies public and non-public DNS answers", () => {
    expect(isPublicIpAddress("8.8.8.8")).toBe(true);
    expect(isPublicIpAddress("2606:4700:4700::1111")).toBe(true);
    expect(isPublicIpAddress("100.64.0.1")).toBe(false);
    expect(isPublicIpAddress("192.0.2.10")).toBe(false);
    expect(isPublicIpAddress("fe80::1")).toBe(false);
    expect(isPublicIpAddress("64:ff9b::c0a8:1")).toBe(false);
    expect(isPublicIpAddress("2002:c0a8:1::")).toBe(false);
    expect(isPublicIpAddress("fec0::1")).toBe(false);
  });

  it("bounds concurrent publisher work while preserving result order", async () => {
    let active = 0;
    let maximumActive = 0;
    const results = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (value) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return value * 2;
    });

    expect(maximumActive).toBeLessThanOrEqual(2);
    expect(results).toEqual([2, 4, 6, 8, 10]);
  });
});
