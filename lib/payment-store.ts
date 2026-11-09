import { and, eq, lte } from "drizzle-orm";
import { getDb } from "@/db";
import { paymentAttempts } from "@/db/schema";
import type { PaymentStore } from "./paypal-service.ts";

export function getPaymentStore(): PaymentStore {
  const db = getDb();
  return {
    async insertIfAbsent(attempt) {
      await db.insert(paymentAttempts).values(attempt).onConflictDoNothing({ target: [paymentAttempts.ownerId, paymentAttempts.quoteId, paymentAttempts.buyerId] });
    },
    async findByQuoteBuyer(ownerId, quoteId, buyerId) {
      const [row] = await db.select().from(paymentAttempts).where(and(eq(paymentAttempts.ownerId, ownerId), eq(paymentAttempts.quoteId, quoteId), eq(paymentAttempts.buyerId, buyerId))).limit(1);
      return row ?? null;
    },
    async listForQuote(ownerId, quoteId) {
      return db.select().from(paymentAttempts).where(and(eq(paymentAttempts.ownerId, ownerId), eq(paymentAttempts.quoteId, quoteId)));
    },
    async findByOrder(ownerId, orderId) {
      const [row] = await db.select().from(paymentAttempts).where(and(eq(paymentAttempts.ownerId, ownerId), eq(paymentAttempts.paypalOrderId, orderId))).limit(1);
      return row ?? null;
    },
    async claim(id, ownerId, now, lockUntil) {
      const claimed = await db.update(paymentAttempts).set({ lockUntil }).where(and(eq(paymentAttempts.id, id), eq(paymentAttempts.ownerId, ownerId), lte(paymentAttempts.lockUntil, now))).returning({ id: paymentAttempts.id });
      return claimed.length === 1;
    },
    async update(id, ownerId, patch) {
      await db.update(paymentAttempts).set(patch).where(and(eq(paymentAttempts.id, id), eq(paymentAttempts.ownerId, ownerId)));
    },
  };
}
