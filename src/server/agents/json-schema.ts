/**
 * Normalizes a JSON Schema (typically from `z.toJSONSchema`) for CLI structured output
 * (`claude -p --json-schema`). The CLI validates the schema with its own validator, which rejects
 * meta keywords like `$schema` (draft 2020-12 is not registered) and unknown `format`s. We keep the
 * structural core (types, properties, required, items, enums, unions, bounds, valid `pattern`s) and drop
 * the rest — the caller validates the answer with the original zod schema afterwards anyway.
 */

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type SchemaObject = { [key: string]: Json };

/** Keywords whose value is a single sub-schema. */
const SCHEMA_KEYWORDS = new Set(["items", "additionalProperties", "not", "contains", "propertyNames", "additionalItems"]);
/** Keywords whose value is a list of sub-schemas. */
const SCHEMA_LIST_KEYWORDS = new Set(["anyOf", "oneOf", "allOf", "prefixItems"]);
/** Keywords whose value is a map of name → sub-schema. */
const SCHEMA_MAP_KEYWORDS = new Set(["properties", "$defs", "definitions", "patternProperties"]);
/** Plain keywords that are safe to keep as-is. */
const VALUE_KEYWORDS = new Set([
  "type",
  "required",
  "enum",
  "const",
  "description",
  "title",
  "default",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "uniqueItems",
  "minProperties",
  "maxProperties",
  "$ref",
]);
/** Dropped: `$schema`, `$id`, `$comment`, `format`, `examples`, `readOnly`, vendor keys (`x-…`), invalid `pattern`s… */

/** Patterns are kept when they compile as Unicode regexes (what JSON Schema validators use). */
function validPattern(p: unknown): p is string {
  if (typeof p !== "string" || p.length > 2000) return false;
  try {
    new RegExp(p, "u");
    return true;
  } catch {
    return false;
  }
}

const MAX_DEPTH = 64;

function isObject(v: unknown): v is SchemaObject {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function normalizeNode(node: unknown, depth: number): Json {
  if (typeof node === "boolean") return node;
  if (!isObject(node) || depth > MAX_DEPTH) return {};
  const out: SchemaObject = {};
  for (const [key, value] of Object.entries(node)) {
    if (SCHEMA_KEYWORDS.has(key)) {
      if (typeof value === "boolean" || isObject(value)) out[key] = normalizeNode(value, depth + 1);
    } else if (SCHEMA_LIST_KEYWORDS.has(key)) {
      if (Array.isArray(value)) out[key] = value.map((v) => normalizeNode(v, depth + 1));
    } else if (SCHEMA_MAP_KEYWORDS.has(key)) {
      if (isObject(value)) {
        const map: SchemaObject = {};
        for (const [name, sub] of Object.entries(value)) map[name] = normalizeNode(sub, depth + 1);
        out[key] = map;
      }
    } else if (key === "pattern") {
      if (validPattern(value)) out[key] = value;
    } else if (VALUE_KEYWORDS.has(key)) {
      if (key === "$ref" && (typeof value !== "string" || !value.startsWith("#"))) continue; // only local refs
      if (key === "type" && Array.isArray(value)) out[key] = value.filter((t) => typeof t === "string");
      else out[key] = value as Json;
    }
  }
  // `required` must only name declared properties (some validators are strict about it).
  if (Array.isArray(out.required) && isObject(out.properties)) {
    const props = out.properties;
    out.required = out.required.filter((r) => typeof r === "string" && r in props);
  }
  return out;
}

/** Returns a normalized copy, or null when the input is not a usable object schema. */
export function normalizeJsonSchema(schema: unknown): Record<string, unknown> | null {
  if (!isObject(schema)) return null;
  const out = normalizeNode(schema, 0);
  return isObject(out) && Object.keys(out).length ? out : null;
}
