export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export type JsonValue = string | number | boolean | null | readonly JsonValue[] | JsonObject;

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function serialize(value: JsonValue): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new RangeError("non-finite number in canonical JSON");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(serialize).join(",")}]`;
  if (isJsonObject(value)) {
    const keys = Object.keys(value).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const entries = keys.map((key) => {
      const entry = value[key];
      if (entry === undefined) throw new TypeError(`undefined value for key ${key}`);
      return `${JSON.stringify(key)}:${serialize(entry)}`;
    });
    return `{${entries.join(",")}}`;
  }
  throw new TypeError("unsupported value in canonical JSON");
}

/**
 * RFC 8785 canonical JSON: sorted keys, no whitespace, ES6 number formatting.
 * The server canonicalises the parsed body the same way before verifying a signature, so a client
 * may send the body with any formatting as long as it signs this form.
 */
export function canonicalJson(value: JsonValue): string {
  return serialize(value);
}

export function stripUndefined(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return value;
  if (Array.isArray(value)) return value.map(stripUndefined);
  if (typeof value === "object") {
    const out: Record<string, JsonValue> = {};
    for (const [key, entry] of Object.entries(value))
      if (entry !== undefined) out[key] = stripUndefined(entry);
    return out;
  }
  throw new TypeError("unsupported value in request body");
}
