import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { setImmediate } from "node:timers/promises";
import test from "node:test";
import { budgetedAIFetch } from "../lib/ai-budget.ts";
import { ApiError } from "../lib/api-errors.ts";
import { interpretWithOpenAI } from "../lib/intent.ts";
import { resolveOptionalGuidance } from "../lib/workspace-protection.ts";

function store(db: DatabaseSync) {
  return () => ({
    prepare(query: string) {
      return { bind(...params: (string | number)[]) {
        return { async run() {
          await setImmediate();
          return { meta: { changes: Number(db.prepare(query).run(...params).changes) } };
        } };
      } };
    },
  });
}

const migration = readFileSync(new URL("../drizzle/0001_ai_daily_usage.sql", import.meta.url), "utf8");
const isLimited = (error: unknown) => error instanceof ApiError && error.status === 429 && error.code === "AI_DAILY_LIMIT";

test("parallel requests share owner and site quotas; rejected requests never call the provider", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(migration);
    let calls = 0;
    const send = async () => { calls++; return new Response(); };
    const call = (owner: string) => budgetedAIFetch(owner, store(db), send)("https://api.openai.com/v1/responses");
    const first = await Promise.allSettled(Array.from({ length: 32 }, () => call("buyer")));
    assert.equal(calls, 20);
    assert.equal(first.filter(r => r.status === "rejected" && isLimited(r.reason)).length, 12);
    const seed = db.prepare("INSERT INTO cg_ai_daily_usage VALUES (?, date('now'), ?)");
    for (let i = 0; i < 14; i++) seed.run("earlier-owner-" + i, i === 13 ? 17 : 20);
    const global = await Promise.allSettled(Array.from({ length: 12 }, (_, i) => call("other-" + i)));
    assert.equal(calls, 23);
    assert.equal(global.filter(r => r.status === "rejected" && isLimited(r.reason)).length, 9);
    assert.equal(db.prepare("SELECT SUM(requests) AS total FROM cg_ai_daily_usage").get()?.total, 300);
    db.exec("UPDATE cg_ai_daily_usage SET utc_day = date('now', '-1 day')");
    await call("buyer");
    assert.equal(db.prepare("SELECT requests FROM cg_ai_daily_usage WHERE owner_id = 'buyer'").get()?.requests, 1);
  } finally { db.close(); }
});

test("missing storage fails closed, skipped guidance uses no budget, failed upstream attempts still count", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    let calls = 0;
    const send = async () => { calls++; return new Response(null, { status: 503 }); };
    const call = () => budgetedAIFetch("reviewer", store(db), send)("https://api.openai.com/v1/responses");
    await assert.rejects(call, (e: unknown) => e instanceof ApiError && e.code === "AI_BUDGET_UNAVAILABLE");
    assert.equal(calls, 0);
    db.exec(migration);
    assert.equal((await resolveOptionalGuidance(false, true, call)).guidanceStatus, "skipped");
    assert.equal((await resolveOptionalGuidance(true, false, call)).guidanceStatus, "not_configured");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM cg_ai_daily_usage").get()?.n, 0);
    assert.equal((await call()).status, 503);
    assert.equal(db.prepare("SELECT requests FROM cg_ai_daily_usage").get()?.requests, 1);
    db.exec("UPDATE cg_ai_daily_usage SET requests = 20");
    const guidance = await resolveOptionalGuidance(true, true, call);
    assert.equal(guidance.guidanceStatus, "limited");
    assert.equal(guidance.selection, null);
    assert.equal(calls, 1);
    // One remaining attempt can be spent on interpretation, but its corrective
    // request must obtain a second slot before calling the provider.
    db.exec("UPDATE cg_ai_daily_usage SET requests = 19");
    let attempts = 0;
    const needsCorrection = async () => {
      attempts++;
      const invalid = { quantity: 40, budgetCents: null, maxLeadDays: null, priorities: [], unsupportedRequirements: [], evidence: { quantity: "not in source", budget: null, leadTime: null } };
      return Response.json({ status: "completed", output: [{ type: "message", role: "assistant", status: "completed",
        content: [{ type: "output_text", text: JSON.stringify(invalid) }] }] });
    };
    await assert.rejects(() => interpretWithOpenAI({ buyerId: "luma", text: "I need 40 boxes." },
      { aiReady: true, openaiApiKey: "fixture", openaiModel: "test" }, budgetedAIFetch("reviewer", store(db), needsCorrection)), isLimited);
    assert.equal(attempts, 1);
    assert.equal(db.prepare("SELECT requests FROM cg_ai_daily_usage").get()?.requests, 20);
  } finally { db.close(); }
});
