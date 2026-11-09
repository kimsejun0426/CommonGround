import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "../lib/api-errors.ts";
import { interpretWithOpenAI, parseIntentRequest, validateInterpretation } from "../lib/intent.ts";

const text = "Need 40 branded boxes, budget $90 including delivery, within 10 days.";
const input = { buyerId: "luma" as const, text };
function extracted() {
  return { quantity: 40, budgetCents: 9000, maxLeadDays: 10, priorities: ["branded"], unsupportedRequirements: [] as string[], evidence: { quantity: "40 branded boxes", budget: "$90", leadTime: "10 days" } };
}
const config = { aiReady: true, openaiApiKey: "test-not-a-real-secret", openaiModel: "gpt-5.4-mini" };
function completed(value: unknown): Response {
  return Response.json({ status: "completed", output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify(value) }] }] });
}

test("extracts only review fields with exact original evidence", () => {
  const result = validateInterpretation(extracted(), input);
  assert.equal(result.quantity, 40);
  assert.equal(result.budgetCents, 9000);
  assert.equal(result.maxLeadDays, 10);
  assert.deepEqual(result.unsupportedRequirements, []);
  assert.deepEqual(Object.keys(result).sort(), ["budgetCents", "evidence", "maxLeadDays", "priorities", "quantity", "quantityMin", "quantityMax", "unsupportedRequirements"].sort());
});

test("missing fields stay null and do not become fixture defaults", () => {
  const result = validateInterpretation({ quantity: null, budgetCents: null, maxLeadDays: null, priorities: ["branded"], unsupportedRequirements: [], evidence: { quantity: null, budget: null, leadTime: null } }, input);
  assert.equal(result.quantity, null);
  assert.deepEqual(result.evidence, {});
});

test("invented or numerically inconsistent evidence is rejected", () => {
  for (const value of [
    { ...extracted(), quantity: 35 },
    { ...extracted(), budgetCents: 90 },
    { ...extracted(), evidence: { ...extracted().evidence, quantity: "40 custom boxes" } },
    { ...extracted(), priorities: ["premium recycled finish"] },
    { ...extracted(), unsupportedRequirements: ["no material substitution"] },
  ]) assert.throws(() => validateInterpretation(value, input), (e: unknown) => e instanceof ApiError && e.status === 422);
});

test("unknown fields, invalid ranges and malformed lists fail closed", () => {
  for (const value of [
    { ...extracted(), requestedBase: "kraft" },
    { ...extracted(), quantity: 0 }, { ...extracted(), quantity: 1.5 },
    { ...extracted(), quantity: 100001 }, { ...extracted(), budgetCents: -1 },
    { ...extracted(), budgetCents: 100000001 }, { ...extracted(), maxLeadDays: 366 },
    { ...extracted(), priorities: ["branded", "branded"] },
    { ...extracted(), evidence: { ...extracted().evidence, granted: true } },
  ]) assert.throws(() => validateInterpretation(value, input), ApiError);
});

test("literal dollars convert exactly to cents without floating rounding", () => {
  const request = { ...input, text: text.replace("$90", "$90.05") };
  const value = { ...extracted(), budgetCents: 9005, evidence: { ...extracted().evidence, budget: "$90.05" } };
  assert.equal(validateInterpretation(value, request).budgetCents, 9005);
});

test("Korean dollar and day evidence is supported without assuming missing delivery costs", () => {
  const request = { ...input, text: "브랜드 상자 40개, 배송비 포함 90달러, 제작 10일 이내." };
  const value = { ...extracted(), priorities: ["브랜드"], evidence: { quantity: "40개", budget: "90달러", leadTime: "10일" } };
  assert.deepEqual(validateInterpretation(value, request).unsupportedRequirements, []);
  assert.equal(validateInterpretation(value, request).budgetCents, 9000);
});

test("model omissions cannot silently discard no-substitution requirements", () => {
  for (const condition of ["no material substitution", "do not change the material", "material substitution is not allowed", "must use black material only", "black only", "소재 변경 금지"]) {
    const result = validateInterpretation(extracted(), { ...input, text: `${text} ${condition}.` });
    assert.ok(result.unsupportedRequirements.length > 0, condition);
  }
});

test("unmodeled materials, currencies, delivery dates and business days block application", () => {
  for (const condition of ["recycled paperboard", "EUR 100", "by 2026-11-20", "by November 20", "10 business days", "must be delivered", "waterproof", "tax included"]) {
    const result = validateInterpretation(extracted(), { ...input, text: `${text} ${condition}.` });
    assert.ok(result.unsupportedRequirements.length > 0, condition);
  }
});

