export async function readManagedApiError(
  response: Response,
  fallback: string
): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    return typeof body.error === "string" && body.error.trim()
      ? body.error.trim()
      : fallback;
  } catch {
    return fallback;
  }
}
