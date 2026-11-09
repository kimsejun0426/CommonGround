import type {
  BaseVariant,
  Buyer,
  BuyerId,
  BuyerPatch,
  BuyerQuote,
  ConsentDecision,
  Evaluation,
  MOQGroupStatus,
  Proposal,
  RequiredConsent,
  Scenario,
  ScenarioIssue,
} from "./domain.ts";
import { BUYER_IDS, createDemoScenario, DEMO_METADATA, DEMO_SUPPLIER } from "./fixtures.ts";

export { createDemoScenario } from "./fixtures.ts";

export class ScenarioValidationError extends Error {
  readonly code = "INVALID_SCENARIO";
  constructor(message: string) {
    super(message);
    this.name = "ScenarioValidationError";
  }
}

type RecordValue = Record<string, unknown>;

function record(value: unknown, path: string): RecordValue {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ScenarioValidationError(`${path} must be an object.`);
  }
  return value as RecordValue;
}

function exactKeys(value: RecordValue, keys: readonly string[], path: string, optional: readonly string[] = []): void {
  const unknown = Object.keys(value).filter((key) => !keys.includes(key) && !optional.includes(key));
  if (unknown.length) throw new ScenarioValidationError(`${path} contains unsupported fields: ${unknown.join(", ")}.`);
  const missing = keys.filter((key) => !Object.prototype.hasOwnProperty.call(value, key));
  if (missing.length) throw new ScenarioValidationError(`${path} is missing fields: ${missing.join(", ")}.`);
}

function integer(value: unknown, min: number, max: number, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new ScenarioValidationError(`${path} must be a whole number between ${min} and ${max}.`);
  }
  return value;
}

function sameValue(actual: unknown, expected: unknown, path: string): void {
  if (actual !== expected) throw new ScenarioValidationError(`${path} does not match the fixed demo facts.`);
}

