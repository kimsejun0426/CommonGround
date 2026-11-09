import { ApiError } from "./api-errors.ts";

const OWNER_DAILY_REQUESTS = 20;
const SITE_DAILY_REQUESTS = 300;

// SQLite serializes this conditional upsert. All outbound attempts share
// one UTC-day budget across both guidance and interpretation, including retries.
const claimRequest = `
  INSERT INTO cg_ai_daily_usage (owner_id, utc_day, requests)
  SELECT ?, date('now'), 1
  WHERE (SELECT COALESCE(SUM(requests), 0) FROM cg_ai_daily_usage WHERE utc_day = date('now')) < ?
  ON CONFLICT(owner_id) DO UPDATE SET
    utc_day = excluded.utc_day,
    requests = CASE WHEN utc_day = excluded.utc_day THEN requests + 1 ELSE 1 END
  WHERE utc_day <> excluded.utc_day OR requests < ?
`;

type BudgetDatabase = {
  prepare(query: string): {
    bind(...values: (string | number)[]): { run(): Promise<{ meta: { changes: number } }> };
  };
};

export function budgetedAIFetch(ownerId: string, database: () => BudgetDatabase, send: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    init?.signal?.throwIfAborted();
    let changes;
    try {
      const result = await database().prepare(claimRequest).bind(ownerId, SITE_DAILY_REQUESTS, OWNER_DAILY_REQUESTS).run();
      changes = result.meta.changes;
      if (changes !== 0 && changes !== 1) throw new Error("Unexpected usage counter result");
    } catch {
      throw new ApiError(503, "AI_BUDGET_UNAVAILABLE", "AI usage could not be checked. You can still edit the brief manually.", true);
    }
    if (changes === 0) {
      throw new ApiError(429, "AI_DAILY_LIMIT", "The daily AI request limit was reached. You can still edit the brief and compare plans. AI becomes available at 00:00 UTC.", true);
    }
    return send(input, init);
  };
}
