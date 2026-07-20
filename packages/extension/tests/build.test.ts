import { describe, it, expect } from "vitest";

describe("build CSP patching", () => {
  const manifest = {
    manifest_version: 3,
    name: "Lenses",
    content_security_policy: {
      extension_pages:
        "script-src 'self'; object-src 'self'; connect-src https://*.convex.cloud",
    },
  };

  function patchCspForDev(manifest: {
    content_security_policy: { extension_pages: string };
  }) {
    const patched = JSON.parse(JSON.stringify(manifest));
    const csp = patched.content_security_policy.extension_pages;
    patched.content_security_policy.extension_pages = csp.replace(
      "connect-src",
      "connect-src ws://localhost:8234"
    );
    return patched;
  }

  it("adds ws://localhost to connect-src in dev mode", () => {
    const patched = patchCspForDev(manifest);
    expect(patched.content_security_policy.extension_pages).toBe(
      "script-src 'self'; object-src 'self'; connect-src ws://localhost:8234 https://*.convex.cloud"
    );
  });

  it("preserves original Convex connect-src", () => {
    const patched = patchCspForDev(manifest);
    expect(patched.content_security_policy.extension_pages).toContain(
      "https://*.convex.cloud"
    );
  });

  it("does not modify the original manifest object", () => {
    const original = JSON.parse(JSON.stringify(manifest));
    patchCspForDev(manifest);
    expect(manifest).toEqual(original);
  });
});