/** Strictly validates the disclosed fixture; client-supplied supplier prices are never trusted. */
export function parseScenario(input: unknown): Scenario {
  const value = record(input, "scenario");
  exactKeys(value, ["id", "revision", "currency", "metadata", "supplier", "buyers"], "scenario");
  sameValue(value.id, "commonground-demo-v1", "scenario.id");
  sameValue(value.currency, "USD", "scenario.currency");
  const revision = integer(value.revision, 1, 1_000_000_000, "scenario.revision");

  const metadata = record(value.metadata, "scenario.metadata");
  exactKeys(metadata, Object.keys(DEMO_METADATA), "scenario.metadata");
  for (const [key, expected] of Object.entries(DEMO_METADATA)) sameValue(metadata[key], expected, `scenario.metadata.${key}`);

  const supplier = record(value.supplier, "scenario.supplier");
  exactKeys(supplier, Object.keys(DEMO_SUPPLIER), "scenario.supplier");
  for (const [key, expected] of Object.entries(DEMO_SUPPLIER)) {
    if (key !== "baseUnitCents") sameValue(supplier[key], expected, `scenario.supplier.${key}`);
  }
  const units = record(supplier.baseUnitCents, "scenario.supplier.baseUnitCents");
  exactKeys(units, ["kraft", "black"], "scenario.supplier.baseUnitCents");
  sameValue(units.kraft, DEMO_SUPPLIER.baseUnitCents.kraft, "scenario.supplier.baseUnitCents.kraft");
  sameValue(units.black, DEMO_SUPPLIER.baseUnitCents.black, "scenario.supplier.baseUnitCents.black");

  if (!Array.isArray(value.buyers) || value.buyers.length !== BUYER_IDS.length) {
    throw new ScenarioValidationError("scenario.buyers must contain exactly the three demo personas.");
  }
  const templates = createDemoScenario().buyers;
  const buyers = value.buyers.map((item, index): Buyer => {
    const path = `scenario.buyers[${index}]`;
    const buyer = record(item, path);
    exactKeys(buyer, ["id", "name", "quantity", "budgetCents", "maxLeadDays", "active", "requestedBase", "substitutionConsent"], path, ["quantityRange"]);
    const template = templates.find((entry) => entry.id === buyer.id);
    if (!template) throw new ScenarioValidationError(`${path}.id is not a known demo persona.`);
    sameValue(buyer.name, template.name, `${path}.name`);
    sameValue(buyer.requestedBase, template.requestedBase, `${path}.requestedBase`);
    if (typeof buyer.active !== "boolean") throw new ScenarioValidationError(`${path}.active must be boolean.`);
    const consent = record(buyer.substitutionConsent, `${path}.substitutionConsent`);
    exactKeys(consent, ["decision", "conditionsKey"], `${path}.substitutionConsent`);
    if (typeof consent.decision !== "string" || !["pending", "accepted", "declined"].includes(consent.decision)) {
      throw new ScenarioValidationError(`${path}.substitutionConsent.decision is invalid.`);
    }
    if (consent.conditionsKey !== null && (typeof consent.conditionsKey !== "string" || consent.conditionsKey.length > 16_000)) {
      throw new ScenarioValidationError(`${path}.substitutionConsent.conditionsKey is invalid.`);
    }
    if (consent.decision === "pending" && consent.conditionsKey !== null) {
      throw new ScenarioValidationError(`${path}: pending consent cannot bind conditions.`);
    }
    if (consent.decision !== "pending" && (typeof consent.conditionsKey !== "string" || !consent.conditionsKey)) {
      throw new ScenarioValidationError(`${path}: a decision must bind the scenario conditions.`);
    }
    if (template.id !== "luma" && consent.decision !== "pending") {
      throw new ScenarioValidationError(`${path}: this persona has no proposed physical substitution.`);
    }
    const quantity = integer(buyer.quantity, 1, 100_000, `${path}.quantity`);
    let quantityRange: Buyer["quantityRange"];
    if (Object.prototype.hasOwnProperty.call(buyer, "quantityRange")) {
      const range = record(buyer.quantityRange, `${path}.quantityRange`);
      exactKeys(range, ["min", "max"], `${path}.quantityRange`);
      quantityRange = {
        min: integer(range.min, 1, 100_000, `${path}.quantityRange.min`),
        max: integer(range.max, 1, 100_000, `${path}.quantityRange.max`),
      };
      if (quantityRange.min > quantity || quantityRange.max < quantity) {
        throw new ScenarioValidationError(`${path}.quantityRange must contain the requested quantity.`);
      }
    }
    return {
      id: template.id,
      name: template.name,
      requestedBase: template.requestedBase,
      quantity,
      ...(quantityRange ? { quantityRange } : {}),
      budgetCents: integer(buyer.budgetCents, 0, 100_000_000, `${path}.budgetCents`),
      maxLeadDays: integer(buyer.maxLeadDays, 1, 365, `${path}.maxLeadDays`),
      active: buyer.active,
      substitutionConsent: {
        decision: consent.decision as ConsentDecision,
        conditionsKey: consent.conditionsKey as string | null,
      },
    };
  });
  if (new Set(buyers.map((buyer) => buyer.id)).size !== BUYER_IDS.length) {
    throw new ScenarioValidationError("scenario.buyers must not contain duplicate personas.");
  }
  buyers.sort((a, b) => BUYER_IDS.indexOf(a.id) - BUYER_IDS.indexOf(b.id));
  return {
    id: "commonground-demo-v1",
    revision,
    currency: "USD",
    metadata: { ...DEMO_METADATA },
    supplier: { ...DEMO_SUPPLIER, baseUnitCents: { ...DEMO_SUPPLIER.baseUnitCents } },
    buyers,
  };
}

/** Returns an effective range without adding fields to legacy stored scenarios. */
export function getQuantityRange(buyer: Pick<Buyer, "quantity" | "quantityRange">): { min: number; max: number } {
  return buyer.quantityRange ? { ...buyer.quantityRange } : { min: buyer.quantity, max: buyer.quantity };
}

