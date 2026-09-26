import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  EVENT_HEADER,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  generateSigningSecret,
  signWebhookPayload,
  verifyWebhookSignature,
  webhookHeaders,
} from "./signature";

describe("webhook signatures", () => {
  it("matches a plain HMAC-SHA256 over `${timestamp}.${body}`", () => {
    const body = JSON.stringify({ event: "task.created", tasks: [{ id: "tsk_1" }] });
    const expected = crypto.createHmac("sha256", "s3cret").update(`1700000000.${body}`).digest("hex");
    expect(signWebhookPayload("s3cret", 1700000000, body)).toBe(`sha256=${expected}`);
  });

  it("verifies valid signatures and rejects tampering, wrong secret and stale timestamps", () => {
    const secret = generateSigningSecret();
    expect(secret.startsWith("whsec_")).toBe(true);
    const now = 1_800_000_000_000;
    const body = '{"event":"ping"}';
    const headers = webhookHeaders(secret, "ping", body, now);
    expect(headers[EVENT_HEADER]).toBe("ping");
    const ts = headers[TIMESTAMP_HEADER]!;
    const sig = headers[SIGNATURE_HEADER]!;
    expect(verifyWebhookSignature(secret, ts, body, sig, { now })).toBe(true);
    expect(verifyWebhookSignature(secret, ts, body + " ", sig, { now })).toBe(false);
    expect(verifyWebhookSignature("other", ts, body, sig, { now })).toBe(false);
    expect(verifyWebhookSignature(secret, ts, body, sig, { now: now + 10 * 60_000 })).toBe(false);
    expect(verifyWebhookSignature(secret, "nope", body, sig, { now })).toBe(false);
  });

  it("generates distinct secrets", () => {
    expect(generateSigningSecret()).not.toBe(generateSigningSecret());
  });
});
