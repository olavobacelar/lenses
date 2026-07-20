"use node";

import { v } from "convex/values";
import { env, internalAction } from "./_generated/server";
import ogs from "open-graph-scraper";
import { lookup } from "node:dns/promises";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { request as httpsRequest } from "node:https";
import type { LookupAddress } from "node:dns";
import {
  CITATION_FETCH_CONCURRENCY,
  CITATION_REQUEST_TIMEOUT_MS,
  MAX_CITATION_REDIRECTS,
  MAX_CITATION_RESPONSE_BYTES,
  isPublicIpAddress,
  mapWithConcurrency,
} from "../src/citationTargets.js";
import {
  MAX_CITATION_PUBLISHER_URLS,
  normalizePublicCitationUrl,
} from "../src/citationUrl.js";

function logCitationResolver(event: string, details: Record<string, unknown> = {}) {
  if (env.LENSES_MANAGED_DIAGNOSTICS !== "true") return;
  console.log("[Lenses][convex][citation-resolver]", event, details);
}

export const resolvePublishers = internalAction({
  args: {
    urls: v.array(v.string()),
  },
  handler: async (_ctx, args) => {
    const normalizedUrls = args.urls
      .map((url) => normalizePublicCitationUrl(url))
      .filter((url): url is string => typeof url === "string")
      .slice(0, MAX_CITATION_PUBLISHER_URLS);

    if (normalizedUrls.length === 0) {
      logCitationResolver("resolve_publishers_empty", {
        requestedUrlCount: args.urls.length,
      });
      return { publishers: {} as Record<string, string> };
    }

    const originToPublisher = new Map<string, string>();
    const originSet = new Set<string>();
    for (const url of normalizedUrls) {
      const origin = getUrlOrigin(url);
      if (!origin) continue;
      originSet.add(origin);
    }

    logCitationResolver("resolve_publishers_start", {
      requestedUrlCount: args.urls.length,
      normalizedUrlCount: normalizedUrls.length,
      uniqueOriginCount: originSet.size,
    });

    await mapWithConcurrency(
      normalizedUrls,
      CITATION_FETCH_CONCURRENCY,
      async (url) => {
        const origin = getUrlOrigin(url);
        if (!origin) return;
        if (originToPublisher.has(origin)) return;

        const publisher = await resolvePublisherWithOgs(url);
        if (!publisher) return;
        originToPublisher.set(origin, publisher);
      }
    );

    const publishers: Record<string, string> = {};
    for (const [origin, publisher] of originToPublisher.entries()) {
      publishers[origin] = publisher;
    }

    logCitationResolver("resolve_publishers_done", {
      uniqueOriginCount: originSet.size,
      resolvedOriginCount: Object.keys(publishers).length,
    });

    return { publishers };
  },
});

function getUrlOrigin(url: string): string | null {
  try {
    return new URL(url).origin.toLowerCase();
  } catch {
    return null;
  }
}

async function resolvePublisherWithOgs(url: string): Promise<string | null> {
  try {
    const html = await fetchPublicHtml(url);
    if (!html) return null;

    const response = await ogs({
      html,
      customMetaTags: [
        {
          multiple: false,
          property: "application-name",
          fieldName: "applicationName",
        },
      ],
      jsonLDOptions: {
        throwOnJSONParseError: false,
        logOnJSONParseError: false,
      },
    });

    const result = response.result ?? {};
    const ogSiteName = cleanPublisherLabel(
      typeof result.ogSiteName === "string" ? result.ogSiteName : ""
    );
    if (ogSiteName) return ogSiteName;

    const customMeta = result.customMetaTags as Record<string, unknown> | undefined;
    const applicationName = cleanPublisherLabel(
      typeof customMeta?.applicationName === "string"
        ? customMeta.applicationName
        : ""
    );
    if (applicationName) return applicationName;

    const twitterSite = cleanTwitterSiteValue(
      typeof result.twitterSite === "string" ? result.twitterSite : ""
    );
    if (twitterSite) return twitterSite;

    const jsonLdPublisher = extractPublisherFromJsonLd(result.jsonLD);
    if (jsonLdPublisher) return jsonLdPublisher;

    return null;
  } catch {
    logCitationResolver("resolve_publisher_error");
    return null;
  }
}