function conditionsKey(scenario: Scenario): string {
  return JSON.stringify({
    scenarioId: scenario.id,
    currency: scenario.currency,
    supplier: scenario.supplier,
    buyers: scenario.buyers.map(({ id, quantity, budgetCents, maxLeadDays, active, requestedBase, quantityRange }) => ({
      id, quantity, budgetCents, maxLeadDays, active, requestedBase,
      ...(quantityRange ? { quantityRange } : {}),
    })),
  });
}

/** Canonical conditions used to invalidate stale physical-change decisions. Not a payment authorization. */
export function getScenarioConditionsKey(input: Scenario): string {
  return conditionsKey(parseScenario(input));
}

/** Includes decisions and revision; the server may hash this along with evaluateScenario().buyerQuotes. */
export function getScenarioFingerprintInput(input: Scenario): string {
  return JSON.stringify(parseScenario(input));
}

export function getEffectiveConsent(input: Scenario, buyerId: BuyerId): ConsentDecision {
  const scenario = parseScenario(input);
  const buyer = scenario.buyers.find((item) => item.id === buyerId);
  if (!buyer || !buyer.active) return "pending";
  return buyer.substitutionConsent.conditionsKey === conditionsKey(scenario)
    ? buyer.substitutionConsent.decision
    : "pending";
}

/** Largest-remainder allocation; every setup cent is assigned exactly once. Ties use buyer id. */
function allocateSetup(buyers: Buyer[], setupCents: number): Map<BuyerId, number> {
  const totalQuantity = buyers.reduce((total, buyer) => total + buyer.quantity, 0);
  const shares = buyers.map((buyer) => ({
    id: buyer.id,
    cents: Math.floor((setupCents * buyer.quantity) / totalQuantity),
    remainder: (setupCents * buyer.quantity) % totalQuantity,
  }));
  let unassigned = setupCents - shares.reduce((total, share) => total + share.cents, 0);
  shares.sort((a, b) => b.remainder - a.remainder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const share of shares) {
    if (unassigned <= 0) break;
    share.cents += 1;
    unassigned -= 1;
  }
  return new Map(shares.map((share) => [share.id, share.cents]));
}

function makeRequiredConsent(scenario: Scenario): RequiredConsent {
  return {
    buyerId: "luma",
    changeId: "kraft-with-black-sleeve",
    from: "black",
    to: "kraft",
    brandingFinish: "black-branded-sleeve",
    description: "Use the shared kraft gift box with a LUMA-branded black sleeve instead of a black base box. The sleeve replaces the separate brand label.",
    conditionsKey: conditionsKey(scenario),
  };
}

