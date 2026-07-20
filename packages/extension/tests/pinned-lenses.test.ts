import { describe, expect, it } from "vitest";
import {
  isAnnotationPinned,
  isLensPinned,
  parsePinnedIdsByDomain,
  pinKeyFromUrl,
  pinsForDomain,
  toggleAnnotationPin,
  toggleLensPin,
  type PinnedIdsByDomain,
} from "../src/lib/pinned-lenses";

describe("pinKeyFromUrl", () => {
  it("strips scheme, path, www, and lowercases", () => {
    expect(pinKeyFromUrl("https://www.NYTimes.com/article/123")).toBe("nytimes.com");
    expect(pinKeyFromUrl("http://example.com")).toBe("example.com");
  });

  it("collapses subdomains to the eTLD+1 site", () => {
    expect(pinKeyFromUrl("https://news.nytimes.com/x")).toBe("nytimes.com");
    expect(pinKeyFromUrl("https://cooking.nytimes.com/recipes")).toBe("nytimes.com");
  });

  it("returns null for unusable URLs", () => {
    expect(pinKeyFromUrl("")).toBeNull();
    expect(pinKeyFromUrl("not a url")).toBeNull();
    expect(pinKeyFromUrl("chrome://settings")).toBeNull();
  });
});

describe("parsePinnedIdsByDomain", () => {
  it("returns empty object for non-object inputs", () => {
    expect(parsePinnedIdsByDomain(null)).toEqual({});
    expect(parsePinnedIdsByDomain(undefined)).toEqual({});
    expect(parsePinnedIdsByDomain("nope")).toEqual({});
    expect(parsePinnedIdsByDomain(42)).toEqual({});
  });

  it("normalises domain keys and id lists", () => {
    const out = parsePinnedIdsByDomain({
      "www.NYTimes.com": { lensIds: ["claims", "claims", " sources "], annotationIds: [] },
    });
    expect(out).toEqual({
      "nytimes.com": { lensIds: ["claims", "sources"], annotationIds: [] },
    });
  });

  it("drops domains with no remaining ids and ignores malformed rows", () => {
    const out = parsePinnedIdsByDomain({
      "example.com": { lensIds: [], annotationIds: [] },
      "good.com": { lensIds: ["a"] },
      garbage: 42,
      "also.com": null,
    });
    expect(out).toEqual({ "good.com": { lensIds: ["a"], annotationIds: [] } });
  });

  it("filters non-string entries from id lists", () => {
    const out = parsePinnedIdsByDomain({
      "x.com": { lensIds: ["claims", 5, null, "sources"], annotationIds: [{}, "claim-extractor"] },
    });
    expect(out["x.com"]).toEqual({
      lensIds: ["claims", "sources"],
      annotationIds: ["claim-extractor"],
    });
  });
});

describe("pinsForDomain", () => {
  it("returns the entry when present, regardless of input case", () => {
    const map: PinnedIdsByDomain = {
      "example.com": { lensIds: ["a"], annotationIds: ["b"] },
    };
    expect(pinsForDomain(map, "WWW.example.com")).toEqual({
      lensIds: ["a"],
      annotationIds: ["b"],
    });
  });

  it("returns empty set when domain is missing or invalid", () => {
    expect(pinsForDomain({}, "example.com")).toEqual({ lensIds: [], annotationIds: [] });
    expect(pinsForDomain({}, "")).toEqual({ lensIds: [], annotationIds: [] });
  });
});

describe("isLensPinned / isAnnotationPinned", () => {
  const map: PinnedIdsByDomain = {
    "nytimes.com": {
      lensIds: ["claims"],
      annotationIds: ["claim-extractor"],
    },
  };

  it("reports pinned correctly with subdomain collapsing", () => {
    expect(isLensPinned(map, "news.nytimes.com", "claims")).toBe(true);
    expect(isLensPinned(map, "nytimes.com", "claims")).toBe(true);
    expect(isLensPinned(map, "nytimes.com", "quotes")).toBe(false);
    expect(isLensPinned(map, "other.com", "claims")).toBe(false);
  });

  it("separates lens pins from annotation pins", () => {
    expect(isAnnotationPinned(map, "nytimes.com", "claim-extractor")).toBe(true);
    expect(isAnnotationPinned(map, "nytimes.com", "claims")).toBe(false);
    expect(isLensPinned(map, "nytimes.com", "claim-extractor")).toBe(false);
  });
});

describe("toggleLensPin", () => {
  it("adds a pin when missing, removes when present, is idempotent on repeat", () => {
    const empty: PinnedIdsByDomain = {};

    const added = toggleLensPin(empty, "nytimes.com", "claims");
    expect(added).toEqual({ "nytimes.com": { lensIds: ["claims"], annotationIds: [] } });

    const removed = toggleLensPin(added, "nytimes.com", "claims");
    expect(removed).toEqual({});

    const reAdded = toggleLensPin(removed, "nytimes.com", "claims");
    expect(reAdded).toEqual(added);
  });

  it("preserves other domains and other lenses on the same domain", () => {
    const map: PinnedIdsByDomain = {
      "nytimes.com": { lensIds: ["claims", "sources"], annotationIds: ["claim-extractor"] },
      "example.com": { lensIds: ["quotes"], annotationIds: [] },
    };
    const after = toggleLensPin(map, "nytimes.com", "claims");
    expect(after).toEqual({
      "nytimes.com": { lensIds: ["sources"], annotationIds: ["claim-extractor"] },
      "example.com": { lensIds: ["quotes"], annotationIds: [] },
    });
  });

  it("does not mutate the input map", () => {
    const original: PinnedIdsByDomain = { "x.com": { lensIds: ["a"], annotationIds: [] } };
    const snapshot = JSON.parse(JSON.stringify(original));
    toggleLensPin(original, "x.com", "b");
    expect(original).toEqual(snapshot);
  });

  it("collapses subdomains to a single canonical entry", () => {
    const first = toggleLensPin({}, "news.nytimes.com", "claims");
    const second = toggleLensPin(first, "cooking.nytimes.com", "claims");
    // Toggling the same lens id under what normalizes to the same domain
    // should remove it, not create two entries.
    expect(second).toEqual({});
  });

  it("ignores invalid domains or empty ids", () => {
    const start: PinnedIdsByDomain = { "x.com": { lensIds: ["a"], annotationIds: [] } };
    expect(toggleLensPin(start, "", "a")).toEqual(start);
    expect(toggleLensPin(start, "x.com", "")).toEqual(start);
    expect(toggleLensPin(start, "x.com", "   ")).toEqual(start);
  });
});

describe("toggleAnnotationPin", () => {
  it("toggles annotations independently of lenses", () => {
    const start: PinnedIdsByDomain = {
      "x.com": { lensIds: ["claims"], annotationIds: [] },
    };
    const after = toggleAnnotationPin(start, "x.com", "claim-extractor");
    expect(after).toEqual({
      "x.com": { lensIds: ["claims"], annotationIds: ["claim-extractor"] },
    });
  });

  it("removes the domain entry when both lists become empty", () => {
    const start: PinnedIdsByDomain = {
      "x.com": { lensIds: [], annotationIds: ["claim-extractor"] },
    };
    const after = toggleAnnotationPin(start, "x.com", "claim-extractor");
    expect(after).toEqual({});
  });
});