interface BoundedHttpResponse {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

async function fetchPublicHtml(initialUrl: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CITATION_REQUEST_TIMEOUT_MS);

  try {
    let currentUrl = initialUrl;
    for (let redirectCount = 0; redirectCount <= MAX_CITATION_REDIRECTS; redirectCount++) {
      const normalizedUrl = normalizePublicCitationUrl(currentUrl);
      if (!normalizedUrl) return null;

      const target = new URL(normalizedUrl);
      const addresses = await resolvePublicAddresses(target.hostname, controller.signal);
      if (addresses.length === 0) return null;

      const response = await requestAtPinnedAddress(target, addresses[0], controller.signal);
      if (response.status >= 300 && response.status < 400) {
        const location = firstHeaderValue(response.headers.location);
        if (!location || redirectCount === MAX_CITATION_REDIRECTS) return null;
        currentUrl = new URL(location, normalizedUrl).toString();
        continue;
      }

      if (response.status < 200 || response.status >= 300) return null;
      const contentType = firstHeaderValue(response.headers["content-type"])?.toLowerCase() ?? "";
      if (!contentType.startsWith("text/html") && !contentType.startsWith("application/xhtml+xml")) {
        return null;
      }
      return response.body;
    }

    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function resolvePublicAddresses(
  rawHostname: string,
  signal: AbortSignal
): Promise<LookupAddress[]> {
  const hostname = rawHostname.replace(/^\[|\]$/g, "");
  if (isPublicIpAddress(hostname)) {
    return [{ address: hostname, family: hostname.includes(":") ? 6 : 4 }];
  }

  const addresses = await abortable(lookup(hostname, { all: true, verbatim: true }), signal);
  if (addresses.length === 0 || addresses.some((entry) => !isPublicIpAddress(entry.address))) {
    return [];
  }
  return addresses;
}

async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw new Error("Citation metadata request timed out");
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(new Error("Citation metadata request timed out"));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([promise, aborted]);
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}

async function requestAtPinnedAddress(
  url: URL,
  address: LookupAddress,
  signal: AbortSignal
): Promise<BoundedHttpResponse> {
  return await new Promise<BoundedHttpResponse>((resolve, reject) => {
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(
      url,
      {
        method: "GET",
        signal,
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "Accept-Encoding": "identity",
          "User-Agent": "Lenses-Citation-Publisher/1.0",
        },
        lookup: (_hostname, _options, callback) => {
          callback(null, address.address, address.family);
        },
      },
      (response) => {
        const status = response.statusCode ?? 0;
        const rawLength = firstHeaderValue(response.headers["content-length"]);
        const contentLength = rawLength ? Number(rawLength) : Number.NaN;
        if (Number.isFinite(contentLength) && contentLength > MAX_CITATION_RESPONSE_BYTES) {
          response.destroy();
          reject(new Error("Citation metadata response is too large"));
          return;
        }

        if (status >= 300 && status < 400) {
          response.resume();
          resolve({ status, headers: response.headers, body: "" });
          return;
        }

        const chunks: Buffer[] = [];
        let receivedBytes = 0;
        response.on("data", (chunk: Buffer | string) => {
          const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
          receivedBytes += buffer.byteLength;
          if (receivedBytes > MAX_CITATION_RESPONSE_BYTES) {
            response.destroy(new Error("Citation metadata response is too large"));
            return;
          }
          chunks.push(buffer);
        });
        response.on("end", () => {
          resolve({
            status,
            headers: response.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
        response.on("error", reject);
      }
    );
    request.on("error", reject);
    request.end();
  });
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function extractPublisherFromJsonLd(jsonLd: unknown): string | null {
  const publisherCandidates: string[] = [];
  const organizationCandidates: string[] = [];
  const visited = new Set<object>();

  collectJsonLdPublisherCandidates(jsonLd, publisherCandidates, organizationCandidates, visited);

  if (publisherCandidates.length > 0) return publisherCandidates[0];
  if (organizationCandidates.length > 0) return organizationCandidates[0];
  return null;
}

function collectJsonLdPublisherCandidates(
  value: unknown,
  publisherCandidates: string[],
  organizationCandidates: string[],
  visited: Set<object>
) {
  if (value == null) return;

  if (Array.isArray(value)) {
    for (const item of value) {
      collectJsonLdPublisherCandidates(item, publisherCandidates, organizationCandidates, visited);
    }
    return;
  }

  if (typeof value !== "object") {
    return;
  }

  if (visited.has(value)) {
    return;
  }
  visited.add(value);

  const record = value as Record<string, unknown>;
  appendPublisherCandidate(publisherCandidates, extractPublisherNameFromValue(record.publisher));
  appendPublisherCandidate(
    publisherCandidates,
    extractPublisherNameFromValue(record.sourceOrganization)
  );
  appendPublisherCandidate(publisherCandidates, extractPublisherNameFromValue(record.provider));

  const types = parseJsonLdTypes(record["@type"]);
  if (isOrganizationType(types)) {
    appendPublisherCandidate(
      organizationCandidates,
      typeof record.name === "string" ? cleanPublisherLabel(record.name) : null
    );
  }

  collectJsonLdPublisherCandidates(
    record.publisher,
    publisherCandidates,
    organizationCandidates,
    visited
  );
  collectJsonLdPublisherCandidates(
    record.sourceOrganization,
    publisherCandidates,
    organizationCandidates,
    visited
  );
  collectJsonLdPublisherCandidates(
    record.provider,
    publisherCandidates,
    organizationCandidates,
    visited
  );
  collectJsonLdPublisherCandidates(
    record["@graph"],
    publisherCandidates,
    organizationCandidates,
    visited
  );
}

function extractPublisherNameFromValue(value: unknown): string | null {
  if (typeof value === "string") {
    const cleaned = cleanPublisherLabel(value);
    return cleaned || null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = extractPublisherNameFromValue(item);
      if (nested) return nested;
    }
    return null;
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const keys = ["name", "legalName", "alternateName"] as const;
  for (const key of keys) {
    const raw = record[key];
    if (typeof raw !== "string") continue;
    const cleaned = cleanPublisherLabel(raw);
    if (cleaned) return cleaned;
  }

  return null;
}

function parseJsonLdTypes(typeValue: unknown): string[] {
  if (typeof typeValue === "string") {
    return [typeValue.toLowerCase()];
  }

  if (Array.isArray(typeValue)) {
    return typeValue
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.toLowerCase());
  }

  return [];
}

function isOrganizationType(types: string[]): boolean {
  return types.some(
    (type) =>
      type.includes("organization") || type.includes("newsmediaorganization")
  );
}

function appendPublisherCandidate(target: string[], value: string | null) {
  if (!value) return;
  if (!target.includes(value)) {
    target.push(value);
  }
}

function cleanPublisherLabel(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 160);
}

function cleanTwitterSiteValue(value: string): string | null {
  let cleaned = cleanPublisherLabel(value);
  if (!cleaned) return null;

  cleaned = cleaned.replace(/^https?:\/\/(www\.)?twitter\.com\//i, "");
  cleaned = cleaned.replace(/^@+/, "");
  cleaned = cleaned.split(/[/?#]/)[0] ?? cleaned;
  cleaned = cleaned.replace(/[_-]+/g, " ");
  cleaned = cleanPublisherLabel(cleaned);
  if (!cleaned) return null;

  if (/^[a-z0-9 ]+$/.test(cleaned)) {
    cleaned = toTitleCase(cleaned);
  }

  return cleaned || null;
}

function toTitleCase(value: string): string {
  return value
    .split(" ")
    .filter((part) => part.length > 0)
    .map((part) => part[0].toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}