function evaluate(scenario: Scenario, hypotheticalSubstitution: boolean): Evaluation {
  const active = scenario.buyers.filter((buyer) => buyer.active);
  const key = conditionsKey(scenario);
  const luma = active.find((buyer) => buyer.id === "luma");
  const accepted = luma?.substitutionConsent.decision === "accepted" && luma.substitutionConsent.conditionsKey === key;
  const substitute = Boolean(luma && (accepted || hypotheticalSubstitution));
  const variantFor = (buyer: Buyer): BaseVariant => buyer.id === "luma" && substitute ? "kraft" : buyer.requestedBase;
  const requiredConsents: RequiredConsent[] = hypotheticalSubstitution && luma && !accepted ? [makeRequiredConsent(scenario)] : [];
  const issues: ScenarioIssue[] = [];
  const groups: MOQGroupStatus[] = [];
  const setupByBuyer = new Map<BuyerId, number>();

  if (!active.length) issues.push({ code: "NO_ACTIVE_BUYERS", message: "At least one active buyer is required.", buyerIds: [] });

  for (const baseVariant of ["kraft", "black"] as const) {
    const groupBuyers = active.filter((buyer) => variantFor(buyer) === baseVariant);
    if (!groupBuyers.length) continue;
    const quantity = groupBuyers.reduce((total, buyer) => total + buyer.quantity, 0);
    const moq = scenario.supplier.moqPerBaseVariant;
    const shortfall = Math.max(0, moq - quantity);
    const buyerIds = groupBuyers.map((buyer) => buyer.id);
    groups.push({ baseVariant, buyerIds, quantity, moq, shortfall, met: shortfall === 0, setupFeeCents: scenario.supplier.setupCentsPerBaseVariant });
    for (const [id, cents] of allocateSetup(groupBuyers, scenario.supplier.setupCentsPerBaseVariant)) setupByBuyer.set(id, cents);
    if (shortfall > 0) issues.push({
      code: "MOQ_NOT_MET", baseVariant, shortfall, buyerIds,
      message: `${baseVariant === "kraft" ? "Kraft" : "Black"} base: ${quantity} of ${moq} required boxes; ${shortfall} more needed. Different base variants cannot share this MOQ.`,
    });
  }

  const buyerQuotes = active.map((buyer): BuyerQuote => {
    const baseVariant = variantFor(buyer);
    const substitutionApplied = buyer.id === "luma" && substitute;
    const unitBaseCents = scenario.supplier.baseUnitCents[baseVariant];
    const unitBrandingCents = substitutionApplied ? scenario.supplier.blackBrandedSleeveUnitCents : scenario.supplier.brandLabelUnitCents;
    const baseCents = buyer.quantity * unitBaseCents;
    const brandingCents = buyer.quantity * unitBrandingCents;
    const setupCents = setupByBuyer.get(buyer.id) ?? 0;
    const shippingCents = scenario.supplier.shippingCentsPerBuyer;
    const totalCents = baseCents + brandingCents + setupCents + shippingCents;
    const withinBudget = totalCents <= buyer.budgetCents;
    const withinLeadTime = scenario.supplier.leadDays <= buyer.maxLeadDays;
    if (!withinBudget) issues.push({
      code: "BUDGET_EXCEEDED", buyerIds: [buyer.id], shortfall: totalCents - buyer.budgetCents,
      message: `${buyer.name}'s conditional total exceeds their budget by $${((totalCents - buyer.budgetCents) / 100).toFixed(2)}.`,
    });
    if (!withinLeadTime) issues.push({
      code: "LEAD_TIME_EXCEEDED", buyerIds: [buyer.id], shortfall: scenario.supplier.leadDays - buyer.maxLeadDays,
      message: `${buyer.name} needs delivery within ${buyer.maxLeadDays} days; the demo supplier requires ${scenario.supplier.leadDays} days.`,
    });
    return {
      buyerId: buyer.id, buyerName: buyer.name, quantity: buyer.quantity,
      requestedBase: buyer.requestedBase, baseVariant,
      brandingFinish: substitutionApplied ? "black-branded-sleeve" : "brand-label",
      unitBaseCents, unitBrandingCents, baseCents, brandingCents, setupCents, shippingCents, totalCents,
      budgetCents: buyer.budgetCents, withinBudget,
      leadDays: scenario.supplier.leadDays, maxLeadDays: buyer.maxLeadDays, withinLeadTime,
      substitutionApplied,
    };
  });
  const constraintsSatisfied = active.length > 0 && issues.length === 0;
  for (const consent of requiredConsents) issues.push({
    code: "SUBSTITUTION_CONSENT_REQUIRED", buyerIds: [consent.buyerId],
    message: "LUMA must explicitly accept the kraft box with a branded black sleeve before this configuration can be ordered.",
  });
  const feasible = constraintsSatisfied && requiredConsents.length === 0 && !hypotheticalSubstitution;
  return {
    feasible, constraintsSatisfied, isHypothetical: hypotheticalSubstitution,
    status: !active.length ? "empty" : feasible ? "ready" : "blocked",
    priceStatus: feasible ? "orderable" : "conditional-estimate",
    currency: "USD",
    totalCents: buyerQuotes.reduce((total, quote) => total + quote.totalCents, 0),
    totalQuantity: active.reduce((total, buyer) => total + buyer.quantity, 0),
    activeBuyerCount: active.length,
    buyerQuotes, groups, issues, requiredConsents,
  };
}

/** Only explicitly accepted, current physical-change consent can change a buyer's requested base. */
export function evaluateScenario(input: Scenario): Evaluation {
  return evaluate(parseScenario(input), false);
}

