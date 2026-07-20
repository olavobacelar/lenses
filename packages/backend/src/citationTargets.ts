import { BlockList, isIP } from "node:net";

export const MAX_CITATION_REDIRECTS = 3;
export const MAX_CITATION_RESPONSE_BYTES = 256 * 1024;
export const CITATION_REQUEST_TIMEOUT_MS = 6_000;
export const CITATION_FETCH_CONCURRENCY = 4;

const blockedAddresses = new BlockList();

for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blockedAddresses.addSubnet(address, prefix, "ipv4");
}

for (const [address, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["::", 96],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
] as const) {
  blockedAddresses.addSubnet(address, prefix, "ipv6");
}

export function isPublicIpAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blockedAddresses.check(address, "ipv4");
  if (family === 6) {
    if (address.toLowerCase().startsWith("::ffff:")) return false;
    return !blockedAddresses.check(address, "ipv6");
  }
  return false;
}

export async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  worker: (value: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(values.length);
  const workerCount = Math.min(values.length, Math.max(1, Math.floor(concurrency)));
  let nextIndex = 0;

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const index = nextIndex++;
        if (index >= values.length) return;
        results[index] = await worker(values[index]);
      }
    })
  );

  return results;
}
