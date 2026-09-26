import "server-only";
import type { z } from "zod";
import type { ApiScope } from "@/features/api-settings/scopes";

/** Leaf module (no imports from openapi.ts) so `openapi-ops/*` can use these without an import cycle. */
export type Json = Record<string, unknown>;

export type OpenApiOperation = {
  method: "get" | "post" | "put" | "delete";
  path: string;
  operationId: string;
  summary: string;
  description?: string;
  tag: string;
  scope: ApiScope;
  permission?: string;
  /** Can incur cost → also requires the "spend" scope (derived from SPEND_ROUTES in openapi.ts). */
  spend?: boolean;
  query?: z.ZodObject;
  body?: z.ZodType;
  /** JSON schema of `data`. */
  data: Json;
  /** Extra JSON schema properties of `meta`. */
  meta?: Json;
  status?: number;
  csv?: boolean;
};

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const arr = (items: Json) => ({ type: "array", items });
const num = { type: ["number", "null"] };
const int = { type: "integer" };
const str = { type: "string" };
const strN = { type: ["string", "null"] };
const bool = { type: "boolean" };
const obj = (properties: Json, extra: Json = {}) => ({ type: "object", properties, ...extra });

/** JSON-schema building blocks for domain operation files (`openapi-ops/*`). */
export const S = { ref, arr, num, int, str, strN, bool, obj };