/** Re-evaluates the originally requested base variants; prices remain conditional when MOQ fails. */
export function evaluateOriginalScenario(input: Scenario): Evaluation {
  const scenario = parseScenario(input);
  for (const buyer of scenario.buyers) buyer.substitutionConsent = { decision: "pending", conditionsKey: null };
  return evaluate(scenario, false);
}

/** Tries the unchanged configuration first. Declines are respected; no automatic changes occur. */
export function proposeScenario(input: Scenario): Proposal {
  const scenario = parseScenario(input);
  const current = evaluate(scenario, false);
  if (current.feasible) return { status: "already-feasible", current, candidate: null, requiredConsents: [], feasibleIfAccepted: true };
  const luma = scenario.buyers.find((buyer) => buyer.id === "luma" && buyer.active);
  const decision = getEffectiveConsent(scenario, "luma");
  if (!luma || decision === "accepted") return { status: "blocked", current, candidate: null, requiredConsents: [], feasibleIfAccepted: false };
  if (decision === "declined") return { status: "declined", current, candidate: null, requiredConsents: [], feasibleIfAccepted: false };
  const candidate = evaluate(scenario, true);
  return {
    status: candidate.constraintsSatisfied ? "needs-consent" : "blocked",
    current, candidate, requiredConsents: candidate.requiredConsents,
    feasibleIfAccepted: candidate.constraintsSatisfied,
  };
}

/** Records only the physical substitution. Final quote approvals and PayPal states live on the server. */
export function applyConsent(input: Scenario, buyerId: BuyerId, decision: ConsentDecision): Scenario {
  const scenario = parseScenario(input);
  if (buyerId !== "luma") throw new ScenarioValidationError("Only LUMA has a proposed physical substitution.");
  if (!["pending", "accepted", "declined"].includes(decision)) throw new ScenarioValidationError("Invalid consent decision.");
  const buyer = scenario.buyers.find((entry) => entry.id === buyerId)!;
  if (!buyer.active && decision !== "pending") throw new ScenarioValidationError("An inactive buyer cannot accept or decline a substitution.");
  const key = decision === "pending" ? null : conditionsKey(scenario);
  buyer.substitutionConsent = { decision, conditionsKey: key };
  scenario.revision += 1;
  return parseScenario(scenario);
}

/** A changed request invalidates physical-change consent; the server separately invalidates quote approvals. */
export function updateBuyer(input: Scenario, buyerId: BuyerId, patch: BuyerPatch): Scenario {
  const scenario = parseScenario(input);
  const buyer = scenario.buyers.find((entry) => entry.id === buyerId);
  if (!buyer) throw new ScenarioValidationError("Unknown buyer.");
  const values = record(patch, "buyerPatch");
  const allowed = ["quantity", "quantityRange", "budgetCents", "maxLeadDays", "active"];
  if (Object.keys(values).some((key) => !allowed.includes(key))) throw new ScenarioValidationError("Only quantity, quantity range, budget, lead time and active status may be edited.");
  let changed = false;
  for (const key of allowed as Array<keyof BuyerPatch>) {
    if (Object.prototype.hasOwnProperty.call(values, key)) {
      if (key === "quantityRange") {
        if (values[key] === null) {
          if (buyer.quantityRange !== undefined) changed = true;
          delete buyer.quantityRange;
        } else {
          const range = record(values[key], "buyerPatch.quantityRange");
          exactKeys(range, ["min", "max"], "buyerPatch.quantityRange");
          if (buyer.quantityRange?.min !== range.min || buyer.quantityRange?.max !== range.max) changed = true;
          buyer.quantityRange = { min: range.min as number, max: range.max as number };
        }
        continue;
      }
      if (values[key] !== buyer[key]) changed = true;
      Object.assign(buyer, { [key]: values[key] });
    }
  }
  if (changed) {
    for (const item of scenario.buyers) item.substitutionConsent = { decision: "pending", conditionsKey: null };
    scenario.revision += 1;
  }
  return parseScenario(scenario);
}
