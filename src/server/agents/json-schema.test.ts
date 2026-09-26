import { describe, expect, it } from "vitest";
import { z } from "zod";
import { normalizeJsonSchema } from "./json-schema";
// The agent runtime ships the same normalizer (it must stay dependency-free).
import { normalizeJsonSchema as agentNormalize } from "../../../agent/agent.mjs";

/** Representative of what AutoSEO modules pass to runLlm (fact check extraction, analysis, …). */
const FactSchema = z.object({
  answers: z.array(
    z.object({
      answerId: z.string().min(1),
      statements: z.array(
        z.object({
          claim: z.string().max(500),
          quote: z.string().nullable(),
          category: z.enum(["dosage", "ingredient", "pricing", "other"]),
          confidence: z.number().min(0).max(1),
          sourceUrl: z.string().url().optional(),
          contactEmail: z.email().nullable().optional(),
          sku: z.string().regex(/^[A-Z]{2}-\d+$/).optional(),
        }),
      ),
    }),
  ),
  sentiment: z.number().int().min(-100).max(100).nullable(),
  tags: z.array(z.string()).max(10).default([]),
  meta: z.record(z.string(), z.string()).optional(),
});

function walk(node: unknown, visit: (n: Record<string, unknown>) => void) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const n of node) walk(n, visit);
    return;
  }
  visit(node as Record<string, unknown>);
  for (const v of Object.values(node)) walk(v, visit);
}

describe("normalizeJsonSchema", () => {
  const raw = z.toJSONSchema(FactSchema) as Record<string, unknown>;
  const out = normalizeJsonSchema(raw)!;

  it("drops keywords CLI validators reject ($schema, format) but keeps valid patterns", () => {
    expect(raw.$schema).toBeDefined();
    expect(out.$schema).toBeUndefined();
    const patterns: string[] = [];
    walk(out, (n) => {
      expect(n).not.toHaveProperty("format");
      expect(n).not.toHaveProperty("$id");
      if (typeof n.pattern === "string") patterns.push(n.pattern);
    });
    expect(patterns).toContain("^[A-Z]{2}-\\d+$");
    expect(normalizeJsonSchema({ type: "string", pattern: "(?<=a" })).toEqual({ type: "string" });
  });

  it("keeps structure: types, required, enums, nested arrays, bounds, nullable unions", () => {
    expect(out.type).toBe("object");
    expect(out.required).toEqual(expect.arrayContaining(["answers", "sentiment"]));
    const props = out.properties as Record<string, Record<string, unknown>>;
    const statement = ((props.answers!.items as Record<string, unknown>).properties as Record<string, Record<string, unknown>>).statements!
      .items as Record<string, unknown>;
    const sp = statement.properties as Record<string, Record<string, unknown>>;
    expect(sp.category!.enum).toEqual(["dosage", "ingredient", "pricing", "other"]);
    expect(sp.confidence).toMatchObject({ type: "number", minimum: 0, maximum: 1 });
    expect(sp.claim).toMatchObject({ type: "string", maxLength: 500 });
    expect(JSON.stringify(sp.quote)).toContain("null");
    expect(statement.additionalProperties).toBe(false);
    expect(props.tags).toMatchObject({ type: "array", maxItems: 10 });
    expect(JSON.stringify(props.sentiment)).toContain("null");
  });

  it("only lists declared properties as required and keeps local $refs", () => {
    const schema = normalizeJsonSchema({
      type: "object",
      properties: { a: { $ref: "#/$defs/A" }, b: { $ref: "https://example.com/x.json" } },
      required: ["a", "ghost"],
      $defs: { A: { type: "string", format: "uuid", "x-internal": true } },
    })!;
    expect(schema.required).toEqual(["a"]);
    expect((schema.properties as Record<string, unknown>).a).toEqual({ $ref: "#/$defs/A" });
    expect((schema.properties as Record<string, unknown>).b).toEqual({});
    expect((schema.$defs as Record<string, unknown>).A).toEqual({ type: "string" });
  });

  it("returns null for unusable input", () => {
    expect(normalizeJsonSchema(null)).toBeNull();
    expect(normalizeJsonSchema([])).toBeNull();
    expect(normalizeJsonSchema({ $schema: "x" })).toBeNull();
  });

  it("is idempotent and still describes data the zod schema accepts", () => {
    expect(normalizeJsonSchema(out)).toEqual(out);
    const sample = {
      answers: [{ answerId: "a1", statements: [{ claim: "X helps", quote: null, category: "other", confidence: 0.4 }] }],
      sentiment: null,
      tags: [],
    };
    expect(FactSchema.parse(sample)).toBeTruthy();
  });

  it("matches the agent runtime's normalizer exactly", () => {
    expect(agentNormalize(raw)).toEqual(out);
  });
});