test("fixed persona base changes and shipping-ambiguous budgets are not silently applied", () => {
  assert.ok(validateInterpretation(extracted(), { ...input, text: `${text} kraft base.` }).unsupportedRequirements.includes("kraft"));
  assert.ok(validateInterpretation(extracted(), { ...input, buyerId: "juniper", text: `${text} black base.` }).unsupportedRequirements.includes("black"));
  const result = validateInterpretation(extracted(), { ...input, text: text.replace(" including delivery", "") });
  assert.ok(result.unsupportedRequirements.includes("$90"));
});

test("input contract rejects extra fields, unknown personas and oversized requests", () => {
  assert.deepEqual(parseIntentRequest(input), input);
  for (const body of [{ ...input, ownerId: "other" }, { ...input, buyerId: "other" }, { ...input, text: " " }, { ...input, text: "a".repeat(4001) }]) {
    assert.throws(() => parseIntentRequest(body), ApiError);
  }
});

test("no credentials returns 503 without invoking a provider or generating a fake result", async () => {
  let called = false;
  await assert.rejects(interpretWithOpenAI(input, { ...config, aiReady: false, openaiApiKey: "" }, async () => { called = true; return completed(extracted()); }), (e: unknown) => e instanceof ApiError && e.status === 503 && e.code === "AI_NOT_CONFIGURED");
  assert.equal(called, false);
});

test("provider call uses strict structured output and treats the user request as data", async () => {
  let calls = 0;
  const result = await interpretWithOpenAI(input, config, async (url, options) => {
    calls++;
    assert.equal(url, "https://api.openai.com/v1/responses");
    const body = JSON.parse(String(options?.body));
    assert.equal(body.store, false);
    assert.equal(body.text.format.strict, true);
    assert.equal(body.text.format.schema.additionalProperties, false);
    assert.deepEqual(JSON.parse(body.input[1].content), { buyerId: "luma", fixedRequestedBase: "black", text });
    return completed(extracted());
  });
  assert.equal(calls, 1);
  assert.equal(result.budgetCents, 9000);
});

test("incomplete, refused and unsupported model results never become accepted interpretations", async () => {
  const replies = [
    Response.json({ status: "incomplete", output: [] }),
    Response.json({ status: "completed", output: [{ type: "refusal" }] }),
    completed({ ...extracted(), quantity: 500 }),
  ];
  for (const reply of replies) await assert.rejects(interpretWithOpenAI(input, config, async () => reply), ApiError);
});

test("upstream failure is sanitized and never falls back to a fictional interpretation", async () => {
  await assert.rejects(interpretWithOpenAI(input, config, async () => new Response("provider secrets must not leak", { status: 429 })), (e: unknown) => e instanceof ApiError && e.status === 503 && e.retryable && !e.message.includes("secrets"));
  await assert.rejects(interpretWithOpenAI(input, config, async () => { throw new Error("private network details"); }), (e: unknown) => e instanceof ApiError && e.code === "AI_UNAVAILABLE" && !e.message.includes("private"));
});

function rangedExtraction() {
  return { ...extracted(), quantityMin: 38, quantityMax: 40, evidence: { ...extracted().evidence, quantityMin: "38-40 boxes", quantityMax: "38-40 boxes" } };
}
const flexibleInput = { ...input, text: `${text} I can accept 38-40 boxes.` };

test("explicit flexibility is distinct from an exact or unspecified quantity", () => {
  const exact = validateInterpretation(extracted(), input);
  assert.equal(exact.quantityMin, null);
  assert.equal(exact.quantityMax, null);
  const ranged = validateInterpretation(rangedExtraction(), flexibleInput);
  assert.equal(ranged.quantity, 40);
  assert.equal(ranged.quantityMin, 38);
  assert.equal(ranged.quantityMax, 40);
  assert.deepEqual(ranged.unsupportedRequirements, []);
});

test("missing, inverted, invented, inconsistent or unsupported interval evidence fails closed", () => {
  const good = rangedExtraction();
  for (const value of [
    { ...good, quantityMin: null }, { ...good, quantityMax: 39 }, { ...good, quantityMin: 41 },
    { ...good, quantity: null, evidence: { ...good.evidence, quantity: null } },
    { ...good, evidence: { ...good.evidence, quantityMin: "37-40 boxes" } },
    { ...good, evidence: { ...good.evidence, quantityMax: null } },
  ]) assert.throws(() => validateInterpretation(value, flexibleInput), ApiError);
  assert.throws(() => validateInterpretation(good, input), ApiError);
});

