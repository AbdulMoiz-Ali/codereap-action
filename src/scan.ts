import * as core from "@actions/core";
import type { ScanResult } from "./types";

const MAX_BYTES = 200 * 1024;

export async function scanCode(apiUrl: string, code: string): Promise<ScanResult | null> {
  if (Buffer.byteLength(code, "utf8") > MAX_BYTES) {
    core.warning(
      `Skipping a file because its size (${Math.round(Buffer.byteLength(code, "utf8") / 1024)} KB) exceeds the API limit of ${MAX_BYTES / 1024} KB.`,
    );
    return null;
  }

  const res = await fetch(apiUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code }),
  });

  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(
      `VibeAudit scan failed: HTTP ${res.status}${data.error ? ` — ${data.error}` : ""}`,
    );
  }

  return (await res.json()) as ScanResult;
}
