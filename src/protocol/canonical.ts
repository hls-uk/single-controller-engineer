/**
 * Canonical JSON for hashes and idempotency keys. This implements the portion
 * of RFC 8785 needed by the protocol's JSON-only wire domain: finite numbers,
 * strings without unpaired surrogates, arrays, and string-keyed objects.
 */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { readonly [key: string]: JsonValue };

export type StringNormalizer = (value: string) => string;

export const normalizeNfc: StringNormalizer = (value) => value.normalize("NFC");

export function canonicalJson(
  value: JsonValue,
  normalizeString: StringNormalizer = (text) => text,
): string {
  if (value === null || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new TypeError("canonical JSON does not permit non-finite numbers");
    return Object.is(value, -0) ? "0" : JSON.stringify(value);
  }
  if (typeof value === "string")
    return JSON.stringify(validString(normalizeString(value)));
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalJson(item, normalizeString)).join(",")}]`;
  if (typeof value !== "object")
    throw new TypeError("canonical JSON only permits JSON values");

  const object = value as { readonly [key: string]: JsonValue };
  return `{${Object.keys(object)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(validString(key))}:${canonicalJson(object[key]!, normalizeString)}`,
    )
    .join(",")}}`;
}

function validString(value: string): string {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff))
        throw new TypeError(
          "canonical JSON rejects unpaired surrogate code units",
        );
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new TypeError(
        "canonical JSON rejects unpaired surrogate code units",
      );
    }
  }
  return value;
}