test("omitted ranges and unsupported approximations cannot turn into exact requests", () => {
  assert.ok(validateInterpretation(extracted(), flexibleInput).unsupportedRequirements.includes("38-40 boxes"));
  for (const condition of ["about 40 boxes", "at least 38 boxes", "up to 40 boxes"]) {
    assert.ok(validateInterpretation(extracted(), { ...input, text: `${text} ${condition}.` }).unsupportedRequirements.length > 0);
  }
  const conflicting = { ...flexibleInput, text: `${flexibleInput.text} Exactly 40 boxes.` };
  assert.ok(validateInterpretation(rangedExtraction(), conflicting).unsupportedRequirements.length > 0);
});

test("English between and Korean explicit intervals retain both grounded endpoints", () => {
  for (const interval of ["between 38 and 40 boxes", "38~40개"]) {
    const request = { ...input, text: `${text} Accept ${interval}.` };
    const value = { ...rangedExtraction(), evidence: { ...extracted().evidence, quantityMin: interval, quantityMax: interval } };
    assert.deepEqual(validateInterpretation(value, request).unsupportedRequirements, []);
  }
});

const koreanFlexibleInput = {
  ...input,
  text: "상자 40개가 필요하지만 38~40개까지 조정 가능해. 배송비 포함 최대 예산은 80달러이고, 제작은 10일 이내로 끝내야 해.",
};
function koreanFlexibleExtraction() {
  return {
    quantity: 40, quantityMin: 38, quantityMax: 40, budgetCents: 8000, maxLeadDays: 10,
    priorities: [], unsupportedRequirements: [],
    evidence: { quantity: "40개", quantityMin: "38~40개", quantityMax: "38~40개", budget: "80달러", leadTime: "10일" },
  };
}
function inventedKoreanEvidence() {
  const value = koreanFlexibleExtraction();
  return { ...value, evidence: { ...value.evidence, quantityMin: "38개" } };
}

test("one correction recovers literal Korean interval evidence from the same original request", async () => {
  const requests: Array<{ input: Array<{ role: string; content: string }> }> = [];
  const result = await interpretWithOpenAI(koreanFlexibleInput, config, async (_url, options) => {
    requests.push(JSON.parse(String(options?.body)));
    return completed(requests.length === 1 ? inventedKoreanEvidence() : koreanFlexibleExtraction());
  });
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1].input[1], requests[0].input[1]);
  assert.deepEqual(JSON.parse(requests[1].input[1].content), {
    buyerId: "luma", fixedRequestedBase: "black", text: koreanFlexibleInput.text,
  });
  assert.notEqual(requests[1].input[0].content, requests[0].input[0].content);
  assert.deepEqual(result, koreanFlexibleExtraction());
});

test("two ungrounded candidates fail closed without a third provider call", async () => {
  let calls = 0;
  await assert.rejects(interpretWithOpenAI(koreanFlexibleInput, config, async () => {
    calls++;
    return completed(inventedKoreanEvidence());
  }), (e: unknown) => e instanceof ApiError && e.status === 422 && e.code === "INTENT_NOT_GROUNDED");
  assert.equal(calls, 2);
});

test("provider errors, unavailable calls and refusals do not trigger grounding correction", async () => {
  const failures: Array<() => Response> = [
    () => new Response("private provider details", { status: 429 }),
    () => { throw new Error("private network details"); },
    () => Response.json({ status: "completed", output: [{ type: "refusal" }] }),
    () => Response.json({ status: "incomplete", output: [] }),
  ];
  for (const failure of failures) {
    let calls = 0;
    await assert.rejects(interpretWithOpenAI(koreanFlexibleInput, config, async () => {
      calls++;
      return failure();
    }), (e: unknown) => e instanceof ApiError && e.code !== "INTENT_NOT_GROUNDED" && !e.message.includes("private"));
    assert.equal(calls, 1);
  }
});

test("correction shares the first attempt's 45-second deadline and abort signal", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  let firstSignal: AbortSignal | null | undefined;
  await assert.rejects(interpretWithOpenAI(koreanFlexibleInput, config, async (_url, options) => {
    calls++;
    const signal = options?.signal;
    assert.ok(signal);
    if (calls === 1) {
      firstSignal = signal;
      t.mock.timers.tick(40_000);
      return completed(inventedKoreanEvidence());
    }
    assert.equal(signal, firstSignal);
    return new Promise<Response>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("provider aborted")), { once: true });
      t.mock.timers.tick(4_999);
      assert.equal(signal.aborted, false);
      t.mock.timers.tick(1);
      assert.equal(signal.aborted, true);
    });
  }), (e: unknown) => e instanceof ApiError && e.status === 504 && e.code === "AI_TIMEOUT");
  assert.equal(calls, 2);
});
