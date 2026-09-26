import { and, eq, isNull, lt } from "drizzle-orm";
import { db } from "@/server/db/client";
import { stripeEvents } from "@/server/db/schema";
import { logEvent } from "@/server/events";
import { constructWebhookEvent, handleStripeEvent } from "@/server/stripe";

/** A claim that never finished (process killed mid-event) may be taken over by Stripe's retry after this. */
const STALE_CLAIM_MS = 10 * 60 * 1000;

/**
 * Stripe webhook. The signature is mandatory and verified against the raw body with the signing secret
 * stored at setup. Each event id is processed once; slow work (provisioning) runs after the response.
 */
export async function POST(req: Request) {
  const signature = req.headers.get("stripe-signature");
  if (!signature) return Response.json({ error: "Missing Stripe-Signature header" }, { status: 400 });
  const rawBody = await req.text();

  let event;
  try {
    event = await constructWebhookEvent(rawBody, signature);
  } catch (err) {
    console.warn("[stripe] webhook rejected:", err instanceof Error ? err.message : err);
    return Response.json({ error: "Invalid signature" }, { status: 400 });
  }

  const [claimed] = await db
    .insert(stripeEvents)
    .values({ id: event.id, type: event.type })
    .onConflictDoNothing()
    .returning({ id: stripeEvents.id });
  if (!claimed) {
    const [retaken] = await db
      .update(stripeEvents)
      .set({ createdAt: new Date() })
      .where(
        and(
          eq(stripeEvents.id, event.id),
          isNull(stripeEvents.processedAt),
          lt(stripeEvents.createdAt, new Date(Date.now() - STALE_CLAIM_MS)),
        ),
      )
      .returning({ id: stripeEvents.id });
    if (!retaken) return Response.json({ received: true, duplicate: true });
  }

  try {
    await handleStripeEvent(event);
  } catch (err) {
    // Release the claim so Stripe's retry processes the event again.
    await db.delete(stripeEvents).where(eq(stripeEvents.id, event.id));
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[stripe] ${event.type} ${event.id} failed`, err);
    await logEvent("stripe.webhook_failed", { data: { eventId: event.id, type: event.type, error: message } });
    return Response.json({ error: "Webhook handler failed" }, { status: 500 });
  }
  await db.update(stripeEvents).set({ processedAt: new Date() }).where(eq(stripeEvents.id, event.id));
  return Response.json({ received: true });
}
