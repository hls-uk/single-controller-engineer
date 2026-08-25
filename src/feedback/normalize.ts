const utf8 = new TextEncoder();

export const MAX_NARRATIVE_BYTES = 4 * 1024;

const DISALLOWED =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200e\u200f\u061c\u202a-\u202e\u2066-\u2069]/u;

/** Normalizes an allowlisted field; it never attempts to redact arbitrary text. */
export function normalizedText(
  value: string,
  maxBytes: number,
): string | undefined {
  if (typeof value !== "string" || value.includes("\r")) return undefined;
  const normalized = value.normalize("NFC");
  if (
    DISALLOWED.test(normalized) ||
    utf8.encode(normalized).byteLength > maxBytes
  )
    return undefined;
  return normalized;
}

export function normalizedSingleLine(
  value: string,
  maxBytes: number,
): string | undefined {
  const normalized = normalizedText(value, maxBytes);
  return normalized === undefined || normalized.includes("\n")
    ? undefined
    : normalized;
}

export type NarrativeFinding =
  "absolute_path" | "credential_like" | "source_like" | "token_like" | "url";

/** Preview warnings deliberately block unattended narrative submission. */
export function inspectNarrative(value: string): readonly NarrativeFinding[] {
  const findings: NarrativeFinding[] = [];
  if (/https?:\/\//iu.test(value)) findings.push("url");
  if (/(?:^|[\s"'])\/(?:Users|home|private|var|tmp)\//mu.test(value))
    findings.push("absolute_path");
  if (/\b(?:password|secret|api[_-]?key|authorization)\s*[:=]/iu.test(value))
    findings.push("credential_like");
  if (
    /\b(?:ghp_|github_pat_|sk-[A-Za-z0-9]|AKIA)[A-Za-z0-9_-]{8,}/u.test(value)
  )
    findings.push("token_like");
  if (/```|\b(?:function|const|import|class)\s+[A-Za-z_$]/u.test(value))
    findings.push("source_like");
  return findings;
}

export function utf8Bytes(value: string): number {
  return utf8.encode(value).byteLength;
}
