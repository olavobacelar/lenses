import { DEFAULT_SLIDE_EXPORT_SERVER_URL } from "../constants";

export function getSlideExportServerUrl(): string {
  const importMeta = import.meta as ImportMeta & {
    env?: { VITE_SLIDE_EXPORT_SERVER_URL?: string };
  };
  return (importMeta.env?.VITE_SLIDE_EXPORT_SERVER_URL || DEFAULT_SLIDE_EXPORT_SERVER_URL).replace(
    /\/$/,
    ""
  );
}

export function getResponseFileName(response: Response, videoId: string): string {
  const explicitName = response.headers.get("x-lenses-filename");
  if (explicitName) return explicitName;

  const disposition = response.headers.get("content-disposition");
  const match = disposition?.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i);
  if (match?.[1]) {
    return decodeURIComponent(match[1].replace(/"$/g, ""));
  }

  return `lenses-slides-${videoId}.html`;
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function readSlideExportError(response: Response): Promise<string> {
  try {
    const data = await response.json();
    if (typeof data?.error === "string") return data.error;
  } catch {
    // Fall through to status text.
  }
  return response.statusText || `Slide export failed (${response.status})`;
}
