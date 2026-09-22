/**
 * Exact parser for `dolt diff -r json` output.
 *
 * dolt 2.2.1 renders a long text cell of a row diff as a wrapped byte buffer,
 * `{"Buf": "<base64>", "Addr": "<content address>"}`, on whichever side the
 * cell is stored out of line, while the other side may be plain text. The
 * cell value is the decoded UTF-8 text; every pinned delta matcher compares
 * that, never the rendering.
 */

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/u;

function decodeBuffers(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decodeBuffers);
  if (value === null || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  // The address is opaque (dolt renders it as a byte array); only the buffer
  // is the value, and only an exact base64 round trip identifies the shape.
  if (
    (keys.join(",") === "Buf" || keys.join(",") === "Addr,Buf") &&
    typeof record.Buf === "string" &&
    BASE64.test(record.Buf)
  ) {
    const decoded = Buffer.from(record.Buf, "base64");
    // An exact round trip distinguishes the rendering from a coincidental
    // one-key object whose value merely looks like base64.
    if (decoded.toString("base64") === record.Buf)
      return decoded.toString("utf8");
  }
  return Object.fromEntries(
    keys.map((key) => [key, decodeBuffers(record[key])]),
  );
}

/** Parses diff JSON with wrapped text cells decoded; malformed input is undefined. */
export function parseDoltDiff(source: string): unknown {
  try {
    return decodeBuffers(JSON.parse(source) as unknown);
  } catch {
    return undefined;
  }
}
