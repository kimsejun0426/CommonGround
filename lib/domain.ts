/** Pure domain contracts. All amounts are integer USD cents. */
export type BuyerId = "luma" | "juniper" | "forma";
export type BaseVariant = "kraft" | "black";
export type BrandingFinish = "brand-label" | "black-branded-sleeve";
export type ConsentDecision = "pending" | "accepted" | "declined";
export interface QuantityRange { min: number; max: number; }

export interface SubstitutionConsent {
  decision: ConsentDecision;
  /** Canonical scenario conditions at the time of the decision; not a signature. */
  conditionsKey: string | null;
}

export interface Buyer {
  id: BuyerId;
  name: string;
  quantity: number;
  /** Absent means exactly quantity. A range permits proposals, never automatic acceptance. */
  quantityRange?: QuantityRange;
  budgetCents: number;
  maxLeadDays: number;
  active: boolean;
  requestedBase: BaseVariant;
  /** Only LUMA has an optional kraft-base + branded black-sleeve substitution. */
  substitutionConsent: SubstitutionConsent;
}

export interface Supplier {
  id: "demo-box-studio";
  name: string;
  leadDays: number;
  moqPerBaseVariant: number;
  baseUnitCents: Record<BaseVariant, number>;
  setupCentsPerBaseVariant: number;
  shippingCentsPerBuyer: number;
  brandLabelUnitCents: number;
  blackBrandedSleeveUnitCents: number;
  rulesVersion: "demo-rules-v1";
}

export interface Scenario {
  id: "commonground-demo-v1";
  revision: number;
  currency: "USD";
  metadata: {
    fictional: true;
    source: "curated-demo";
    supplierVerified: false;
    description: string;
  };
  supplier: Supplier;
  buyers: Buyer[];
}

export type ScenarioIssueCode =
  | "NO_ACTIVE_BUYERS"
  | "MOQ_NOT_MET"
  | "BUDGET_EXCEEDED"
  | "LEAD_TIME_EXCEEDED"
  | "QUANTITY_OUT_OF_RANGE"
  | "SUBSTITUTION_CONSENT_REQUIRED";

export interface ScenarioIssue {
  code: ScenarioIssueCode;
  message: string;
  buyerIds: BuyerId[];
  baseVariant?: BaseVariant;
  shortfall?: number;
}

export interface MOQGroupStatus {
  baseVariant: BaseVariant;
  buyerIds: BuyerId[];
  quantity: number;
  moq: number;
  shortfall: number;
  met: boolean;
  setupFeeCents: number;
}

export interface BuyerQuote {
  buyerId: BuyerId;
  buyerName: string;
  quantity: number;
  requestedBase: BaseVariant;
  baseVariant: BaseVariant;
  brandingFinish: BrandingFinish;
  unitBaseCents: number;
  unitBrandingCents: number;
  baseCents: number;
  brandingCents: number;
  setupCents: number;
  shippingCents: number;
  totalCents: number;
  budgetCents: number;
  withinBudget: boolean;
  leadDays: number;
  maxLeadDays: number;
  withinLeadTime: boolean;
  substitutionApplied: boolean;
}

export interface RequiredConsent {
  buyerId: BuyerId;
  changeId: "kraft-with-black-sleeve";
  from: "black";
  to: "kraft";
  brandingFinish: "black-branded-sleeve";
  description: string;
  conditionsKey: string;
}

export interface Evaluation {
  /** True only for the current, explicitly consented, orderable configuration. */
  feasible: boolean;
  /** MOQ, budget and lead-time checks, separate from hypothetical consent. */
  constraintsSatisfied: boolean;
  isHypothetical: boolean;
  status: "ready" | "blocked" | "empty";
  priceStatus: "orderable" | "conditional-estimate";
  currency: "USD";
  totalCents: number;
  totalQuantity: number;
  activeBuyerCount: number;
  buyerQuotes: BuyerQuote[];
  groups: MOQGroupStatus[];
  issues: ScenarioIssue[];
  requiredConsents: RequiredConsent[];
}

export interface Proposal {
  status: "already-feasible" | "needs-consent" | "blocked" | "declined";
  current: Evaluation;
  /** Hypothetical only. Never use this object to create a payment. */
  candidate: Evaluation | null;
  requiredConsents: RequiredConsent[];
  feasibleIfAccepted: boolean;
}

export interface BuyerPatch {
  quantity?: number;
  /** null removes an existing range and restores an exact quantity. */
  quantityRange?: QuantityRange | null;
  budgetCents?: number;
  maxLeadDays?: number;
  active?: boolean;
}
