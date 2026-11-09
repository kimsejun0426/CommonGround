import type { BuyerId, Scenario, Supplier } from "./domain.ts";

export const BUYER_IDS: readonly BuyerId[] = ["luma", "juniper", "forma"];

/** Invented rules for a disclosed hackathon scenario, not a real supplier quote. */
export const DEMO_SUPPLIER: Readonly<Supplier> = Object.freeze({
  id: "demo-box-studio",
  name: "Common Box Studio · fictional supplier",
  leadDays: 7,
  moqPerBaseVariant: 100,
  baseUnitCents: Object.freeze({ kraft: 120, black: 160 }),
  setupCentsPerBaseVariant: 3000,
  shippingCentsPerBuyer: 800,
  brandLabelUnitCents: 15,
  blackBrandedSleeveUnitCents: 35,
  rulesVersion: "demo-rules-v1",
});

export const DEMO_METADATA: Scenario["metadata"] = Object.freeze({
  fictional: true,
  source: "curated-demo",
  supplierVerified: false,
  description:
    "Three simulated buyer personas and one fictional supplier. Prices, production rules and preferences are curated demo assumptions; they are not verified supplier offers or measured savings.",
});

export function createDemoScenario(): Scenario {
  return {
    id: "commonground-demo-v1",
    revision: 1,
    currency: "USD",
    metadata: { ...DEMO_METADATA },
    supplier: { ...DEMO_SUPPLIER, baseUnitCents: { ...DEMO_SUPPLIER.baseUnitCents } },
    buyers: [
      {
        id: "luma",
        name: "LUMA",
        quantity: 40,
        budgetCents: 9000,
        maxLeadDays: 10,
        active: true,
        requestedBase: "black",
        substitutionConsent: { decision: "pending", conditionsKey: null },
      },
      {
        id: "juniper",
        name: "JUNIPER",
        quantity: 35,
        budgetCents: 7000,
        maxLeadDays: 10,
        active: true,
        requestedBase: "kraft",
        substitutionConsent: { decision: "pending", conditionsKey: null },
      },
      {
        id: "forma",
        name: "FORMA",
        quantity: 25,
        budgetCents: 5500,
        maxLeadDays: 10,
        active: true,
        requestedBase: "kraft",
        substitutionConsent: { decision: "pending", conditionsKey: null },
      },
    ],
  };
}
