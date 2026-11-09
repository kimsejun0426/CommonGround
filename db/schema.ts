import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const aiDailyUsage = sqliteTable("cg_ai_daily_usage", {
  ownerId: text("owner_id").primaryKey(),
  utcDay: text("utc_day").notNull(),
  requests: integer("requests").notNull(),
}, (t) => [index("cg_ai_daily_usage_day_idx").on(t.utcDay)]);

export const workspaces = sqliteTable("cg_workspaces", {
  ownerId: text("owner_id").primaryKey(),
  activeProposalId: text("active_proposal_id"),
  lockUntil: integer("lock_until").notNull().default(0),
  lockToken: text("lock_token"),
  updatedAt: integer("updated_at").notNull(),
});

export const proposals = sqliteTable("cg_proposals", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  fingerprint: text("fingerprint").notNull(),
  scenarioJson: text("scenario_json").notNull(),
  proposalJson: text("proposal_json").notNull(),
  mode: text("mode").notNull(),
  aiSelectionJson: text("ai_selection_json"),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
}, (t) => [index("cg_proposals_owner_idx").on(t.ownerId)]);

export const approvedQuotes = sqliteTable("cg_approved_quotes", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  proposalId: text("proposal_id").notNull(),
  fingerprint: text("fingerprint").notNull(),
  scenarioJson: text("scenario_json").notNull(),
  evaluationJson: text("evaluation_json").notNull(),
  consentsJson: text("consents_json").notNull(),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
}, (t) => [uniqueIndex("cg_quotes_owner_proposal_unique").on(t.ownerId, t.proposalId)]);

export const paymentAttempts = sqliteTable("cg_payment_attempts", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  quoteId: text("quote_id").notNull(),
  buyerId: text("buyer_id").notNull(),
  quoteHash: text("quote_hash").notNull(),
  quoteJson: text("quote_json").notNull(),
  expectedAmountCents: integer("expected_amount_cents").notNull(),
  currency: text("currency").notNull().default("USD"),
  createRequestId: text("create_request_id").notNull(),
  captureRequestId: text("capture_request_id").notNull(),
  paypalOrderId: text("paypal_order_id"),
  captureId: text("capture_id"),
  approvalUrl: text("approval_url"),
  status: text("status").notNull().default("CREATING"),
  verifiedAt: integer("verified_at"),
  lockUntil: integer("lock_until").notNull().default(0),
  lastErrorCode: text("last_error_code"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (t) => [
  uniqueIndex("cg_payment_quote_buyer_unique").on(t.ownerId, t.quoteId, t.buyerId),
  uniqueIndex("cg_payment_order_unique").on(t.paypalOrderId),
  index("cg_payment_owner_idx").on(t.ownerId),
]);
