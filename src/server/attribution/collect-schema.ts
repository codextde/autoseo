/** Validation schema for snippet / pixel events (POST /api/public/attribution/collect). Pure. */
import { z } from "zod";

const optStr = (max: number) => z.string().trim().max(max).optional().nullable();
const emailFields = {
  email: optStr(320),
  emailHash: z.string().regex(/^[a-fA-F0-9]{64}$/).optional().nullable(),
  emailMask: optStr(80),
};

export const collectSchema = z.object({
  k: z.string().max(80),
  v: z.string().regex(/^[A-Za-z0-9_-]{6,80}$/),
  u: optStr(2000),
  t: z.enum(["seen", "response", "conversion"]),
  r: z
    .object({
      mode: z.enum(["popup", "form"]),
      channel: optStr(40),
      detail: optStr(40),
      answer: optStr(300),
      freetext: optStr(300),
      question: optStr(300),
      formId: optStr(200),
      formName: optStr(200),
      trigger: optStr(40),
      transactionId: optStr(120),
      ...emailFields,
    })
    .optional(),
  c: z
    .object({
      transactionId: optStr(120),
      value: z.number().finite().min(0).max(1e10).optional().nullable(),
      currency: z.string().regex(/^[A-Za-z]{3}$/).optional().nullable(),
      items: z
        .array(z.record(z.string().max(40), z.union([z.string().max(200), z.number(), z.boolean(), z.null()])))
        .max(50)
        .optional()
        .nullable(),
      kind: z.enum(["purchase", "lead"]).default("purchase"),
      via: z.enum(["ga", "meta", "api", "shopify"]).default("api"),
      ...emailFields,
    })
    .optional(),
});
