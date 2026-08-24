/**
 * RFC 8785 / JCS serialization for the protocol JSON domain. String
 * normalization is deliberately a caller-supplied field policy: JCS itself
 * does not normalize Unicode, and prompt/response bytes must remain exact.
 */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { readonly [key: string]: JsonValue };

export type JsonPath = readonly (string | number)[];
export type StringTarget = "key" | "value";
export type StringNormalization = "exact" | "nfc";

/** Declares how one string field (or object key) is normalized. */
export interface StringNormalizationRule {
  readonly path: JsonPath;
  readonly target: StringTarget;
  readonly normalization: StringNormalization;
}

/**
 * A field/path policy, evaluated before JCS serialization. Paths contain
 * object keys and array indexes; a key and its value share a path but have
 * different targets.
 */
export type CanonicalStringPolicy = (
  path: JsonPath,
  target: StringTarget,
) => StringNormalization;

/** The explicit policy for byte-exact strings and object keys. */
export const preserveStrings: CanonicalStringPolicy = () => "exact";

/** Builds a compact policy whose unspecified paths remain byte-exact. */
export function stringNormalizationPolicy(
  rules: readonly StringNormalizationRule[],
): CanonicalStringPolicy {
  return (path, target) => {
    const rule = rules.find(
      (candidate) =>
        candidate.target === target && pathsEqual(candidate.path, path),
    );
    return rule?.normalization ?? "exact";
  };
}

export function canonicalJson(
  value: JsonValue,
  stringPolicy: CanonicalStringPolicy = preserveStrings,
): string {
  return canonical(value, stringPolicy, []);
}

function canonical(
  value: JsonValue,
  stringPolicy: CanonicalStringPolicy,
  path: JsonPath,
): string {
  if (value === null || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new TypeError("canonical JSON does not permit non-finite numbers");
    // ECMAScript's Number::toString, used by JSON.stringify, is RFC 8785's
    // number serialization algorithm. It also renders negative zero as 0.
    return JSON.stringify(value);
  }
  if (typeof value === "string")
    return JSON.stringify(normalizeString(value, stringPolicy(path, "value")));
  if (Array.isArray(value))
    return `[${value
      .map((item, index) => canonical(item, stringPolicy, [...path, index]))
      .join(",")}]`;
  if (typeof value !== "object")
    throw new TypeError("canonical JSON only permits JSON values");

  const object = value as { readonly [key: string]: JsonValue };
  const entries = Object.keys(object).map((key) => ({
    key,
    normalizedKey: normalizeString(key, stringPolicy([...path, key], "key")),
  }));
  entries.sort((left, right) =>
    left.normalizedKey < right.normalizedKey
      ? -1
      : left.normalizedKey > right.normalizedKey
        ? 1
        : 0,
  );
  for (let index = 1; index < entries.length; index += 1) {
    if (entries[index - 1]!.normalizedKey === entries[index]!.normalizedKey)
      throw new TypeError(
        "canonical JSON rejects duplicate normalized object keys",
      );
  }
  return `{${entries
    .map(
      ({ key, normalizedKey }) =>
        `${JSON.stringify(normalizedKey)}:${canonical(
          object[key]!,
          stringPolicy,
          [...path, key],
        )}`,
    )
    .join(",")}}`;
}

function normalizeString(
  value: string,
  normalization: StringNormalization,
): string {
  if (normalization !== "exact" && normalization !== "nfc")
    throw new TypeError(
      "canonical JSON string policy must return exact or nfc",
    );
  return validString(normalization === "nfc" ? value.normalize("NFC") : value);
}

function pathsEqual(left: JsonPath, right: JsonPath): boolean {
  return (
    left.length === right.length &&
    left.every((segment, index) => segment === right[index])
  );
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
