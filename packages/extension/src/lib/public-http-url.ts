/**
 * Normalize a URL that may be sent to a server-side metadata resolver.
 *
 * This is a first-line filter for literal private and special-use addresses.
 * The server must repeat the check after DNS resolution and after every
 * redirect because a hostname can resolve differently from its spelling.
 */
export function normalizePublicHttpUrl(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (parsed.username || parsed.password) return null;
    if (!isPublicHostname(parsed.hostname)) return null;
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

export function isPublicHostname(rawHostname: string): boolean {
  const hostname = rawHostname
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
  if (!hostname) return false;
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".home") ||
    hostname.endsWith(".lan")
  ) {
    return false;
  }

  const ipv4 = parseIpv4(hostname);
  if (ipv4) return !isSpecialIpv4(ipv4);
  if (hostname.includes(":")) return !isSpecialIpv6(hostname);
  return true;
}

function parseIpv4(hostname: string): [number, number, number, number] | null {
  const parts = hostname.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => Number(part));
  if (
    octets.some(
      (octet, index) =>
        !Number.isInteger(octet) || octet < 0 || octet > 255 || String(octet) !== parts[index]
    )
  ) {
    return null;
  }
  return octets as [number, number, number, number];
}

function isSpecialIpv4([a, b]: [number, number, number, number]): boolean {
  return (
    a === 0 ||
    a === 10 ||
    (a === 100 && b >= 64 && b <= 127) ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    (a === 203 && b === 0) ||
    a >= 224
  );
}

function isSpecialIpv6(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  if (/^fe[89ab]/.test(normalized)) return true;
  if (normalized.startsWith("2001:db8:")) return true;
  if (normalized.startsWith("::ffff:")) {
    const mapped = parseIpv4(normalized.slice("::ffff:".length));
    return mapped ? isSpecialIpv4(mapped) : true;
  }
  return false;
}
