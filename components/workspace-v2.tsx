"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Box,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  ClipboardList,
  Clock3,
  CreditCard,
  Download,
  FileText,
  Fingerprint,
  Globe2,
  Layers3,
  LayoutGrid,
  Leaf,
  LoaderCircle,
  LockKeyhole,
  PackageCheck,
  Pencil,
  Plus,
  Printer,
  RotateCcw,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { BrandBox } from "@/components/brand-box";
import PlanEvidence from "@/components/plan-evidence";
import NegotiationPanel from "@/components/negotiation-panel";
import { buildCheckoutSummary, checkoutReference } from "@/lib/checkout-summary";
import { useOrderWorkspace, type Lang } from "@/components/use-order-workspace";
import {
  applyConsent,
  createDemoScenario,
  getEffectiveConsent,
  getQuantityRange,
  updateBuyer,
} from "@/lib/engine";
import { applyPlanningPlan, buildPlanningOverview } from "@/lib/planning";
import { clientApi, ClientApiError } from "@/lib/client-api";
import { createInterpretationRequestGuard, type InterpretationRequestToken } from "@/lib/interpretation-request";
import { applyNegotiationOption, buildNegotiationOptions, type NegotiationOption } from "@/lib/negotiation";
import type { RequestInterpretation as Interpretation } from "@/lib/intent";
import type {
  Buyer,
  BuyerId,
  BuyerPatch,
  Evaluation,
  Scenario,
} from "@/lib/domain";

type View = "briefs" | "plans" | "agreement" | "checkout" | "brief";
type PresetKind = "standard" | "budget" | "fixed-budget" | "deadline";
type Plan = ReturnType<typeof buildPlanningOverview>["plans"][number];
type Order = ReturnType<typeof useOrderWorkspace>;
const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    cents / 100,
  );
const brandCopy = {
  luma: {
    category: ["Lifestyle objects", "라이프스타일 제품"],
    quote: [
      "The first impression should still feel unmistakably LUMA.",
      "처음 마주하는 순간부터 LUMA다운 검정색 인상이 필요해요.",
    ],
    priority: ["A signature black exterior", "시그니처 블랙 외관"],
    flexibility: [
      "Open to a branded sleeve, after review",
      "검토 후 브랜드 슬리브로 변경 가능",
    ],
  },
  juniper: {
    category: ["Botanical essentials", "보태니컬 케어"],
    quote: [
      "Keep the natural paper feel. Our own label does the talking.",
      "자연스러운 종이 질감은 그대로, 우리 라벨을 붙이고 싶어요.",
    ],
    priority: ["Natural kraft + own label", "크라프트 질감과 자체 라벨"],
    flexibility: [
      "Same base, separate branding",
      "공통 상자에 브랜딩은 개별 적용",
    ],
  },
  forma: {
    category: ["Independent design goods", "독립 디자인 소품"],
    quote: [
      "A small first run. Something we can make our own.",
      "첫 제작은 작게 시작하되, 우리만의 느낌은 담고 싶어요.",
    ],
    priority: ["Own graphic identity", "자체 그래픽 아이덴티티"],
    flexibility: [
      "Quantity changes can be reviewed",
      "제안에 따라 수량 조정 검토 가능",
    ],
  },
} as const;

function Avatar({ id, small = false }: { id: BuyerId; small?: boolean }) {
  return (
    <span className={`cg-avatar ${id} ${small ? "small" : ""}`}>
      {id === "luma" ? "L" : id === "juniper" ? "J" : "F"}
    </span>
  );
}

function ScenarioPresets({
  lang,
  disabled,
  onPick,
}: {
  lang: Lang;
  disabled: boolean;
  onPick: (kind: PresetKind) => void;
}) {
  const t = (en: string, ko: string) => (lang === "en" ? en : ko);
  return (
    <section
      className="cg-scenario-presets"
      aria-label={t("Load a demo scenario", "시연 사례 불러오기")}
    >
      <div>
        <span className="cg-eyebrow">
          {t("LOAD A DEMO SCENARIO", "시연 사례 불러오기")}
        </span>
        <p>
          {t(
            "Compare fixed quantities with flexibility from both brands. Each example replaces all three saved briefs.",
            "수량 고정과 두 브랜드의 조정 허용을 비교해 보세요. 사례를 불러오면 세 브랜드의 요청이 예시 조건으로 바뀌어요.",
          )}
        </p>
      </div>
      <button
        className="cg-btn secondary"
        onClick={() => onPick("fixed-budget")}
        disabled={disabled}
      >
        <LockKeyhole size={15} />
        {t("$80 · quantities fixed", "$80 · 수량 고정")}
      </button>
      <button
        className="cg-btn secondary"
        onClick={() => onPick("budget")}
        disabled={disabled}
      >
        <SlidersHorizontal size={15} />
        {t("$80 · two brands can adjust", "$80 · 두 브랜드 조정 허용")}
      </button>
      <button
        className="cg-btn ghost small"
        onClick={() => onPick("standard")}
        disabled={disabled}
      >
        <RotateCcw size={13} />
        {t("Standard example", "기본 사례")}
      </button>
      <div className="cg-preset-conditions">
        <span><strong>{t("Fixed", "고정")}</strong> LUMA 40 · JUNIPER 35 · FORMA 25</span>
        <span><strong>{t("Flexible", "조정 허용")}</strong> LUMA 38–40 · JUNIPER 35 · FORMA 25–30</span>
      </div>
    </section>
  );
}

function Wordmark({ small = false }: { small?: boolean }) {
  return (
    <div className={`cg-logo ${small ? "compact" : ""}`}>
      <span className="cg-logo-symbol">
        <i />
        <i />
        <i />
      </span>
      <span className="cg-nav-label">
        common
        <br />
        <b>ground.</b>
      </span>
    </div>
  );
}

function Dialog({
  title,
  subtitle,
  children,
  onClose,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="cg-dialog"
      aria-labelledby={headingId}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="cg-dialog-heading">
        <div>
          <h2 id={headingId}>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <button
          className="cg-btn icon ghost"
          aria-label="Close"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

function PanelHead({
  kicker,
  title,
  children,
}: {
  kicker?: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="cg-panel-head">
      <div>
        {kicker && <span className="cg-eyebrow">{kicker}</span>}
        <h2>{title}</h2>
      </div>
      {children}
    </div>
  );
}

function planTitle(plan: Plan, lang: Lang) {
  const ko = lang === "ko";
  return plan.kind === "shared-base"
    ? ko
      ? "공통 상자, 각자의 브랜딩"
      : plan.evaluation.activeBuyerCount === 3
        ? "One base. Three identities."
        : "One base. Individual brands."
    : plan.kind === "quantity-rebalance"
      ? ko
        ? "수량을 조금씩 조정하기"
        : "A little give. A better fit."
      : ko
        ? plan.totalExtraUnits > 0
          ? "원래 상자로 최소 수량 맞추기"
          : "원래 요청 그대로 제작하기"
        : "Keep every original detail.";
}

function changedConfigurations(source: Evaluation, plan: Plan): BuyerId[] {
  return plan.evaluation.buyerQuotes
    .filter((next) => {
      const previous = source.buyerQuotes.find(
        (q) => q.buyerId === next.buyerId,
      );
      return (
        previous &&
        (previous.baseVariant !== next.baseVariant ||
          previous.brandingFinish !== next.brandingFinish)
      );
    })
    .map((q) => q.buyerId);
}

function PlanState({ plan, lang }: { plan: Plan; lang: Lang }) {
  return (
    <span
      className={`cg-pill ${plan.feasibleIfApproved ? "positive" : "warning"}`}
    >
      {plan.feasibleIfApproved ? <Check size={12} /> : <CircleHelp size={12} />}
      {plan.feasibleIfApproved
        ? lang === "ko"
          ? "동의 후 가능"
          : "Works with approval"
        : lang === "ko"
          ? "조건 조정 필요"
          : "Needs a change"}
    </span>
  );
}

function issueText(issue: Evaluation["issues"][number], lang: Lang) {
  if (lang === "en") return issue.message;
  const brands = issue.buyerIds.map((id) => id.toUpperCase()).join(" · ");
  if (issue.code === "MOQ_NOT_MET")
    return `${issue.baseVariant === "black" ? "블랙" : "크라프트"} 상자가 최소 주문량보다 ${issue.shortfall ?? 0}개 부족해요.`;
  if (issue.code === "BUDGET_EXCEEDED")
    return `${brands}의 예산을 초과해요. 금액을 확인하고 다른 구성을 검토해 주세요.`;
  if (issue.code === "LEAD_TIME_EXCEEDED")
    return `${brands}의 희망 제작 기간이 공급 조건인 7일보다 짧아요.`;
  if (issue.code === "NO_ACTIVE_BUYERS")
    return "참여할 브랜드를 한 곳 이상 선택해 주세요.";
  return "LUMA의 기본 상자 변경에 대한 동의가 필요해요.";
}

function QuoteTable({
  evaluation,
  lang,
}: {
  evaluation: Evaluation;
  lang: Lang;
}) {
  const t = (en: string, ko: string) => (lang === "en" ? en : ko);
  return (
    <div className="cg-table-wrap">
      <table className="cg-compare">
        <caption className="cg-sr-only">{t("Itemized estimate in USD. Delivery is included; taxes are not modeled.", "USD 기준 항목별 예상 금액. 배송비 포함, 세금은 반영되지 않은 예시예요.")}</caption>
        <thead>
          <tr>
            <th>{t("Brand / quantity", "브랜드 / 수량")}</th>
            <th>{t("Base", "상자")}</th>
            <th>{t("Branding", "브랜딩")}</th>
            <th>{t("Setup", "준비비")}</th>
            <th>{t("Delivery", "배송")}</th>
            <th>{t("Your share", "개인별 금액")}</th>
          </tr>
        </thead>
        <tbody>
          {evaluation.buyerQuotes.map((q) => (
            <tr key={q.buyerId}>
              <td>
                <span className="cg-table-brand">
                  <Avatar id={q.buyerId} small />
                  <span>
                    {q.buyerName}
                    <small>
                      {q.quantity} {t("units", "개")}
                    </small>
                  </span>
                </span>
              </td>
              <td>{money(q.baseCents)}</td>
              <td>{money(q.brandingCents)}</td>
              <td>{money(q.setupCents)}</td>
              <td>{money(q.shippingCents)}</td>
              <td className={q.withinBudget ? "cg-price" : "cg-over-budget"}>
                {money(q.totalCents)}
                <small>
                  {q.withinBudget
                    ? t("Within budget", "예산 이내")
                    : t("Over budget", "예산 초과")}
                </small>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={5}>{t("Shared order total", "공동발주 총금액")}</td>
            <td>{money(evaluation.totalCents)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export default function WorkspaceV2() {
  const order = useOrderWorkspace();
  const { lang, scenario, current, config, locked } = order;
  const signedOut = order.checkoutRecoveryStatus === "unauthenticated";
  const canUseAI = order.checkoutRecoveryStatus === "ready" && config.aiReady;
  const t = (en: string, ko: string) => (lang === "en" ? en : ko);
  const [view, setView] = useState<View>("briefs");
  const [modal, setModal] = useState<
    "connections" | "supplier" | "about" | "archive" | null
  >(null);
  const [editor, setEditor] = useState<BuyerId | null>(null);
  const [editorIntent, setEditorIntent] = useState(false);
  const [reviewPlan, setReviewPlan] = useState<Plan | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [visual, setVisual] = useState<"original" | "shared">("shared");
  const [analysing, setAnalysing] = useState(false);
  const content = useRef<HTMLDivElement>(null);
  const requestedNavigation = useRef(false);
  const planning = useMemo(() => buildPlanningOverview(scenario), [scenario]);
  const negotiationOptions = useMemo(() => buildNegotiationOptions(scenario), [scenario]);
  const recommended =
    planning.plans.find((plan) => plan.id === planning.recommendedPlanId) ??
    planning.plans[0];
  const selected =
    planning.plans.find((plan) => plan.id === selectedId) ?? recommended;
  const selectedConfigurationChanges = selected
    ? changedConfigurations(current, selected)
    : [];
  const displayedPlans = planning.plans.filter(
    (plan) =>
      plan.kind !== "quantity-rebalance" ||
      plan.id === planning.recommendedPlanId,
  );
  const showingPlanEstimate = view === "plans" || !current.feasible;
  const comparison = showingPlanEstimate
    ? (selected?.evaluation ?? current)
    : current;
  const railIsPreview = view === "plans";
  const railEvaluation = railIsPreview ? (selected?.evaluation ?? current) : current;
  const railFits = railIsPreview ? Boolean(selected?.feasibleIfApproved) : current.feasible;
  const accepted = getEffectiveConsent(scenario, "luma") === "accepted";
  const declined = getEffectiveConsent(scenario, "luma") === "declined";
  const approvedCount = order.activeBuyers.filter(
    (b) => order.agreed[b.id],
  ).length;
  const waitingApprovals = order.activeBuyers.filter((b) => !order.agreed[b.id]).map((b) => b.name);
  const paymentSummary = buildCheckoutSummary(current.buyerQuotes, order.receipts, order.paymentMode);
  const reviewReady = current.feasible && order.allAgreed && order.allPaid;
  const stage = reviewReady
    ? 4
    : order.hasOrders
      ? 3
      : current.feasible
        ? 2
        : view === "briefs"
          ? 0
          : 1;

  useEffect(() => {
    if (order.shouldShowCheckout) setView("checkout");
  }, [order.shouldShowCheckout]);
  useEffect(() => {
    if (!requestedNavigation.current) return;
    requestedNavigation.current = false;
    const frame = requestAnimationFrame(() => {
      content.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" });
      content.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [view]);
  function navigate(next: View) {
    if (locked && next !== "checkout" && next !== "brief") return;
    requestedNavigation.current = true;
    setView(next);
    if (next === view) {
      requestedNavigation.current = false;
      content.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }
  async function analyse() {
    navigate("plans");
    if (canUseAI && !locked) await refreshGuidance();
  }
  async function refreshGuidance() {
    setAnalysing(true);
    try { await order.findFit(); }
    finally { setAnalysing(false); }
  }
  async function applyNegotiation(option: NegotiationOption, approved: BuyerId[]) {
    const next = applyNegotiationOption(scenario, option.id, approved, option.inputFingerprint);
    if (!await order.changeScenario(next)) {
      throw new Error(t("The revised conditions could not be saved. Review the current checkout and try again.", "변경 조건을 저장하지 못했어요. 진행 중인 견적을 확인하고 다시 시도해 주세요."));
    }
    setSelectedId(null);
    requestedNavigation.current = true;
    setView("plans");
    order.setNotice(t("The reviewed conditions are saved. Now review the specific packaging and quantity changes; final quote approval still follows.", "확인한 조건을 저장했어요. 이제 구체적인 포장·수량 변경을 검토하고, 최종 견적에도 동의해 주세요."));
    if (canUseAI) await refreshGuidance();
  }
  async function preset(kind: PresetKind) {
    let next = createDemoScenario();
    if (kind === "budget" || kind === "fixed-budget")
      next = updateBuyer(next, "luma", { budgetCents: 8000 });
    if (kind === "budget") {
      next = updateBuyer(next, "luma", { quantityRange: { min: 38, max: 40 } });
      next = updateBuyer(next, "forma", {
        quantityRange: { min: 25, max: 30 },
      });
    }
    if (kind === "deadline")
      next = updateBuyer(next, "juniper", { maxLeadDays: 6 });
    if (await order.changeScenario(next)) {
      setSelectedId(null);
      requestedNavigation.current = true;
      setView(kind === "standard" ? "briefs" : "plans");
      order.setNotice(
        kind === "budget"
          ? t(
              "LUMA can review 38–40 boxes; FORMA can review 25–30. Both still approve any proposed change. Budgets stay fixed.",
              "LUMA는 38–40개, FORMA는 25–30개까지 검토할 수 있는 예시예요. 실제 변경은 양쪽의 별도 동의가 필요하고 예산은 유지돼요.",
            )
          : kind === "fixed-budget"
            ? t(
                "LUMA needs exactly 40 boxes with an $80 maximum. The app cannot reduce its quantity to make the numbers work.",
                "LUMA는 정확히 40개가 필요하고 예산은 80달러예요. 예산을 맞추기 위해 필요한 수량을 줄일 수 없어요.",
              )
            : kind === "deadline"
              ? t(
                  "JUNIPER needs production in 6 days. The supplier requires 7; no plan can promise an earlier finish.",
                  "JUNIPER는 6일 이내 제작을 원해요. 공급 조건은 7일이라 현재는 약속할 수 없어요.",
                )
              : "",
      );
      if (kind !== "standard" && canUseAI) await refreshGuidance();
    }
  }
  async function applyPlan(plan: Plan, approved: BuyerId[]) {
    if (
      changedConfigurations(current, plan).some((id) => !approved.includes(id))
    ) {
      throw new Error(
        t(
          "Every brand whose packaging changes must approve that change.",
          "포장 구성이 바뀌는 브랜드의 확인이 필요해요.",
        ),
      );
    }
    let next = applyPlanningPlan(
      scenario,
      plan.id,
      approved.filter((id) => plan.requiredApprovals.includes(id)),
      plan.inputFingerprint,
    );
    if (plan.physicalConsentRequired.includes("luma")) {
      if (!approved.includes("luma"))
        throw new Error(
          t(
            "LUMA must approve the packaging change.",
            "LUMA의 포장 변경 동의가 필요해요.",
          ),
        );
      next = applyConsent(next, "luma", "accepted");
    }
    if (await order.changeScenario(next)) {
      setReviewPlan(null);
      setSelectedId(null);
      requestedNavigation.current = true;
      setView("agreement");
    } else
      throw new Error(
        t(
          "The saved order could not be changed. Please try again.",
          "저장된 주문을 변경하지 못했어요. 다시 시도해 주세요.",
        ),
      );
  }
  function exportBrief() {
    const lines = [
      "COMMONGROUND — SHARED PRODUCTION BRIEF",
      `Created: ${new Date().toISOString()}`,
      `Scenario revision: ${scenario.revision}`,
      `Quote reference: ${checkoutReference(order.paymentMode, order.quoteId, scenario.revision) ?? "Not created yet"}`,
      "Status: fictional supplier / draft for review / no manufacturing order sent",
      `Payment mode: ${order.paymentMode === "sample" ? "local simulation; no payment" : "PayPal Sandbox test payments"}`,
      `Configuration feasible under sample rules: ${current.feasible ? "yes" : "no"}`,
      `Final persona approvals: ${approvedCount}/${order.activeBuyers.length}`,
      `Payment steps complete: ${order.paidCount}/${order.activeBuyers.length}`,
      "",
      "SUPPLIER ASSUMPTIONS",
      `Supplier: ${scenario.supplier.name}`,
      "This sample assumes one common box format and size; different base variants and separate branding. Physical compatibility is not independently verified.",
      `Minimum ${scenario.supplier.moqPerBaseVariant} per base variant; production ${scenario.supplier.leadDays} days; taxes not modeled.`,
      "",
      "BRAND LINE ITEMS",
      ...current.buyerQuotes.map(
        (q) =>
          `${q.buyerName}: ${q.quantity} units; permitted quantity ${getQuantityRange(scenario.buyers.find((b) => b.id === q.buyerId)!).min}–${getQuantityRange(scenario.buyers.find((b) => b.id === q.buyerId)!).max}; ${q.baseVariant}; ${q.brandingFinish}; base ${money(q.baseCents)} + branding ${money(q.brandingCents)} + setup ${money(q.setupCents)} + delivery ${money(q.shippingCents)} = ${money(q.totalCents)}. Final approval: ${order.agreed[q.buyerId] ? "recorded by demo operator" : "pending"}. Payment: ${order.receipts[q.buyerId]?.kind === "sandbox" ? `verified Sandbox capture ${order.receipts[q.buyerId]?.reference}` : order.receipts[q.buyerId] ? "sample step only; no PayPal transaction" : "pending"}.`,
      ),
      "",
      `TOTAL: ${money(current.totalCents)} USD / ${current.totalQuantity} units`,
      `${order.paymentMode === "sample" ? "Sample steps represented" : "Verified Sandbox captures"}: ${money(paymentSummary.completedCents)}; outstanding shares: ${money(paymentSummary.remainingCents)}. No real money is represented.`,
      `LUMA material change: ${accepted ? "kraft base + black branded sleeve accepted for this revision" : declined ? "declined; original black base retained" : "not approved"}`,
      "",
      "BEFORE REAL PRODUCTION",
      "Confirm dimensions and fit; material/finish; artwork files and print proof; physical sample; supplier quotation and delivery terms.",
      "",
      "Three fictional buyer personas are operated by one user. This document is not a supplier confirmation, binding purchase order, or real payment receipt.",
    ];
    const url = URL.createObjectURL(
      new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "CommonGround_Production_Brief.txt";
    a.click();
    URL.revokeObjectURL(url);
    order.setNotice(
      t(
        "The production brief has been downloaded.",
        "제작 요청서 초안을 내려받았어요.",
      ),
    );
  }

  if (order.restoring || order.restoreError)
    return (
      <main className="cg-loading-page">
        <Wordmark />
        <div className="cg-panel">
          <LoaderCircle className={order.restoring ? "cg-spin" : ""} />
          <h1>
            {t(
              "Picking up where you left off",
              "진행하던 주문을 불러오고 있어요",
            )}
          </h1>
          <p>
            {order.restoreError ||
              t(
                "Checking the saved quote and payment records.",
                "저장된 견적과 결제 기록을 확인하고 있어요.",
              )}
          </p>
          {signedOut ? <SignInLink lang={lang} /> : order.restoreError && (
            <button className="cg-btn primary" onClick={order.restoreRetry}>
              {t("Try again", "다시 시도")}
            </button>
          )}
        </div>
      </main>
    );
  if (order.paypalReturn)
    return (
      <main className="cg-loading-page">
        <Wordmark />
        <div className="cg-panel">
          <PackageCheck size={38} />
          <h1>
            {order.paypalReturn === "cancel"
              ? t("Checkout cancelled", "결제창에서 취소했어요")
              : t("Back to your shared order", "공동발주로 돌아가기")}
          </h1>
          <p>
            {t(
              "Your order is waiting in the original tab. Use “Check payment” there to verify the result.",
              "원래 탭에서 ‘결제 확인’을 눌러 결과를 확인해 주세요.",
            )}
          </p>
          <button
            className="cg-btn primary"
            onClick={() => {
              if (window.opener) {
                window.opener.focus();
                window.close();
              } else {
                const id = new URLSearchParams(window.location.search).get(
                  "quoteId",
                );
                if (id) sessionStorage.setItem("commonground-active-quote", id);
                window.location.href = "/";
              }
            }}
          >
            {t("Return to the workspace", "주문 화면으로 돌아가기")}
            <ArrowUpRight size={16} />
          </button>
          <small>
            {t(
              "Returning here does not confirm a payment.",
              "이 화면으로 돌아온 것만으로 결제가 완료되지는 않아요.",
            )}
          </small>
        </div>
      </main>
    );

  const navItems: {
    id: View;
    icon: typeof LayoutGrid;
    en: string;
    ko: string;
  }[] = [
    { id: "briefs", icon: LayoutGrid, en: "Brand briefs", ko: "브랜드 요청" },
    { id: "plans", icon: Layers3, en: "Find a fit", ko: "함께할 조건" },
    { id: "agreement", icon: Fingerprint, en: "Agreements", ko: "변경과 합의" },
    { id: "checkout", icon: CreditCard, en: "Your share", ko: "각자의 결제" },
    { id: "brief", icon: FileText, en: "Production brief", ko: "제작 요청서" },
  ];
  const currentNav = navItems.find((item) => item.id === view)!;
  const stepNumber = navItems.findIndex((item) => item.id === view) + 1;
  const stageTitles: Record<View, [string, string]> = {
    briefs: ["Start with what matters to each brand.", "각 브랜드의 중요한 조건부터."],
    plans: ["Find the plan worth agreeing to.", "함께 동의할 수 있는 구성을 찾아요."],
    agreement: ["A shared plan. Each brand’s own decision.", "함께할 구성, 각자의 결정."],
    checkout: ["One batch. Pay only your share.", "한 번의 제작, 결제는 각자의 몫만."],
    brief: ["Every decision, in one clear brief.", "지금까지의 결정을 하나의 요청서로."],
  };
  const nextAction = order.busy
    ? analysing
      ? t("Supplier-rule calculations are ready. AI is considering the next question.", "공급 조건 계산은 준비됐어요. AI가 다음에 확인할 질문을 검토하고 있어요.")
      : t("Updating the saved conditions and their plan. Please wait a moment.", "저장 조건과 구성을 함께 갱신하고 있어요. 잠시만 기다려 주세요.")
    : view === "plans"
    ? selected?.feasibleIfApproved
      ? t("Next: review the exact changes with the affected brands.", "다음: 변경되는 브랜드가 구체적인 변경 내용을 확인해요.")
      : !planning.search.complete && !planning.recommendedPlanId
        ? t("The search is incomplete. Narrow the quantity ranges and compare again before drawing a conclusion.", "조합 탐색이 아직 끝나지 않았어요. 가능 여부를 판단하기 전에 수량 범위를 좁혀 다시 비교해 주세요.")
        : negotiationOptions.length
        ? t("Choose a question to review with the affected brands. Their saved conditions stay in place until they agree.", "변경되는 브랜드에게 확인할 질문을 선택해 주세요. 동의 전에는 저장된 조건을 유지해요.")
        : t("This plan needs a revised brief before anyone can approve it.", "현재 조건으로는 적용할 수 없어요. 막힌 조건을 확인하고 요청을 수정해 주세요.")
    : view === "agreement"
      ? !current.feasible ? t("Choose a workable plan first.", "먼저 가능한 구성을 선택해 주세요.") : waitingApprovals.length ? t(`Final approval needed: ${waitingApprovals.join(", ")}.`, `최종 동의 대기: ${waitingApprovals.join(" · ")}.`) : t("All final quotes approved. Continue to individual checkout.", "모든 최종 견적에 동의했어요. 각자의 결제로 이어가세요.")
      : view === "checkout"
        ? !order.allAgreed ? t(`Approve the final quotes first: ${waitingApprovals.join(", ")}.`, `먼저 최종 견적에 동의해 주세요: ${waitingApprovals.join(" · ")}.`) : !order.quoteCurrent ? t("This quote expired. Preserve its records and close it before planning again.", "만료된 견적이에요. 기록을 보존하고 견적을 닫은 뒤 다시 계획해 주세요.") : order.paymentMode === "sandbox" && !config.paypalReady ? t("Connect PayPal Sandbox, or use the clearly labeled sample checkout.", "PayPal Sandbox를 연결하거나 예시 결제 모드로 체험해 주세요.") : order.allPaid ? t("Every share is complete. Review the production brief.", "각자의 결제 단계가 끝났어요. 제작 요청서를 확인해 주세요.") : t(`Shares still to complete: ${paymentSummary.pendingNames.join(", ") || "none"}.`, `결제 단계 대기: ${paymentSummary.pendingNames.join(" · ") || "없음"}.`)
        : t("Review the configuration, approvals and payment records together.", "구성·동의·결제 기록을 함께 확인해 주세요.");

  return (
    <div className="cg-app">
      <a href="#cg-workspace" className="cg-skip-link">{t("Skip to the current step", "현재 단계로 건너뛰기")}</a>
      <aside className="cg-sidebar">
        <Wordmark />
        <div className="cg-sidebar-project">
          <span className="cg-project-icon">
            <Box size={18} />
          </span>
          <div className="cg-nav-label">
            <strong>{t(currentNav.en, currentNav.ko)}</strong>
            <small>{t("Packaging · CG-001", "포장 제작 · CG-001")}</small>
          </div>
        </div>
        <span className="cg-sidebar-label cg-nav-label">
          {t("WORKSPACE", "워크스페이스")}
        </span>
        <nav
          className="cg-nav"
          aria-label={t("Workspace navigation", "워크스페이스 메뉴")}
        >
          {navItems.map((item) => (
            <button
              key={item.id}
              className={`cg-nav-item ${view === item.id ? "active" : ""}`}
              onClick={() => navigate(item.id)}
              disabled={
                (locked && !["checkout", "brief"].includes(item.id)) ||
                (item.id === "checkout" && !current.feasible)
              }
              aria-current={view === item.id ? "page" : undefined}
            >
              <item.icon size={18} />
              <span className="cg-nav-label">{t(item.en, item.ko)}</span>
              {item.id === "agreement" && current.feasible && (
                <span className="cg-nav-count cg-nav-label">
                  {approvedCount}/{order.activeBuyers.length}
                </span>
              )}
            </button>
          ))}
        </nav>
        <div className="cg-sidebar-tip cg-nav-label">
          <Leaf size={20} />
          <h3>{t("Small is a starting point.", "작게 시작해도 괜찮아요.")}</h3>
          <p>
            {t(
              "Keep what makes your brand yours. Find what you can make together.",
              "내 브랜드의 개성은 지키고, 함께 만들 수 있는 부분을 찾아요.",
            )}
          </p>
          <button onClick={() => setModal("about")}>
            {t("The idea behind CommonGround", "CommonGround가 하는 일")}
            <ArrowUpRight size={13} />
          </button>
        </div>
        <div className="cg-sidebar-footer">
          <span className="cg-profile">S</span>
          <div className="cg-nav-label">
            <strong>{t("Your workspace", "나의 워크스페이스")}</strong>
            <small>{signedOut ? t("Sample session", "예시 세션") : t("Personal session", "개인 세션")}</small>
          </div>
          <LockKeyhole size={14} />
        </div>
      </aside>

      <main className="cg-main">
        <header className="cg-topbar">
          <div className="cg-breadcrumb">
            <span className="cg-mobile-mark">cg.</span>
            <span>{t("Workspace", "워크스페이스")}</span>
            <ChevronRight size={14} />
            <strong>{t("Brand launch batch", "브랜드 공동 제작")}</strong>
          </div>
          <div className="cg-top-actions">
            <button
              className="cg-btn ghost small"
              onClick={() => order.setLang(lang === "en" ? "ko" : "en")}
            >
              <Globe2 size={15} />
              {lang === "en" ? "한국어" : "English"}
            </button>
            <button
              className="cg-btn icon ghost"
              aria-label={t("Connection status", "연결 상태")}
              onClick={() => setModal("connections")}
            >
              <Settings2 size={18} />
              <span
                className={`cg-connection-dot ${config.aiReady && config.paypalReady ? "ready" : ""}`}
              />
            </button>
            <button
              className="cg-btn secondary small"
              onClick={() => navigate("brief")}
            >
              <FileText size={15} />
              <span>{t("View brief", "요청서 보기")}</span>
            </button>
          </div>
        </header>

        {signedOut && (
          <div className="cg-sign-in-note">
            <span>{t("Explore the sample here, or sign in for AI guidance and PayPal Sandbox checkout.", "예시를 둘러보거나 로그인하여 AI 안내와 PayPal Sandbox 결제를 이용하세요.")}</span>
            <SignInLink lang={lang} />
          </div>
        )}

        {view === "briefs" ? <><section className="cg-hero">
          <div className="cg-hero-copy">
            <span className="cg-eyebrow">
              <span className="cg-line" />
              {t(
                "INDEPENDENT BRANDS. SHARED POSSIBILITIES.",
                "각자의 개성, 함께 만드는 가능성",
              )}
            </span>
            <h1>
              {t("Your next run.", "다음 제작을,")}
              <br />
              <em>{t("Made together.", "함께 가능하게.")}</em>
            </h1>
            <p>
              {t(
                "Bring small packaging orders into one shared production plan. Keep your brand. Agree on the changes. Pay only your share.",
                "작은 포장 주문들을 함께 가능한 하나의 제작안으로. 브랜드는 각자, 변경은 동의한 만큼, 결제는 내 몫만.",
              )}
            </p>
            {view === "briefs" && (
              <div className="cg-opening-problem">
                <h2>
                  {current.feasible
                    ? t(
                        "The configuration fits. Your approval comes next.",
                        "가능한 구성을 찾았어요. 이제 각자 확인해요.",
                      )
                    : current.groups.some((group) => !group.met)
                      ? t(
                          `${current.totalQuantity} boxes in total. Production minimums still unmet.`,
                          `합치면 ${current.totalQuantity}개. 상자 종류별 최소 수량은 아직 부족해요.`,
                        )
                      : t(
                          "A production match still has to fit every brief.",
                          "제작 조건과 각자의 요구를 모두 맞춰야 해요.",
                        )}
                </h2>
                <div className="cg-batch-groups">
                  {current.groups.map((group) => (
                    <div key={group.baseVariant}>
                      <span>
                        {group.baseVariant === "black"
                          ? t("Black base", "블랙 상자")
                          : t("Kraft base", "크라프트 상자")}
                      </span>
                      <strong>
                        {group.quantity} / {group.moq}
                      </strong>
                      <div className="cg-meter">
                        <i
                          style={{
                            width: `${Math.min(100, (group.quantity / group.moq) * 100)}%`,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <div className="cg-opening-actions">
                  <button
                    className="cg-btn primary"
                    onClick={analyse}
                    disabled={locked || !order.activeBuyers.length}
                  >
                    {t("Compare shared plans", "함께 가능한 구성 비교하기")}
                    <ArrowRight size={17} />
                  </button>
                  <button
                    className="cg-btn secondary"
                    disabled={locked || !order.activeBuyers.length}
                    onClick={() => { setEditorIntent(true); setEditor(order.activeBuyers[0]?.id ?? "luma"); }}
                  >
                    <Sparkles size={16} />
                    {t("Start with your words", "말로 요청 시작하기")}
                  </button>
                  <small>
                    {t(
                      "Same box format · individual branding",
                      "동일 기본 규격의 상자 · 브랜딩은 각자",
                    )}
                  </small>
                </div>
              </div>
            )}
            <div className="cg-hero-caption">
              <div className="cg-avatar-stack">
                <Avatar id="luma" small />
                <Avatar id="juniper" small />
                <Avatar id="forma" small />
              </div>
              <span>
                {t(
                  `${order.activeBuyers.length} brands. One shared opportunity.`,
                  `${order.activeBuyers.length}개 브랜드가 함께 찾는 제작 기회.`,
                )}
              </span>
            </div>
          </div>
          <div className="cg-hero-photo">
            <img
              src="/images/common-batch-v2.png"
              alt={t(
                "Concept packaging for LUMA, JUNIPER and FORMA, sharing a kraft base with separate brand finishes",
                "공통 크라프트 상자에 각자의 브랜딩을 적용한 LUMA·JUNIPER·FORMA 포장 시안",
              )}
            />
            <span className="cg-photo-note">
              {t("Packaging concept · illustrative", "포장 콘셉트 시안")}
            </span>
            <div className="cg-photo-card">
              <span>
                <Layers3 size={16} />
                {t("One common base", "하나의 공통 상자")}
              </span>
              <strong>
                {t("Still unmistakably yours.", "브랜드는 여전히, 나답게.")}
              </strong>
            </div>
          </div>
        </section>

        <div className="cg-stats">
          <div>
            <span>{t("INDEPENDENT BRANDS", "참여 브랜드")}</span>
            <strong>
              {order.activeBuyers.length}
              <small>{t("on this batch", "개 브랜드")}</small>
            </strong>
          </div>
          <div>
            <span>{t("REQUESTED QUANTITY", "현재 요청 수량")}</span>
            <strong>
              {current.totalQuantity}
              <small>{t("boxes", "개")}</small>
            </strong>
          </div>
          <div>
            <span>
              {!showingPlanEstimate
                ? t("AGREED CONFIGURATION", "동의한 구성의 금액")
                : t("SHARED OPTION ESTIMATE", "함께 만드는 구성의 예상금액")}
            </span>
            <strong>
              {money(comparison.totalCents)}
              <small>USD</small>
            </strong>
          </div>
          <div>
            <span>
              {t("SUPPLIER PRODUCTION TIME", "예시 공급자의 제작 기간")}
            </span>
            <strong>
              {scenario.supplier.leadDays}
              <small>
                {t("days · delivery separate", "일 · 배송 기간 별도")}
              </small>
            </strong>
          </div>
        </div></> : <section className="cg-journey" aria-label={t("Current step", "현재 단계")}>
          <div className="cg-journey-copy">
            <span className="cg-eyebrow">CG-001 · {t("BRAND LAUNCH BATCH", "브랜드 공동 제작")}</span>
            <h1 className="cg-journey-title">{t(...stageTitles[view])}</h1>
            <p className="cg-journey-subtitle">{current.totalQuantity} {t("boxes", "개")} · {order.activeBuyers.length} {t("brands", "개 브랜드")} · {t("Revision", "구성 버전")} {scenario.revision}</p>
          </div>
          <div className="cg-journey-progress" aria-label={t(`Step ${stepNumber} of 5`, `5단계 중 ${stepNumber}단계`)}><strong>{String(stepNumber).padStart(2,"0")}</strong><span>/ 05</span></div>
        </section>}

        <div className="cg-content" id="cg-workspace" tabIndex={-1} ref={content}>
          <div className="cg-content-bar">
            <div
              className="cg-tabs"
              aria-label={t("Batch stage", "발주 진행 단계")}
            >
              {[
                { view: "briefs" as View, en: "01 Briefs", ko: "01 요청" },
                { view: "plans" as View, en: "02 Find a fit", ko: "02 조율" },
                { view: "agreement" as View, en: "03 Agree", ko: "03 합의" },
                { view: "checkout" as View, en: "04 Checkout", ko: "04 결제" },
                { view: "brief" as View, en: "05 Brief", ko: "05 요청서" },
              ].map((item, i) => (
                <button
                  key={item.view}
                  className={
                    view === item.view ? "active" : i < stage ? "done" : ""
                  }
                  aria-current={view === item.view ? "step" : undefined}
                  disabled={
                    (locked && item.view !== "checkout" && item.view !== "brief") ||
                    (item.view === "checkout" && !current.feasible)
                  }
                  onClick={() => navigate(item.view)}
                >
                  {i < stage && <Check size={13} />} {t(item.en, item.ko)}
                </button>
              ))}
            </div>
            <span className="cg-demo-label">
              <span />
              {order.serverProposal?.mode === "live_ai"
                ? t(
                    "AI guidance received · sample supplier",
                    "AI 안내 수신 · 예시 공급자",
                  )
                : t("Rules demo · sample supplier", "규칙 데모 · 예시 공급자")}
            </span>
          </div>
          {view !== "briefs" && <div className={`cg-next-action ${order.busy ? "busy" : ""}`} role="status" aria-live="polite" aria-busy={order.busy}>{order.busy ? <LoaderCircle className="cg-spin" size={16}/> : <ArrowRight size={16}/>}<span>{nextAction}</span></div>}
          {order.error && (
            <div className="cg-alert error" role="alert">
              <CircleHelp size={18} />
              <p>{order.error}</p>
              <button
                className="cg-btn icon ghost"
                aria-label="Dismiss"
                onClick={() => order.setError("")}
              >
                <X size={15} />
              </button>
            </div>
          )}
          <div
            className={`cg-workspace ${view === "brief" ? "brief-view" : ""}`}
          >
            <div className="cg-workpane">
              {view === "briefs" && (
                <>
                  <section className="cg-panel">
                    <PanelHead
                      kicker={t(
                        "IT STARTS WITH EACH BRAND",
                        "각 브랜드의 이야기에서 시작해요",
                      )}
                      title={t(
                        "Three briefs. Three points of view.",
                        "같이 만들지만, 원하는 것은 달라요.",
                      )}
                    >
                      <button className="cg-btn secondary small" disabled={locked || !order.activeBuyers.length} onClick={() => { setEditorIntent(true); setEditor(order.activeBuyers[0]?.id ?? "luma"); }}>
                        <Sparkles size={15}/>{t("Start with your words", "말로 요청 시작하기")}
                      </button>
                    </PanelHead>
                    <div className="cg-brand-list">
                      {scenario.buyers.map((buyer) => (
                        <article
                          className={`cg-brand-row ${!buyer.active ? "inactive" : ""}`}
                          key={buyer.id}
                        >
                          <div className={`cg-brand-art ${buyer.id}`}>
                            <BrandBox
                              brand={buyer.id}
                              shared={accepted}
                              compact
                            />
                          </div>
                          <div className="cg-brand-body">
                            <div className="cg-brand-title">
                              <div>
                                <span className="cg-eyebrow">
                                  {
                                    brandCopy[buyer.id].category[
                                      lang === "en" ? 0 : 1
                                    ]
                                  }
                                </span>
                                <h3>
                                  {buyer.name}
                                  <span>
                                    {buyer.id === "luma"
                                      ? "STUDIO"
                                      : buyer.id === "juniper"
                                        ? "& CO."
                                        : "GOODS"}
                                  </span>
                                </h3>
                              </div>
                              <button
                                className="cg-btn icon ghost"
                                onClick={() => { setEditorIntent(false); setEditor(buyer.id); }}
                                disabled={locked}
                                aria-label={t("Edit ", "수정: ") + buyer.name}
                              >
                                <Pencil size={15} />
                              </button>
                            </div>
                            <blockquote className="cg-brand-quote">
                              “
                              {brandCopy[buyer.id].quote[lang === "en" ? 0 : 1]}
                              ”
                            </blockquote>
                            <div className="cg-brand-conditions">
                              <span>
                                <Fingerprint size={13} />
                                {
                                  brandCopy[buyer.id].priority[
                                    lang === "en" ? 0 : 1
                                  ]
                                }
                              </span>
                              <span>
                                <SlidersHorizontal size={13} />
                                {buyer.id === "forma"
                                  ? buyer.quantityRange &&
                                    buyer.quantityRange.min !==
                                      buyer.quantityRange.max
                                    ? t(
                                        "Quantity flexible within your stated range",
                                        "명시한 범위 안에서 수량 조정 검토",
                                      )
                                    : t(
                                        "Requested quantity stays fixed",
                                        "요청한 수량 고정",
                                      )
                                  : buyer.id === "luma" && declined
                                    ? t(
                                        "Original black base retained",
                                        "원래 블랙 상자 유지",
                                      )
                                    : brandCopy[buyer.id].flexibility[
                                        lang === "en" ? 0 : 1
                                      ]}
                              </span>
                            </div>
                            <div className="cg-brand-numbers">
                              <div>
                                <span>{t("QUANTITY", "수량")}</span>
                                <strong>
                                  {buyer.quantity}
                                  <small> {t("boxes", "개")}</small>
                                </strong>
                              </div>
                              <div>
                                <span>{t("BUDGET", "예산")}</span>
                                <strong>{money(buyer.budgetCents)}</strong>
                              </div>
                              <div>
                                <span>{t("PRODUCTION BY", "제작 기간")}</span>
                                <strong>
                                  {buyer.maxLeadDays}
                                  <small> {t("days", "일 이내")}</small>
                                </strong>
                              </div>
                            </div>
                            <span
                              className={`cg-quantity-policy ${buyer.quantityRange && buyer.quantityRange.min !== buyer.quantityRange.max ? "flexible" : "fixed"}`}
                            >
                              {buyer.quantityRange &&
                              buyer.quantityRange.min !==
                                buyer.quantityRange.max ? (
                                <>
                                  <SlidersHorizontal size={12} />
                                  {t(
                                    `May review ${buyer.quantityRange.min}–${buyer.quantityRange.max} boxes · approval still required`,
                                    `${buyer.quantityRange.min}–${buyer.quantityRange.max}개 검토 가능 · 변경 시 별도 동의`,
                                  )}
                                </>
                              ) : (
                                <>
                                  <LockKeyhole size={12} />
                                  {t(
                                    `Exactly ${buyer.quantity} boxes · no quantity trade-off`,
                                    `정확히 ${buyer.quantity}개 · 수량 조정 불가`,
                                  )}
                                </>
                              )}
                            </span>
                            {!buyer.active && (
                              <span className="cg-pill warning">
                                {t("Not participating", "이번 발주에서 제외")}
                              </span>
                            )}
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>
                  <section className="cg-opportunity">
                    <div className="cg-opportunity-icon">
                      <Layers3 size={26} />
                    </div>
                    <div>
                      <span className="cg-eyebrow">
                        {t("A SHARED OPPORTUNITY", "함께 풀어볼 문제")}
                      </span>
                      <h2>
                        {t(
                          "Can we share the base, without sharing the brand?",
                          "상자는 함께, 브랜드는 각자의 것으로?",
                        )}
                      </h2>
                      <p>
                        {t(
                          "LUMA’s black base and the others’ kraft base are separate production groups. A common base might connect the orders. The branding can stay individual.",
                          "LUMA의 블랙 상자와 다른 두 브랜드의 크라프트 상자는 생산 그룹이 달라요. 공통 상자를 쓰고 브랜딩은 따로 적용하면 함께 제작할 수 있을지 검토해 봐요.",
                        )}
                      </p>
                      <button
                        className="cg-btn primary"
                        onClick={analyse}
                        disabled={locked || !order.activeBuyers.length}
                      >
                        {t("Explore shared plans", "함께 가능한 구성 찾기")}
                        <ArrowRight size={17} />
                      </button>
                    </div>
                  </section>
                  <ScenarioPresets
                    lang={lang}
                    disabled={locked}
                    onPick={preset}
                  />
                  <div className="cg-scenario-tools">
                    <span>
                      <SlidersHorizontal size={15} />
                      {t("Explore a different brief", "조건을 바꿔서 살펴보기")}
                    </span>
                    <button
                      onClick={() => preset("deadline")}
                      disabled={locked}
                    >
                      {t(
                        "JUNIPER needs 6 days",
                        "JUNIPER가 6일 내 제작을 원한다면?",
                      )}
                      <ArrowUpRight size={13} />
                    </button>
                  </div>
                </>
              )}

              {view === "plans" && (
                <>
                  <NegotiationPanel
                    options={negotiationOptions}
                    baselineEvaluation={planning.plans.find(plan => plan.kind === "shared-base")?.evaluation ?? current}
                    lang={lang}
                    disabled={locked}
                    aiSelection={order.aiSelection}
                    onApply={applyNegotiation}
                  />
                  {planning.search && !planning.search.complete && (
                    <div className="cg-alert" role="status"><CircleHelp size={18}/><p>{t("These quantity ranges are broad, so only part of the search was checked. A missing recommendation does not mean no plan exists. Narrow the ranges and compare again.", "허용 범위가 넓어 일부 조합만 확인했어요. 결과가 없더라도 불가능하다는 뜻은 아니에요. 수량 범위를 좁혀 다시 검토해 주세요.")}</p></div>
                  )}
                  {order.aiSelection && !negotiationOptions.length && (
                    <section className="cg-recommendation">
                      <Sparkles size={20} />
                      <div>
                        <h3>{t("The next question to consider", "이번에 확인할 질문")}</h3>
                        {order.aiSelection.question && <p>{order.aiSelection.question}</p>}
                        <p>{order.aiSelection.explanation}</p>
                        <small>{t("AI guidance using this request and the supplier rules", "현재 요청과 공급 조건에 근거한 AI 안내")}</small>
                      </div>
                    </section>
                  )}
                  <section className="cg-panel cg-plan-section">
                    <PanelHead
                      kicker={t(
                        "FIND THE OVERLAP",
                        "함께할 수 있는 조건을 찾아요",
                      )}
                      title={t(
                        "Different ways to make this work.",
                        "어떻게 함께 만들 수 있을까요?",
                      )}
                    >
                      <button
                        className="cg-btn ghost small"
                        onClick={() => navigate("briefs")}
                        disabled={locked}
                      >
                        <Pencil size={14} />
                        {t("Edit briefs", "요청 수정")}
                      </button>
                    </PanelHead>
                    <div className="cg-constraint-strip">
                      <span>
                        <ShieldCheck size={15} />
                        {t(
                          "Same base counts together",
                          "같은 상자만 수량 합산",
                        )}
                      </span>
                      <span>
                        <Fingerprint size={15} />
                        {t("Branding stays individual", "브랜딩은 개별 적용")}
                      </span>
                      <span>
                        <CheckCircle2 size={15} />
                        {t(
                          "Every change needs approval",
                          "변경은 각각 동의 후",
                        )}
                      </span>
                    </div>
                    <div className="cg-plan-grid">
                      {displayedPlans.map((plan) => (
                        <button
                          key={plan.id}
                          className={`cg-plan-card ${selected?.id === plan.id ? "selected" : ""}`}
                          onClick={() => setSelectedId(plan.id)}
                          disabled={locked}
                          aria-pressed={selected?.id === plan.id}
                        >
                          <div className="cg-plan-label">
                            <span>
                              {plan.kind === "shared-base" ? (
                                <Layers3 size={20} />
                              ) : plan.kind === "quantity-rebalance" ? (
                                <Users size={20} />
                              ) : (
                                <Box size={20} />
                              )}
                            </span>
                            {plan.id === planning.recommendedPlanId && (
                              <span className="cg-recommended-label">
                                {planning.search.complete ? t("BEST FIT", "추천 구성") : t("WORKABLE OPTION", "찾은 가능한 구성")}
                              </span>
                            )}
                          </div>
                          <h3>{planTitle(plan, lang)}</h3>
                          <p>
                            {plan.kind === "shared-base"
                              ? plan.evaluation.buyerQuotes.some(
                                  (q) => q.buyerId === "luma",
                                )
                                ? t(
                                    "Keep the quantities. Share kraft, with LUMA’s own black sleeve.",
                                    "수량은 그대로. 크라프트 상자에 LUMA의 블랙 슬리브를 적용해요.",
                                  )
                                : t(
                                    "Keep the quantities and individual labels on a compatible kraft base.",
                                    "수량과 개별 라벨을 유지하며 같은 크라프트 상자를 사용해요.",
                                  )
                              : plan.kind === "quantity-rebalance"
                                ? t(
                                    "Adjust a few units between brands to meet the individual budgets.",
                                    "브랜드 사이에서 수량을 조금 조정해 각자의 예산을 맞춰요.",
                                  )
                                : plan.totalExtraUnits > 0
                                  ? t(
                                      "Buy enough of each original base to meet both production minimums.",
                                      "기본 상자는 유지하고, 종류별 최소 주문량에 맞춰 수량을 늘려요.",
                                    )
                                  : t(
                                      "The original specifications already meet the minimums. Keep each requested quantity.",
                                      "원래 사양으로 최소 주문량을 충족해요. 각자의 요청 수량을 유지해요.",
                                    )}
                          </p>
                          <div className="cg-plan-price">
                            {money(plan.evaluation.totalCents)}
                            <small>
                              {plan.evaluation.totalQuantity} {t("boxes", "개")}
                            </small>
                          </div>
                          <div className="cg-plan-quantities">
                            {plan.evaluation.buyerQuotes.map((q) => (
                              <span key={q.buyerId}>
                                <Avatar id={q.buyerId} small />
                                {q.quantity}
                              </span>
                            ))}
                          </div>
                          <div className="cg-plan-footer">
                            <PlanState plan={plan} lang={lang} />
                            <span className="cg-radio-dot" />
                          </div>
                        </button>
                      ))}
                    </div>
                    {!planning.plans.length && (
                      <div className="cg-empty">
                        {t(
                          "Add a participating brand to explore plans.",
                          "참여할 브랜드를 선택하면 구성을 검토할 수 있어요.",
                        )}
                      </div>
                    )}
                  </section>
                  {selected && (
                    <section className="cg-panel cg-selected-plan">
                      <PanelHead
                        kicker={t(
                          "LOOK AT THE DETAILS",
                          "변경 내용을 자세히 살펴봐요",
                        )}
                        title={planTitle(selected, lang)}
                      >
                        <PlanState plan={selected} lang={lang} />
                      </PanelHead>
                      <PlanEvidence overview={planning} plan={selected} lang={lang} />
                      {selected.kind !== "original-minimums" &&
                        selected.evaluation.buyerQuotes.some(
                          (q) => q.buyerId === "luma",
                        ) && (
                          <div className="cg-visual-comparison">
                            <div className="cg-visual-copy">
                              <span className="cg-eyebrow">LUMA</span>
                              <h3>
                                {t(
                                  "Same black identity. A different construction.",
                                  "블랙 아이덴티티는 그대로, 구성은 다르게.",
                                )}
                              </h3>
                              <p>
                                {t(
                                  "The carton changes from black to kraft. A black branded sleeve replaces the separate label. The unwrapped box will look different.",
                                  "블랙 상자가 크라프트 상자로 바뀌고, 별도 라벨 대신 블랙 브랜드 슬리브를 씌워요. 슬리브를 벗기면 상자의 모습은 달라져요.",
                                )}
                              </p>
                              <div className="cg-segmented">
                                <button
                                  className={
                                    visual === "original" ? "active" : ""
                                  }
                                  onClick={() => setVisual("original")}
                                >
                                  {t("Original request", "원래 요청")}
                                </button>
                                <button
                                  className={
                                    visual === "shared" ? "active" : ""
                                  }
                                  onClick={() => setVisual("shared")}
                                >
                                  {t("Shared option", "공동 제작안")}
                                </button>
                              </div>
                            </div>
                            <div className={`cg-product-stage ${visual}`}>
                              <BrandBox
                                brand="luma"
                                shared={visual === "shared"}
                              />
                              <span>
                                {visual === "shared"
                                  ? t(
                                      "Kraft base + signature black sleeve",
                                      "크라프트 상자 + 시그니처 블랙 슬리브",
                                    )
                                  : t(
                                      "Black base + own label",
                                      "블랙 상자 + 자체 라벨",
                                    )}
                              </span>
                            </div>
                          </div>
                        )}
                      <div className="cg-change-list">
                        <div className="cg-change-row">
                          <span>{t("WHAT STAYS", "그대로 지키는 것")}</span>
                          <div>
                            <span>
                              <Check size={14} />
                              {t("Your logo and brand", "각자의 로고와 브랜드")}
                            </span>
                            <span>
                              <Check size={14} />
                              {t("Separate delivery", "개별 배송")}
                            </span>
                            <span>
                              <Check size={14} />
                              {t("Individual approval", "각자의 최종 동의")}
                            </span>
                          </div>
                        </div>
                        <div className="cg-change-row">
                          <span>{t("WHAT CHANGES", "검토할 변경 사항")}</span>
                          <div>
                            {(selected.physicalConsentRequired.length > 0 ||
                              selectedConfigurationChanges.length > 0) && (
                              <span className="cg-delta">
                                {selected.kind === "original-minimums"
                                  ? t(
                                      "LUMA: return to the original black box + own label",
                                      "LUMA: 원래 블랙 상자와 자체 라벨로 복귀",
                                    )
                                  : t(
                                      "LUMA: kraft base + black sleeve",
                                      "LUMA: 크라프트 상자 + 블랙 슬리브",
                                    )}
                              </span>
                            )}
                            {selected.quantityDeltas.map((d) => (
                              <span className="cg-delta" key={d.buyerId}>
                                {d.buyerId.toUpperCase()}: {d.from} → {d.to}{" "}
                                {t("units", "개")}
                              </span>
                            ))}
                            {!selected.quantityDeltas.length &&
                              !selected.physicalConsentRequired.length &&
                              !selectedConfigurationChanges.length && (
                                <span>
                                  {t(
                                    "No configuration change needed",
                                    "구성 변경이 필요하지 않아요",
                                  )}
                                </span>
                              )}
                          </div>
                        </div>
                      </div>
                      <QuoteTable
                        evaluation={selected.evaluation}
                        lang={lang}
                      />
                      {selected.quantityDeltas.length > 0 && (
                        <p className="cg-price-note">
                          {selected.feasibleIfApproved
                            ? t(
                                "Every proposed quantity is inside that buyer’s stated range. A permitted range is not consent: each affected brand must still approve this exact change.",
                                "제안 수량은 각자가 명시한 범위 안에 있어요. 허용 범위는 동의를 대신하지 않으므로, 변경되는 브랜드가 이 수량을 다시 확인해야 해요.",
                              )
                            : t(
                                "This comparison is not ready to accept. Resolve the stated quantity, budget or production constraints first.",
                                "아직 선택할 수 없는 비교안이에요. 표시된 수량·예산·제작 조건을 먼저 해결해야 해요.",
                              )}
                        </p>
                      )}
                      <div className="cg-price-note">
                        {t(
                          "Illustrative USD prices. Setup is allocated by quantity. Delivery is included; taxes are not modeled.",
                          "예시 USD 가격이에요. 준비비는 수량에 비례해 배분하고, 배송비를 포함해요. 세금은 별도로 검토해야 해요.",
                        )}
                      </div>
                      {!selected.feasibleIfApproved && (
                        <div className="cg-plan-blockers">
                          {selected.evaluation.issues
                            .filter(
                              (i) => i.code !== "SUBSTITUTION_CONSENT_REQUIRED",
                            )
                            .map((issue, i) => (
                              <p key={i}>
                                <CircleHelp size={16} />
                                {issueText(issue, lang)}
                              </p>
                            ))}
                          {declined &&
                            selected.kind !== "original-minimums" && (
                              <p>
                                <Fingerprint size={16} />
                                {t(
                                  "LUMA has kept the original black base. Reopen that choice only if LUMA wants to reconsider.",
                                  "LUMA가 원래 블랙 상자를 선택했어요. 다시 검토하려면 LUMA의 의사를 먼저 확인해 주세요.",
                                )}
                              </p>
                            )}
                          {selected.budgetDeltas
                            .filter((d) => d.shortfallCents > 0)
                            .map((d) => (
                              <button
                                key={d.buyerId}
                                className="cg-btn secondary small"
                                onClick={() => setEditor(d.buyerId)}
                                disabled={locked}
                              >
                                {d.buyerId.toUpperCase()}:{" "}
                                {money(d.shortfallCents)}{" "}
                                {t(
                                  "over budget · review",
                                  "예산 초과 · 요청 검토",
                                )}
                                <ArrowUpRight size={13} />
                              </button>
                            ))}
                        </div>
                      )}
                      {selected.kind === "original-minimums" &&
                        selected.totalExtraUnits > 0 && (
                          <p className="cg-price-note">
                            {t(
                              "This option buys more units. Comparing its total with a smaller shared batch is not a per-unit discount or a measured saving.",
                              "이 안은 구매 수량이 늘어나는 비교예요. 더 작은 공동 제작안과의 총금액 차이를 단가 할인이나 실측 절감률로 볼 수는 없어요.",
                            )}
                          </p>
                        )}
                      <div className="cg-panel-actions">
                        <button
                          className="cg-btn ghost"
                          onClick={() => setModal("supplier")}
                        >
                          <ClipboardList size={16} />
                          {t("Check the supplier rules", "공급 조건 확인")}
                        </button>
                        {declined && selected.kind !== "original-minimums" ? (
                          <button
                            className="cg-btn secondary"
                            onClick={() => order.decide("pending")}
                            disabled={locked}
                          >
                            {t(
                              "Reconsider the sleeve",
                              "슬리브 구성 다시 검토",
                            )}
                          </button>
                        ) : (
                          <button
                            className="cg-btn primary"
                            disabled={!selected.feasibleIfApproved || locked}
                            onClick={() => setReviewPlan(selected)}
                          >
                            {t(
                              "Review the changes together",
                              "변경 사항 확인하고 동의하기",
                            )}
                            <ArrowRight size={17} />
                          </button>
                        )}
                      </div>
                    </section>
                  )}
                  {(order.serverProposal?.guidanceStatus === "error" || order.serverProposal?.guidanceStatus === "limited") && (
                    <div className="cg-alert" role="status">
                      <CircleHelp size={18} />
                      <p>
                        {order.serverProposal.guidanceStatus === "limited" ? t(
                          "Daily AI limit reached. Compare these rule-based plans and review permissions now, or try AI again after 00:00 UTC.",
                          "AI 일일 한도에 도달했어요. 지금은 계산된 구성을 비교하고 변경 조건을 검토할 수 있어요. AI는 한국 시간 오전 9시 이후 다시 이용할 수 있어요.",
                        ) : t(
                          "AI guidance is unavailable for this request. These plans still use the stated supplier rules; your approvals and checkout remain separate.",
                          "이번 요청의 AI 안내를 받지 못했어요. 명시된 공급 조건으로 계산한 대안은 계속 검토할 수 있고, 동의와 결제는 별도로 진행돼요.",
                        )}
                      </p>
                    </div>
                  )}
                  <details className="cg-demo-scenarios">
                    <summary><SlidersHorizontal size={15} />{t("Load a demo scenario", "시연 사례 불러오기")}<ChevronDown size={15} /></summary>
                    <ScenarioPresets lang={lang} disabled={locked} onPick={preset} />
                  </details>
                  <div className="cg-scenario-tools">
                    <span>
                      {t("Test a real trade-off", "다른 조건도 검토해 보세요")}
                    </span>
                    <button
                      onClick={() => preset("deadline")}
                      disabled={locked}
                    >
                      {t(
                        "Try a 6-day production deadline",
                        "제작 기간이 6일이라면?",
                      )}
                    </button>
                    <button
                      onClick={() => preset("standard")}
                      disabled={locked}
                    >
                      {t("Reset the sample", "처음 조건으로")}
                    </button>
                  </div>
                </>
              )}

              {view === "agreement" && (
                <section className="cg-panel">
                  <PanelHead
                    kicker={t(
                      "NOTHING CHANGES WITHOUT YOU",
                      "동의하기 전에는 바뀌지 않아요",
                    )}
                    title={
                      current.feasible
                        ? t(
                            `A shared plan. ${order.activeBuyers.length} individual approvals.`,
                            "함께할 구성을, 각자 확인해요.",
                          )
                        : t(
                            "Let’s agree on a workable plan first.",
                            "먼저 함께 가능한 구성부터 정해요.",
                          )
                    }
                  />
                  {current.feasible ? (
                    <>
                      <div className="cg-agreement-intro">
                        <CheckCircle2 size={23} />
                        <div>
                          <strong>
                            {accepted
                              ? t(
                                  "LUMA’s packaging change is accepted.",
                                  "LUMA의 포장 변경에 동의했어요.",
                                )
                              : t(
                                  "The current configuration meets the sample rules.",
                                  "현재 구성은 예시 공급 조건을 충족해요.",
                                )}
                          </strong>
                          <p>
                            {t(
                              "Now each brand reviews the exact quantity, finish and final amount. Every participating brand must approve before checkout.",
                              "이제 각 브랜드가 정확한 수량·구성·최종 금액을 확인해요. 참여 브랜드가 모두 동의하면 결제할 수 있어요.",
                            )}
                          </p>
                        </div>
                      </div>
                      <div className="cg-agreement-list">
                        {current.buyerQuotes.map((q) => (
                          <label
                            className={`cg-agreement-card ${order.agreed[q.buyerId] ? "approved" : ""}`}
                            key={q.buyerId}
                          >
                            <Avatar id={q.buyerId} />
                            <div>
                              <h3>{q.buyerName}</h3>
                              <p>
                                {q.quantity} {t("boxes", "개")} ·{" "}
                                {q.substitutionApplied
                                  ? t(
                                      "kraft + black branded sleeve",
                                      "크라프트 + 블랙 브랜드 슬리브",
                                    )
                                  : q.baseVariant === "black"
                                    ? t("black + own label", "블랙 + 자체 라벨")
                                    : t(
                                        "kraft + own label",
                                        "크라프트 + 자체 라벨",
                                      )}
                              </p>
                              <small>
                                {t(
                                  `${q.leadDays}-day production · delivery included in price`,
                                  `제작 ${q.leadDays}일 · 금액에 배송비 포함`,
                                )}
                              </small>
                              <span className="cg-consent-copy">
                                {t(
                                  "I approve this configuration, quantity and my final total.",
                                  "이 구성·수량·최종 금액에 동의해요.",
                                )}
                              </span>
                            </div>
                            <strong>{money(q.totalCents)}</strong>
                            <input
                              type="checkbox"
                              checked={Boolean(order.agreed[q.buyerId])}
                              disabled={locked}
                              onChange={(e) =>
                                order.setAgreed((previous) => ({
                                  ...previous,
                                  [q.buyerId]: e.target.checked,
                                }))
                              }
                              aria-label={
                                t("Approve ", "최종 동의: ") + q.buyerName
                              }
                            />
                          </label>
                        ))}
                      </div>
                      <p className="cg-approval-progress" aria-live="polite"><Fingerprint size={15}/>{approvedCount}/{order.activeBuyers.length} {t("final quotes approved", "최종 견적 동의 완료")}{waitingApprovals.length > 0 && <span> · {t("Waiting for ", "대기: ")}{waitingApprovals.join(" · ")}</span>}</p>
                      <div className="cg-panel-actions">
                        <button
                          className="cg-btn ghost"
                          onClick={() => navigate("plans")}
                          disabled={locked}
                        >
                          {t("Review the plan again", "구성 다시 검토")}
                        </button>
                        <button
                          className="cg-btn primary"
                          disabled={!order.allAgreed}
                          onClick={() => navigate("checkout")}
                        >
                          {t(
                            "Continue to individual checkout",
                            "각자의 결제로 계속하기",
                          )}
                          <ArrowRight size={17} />
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="cg-empty">
                      <Fingerprint size={34} />
                      <p>
                        {t(
                          "Choose a feasible plan and approve its changes. Final quote approvals will appear here.",
                          "가능한 구성을 선택하고 변경 사항에 동의하면, 여기서 각자의 최종 금액을 확인할 수 있어요.",
                        )}
                      </p>
                      <button
                        className="cg-btn primary"
                        onClick={() => navigate("plans")}
                      >
                        {t("Explore the plans", "가능한 구성 보기")}
                        <ArrowRight size={16} />
                      </button>
                    </div>
                  )}
                </section>
              )}

              {view === "checkout" && (
                <CheckoutPanel
                  order={order}
                  onReview={() => navigate("agreement")}
                  onBrief={() => navigate("brief")}
                  onConnections={() => setModal("connections")}
                  onArchive={() => setModal("archive")}
                  onReplan={() => { requestedNavigation.current = true; setView("plans"); }}
                />
              )}
              {view === "brief" && (
                <ProductionBrief
                  order={order}
                  onExport={exportBrief}
                  onReview={() =>
                    navigate(current.feasible ? "agreement" : "plans")
                  }
                />
              )}
            </div>

            <aside className="cg-rail">
              <section className="cg-panel cg-batch-status">
                <span className="cg-eyebrow">
                  {railIsPreview ? t("SAVED CONDITIONS · PLAN PREVIEW", "저장된 조건의 구성 미리보기") : t("CURRENT SAVED REQUEST", "현재 저장된 요청")}
                </span>
                <div className="cg-rail-title">
                  <h2>
                    {railIsPreview
                      ? railFits
                        ? t("Conditions fit. Approval comes next.", "조건은 맞아요. 이제 동의를 확인해요.")
                        : t("This option still needs a change.", "이 구성에는 조건 조정이 필요해요.")
                      : order.allPaid
                      ? t(
                          "Ready for supplier review.",
                          "공급자 검토를 위한 준비 완료.",
                        )
                      : current.feasible
                        ? t("A plan that fits.", "함께 가능한 구성.")
                        : t("Finding common ground.", "함께할 조건을 찾는 중.")}
                  </h2>
                  <span
                    className={`cg-status-orb ${railFits ? "ready" : ""}`}
                  >
                    <Layers3 size={19} />
                  </span>
                </div>
                <div className="cg-mini-batch">
                  {railEvaluation.buyerQuotes.map(quote => (
                    <div key={quote.buyerId} style={{ flex: quote.quantity }}>
                      <span className={`cg-mini-bar ${quote.buyerId}`} />
                      <span>{quote.buyerName}</span>
                      <strong>{quote.quantity}</strong>
                    </div>
                  ))}
                </div>
                <div className="cg-batch-groups">
                  {railEvaluation.groups.map((group) => (
                    <div key={group.baseVariant}>
                      <div>
                        <span>
                          <i
                            className={`cg-material-dot ${group.baseVariant}`}
                          />
                          {group.baseVariant === "black"
                            ? t("Black base", "블랙 상자")
                            : t("Kraft base", "크라프트 상자")}
                        </span>
                        <strong>
                          {group.quantity}
                          <small> / {group.moq}</small>
                        </strong>
                      </div>
                      <div className={`cg-meter ${group.met ? "met" : ""}`}>
                        <span
                          style={{
                            width:
                              Math.min(
                                100,
                                (group.quantity / group.moq) * 100,
                              ) + "%",
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <p className="cg-rail-note">
                  {railIsPreview
                    ? t("Preview only · saved requests are unchanged. Review the specific changes before adopting this option.", "미승인 미리보기 · 저장된 요청은 그대로예요. 구체적인 변경에 동의한 뒤 적용해요.")
                    : current.feasible
                      ? t("The production minimum is met. Every brand still approves its own final quote.", "최소 제작 수량을 충족했어요. 최종 금액은 각 브랜드가 직접 동의해요.")
                      : t("Only identical base boxes count toward the same 100-unit minimum.", "같은 기본 상자끼리만 최소 주문량 100개로 합산할 수 있어요.")}
                </p>
              </section>
              <section className="cg-panel cg-rail-section">
                <div className="cg-rail-heading">
                  <ShieldCheck size={17} />
                  <h3>
                    {t("Every budget matters", "각자의 예산도 지켜야 해요")}
                  </h3>
                </div>
                {railEvaluation.buyerQuotes.map((q) => (
                  <div className="cg-budget-row" key={q.buyerId}>
                    <div>
                      <span>{q.buyerName}</span>
                      <strong
                        className={q.withinBudget ? "" : "cg-over-budget"}
                      >
                        {money(q.totalCents)}
                        <small> / {money(q.budgetCents)}</small>
                      </strong>
                    </div>
                    <div
                      className={`cg-meter ${q.withinBudget ? "met" : "over"}`}
                    >
                      <span
                        style={{
                          width:
                            Math.min(
                              100,
                              (q.totalCents / q.budgetCents) * 100,
                            ) + "%",
                        }}
                      />
                    </div>
                    <small>
                      {q.withinBudget
                        ? `${money(q.budgetCents - q.totalCents)} ${t("room in the budget", "예산 여유")}`
                        : `${money(q.totalCents - q.budgetCents)} ${t("over budget", "예산 초과")}`}
                    </small>
                  </div>
                ))}
                <p className="cg-rail-note">
                  {!railIsPreview
                    ? t("Current saved request", "현재 저장된 요청 기준")
                    : t(
                        "Selected option estimate · approval pending",
                        "선택한 구성의 예상금액 · 동의 전",
                      )}
                </p>
              </section>
              <section className="cg-panel cg-rail-section">
                <div className="cg-rail-heading">
                  <ClipboardList size={17} />
                  <h3>{t("Supplier rulebook", "이 발주의 공급 조건")}</h3>
                </div>
                <p className="cg-supplier-name">
                  Common Box Studio
                  <span>{t("Fictional supplier", "가상 공급자")}</span>
                </p>
                <div className="cg-rule-mini">
                  <span>{t("Minimum / base", "상자 종류별 최소 수량")}</span>
                  <strong>100</strong>
                </div>
                <div className="cg-rule-mini">
                  <span>{t("Production", "제작 기간")}</span>
                  <strong>7 {t("days", "일")}</strong>
                </div>
                <div className="cg-rule-mini">
                  <span>{t("Brand finishes", "개별 브랜딩")}</span>
                  <strong>{t("Label / sleeve", "라벨 / 슬리브")}</strong>
                </div>
                <button
                  className="cg-text-link"
                  onClick={() => setModal("supplier")}
                >
                  {t("See prices & assumptions", "가격과 가정 자세히 보기")}
                  <ArrowUpRight size={13} />
                </button>
              </section>
              <section className="cg-activity">
                <h3>{t("Your decisions, kept clear", "지금까지 확인한 것")}</h3>
                <div className="cg-activity-item done">
                  <span />
                  <div>
                    <strong>
                      {t("Brand briefs collected", "브랜드 요청 모음")}
                    </strong>
                    <small>
                      {order.activeBuyers.length}{" "}
                      {t("participating personas", "개 브랜드 역할 참여")}
                    </small>
                  </div>
                </div>
                <div
                  className={`cg-activity-item ${current.feasible ? "done" : ""}`}
                >
                  <span />
                  <div>
                    <strong>
                      {t("Configuration agreed", "제작 구성 합의")}
                    </strong>
                    <small>
                      {current.feasible
                        ? t(
                            "Fits MOQ, budgets and timing",
                            "최소 수량·예산·기간 충족",
                          )
                        : declined
                          ? t(
                              "LUMA retained the original base",
                              "LUMA는 원래 상자 유지",
                            )
                          : t("Review a shared plan", "함께할 구성 검토 중")}
                    </small>
                  </div>
                </div>
                <div
                  className={`cg-activity-item ${order.allAgreed ? "done" : ""}`}
                >
                  <span />
                  <div>
                    <strong>
                      {t("Final quotes approved", "최종 견적 확인")}
                    </strong>
                    <small>
                      {approvedCount} / {order.activeBuyers.length}{" "}
                      {t("approvals", "동의")}
                    </small>
                  </div>
                </div>
                <div
                  className={`cg-activity-item ${order.allPaid ? "done" : ""}`}
                >
                  <span />
                  <div>
                    <strong>{t("Individual checkout", "각자 결제")}</strong>
                    <small>
                      {order.paidCount} / {order.activeBuyers.length} ·{" "}
                      {order.paymentMode === "sample"
                        ? t("sample steps", "예시 결제 단계")
                        : "Sandbox"}
                    </small>
                  </div>
                </div>
              </section>
            </aside>
          </div>
          <footer className="cg-footer">
            <p>
              {t(
                "A guided example with fictional brands, supplier rules and prices. Real production needs supplier confirmation.",
                "가상 브랜드·공급 조건·가격을 사용하는 예시예요. 실제 제작에는 공급자 확인이 필요해요.",
              )}
            </p>
            <button
              onClick={async () => {
                if (await order.reset()) {
                  setSelectedId(null);
                  setView("briefs");
                }
              }}
              disabled={locked && !order.allPaid}
            >
              <RotateCcw size={13} />
              {t("Start a fresh sample", "새 예시 시작")}
            </button>
          </footer>
        </div>
      </main>

      {order.notice && (
        <div className="cg-toast" role="status">
          <CheckCircle2 size={18} />
          <p>{order.notice}</p>
          <button
            className="cg-btn icon ghost"
            onClick={() => order.setNotice("")}
            aria-label="Dismiss"
          >
            <X size={15} />
          </button>
        </div>
      )}
      {editor && (
        <BriefEditor
          buyer={scenario.buyers.find((b) => b.id === editor)!}
          lang={lang}
          aiReady={canUseAI}
          signedOut={signedOut}
          initialIntentOpen={editorIntent}
          onClose={() => setEditor(null)}
          onSave={async (patch) => {
            if (
              await order.changeScenario(updateBuyer(scenario, editor, patch))
            ) {
              setEditor(null);
              setSelectedId(null);
              requestedNavigation.current = true;
              setView("plans");
              order.setNotice(
                t(
                  "Brief updated. Previous approvals have been cleared for the new conditions.",
                  "요청을 수정했어요. 변경된 조건에 맞춰 이전 동의는 초기화했어요.",
                ),
              );
              if (canUseAI) await refreshGuidance();
            } else
              throw new Error(
                t(
                  "The current checkout could not be changed.",
                  "진행 중인 견적을 변경하지 못했어요.",
                ),
              );
          }}
        />
      )}
      {reviewPlan && (
        <PlanReview
          plan={reviewPlan}
          source={current}
          lang={lang}
          onClose={() => setReviewPlan(null)}
          onApprove={(ids) => applyPlan(reviewPlan, ids)}
          onDecline={async () => {
            if (await order.decide("declined")) setReviewPlan(null);
          }}
        />
      )}
      {modal && (
        <DetailsDialog
          kind={modal}
          order={order}
          onClose={() => setModal(null)}
          onArchive={async () => {
            if (await order.archiveExpiredQuote()) {
              setModal(null);
              setView("briefs");
            }
          }}
        />
      )}
    </div>
  );
}

function PlanReview({
  plan,
  source,
  lang,
  onClose,
  onApprove,
  onDecline,
}: {
  plan: Plan;
  source: Evaluation;
  lang: Lang;
  onClose: () => void;
  onApprove: (ids: BuyerId[]) => Promise<void>;
  onDecline: () => Promise<void>;
}) {
  const t = (en: string, ko: string) => (lang === "en" ? en : ko);
  const required = [
    ...new Set([
      ...plan.requiredApprovals,
      ...plan.physicalConsentRequired,
      ...changedConfigurations(source, plan),
    ]),
  ];
  const [approved, setApproved] = useState<BuyerId[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  return (
    <Dialog
      title={t("A change worth agreeing on.", "바뀌는 내용을 함께 확인해요.")}
      subtitle={t(
        "Review on behalf of each affected brand in this sample.",
        "이 예시에서는 변경되는 브랜드의 역할로 각각 확인해 주세요.",
      )}
      onClose={onClose}
    >
      <div className="cg-review-intro">
        <span className="cg-pill positive">
          <ShieldCheck size={13} />
          {t("Numeric rules checked", "수량·금액·기간 확인")}
        </span>
        <h3>{planTitle(plan, lang)}</h3>
        <p>
          {plan.evaluation.totalQuantity} {t("boxes", "개")} ·{" "}
          {money(plan.evaluation.totalCents)} ·{" "}
          {t("7-day sample production", "예시 제작 기간 7일")}
        </p>
      </div>
      <div className="cg-review-changes">
        {required.map((id) => {
          const delta = plan.quantityDeltas.find((d) => d.buyerId === id);
          const q = plan.evaluation.buyerQuotes.find((q) => q.buyerId === id)!;
          return (
            <label
              key={id}
              className={`cg-review-brand ${approved.includes(id) ? "checked" : ""}`}
            >
              <Avatar id={id} />
              <div>
                <h3>{id.toUpperCase()}</h3>
                {delta && (
                  <p>
                    <strong>
                      {t("Quantity: ", "수량: ")}
                      {delta.from} → {delta.to}
                    </strong>
                  </p>
                )}
                {(plan.physicalConsentRequired.includes(id) ||
                  changedConfigurations(source, plan).includes(id)) && (
                  <p>
                    {plan.kind === "original-minimums"
                      ? t(
                          "Return from the kraft base and black sleeve to the original black base with your own label.",
                          "크라프트 상자와 블랙 슬리브 대신, 원래의 블랙 상자와 자체 라벨로 돌아가요.",
                        )
                      : source.buyerQuotes.find((q) => q.buyerId === id)
                            ?.substitutionApplied
                        ? t(
                            "Keep the kraft base and black branded sleeve for these revised quantities.",
                            "변경된 수량에도 크라프트 상자와 블랙 브랜드 슬리브 구성을 유지해요.",
                          )
                        : t(
                            "Black base + label → kraft base + black branded sleeve. The bare carton changes.",
                            "블랙 상자 + 라벨 → 크라프트 상자 + 블랙 브랜드 슬리브. 기본 상자의 모습이 달라져요.",
                          )}
                  </p>
                )}
                <span>
                  {t("My updated total: ", "변경된 내 금액: ")}
                  <strong>{money(q.totalCents)}</strong>
                </span>
                <small>
                  {t(
                    "I approve these specific changes for this batch.",
                    "이번 발주에 이 변경 사항을 적용하는 데 동의해요.",
                  )}
                </small>
              </div>
              <input
                type="checkbox"
                checked={approved.includes(id)}
                onChange={(e) =>
                  setApproved((values) =>
                    e.target.checked
                      ? [...values, id]
                      : values.filter((v) => v !== id),
                  )
                }
                aria-label={
                  t("Accept changes for ", "변경 동의: ") + id.toUpperCase()
                }
              />
            </label>
          );
        })}
      </div>
      {!required.length && (
        <p className="cg-dialog-note">
          {t(
            "This plan keeps the current conditions. You will review each final quote next.",
            "현재 조건을 유지하는 구성이에요. 다음 단계에서 각자의 최종 견적을 확인해요.",
          )}
        </p>
      )}
      {error && (
        <p className="cg-error" role="alert">
          {error}
        </p>
      )}
      <div className="cg-dialog-actions">
        {plan.physicalConsentRequired.includes("luma") ? (
          <button
            className="cg-btn ghost"
            onClick={onDecline}
            disabled={saving}
          >
            {t("LUMA keeps the original", "LUMA는 원래 상자 유지")}
          </button>
        ) : (
          <button className="cg-btn ghost" onClick={onClose}>
            {t("Keep reviewing", "더 검토하기")}
          </button>
        )}
        <button
          className="cg-btn primary"
          disabled={saving || required.some((id) => !approved.includes(id))}
          onClick={async () => {
            setSaving(true);
            setError("");
            try {
              await onApprove(approved);
            } catch (e) {
              setError(
                e instanceof Error ? e.message : "Could not apply this plan.",
              );
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving ? (
            <LoaderCircle className="cg-spin" size={16} />
          ) : (
            <Check size={16} />
          )}{" "}
          {t("Use the agreed configuration", "동의한 구성으로 진행")}
        </button>
      </div>
    </Dialog>
  );
}

function SignInLink({ lang }: { lang: Lang }) {
  return <a className="cg-btn secondary small" href="/signin-with-chatgpt?return_to=%2F" target="_top">{lang === "en" ? "Sign in with ChatGPT" : "ChatGPT로 로그인"}</a>;
}

function BriefEditor({
  buyer,
  lang,
  aiReady,
  signedOut,
  initialIntentOpen = false,
  onClose,
  onSave,
}: {
  buyer: Buyer;
  lang: Lang;
  aiReady: boolean;
  signedOut: boolean;
  initialIntentOpen?: boolean;
  onClose: () => void;
  onSave: (patch: BuyerPatch) => Promise<void>;
}) {
  const t = (en: string, ko: string) => (lang === "en" ? en : ko);
  const [quantity, setQuantity] = useState(String(buyer.quantity));
  const initialRange = getQuantityRange(buyer);
  const [flexible, setFlexible] = useState(
    initialRange.min !== initialRange.max,
  );
  const [quantityMin, setQuantityMin] = useState(String(initialRange.min));
  const [quantityMax, setQuantityMax] = useState(String(initialRange.max));
  const [budget, setBudget] = useState(String(buyer.budgetCents / 100));
  const [days, setDays] = useState(String(buyer.maxLeadDays));
  const [active, setActive] = useState(buyer.active);
  const [text, setText] = useState("");
  const [interpretation, setInterpretation] = useState<Interpretation | null>(null);
  const [appliedReview, setAppliedReview] = useState<Interpretation | null>(null);
  const [intentHint, setIntentHint] = useState<"text" | "fields" | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const textRef = useRef("");
  const requestGuard = useRef(createInterpretationRequestGuard());
  const requestAbort = useRef<AbortController | null>(null);
  const reviewToken = useRef<InterpretationRequestToken | null>(null);
  useEffect(() => () => {
    requestGuard.current.invalidate();
    requestAbort.current?.abort();
    reviewToken.current = null;
  }, []);

  function invalidateInterpretation(reason: "text" | "fields" | null) {
    const hadResult = Boolean(requestAbort.current || reviewToken.current);
    requestGuard.current.invalidate();
    requestAbort.current?.abort();
    requestAbort.current = null;
    reviewToken.current = null;
    setBusy(false);
    setInterpretation(null);
    setAppliedReview(null);
    if (hadResult || reason === null) setIntentHint(reason);
  }
  function changeBriefText(next: string) {
    invalidateInterpretation("text");
    textRef.current = next;
    setText(next);
    setError("");
  }
  function fieldEdited() {
    invalidateInterpretation("fields");
    setError("");
  }
  function closeEditor() {
    if (saving) return;
    invalidateInterpretation(null);
    onClose();
  }
  const displayedInterpretation = interpretation ?? appliedReview;
  const interpretationRows = displayedInterpretation ? [
    { label: t("Requested quantity", "요청 수량"), value: displayedInterpretation.quantity === null ? null : `${displayedInterpretation.quantity} ${t("boxes", "개")}`, source: displayedInterpretation.evidence.quantity },
    { label: t("Quantity permission", "수량 변경 허용"), value: displayedInterpretation.quantityMin !== null && displayedInterpretation.quantityMax !== null ? `${displayedInterpretation.quantityMin}–${displayedInterpretation.quantityMax} ${t("boxes", "개")}` : displayedInterpretation.quantity !== null ? t("Exact quantity · no flexibility inferred", "요청 수량 고정 · 변경 허용 추정 없음") : null, source: [displayedInterpretation.evidence.quantityMin, displayedInterpretation.evidence.quantityMax].filter((source, index, all) => source && all.indexOf(source) === index).join(" · ") || displayedInterpretation.evidence.quantity },
    { label: t("Maximum incl. delivery", "배송비 포함 예산 상한"), value: displayedInterpretation.budgetCents === null ? null : money(displayedInterpretation.budgetCents), source: displayedInterpretation.evidence.budget },
    { label: t("Production deadline", "제작 기간 상한"), value: displayedInterpretation.maxLeadDays === null ? null : `${displayedInterpretation.maxLeadDays} ${t("days", "일")}`, source: displayedInterpretation.evidence.leadTime },
  ] : [];
  async function readRequest() {
    if (saving || !textRef.current.trim()) return;
    requestAbort.current?.abort();
    const token = requestGuard.current.begin(textRef.current);
    const controller = new AbortController();
    requestAbort.current = controller;
    reviewToken.current = null;
    setBusy(true);
    setError("");
    setIntentHint(null);
    setInterpretation(null);
    setAppliedReview(null);
    try {
      const data = await clientApi<{ interpretation: Interpretation }>(
        "/api/interpret",
        { buyerId: buyer.id, text: token.text },
        { timeoutMs: 55000, signal: controller.signal },
      );
      if (!requestGuard.current.isCurrent(token, textRef.current)) return;
      reviewToken.current = token;
      setInterpretation(data.interpretation);
    } catch (cause) {
      if (requestGuard.current.isCurrent(token, textRef.current) && !controller.signal.aborted) {
        setError(cause instanceof ClientApiError && cause.code === "AI_DAILY_LIMIT"
          ? t("Daily AI limit reached. Edit the fields manually or try again after 00:00 UTC.", "AI 일일 한도에 도달했어요. 조건을 직접 입력하거나 한국 시간 오전 9시 이후 다시 시도해 주세요.")
          : cause instanceof ClientApiError && cause.code === "REQUEST_TIMEOUT"
          ? t("AI took too long to read this brief. Your form has not changed; try reading it again.", "AI가 요청을 읽는 데 시간이 오래 걸렸어요. 입력값은 바뀌지 않았으니 다시 읽어 주세요.")
          : cause instanceof Error ? cause.message : t("Could not read this brief.", "요청을 읽지 못했어요."));
      }
    } finally {
      if (requestGuard.current.isCurrent(token, textRef.current)) {
        requestAbort.current = null;
        setBusy(false);
      }
    }
  }
  return (
    <Dialog
      title={t("Shape ", "요청 수정: ") + buyer.name + t("’s brief", "")}
      subtitle={t(
        "Start with the things that matter. We will check the rest against the supplier rules.",
        "중요한 조건을 정해 주세요. 공급 조건과 함께 검토할게요.",
      )}
      onClose={closeEditor}
    >
      <div className="cg-editor-brand">
        <Avatar id={buyer.id} />
        <div>
          <strong>{brandCopy[buyer.id].priority[lang === "en" ? 0 : 1]}</strong>
          <span>
            {t(
              "Brand specification stays fixed in this sample.",
              "이 예시의 브랜드 기본 사양은 유지돼요.",
            )}
          </span>
        </div>
      </div>
      <form
        className="cg-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (saving || busy) return;
          setSaving(true);
          setError("");
          try {
            const q = Number(quantity),
              b = Math.round(Number(budget) * 100),
              d = Number(days);
            const min = Number(quantityMin),
              max = Number(quantityMax);
            if (
              !Number.isInteger(q) ||
              q < 1 ||
              q > 10000 ||
              !Number.isSafeInteger(b) ||
              b < 1 ||
              !Number.isInteger(d) ||
              d < 1 ||
              d > 365
            )
              throw new Error(
                t(
                  "Check the quantity, budget and production days.",
                  "수량·예산·제작 기간을 확인해 주세요.",
                ),
              );
            if (
              flexible &&
              (!Number.isInteger(min) ||
                !Number.isInteger(max) ||
                min < 1 ||
                max > 10000 ||
                min > q ||
                max < q)
            )
              throw new Error(
                t(
                  "Your permitted range must include the requested quantity. Check the minimum and maximum.",
                  "허용 범위 안에 요청 수량이 포함되어야 해요. 최소·최대 수량을 확인해 주세요.",
                ),
              );
            await onSave({
              quantity: q,
              quantityRange: flexible ? { min, max } : null,
              budgetCents: b,
              maxLeadDays: d,
              active,
            });
          } catch (e) {
            setError(e instanceof Error ? e.message : "Invalid brief.");
          } finally {
            setSaving(false);
          }
        }}
      >
        <details className="cg-intent" open={initialIntentOpen}>
          <summary>
            <Sparkles size={16} />
            {t("Describe it in your own words", "원하는 조건을 말로 설명하기")}
            <span>
              {signedOut ? t("Sign-in required", "로그인 필요") : aiReady
                ? t("AI configured", "AI 설정됨")
                : t("AI not connected", "AI 미연결")}
            </span>
            <ChevronDown size={14} />
          </summary>
          <p className="cg-intent-purpose">{t("AI reads your request into editable conditions. The rule engine checks what fits; you decide what changes.", "AI가 요청을 수정 가능한 조건으로 정리해요. 계산 규칙으로 가능 여부를 검증하고, 변경은 직접 결정해요.")}</p>
          <label className="cg-field">
            <span>{t("Your brief", "구매 요청")}</span>
            <textarea
              rows={3}
              value={text}
              maxLength={3000}
              disabled={saving}
              onChange={(e) => changeBriefText(e.target.value)}
              placeholder={t(
                "I want 40 boxes and can accept 38–40 boxes. My maximum is $80 including delivery. Production within 10 days.",
                "40개를 원하지만 38–40개까지 괜찮아요. 배송비 포함 최대 80달러, 제작은 10일 이내예요.",
              )}
            />
          </label>
          <div className="cg-intent-examples" aria-label={t("Example request starters", "요청 예문")}>
            <button type="button" className="cg-btn ghost small" disabled={saving} onClick={() => changeBriefText(t(`Exactly ${buyer.quantity} boxes, budget ${money(buyer.budgetCents)} including delivery, production within ${buyer.maxLeadDays} days.`, `정확히 ${buyer.quantity}개, 배송비 포함 예산 ${buyer.budgetCents / 100}달러, 제작은 ${buyer.maxLeadDays}일 이내예요.`))}>{t("Exact quantity example", "수량 고정 예문")}</button>
            <button type="button" className="cg-btn ghost small" disabled={saving} onClick={() => changeBriefText(t(`I want ${buyer.quantity} boxes and can accept ${Math.max(1, buyer.quantity - 2)}–${buyer.quantity} boxes, budget ${money(buyer.budgetCents)} including delivery, production within ${buyer.maxLeadDays} days.`, `${buyer.quantity}개를 원하지만 ${Math.max(1, buyer.quantity - 2)}~${buyer.quantity}개까지 괜찮아요. 배송비 포함 예산 ${buyer.budgetCents / 100}달러, 제작은 ${buyer.maxLeadDays}일 이내예요.`))}>{t("Allowed range example", "허용 범위 예문")}</button>
          </div>
          <button
            type="button"
            className="cg-btn secondary small"
            disabled={!aiReady || busy || saving || !text.trim()}
            onClick={readRequest}
          >
            {busy ? (
              <LoaderCircle className="cg-spin" size={15} />
            ) : (
              <Sparkles size={15} />
            )}{" "}
            {busy ? t("Reading your brief…", "요청을 읽고 있어요…") : t("Read my brief", "요청 읽기")}
          </button>
          {intentHint && <p className="cg-intent-hint" role="status">{intentHint === "text"
            ? t("Your words changed. Read this version before applying an interpretation.", "입력 문장이 바뀌었어요. 현재 문장을 다시 읽은 뒤 적용해 주세요.")
            : t("You edited a field. Read again before applying an AI interpretation.", "입력값을 직접 수정했어요. AI 해석을 적용하려면 다시 읽어 주세요.")}</p>}
          {signedOut ? <SignInLink lang={lang} /> : !aiReady && (
            <p>
              {t(
                "Manual editing works now. Natural-language interpretation needs a connected AI provider.",
                "지금은 위 조건을 직접 수정할 수 있어요. 자연어 해석은 AI 연결 후 사용할 수 있어요.",
              )}
            </p>
          )}
          {interpretation && (
            <div className="cg-intent-review">
              <h3>
                {t("Review the interpretation", "읽어낸 내용을 확인해 주세요")}
              </h3>
              <p>{t("Check each value against your own words before applying it.", "입력한 문장과 읽어낸 값을 나란히 확인한 뒤 적용해 주세요.")}</p>
              <dl className="cg-intent-evidence">{interpretationRows.map((row) => <div key={row.label} className={row.value === null ? "missing" : ""}><dt>{row.label}</dt><dd><strong>{row.value ?? t("Not specified · current value stays", "명시 없음 · 기존 값 유지")}</strong>{row.source && <blockquote>“{row.source}”</blockquote>}</dd></div>)}</dl>
              {interpretation.priorities.length > 0 && (
                <p>
                  {t("Priorities: ", "중요한 조건: ")}
                  {interpretation.priorities.join(" · ")}
                </p>
              )}
              {interpretation.unsupportedRequirements.length > 0 ? (
                <div className="cg-error">
                  {t("Clarify before applying: ", "적용 전 확인이 필요해요: ")}
                  {interpretation.unsupportedRequirements.join("; ")}
                </div>
              ) : (
                <button
                  type="button"
                  className="cg-btn secondary small"
                  disabled={saving || busy}
                  onClick={() => {
                    if (!requestGuard.current.isCurrent(reviewToken.current, textRef.current)) {
                      setInterpretation(null);
                      setIntentHint("text");
                      return;
                    }
                    if (interpretation.quantity !== null)
                      setQuantity(String(interpretation.quantity));
                    if (
                      interpretation.quantityMin !== null &&
                      interpretation.quantityMax !== null
                    ) {
                      setFlexible(
                        interpretation.quantityMin !==
                          interpretation.quantityMax,
                      );
                      setQuantityMin(String(interpretation.quantityMin));
                      setQuantityMax(String(interpretation.quantityMax));
                    } else if (interpretation.quantity !== null) {
                      setFlexible(false);
                      setQuantityMin(String(interpretation.quantity));
                      setQuantityMax(String(interpretation.quantity));
                    }
                    if (interpretation.budgetCents !== null)
                      setBudget(String(interpretation.budgetCents / 100));
                    if (interpretation.maxLeadDays !== null)
                      setDays(String(interpretation.maxLeadDays));
                    setAppliedReview(interpretation);
                    setInterpretation(null);
                    reviewToken.current = null;
                    requestGuard.current.invalidate();
                    setIntentHint(null);
                    setError("");
                  }}
                >
                  {t("Apply reviewed values", "확인한 값을 입력란에 적용")}
                  <Check size={14} />
                </button>
              )}
            </div>
          )}
        </details>
        {appliedReview && (
          <div className="cg-intent-applied">
            <div role="status"><CheckCircle2 size={19}/><div><strong>{t("Reviewed values are in the form.", "확인한 조건을 입력란에 반영했어요.")}</strong><p>{t("This is still a draft. Save to update the shared plans.", "아직 저장 전 초안이에요. 저장하면 공동 제작 구성을 다시 계산해요.")}</p></div></div>
            <button type="submit" className="cg-btn primary" disabled={saving || busy}>{saving ? <LoaderCircle className="cg-spin" size={15}/> : <Check size={15}/>} {t("Save & recheck the plans", "저장하고 구성 다시 검토")}</button>
            <details><summary>{t("Review the original words again", "원문과 해석 다시 보기")}<ChevronDown size={14}/></summary><dl className="cg-intent-evidence">{interpretationRows.map(row => <div key={row.label}><dt>{row.label}</dt><dd><strong>{row.value ?? t("Not specified · existing value kept", "명시 없음 · 기존 값 유지")}</strong>{row.source && <blockquote>“{row.source}”</blockquote>}</dd></div>)}</dl></details>
          </div>
        )}
        <div className="cg-form-grid">
          <label className="cg-field">
            <span>{t("Requested quantity", "요청 수량")}</span>
            <div>
              <input
                type="number"
                min="1"
                max="10000"
                step="1"
                required
                value={quantity}
                disabled={saving}
                onChange={(e) => { fieldEdited(); setQuantity(e.target.value); }}
              />
              <span>{t("boxes", "개")}</span>
            </div>
            <small>
              {t(
                "Fixed unless you allow a range below.",
                "아래에서 허용 범위를 정하지 않으면 고정돼요.",
              )}
            </small>
          </label>
          <label className="cg-field">
            <span>{t("Maximum budget", "최대 예산")}</span>
            <div>
              <span>$</span>
              <input
                type="number"
                min="0.01"
                max="1000000"
                step="0.01"
                required
                value={budget}
                disabled={saving}
                onChange={(e) => { fieldEdited(); setBudget(e.target.value); }}
              />
            </div>
            <small>{t("USD, including delivery", "USD, 배송비 포함")}</small>
          </label>
          <label className="cg-field">
            <span>{t("Production within", "최대 제작 기간")}</span>
            <div>
              <input
                type="number"
                min="1"
                max="365"
                step="1"
                required
                value={days}
                disabled={saving}
                onChange={(e) => { fieldEdited(); setDays(e.target.value); }}
              />
              <span>{t("days", "일")}</span>
            </div>
            <small>
              {t("Transit time is separate.", "배송 기간은 별도예요.")}
            </small>
          </label>
        </div>
        <div className="cg-range-fields">
          <label className="cg-include">
            <input
              type="checkbox"
              checked={flexible}
              disabled={saving}
              onChange={(e) => {
                fieldEdited();
                setFlexible(e.target.checked);
                if (e.target.checked) {
                  setQuantityMin(quantity);
                  setQuantityMax(quantity);
                }
              }}
            />
            <span>
              {t(
                "I can review quantity changes within a range",
                "정해진 범위 안에서 수량 변경을 검토할 수 있어요",
              )}
            </span>
          </label>
          {flexible ? (
            <>
              <label className="cg-field">
                <span>{t("Minimum I can accept", "최소 필요 수량")}</span>
                <div>
                  <input
                    type="number"
                    min="1"
                    max="10000"
                    step="1"
                    value={quantityMin}
                    required
                    disabled={saving}
                onChange={(e) => { fieldEdited(); setQuantityMin(e.target.value); }}
                  />
                  <span>{t("boxes", "개")}</span>
                </div>
              </label>
              <label className="cg-field">
                <span>{t("Maximum I can consider", "최대 검토 수량")}</span>
                <div>
                  <input
                    type="number"
                    min="1"
                    max="10000"
                    step="1"
                    value={quantityMax}
                    required
                    disabled={saving}
                onChange={(e) => { fieldEdited(); setQuantityMax(e.target.value); }}
                  />
                  <span>{t("boxes", "개")}</span>
                </div>
              </label>
              <p>
                {t(
                  "Budgets stay fixed. You still approve the final quantity and amount before checkout.",
                  "예산 상한은 유지돼요. 결제 전 최종 수량과 금액은 다시 동의해야 해요.",
                )}
              </p>
            </>
          ) : (
            <p>
              {t(
                `Exactly ${quantity || "—"} boxes. Plans cannot reduce or increase this quantity.`,
                `정확히 ${quantity || "—"}개가 필요해요. 대안에서도 이 수량을 늘리거나 줄이지 않아요.`,
              )}
            </p>
          )}
        </div>
        <label className="cg-include">
          <input
            type="checkbox"
            checked={active}
            disabled={saving}
            onChange={(e) => { fieldEdited(); setActive(e.target.checked); }}
          />
          <span>
            {t(
              "Include this brand in the shared batch",
              "이번 공동 제작에 참여",
            )}
          </span>
        </label>
        {error && (
          <p className="cg-error" role="alert">
            {error}
          </p>
        )}
        <div className="cg-dialog-actions">
          <button type="button" className="cg-btn ghost" disabled={saving} onClick={closeEditor}>
            {t("Cancel", "취소")}
          </button>
          <button
            type="submit"
            className="cg-btn primary"
            disabled={saving || busy}
          >
            {saving ? (
              <LoaderCircle size={16} className="cg-spin" />
            ) : (
              <Check size={16} />
            )}{" "}
            {t("Save & recheck the plans", "저장하고 구성 다시 검토")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function CheckoutPanel({
  order,
  onReview,
  onBrief,
  onConnections,
  onArchive,
  onReplan,
}: {
  order: Order;
  onReview: () => void;
  onBrief: () => void;
  onConnections: () => void;
  onArchive: () => void;
  onReplan: () => void;
}) {
  const { lang, current } = order;
  const t = (en: string, ko: string) => (lang === "en" ? en : ko);
  const [closingUnpaid, setClosingUnpaid] = useState(false);
  const [closeError, setCloseError] = useState("");
  const closeBusy = order.busy || order.paying !== null || order.restoring;
  const ledger = buildCheckoutSummary(current.buyerQuotes, order.receipts, order.paymentMode);
  const quoteReference = checkoutReference(order.paymentMode, order.quoteId, order.scenario.revision) ?? t("Not created yet", "견적 생성 전");
  const reviewReady = current.feasible && order.allAgreed && order.allPaid;
  return (
    <section className="cg-panel">
      <PanelHead
        kicker={t(
          "ONE BATCH. INDIVIDUAL CHECKOUT.",
          "한 번의 제작, 각자의 결제",
        )}
        title={
          reviewReady
            ? t(
                "Your plan is ready for supplier review.",
                "공급자에게 검토받을 구성이 준비됐어요.",
              )
            : t(
                "Each brand takes care of its share.",
                "내 주문의 금액은 내가 결제해요.",
              )
        }
      />
      <div className="cg-checkout-toolbar">
        <div className="cg-segmented">
          <button
            className={order.paymentMode === "sample" ? "active" : ""}
            disabled={order.hasOrders || order.paying !== null}
            onClick={() => order.choosePaymentMode("sample")}
          >
            {t("Sample checkout", "예시 결제 체험")}
          </button>
          <button
            className={order.paymentMode === "sandbox" ? "active" : ""}
            disabled={order.checkoutRecoveryStatus === "unauthenticated" || order.hasOrders || order.paying !== null}
            onClick={() => order.choosePaymentMode("sandbox")}
          >
            PayPal Sandbox
          </button>
        </div>
        <span>
          <LockKeyhole size={13} />
          {t("No real-money payments", "실제 금전 결제 없음")}
        </span>
      </div>
      <div className="cg-checkout-note">
        <CircleHelp size={17} />
        <p>
          {order.paymentMode === "sample"
            ? t(
                "Try each buyer’s checkout in this guided sample. These steps do not create PayPal transactions.",
                "이 예시에서 각 구매자의 결제 흐름을 체험해 보세요. 실제 PayPal 거래는 생성되지 않아요.",
              )
            : order.config.paypalReady
              ? t(
                  "Each test payment is processed separately. The batch is complete only when every payment is verified.",
                  "테스트 결제는 각각 처리돼요. 모든 결제 완료를 확인해야 공동발주가 완료 상태가 돼요.",
                )
              : t(
                  "Sandbox is not connected yet. The sample checkout is available while credentials are configured.",
                  "Sandbox가 아직 연결되지 않았어요. 지금은 예시 결제로 흐름을 체험할 수 있어요.",
                )}
        </p>
        {order.paymentMode === "sandbox" && !order.config.paypalReady && (
          <button className="cg-text-link" onClick={onConnections}>
            {t("Connection status", "연결 상태")}
          </button>
        )}
      </div>
      <section className="cg-checkout-progress" aria-label={t("Individual payment progress", "개인별 결제 진행 현황")}>
        <div className="cg-payment-totals">
          <div className="cg-payment-total"><span>{order.allAgreed ? t("Agreed batch total", "합의한 총금액") : t("Proposed batch total", "검토 중인 총금액")}</span><strong>{money(ledger.totalCents)}</strong></div>
          <div className="cg-payment-total"><span>{order.paymentMode === "sample" ? t("Sample steps complete", "예시 완료분") : t("Verified Sandbox captures", "확인된 Sandbox 결제")}</span><strong>{money(ledger.completedCents)}</strong></div>
          <div className="cg-payment-total"><span>{t("Shares remaining", "남은 몫")}</span><strong>{money(ledger.remainingCents)}</strong></div>
        </div>
        <div className="cg-payment-progress-track" role="progressbar" aria-label={t("Share amounts completed", "금액 기준 완료율")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ledger.progressPercent)} aria-valuetext={t(`${ledger.completedCount} of ${ledger.totalCount} shares complete. ${money(ledger.remainingCents)} remaining.`, `${ledger.totalCount}명 중 ${ledger.completedCount}명 완료. 남은 금액 ${money(ledger.remainingCents)}.`)}><span className="cg-payment-progress-bar" style={{width:`${ledger.progressPercent}%`}}/></div>
        <p aria-live="polite">{ledger.completedCount}/{ledger.totalCount} {t("shares complete", "개별 결제 단계 완료")}{ledger.pendingNames.length > 0 && <> · {t("Waiting for ", "대기: ")}{ledger.pendingNames.join(" · ")}</>}</p>
        <div className="cg-brief-meta"><span>{t("Quote", "견적")} <code>{quoteReference}</code></span><span>{order.paymentMode === "sample" ? t("Simulation only · no money collected", "시뮬레이션 · 실제 수금 없음") : t("Sandbox test funds only", "Sandbox 테스트 금액")}</span></div>
        {order.paymentMode === "sandbox" && order.quoteExpiresAt !== null && <p className="cg-quote-expiry"><Clock3 size={13}/>{t("Quote expiry", "견적 만료")}: <time dateTime={new Date(order.quoteExpiresAt).toISOString()}>{new Date(order.quoteExpiresAt).toLocaleString(lang === "ko" ? "ko-KR" : "en-US", {month:"short",day:"numeric",hour:"2-digit",minute:"2-digit",timeZoneName:"short"})}</time></p>}
        {order.hasOrders && !order.allPaid && <p className="cg-payment-lock"><LockKeyhole size={14}/>{t("This quote is locked while payment results are unresolved. Each completed share stays on its own record.", "결제 결과를 확인하는 동안 견적은 고정돼요. 완료된 각 결제 기록은 그대로 보존돼요.")}</p>}
        {order.paymentMode === "sandbox" && order.quoteId && order.hasOrders && !order.paidCount && order.quoteCurrent && (
          <button type="button" className="cg-text-link cg-close-unpaid" disabled={closeBusy} onClick={() => { setCloseError(""); setClosingUnpaid(true); }}>{t("Close an unpaid quote", "미결제 견적 종료")}<ArrowUpRight size={13}/></button>
        )}
      </section>
      {!order.quoteCurrent && (
        <div className="cg-alert error">
          <CircleHelp size={18} />
          <p>
            {t(
              "This quote has expired. Existing payments are preserved; new payments are blocked.",
              "견적이 만료되었어요. 기존 결제 기록은 유지되며 새 결제는 할 수 없어요.",
            )}
          </p>
          <button className="cg-btn ghost small" onClick={onArchive}>
            {t("Close this quote", "이 견적 닫기")}
          </button>
        </div>
      )}
      {!order.allAgreed && (
        <div className="cg-alert">
          <Fingerprint size={18} />
          <p>
            {t(
              "Every active brand must approve its final quote before checkout.",
              "참여 브랜드가 모두 최종 견적에 동의해야 결제할 수 있어요.",
            )}
          </p>
          <button className="cg-btn secondary small" onClick={onReview}>
            {t("Review quotes", "견적 확인")}
          </button>
        </div>
      )}
      <div className="cg-checkout-grid">
        {current.buyerQuotes.map((q) => (
          <article
            className={`cg-checkout-card ${order.receipts[q.buyerId] ? "paid" : ""}`}
            key={q.buyerId}
          >
            <div className="cg-checkout-brand">
              <Avatar id={q.buyerId} />
              <div>
                <h3>{q.buyerName}</h3>
                <span>
                  {q.quantity} {t("branded boxes", "개 브랜드 상자")}
                </span>
              </div>
              {order.receipts[q.buyerId] && <CheckCircle2 size={20} />}
            </div>
            <strong className="cg-checkout-price">
              {money(q.totalCents)}
              <span>USD</span>
            </strong>
            <div className="cg-checkout-lines">
              <span>
                <Box size={14} />
                {q.substitutionApplied
                  ? t("Kraft + black sleeve", "크라프트 + 블랙 슬리브")
                  : q.baseVariant === "black"
                    ? t("Black + own label", "블랙 + 자체 라벨")
                    : t("Kraft + own label", "크라프트 + 자체 라벨")}
              </span>
              <span>
                <Clock3 size={14} />
                {t(`${q.leadDays}-day production`, `제작 ${q.leadDays}일`)}
              </span>
              <span>
                <Check size={14} />
                {order.agreed[q.buyerId]
                  ? t("Final quote approved", "최종 견적 동의 완료")
                  : t("Final approval pending", "최종 동의 대기")}
              </span>
            </div>
            <details className="cg-payment-breakdown"><summary>{t("How this adds up", "금액 산정 내역")}<ChevronDown size={13}/></summary><dl><div><dt>{t("Base boxes", "기본 상자")}</dt><dd>{money(q.baseCents)}</dd></div><div><dt>{t("Your branding", "개별 브랜딩")}</dt><dd>{money(q.brandingCents)}</dd></div><div><dt>{t("Your setup share", "배분된 준비비")}</dt><dd>{money(q.setupCents)}</dd></div><div><dt>{t("Delivery", "배송비")}</dt><dd>{money(q.shippingCents)}</dd></div></dl><small>{t("USD · taxes not modeled in this sample", "USD · 예시에서 세금은 미반영")}</small></details>
            {order.receipts[q.buyerId] ? (
              <div className="cg-receipt">
                <CheckCheck size={18} />
                <strong>
                  {order.receipts[q.buyerId]?.kind === "sample"
                    ? t("Sample step complete", "예시 결제 단계 완료")
                    : t("Sandbox capture verified", "Sandbox 결제 확인")}
                </strong>
                <small>{order.receipts[q.buyerId]?.reference}</small>
              </div>
            ) : order.orderIds[q.buyerId] ? (
              <>
                <p className="cg-payment-state"><Clock3 size={14}/>{t("Awaiting PayPal confirmation", "PayPal 완료 확인 대기")}</p>
                <button
                  className="cg-btn paypal"
                  disabled={order.paying !== null}
                  onClick={() => order.capture(q.buyerId)}
                >
                  {order.paying === q.buyerId ? (
                    <LoaderCircle className="cg-spin" size={16} />
                  ) : (
                    <ShieldCheck size={16} />
                  )}{" "}
                  {t("Check payment", "결제 확인")}
                </button>
                {order.quoteCurrent && order.orderUrls[q.buyerId] && (
                  <a
                    className="cg-text-link"
                    href={order.orderUrls[q.buyerId]}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {t("Reopen PayPal", "PayPal 다시 열기")}
                    <ArrowUpRight size={13} />
                  </a>
                )}
              </>
            ) : (
              <button
                className={`cg-btn ${order.paymentMode === "sample" ? "secondary" : "paypal"}`}
                disabled={
                  !order.allAgreed ||
                  !current.feasible ||
                  !order.quoteCurrent ||
                  order.paying !== null ||
                  (order.paymentMode === "sandbox" && !order.config.paypalReady)
                }
                onClick={() => order.pay(q.buyerId)}
              >
                {order.paying === q.buyerId ? (
                  <LoaderCircle size={16} className="cg-spin" />
                ) : (
                  <CreditCard size={16} />
                )}{" "}
                {order.paymentMode === "sample"
                  ? t("Complete sample step", "예시 결제 완료하기")
                  : t("Pay with PayPal", "PayPal로 결제")}
              </button>
            )}
          </article>
        ))}
      </div>
      <div className={`cg-checkout-summary ${reviewReady ? "complete" : ""}`}>
        <PackageCheck size={28} />
        <div>
          <h3>
            {reviewReady
              ? t(
                  "One shared plan. Still your own brand.",
                  "함께하는 제작, 여전히 나의 브랜드.",
                )
              : t(
                  "Every individual payment counts.",
                  "각자의 결제가 하나의 발주를 완성해요.",
                )}
          </h3>
          <p>
            {reviewReady
              ? t(
                  "Your production brief brings together the configuration, approvals and payment records. Nothing has been sent to a factory.",
                  "제작 요청서에서 구성·동의·결제 기록을 함께 확인할 수 있어요. 실제 공장에 발주를 전송하지는 않았어요.",
                )
              : t(
                  "A partial payment never marks the whole batch complete.",
                  "일부만 결제된 상태를 전체 완료로 표시하지 않아요.",
                )}
          </p>
        </div>
        <strong>
          {order.paidCount}
          <span>/{order.activeBuyers.length}</span>
        </strong>
      </div>
      <div className="cg-panel-actions">
        <span className="cg-small-note">
          {t(
            "Three buyer personas, operated by one person in this demo.",
            "한 사용자가 세 구매자 역할을 체험하는 데모예요.",
          )}
        </span>
        <button className="cg-btn primary" onClick={onBrief}>
          {t("View the production brief", "제작 요청서 보기")}
          <ArrowRight size={17} />
        </button>
      </div>
      {closingUnpaid && (
        <Dialog title={t("Close this unpaid quote?", "미결제 견적을 종료할까요?")} onClose={() => { if (!closeBusy) setClosingUnpaid(false); }}>
          <p>{t("We will check PayPal before closing this quote. CommonGround will no longer complete payment from this quote's existing order links.", "PayPal 상태를 확인하고 이 견적을 닫아요. 기존 주문 링크로는 CommonGround에서 결제 완료를 진행할 수 없어요.")}</p>
          <p>{t("If a payment is approved, pending, completed, or cannot be confirmed, the quote stays open for review. No refund is issued by this action.", "승인·보류·완료된 결제가 있거나 상태가 불확실하면 견적을 유지해요. 이 동작으로 환불을 진행하지 않아요.")}</p>
          <code className="cg-quote-reference">{quoteReference}</code>
          {closeError && <p className="cg-error" role="alert">{closeError}</p>}
          <div className="cg-dialog-actions">
            <button type="button" className="cg-btn ghost" disabled={closeBusy} onClick={() => setClosingUnpaid(false)}>{t("Keep this quote", "견적 유지")}</button>
            <button type="button" className="cg-btn primary" disabled={closeBusy} onClick={async () => {
              setCloseError("");
              if (await order.closeUnpaidQuote()) { setClosingUnpaid(false); onReplan(); }
              else setCloseError(t("The quote could not be safely closed. It remains open; check its payment state and try again when resolved.", "견적을 안전하게 종료하지 못해 그대로 유지했어요. 결제 상태를 확인하고 해결된 뒤 다시 시도해 주세요."));
            }}>{closeBusy ? <LoaderCircle className="cg-spin" size={16}/> : <ShieldCheck size={16}/>} {t("Check & close unpaid quote", "상태 확인 후 미결제 견적 종료")}</button>
          </div>
        </Dialog>
      )}
    </section>
  );
}

function ProductionBrief({
  order,
  onExport,
  onReview,
}: {
  order: Order;
  onExport: () => void;
  onReview: () => void;
}) {
  const { lang, current, scenario } = order;
  const t = (en: string, ko: string) => (lang === "en" ? en : ko);
  const accepted = getEffectiveConsent(scenario, "luma") === "accepted";
  const ledger = buildCheckoutSummary(current.buyerQuotes, order.receipts, order.paymentMode);
  const quoteReference = checkoutReference(order.paymentMode, order.quoteId, scenario.revision) ?? t("Not created yet", "견적 생성 전");
  const reviewReady = current.feasible && order.allAgreed && order.allPaid;
  return (
    <section className="cg-panel cg-brief">
      <div className="cg-brief-toolbar">
        <span className={`cg-pill ${reviewReady ? "positive" : ""}`}>{reviewReady ? t("READY FOR SUPPLIER REVIEW", "공급자 검토 준비됨") : t("DRAFT · NOT ALL STEPS COMPLETE", "초안 · 확인할 단계 남음")}</span>
        <div>
          <button className="cg-btn secondary small" onClick={() => window.print()}>
            <Printer size={15} />{t("Print / save as PDF", "인쇄 · PDF로 저장")}
          </button>
          <button className="cg-btn ghost small" onClick={onExport}>
            <Download size={15} />
            {t("Text record (.txt)", "원문 기록 (.txt)")}
          </button>
        </div>
      </div>
      <div className="cg-brief-identity"><div><span>{t("QUOTE REFERENCE", "견적 번호")}</span><code>{quoteReference}</code></div><div><span>{t("RECORD TYPE", "기록 구분")}</span><strong>{order.paymentMode === "sample" ? t("Sample · no transaction", "예시 · 실제 거래 없음") : t("PayPal Sandbox", "PayPal Sandbox")}</strong></div></div>
      <div className="cg-brief-heading">
        <span className="cg-brief-mark">cg.</span>
        <span className="cg-eyebrow">
          {t("SHARED PRODUCTION BRIEF", "함께 만드는 제작 요청서")}
        </span>
        <h2>
          {t("Different brands.", "다른 브랜드.")}
          <br />
          {t("One considered plan.", "함께 검토한 하나의 구성.")}
        </h2>
        <p>
          CG-001 · {t("Revision", "구성 버전")} {scenario.revision} ·{" "}
          {t("Fictional sample", "가상 예시")}
        </p>
      </div>
      <div className="cg-brief-status">
        <span className={current.feasible ? "done" : ""}>
          <CheckCircle2 size={15} />
          {t("Configuration", "제작 구성")}:{" "}
          {current.feasible ? t("agreed", "합의됨") : t("pending", "검토 중")}
        </span>
        <span className={order.allAgreed ? "done" : ""}>
          <Fingerprint size={15} />
          {t("Final approvals", "최종 동의")}:{" "}
          {order.activeBuyers.filter((b) => order.agreed[b.id]).length}/
          {order.activeBuyers.length}
        </span>
        <span>
          <CreditCard size={15} />
          {order.paymentMode === "sample"
            ? t("Sample steps", "예시 결제 단계")
            : "Sandbox"}
          : {order.paidCount}/{order.activeBuyers.length}
        </span>
      </div>
      <div className="cg-brief-section">
        <h3>{t("01 / The shared specification", "01 / 함께 제작할 사양")}</h3>
        <div className="cg-brief-spec-grid">
          <div>
            <span>{t("BASE VARIANTS", "상자 구성")}</span>
            <strong>
              {current.groups
                .map((g) => `${g.baseVariant} ${g.quantity}`)
                .join(" · ")}
            </strong>
          </div>
          <div>
            <span>{t("TOTAL QUANTITY", "총수량")}</span>
            <strong>
              {current.totalQuantity} {t("boxes", "개")}
            </strong>
          </div>
          <div>
            <span>{t("PRODUCTION", "제작 기간")}</span>
            <strong>{scenario.supplier.leadDays} {t("days", "일")}</strong>
          </div>
          <div>
            <span>{t("SAMPLE SUPPLIER", "예시 공급자")}</span>
            <strong>{scenario.supplier.name}</strong>
          </div>
        </div>
        <p>
          {accepted
            ? t(
                "LUMA accepted a kraft base with its own black branded sleeve. JUNIPER and FORMA retain their own labels.",
                "LUMA는 크라프트 상자와 블랙 브랜드 슬리브 구성에 동의했어요. JUNIPER와 FORMA는 각자의 라벨을 유지해요.",
              )
            : t(
                "Each active brand’s original base specification is retained unless a separate change has been approved.",
                "별도로 동의한 변경이 없다면 각 브랜드의 원래 상자 사양을 유지해요.",
              )}
        </p>
      </div>
      <div className="cg-brief-section">
        <h3>{t("02 / Each brand’s share", "02 / 각자의 주문과 금액")}</h3>
        <QuoteTable evaluation={current} lang={lang} />
        <p className="cg-brief-reconciliation">{order.paymentMode === "sample" ? t("Sample completion", "예시 완료분") : t("Verified Sandbox total", "검증된 Sandbox 합계")}: <strong>{money(ledger.completedCents)}</strong> · {t("Remaining", "남은 몫")}: <strong>{money(ledger.remainingCents)}</strong></p>
        <div className="cg-brief-records">
          {order.activeBuyers.map((buyer) => {
            const receipt = order.receipts[buyer.id];
            const range = getQuantityRange(buyer);
            return (
              <div key={buyer.id} className="cg-brief-record">
                <Avatar id={buyer.id} small />
                <div>
                  <strong>{buyer.name}</strong>
                  <p>
                    {range.min === range.max
                      ? t(
                          `Quantity fixed: ${buyer.quantity}`,
                          `고정 수량: ${buyer.quantity}개`,
                        )
                      : t(
                          `Permitted quantity: ${range.min}–${range.max}`,
                          `허용 수량: ${range.min}–${range.max}개`,
                        )}{" "}
                    ·{" "}
                    {order.agreed[buyer.id]
                      ? t(
                          `Final quote approved · revision ${scenario.revision}`,
                          `최종 견적 동의 · 버전 ${scenario.revision}`,
                        )
                      : t("Final approval pending", "최종 동의 대기")}
                  </p>
                  <small>
                    {receipt?.kind === "sandbox"
                      ? t(
                          `Verified Sandbox capture: ${receipt.reference}`,
                          `검증된 Sandbox 결제: ${receipt.reference}`,
                        )
                      : receipt
                        ? t(
                            "Sample complete · no PayPal transaction",
                            "예시 완료 · PayPal 거래 없음",
                          )
                        : t("No verified payment", "검증된 결제 없음")}
                  </small>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="cg-brief-section">
        <h3>
          {t(
            "03 / Before this becomes a real order",
            "03 / 실제 제작 전에 확인할 사항",
          )}
        </h3>
        <div className="cg-brief-checks">
          {[
            t("Dimensions and product fit", "상자 치수와 제품 적합성"),
            t("Material, finish and physical sample", "소재·마감·실물 샘플"),
            t("Brand artwork and print proof", "브랜드 인쇄 파일과 교정본"),
            t(
              "Supplier quote, taxes and delivery terms",
              "공급자 견적·세금·배송 조건",
            ),
          ].map((item) => (
            <span key={item}>
              <span className="cg-unchecked" />
              {item}
            </span>
          ))}
        </div>
        <p>
          {t(
            "Supplier confirmation is still required. This document records a sample configuration and does not place a manufacturing order.",
            "실제 공급자의 확인이 필요해요. 이 문서는 예시 구성을 정리한 초안이며 제조 발주를 전송하지 않아요.",
          )}
        </p>
      </div>
      <div className="cg-brief-signoff">
        <span>
          {t(
            "COMMON GROUND, INDIVIDUAL IDENTITIES.",
            "함께 만드는 조건, 각자의 아이덴티티.",
          )}
        </span>
        <button className="cg-btn ghost small" onClick={onReview}>
          {current.feasible
            ? t("Review approvals", "동의 내역 확인")
            : t("Return to planning", "구성 검토로 돌아가기")}
          <ArrowRight size={15} />
        </button>
      </div>
    </section>
  );
}

function DetailsDialog({
  kind,
  order,
  onClose,
  onArchive,
}: {
  kind: "connections" | "supplier" | "about" | "archive";
  order: Order;
  onClose: () => void;
  onArchive: () => Promise<void>;
}) {
  const t = (en: string, ko: string) => (order.lang === "en" ? en : ko);
  if (kind === "connections")
    return (
      <Dialog title={t("Connections", "연결 상태")} onClose={onClose}>
        <div className="cg-connection-row">
          <Sparkles size={22} />
          <div>
            <h3>{t("AI request interpretation", "AI 요청 해석")}</h3>
            <p>
              {order.config.aiReady
                ? t(
                    "Provider configured. A successful request is required before showing an AI result.",
                    "제공자가 설정되어 있어요. 실제 호출에 성공한 결과만 AI 결과로 표시해요.",
                  )
                : t(
                    "Not connected. The current plans use explicit supplier rules, with no live model call.",
                    "미연결 상태예요. 현재 구성은 실제 모델 호출 없이 명시된 공급 규칙으로 계산해요.",
                  )}
            </p>
          </div>
          <span className="cg-pill">
            {order.config.aiReady
              ? t("Configured", "설정됨")
              : t("Not connected", "미연결")}
          </span>
        </div>
        <div className="cg-connection-row">
          <CreditCard size={22} />
          <div>
            <h3>PayPal Sandbox</h3>
            <p>
              {order.config.paypalReady
                ? t(
                    "Test credentials configured. Verify each completed capture in the checkout flow.",
                    "테스트 인증 정보가 설정되어 있어요. 결제 흐름에서 각 결제 완료를 확인할 수 있어요.",
                  )
                : t(
                    "Not connected. Sample checkout is a local simulation, without PayPal transactions.",
                    "미연결 상태예요. 예시 결제는 PayPal 거래 없이 진행하는 로컬 체험이에요.",
                  )}
            </p>
          </div>
          <span className="cg-pill">
            {order.config.paypalReady
              ? t("Configured", "설정됨")
              : t("Not connected", "미연결")}
          </span>
        </div>
        <p className="cg-dialog-note">
          {t(
            "Credentials are configured securely outside the purchasing flow.",
            "인증 정보는 구매 화면 밖의 안전한 설정에서 연결해요.",
          )}
        </p>
      </Dialog>
    );
  if (kind === "archive")
    return (
      <Dialog
        title={t("Close this expired quote?", "만료된 견적 화면을 닫을까요?")}
        onClose={onClose}
      >
        <p className="cg-dialog-note">
          {t(
            "Existing Sandbox records remain attached to this quote. Starting a new sample does not cancel, refund or transfer payments. Check unfinished test payments in PayPal Sandbox.",
            "기존 Sandbox 기록은 이 견적에 유지돼요. 새 예시를 시작해도 결제를 취소·환불·이전하지 않아요. 미완료 테스트 결제는 PayPal Sandbox에서 확인해 주세요.",
          )}
        </p>
        <code className="cg-quote-reference">{order.quoteId}</code>
        <div className="cg-dialog-actions">
          <button className="cg-btn ghost" onClick={onClose}>
            {t("Keep this quote open", "이 화면 유지")}
          </button>
          <button className="cg-btn primary" onClick={onArchive}>
            {t("Start a new sample", "새 예시 시작")}
          </button>
        </div>
      </Dialog>
    );
  if (kind === "about")
    return (
      <Dialog
        title={t(
          "Small runs, made possible together.",
          "작은 제작이 함께 가능해지는 곳.",
        )}
        onClose={onClose}
      >
        <div className="cg-about-steps">
          {[
            {
              n: "01",
              en: "Start with the brand, not the order total.",
              ko: "주문 총량보다 각 브랜드의 조건에서 시작해요.",
              body: t(
                "Read what each buyer wants to preserve: look, quantity, budget and timing.",
                "지키고 싶은 외관, 필요한 수량, 예산과 제작 기간을 함께 읽어요.",
              ),
            },
            {
              n: "02",
              en: "Make the trade-offs visible.",
              ko: "함께 만들기 위해 바뀌는 것을 보여줘요.",
              body: t(
                "Compare compatible materials and quantity adjustments. A proposal is always different from consent.",
                "공통 소재와 수량 조정안을 비교해요. 제안만으로 동의한 것으로 처리하지 않아요.",
              ),
            },
            {
              n: "03",
              en: "Agree together. Pay individually.",
              ko: "조건에 합의하고, 각자의 금액을 결제해요.",
              body: t(
                "Each brand gets its own final quote and payment step, gathered into a shared production brief.",
                "각자의 최종 견적과 결제 기록이 하나의 제작 요청서로 모여요.",
              ),
            },
          ].map((step) => (
            <div key={step.n}>
              <span>{step.n}</span>
              <h3>{t(step.en, step.ko)}</h3>
              <p>{step.body}</p>
            </div>
          ))}
        </div>
        <p className="cg-dialog-note">
          {t(
            "This prototype uses three fictional buyer personas operated by one person. It is not a live multi-user marketplace.",
            "이 프로토타입은 한 사용자가 세 가상 구매자 역할을 체험하는 구조예요. 실제 여러 고객이 거래하는 마켓플레이스는 아니에요.",
          )}
        </p>
      </Dialog>
    );
  return (
    <Dialog
      title={t("The supplier rulebook", "이 예시의 공급 조건")}
      subtitle={t(
        "Common Box Studio · fictional supplier",
        "Common Box Studio · 가상 공급자",
      )}
      onClose={onClose}
    >
      <p className="cg-dialog-note">
        {t(
          "These transparent assumptions make the trade-offs testable. They are not verified supplier quotations.",
          "조율 과정을 검토하기 위해 공개한 예시 가정이에요. 실제 공급자가 확인한 견적은 아니에요.",
        )}
      </p>
      <p className="cg-dialog-note">
        {t(
          "All three briefs assume the same box format and dimensions. Only the base variant and branding differ. A real supplier must confirm shared production and any separate minimums for labels or sleeves.",
          "세 요청은 동일한 상자 형식과 치수를 사용하고, 기본 바탕과 브랜딩만 다른 것으로 가정해요. 실제로 함께 제작할 수 있는지와 라벨·슬리브의 별도 최소 수량은 공급자 확인이 필요해요.",
        )}
      </p>
      <div className="cg-rule-list">
        {[
          [t("Minimum per base variant", "상자 종류별 최소 주문량"), "100"],
          [
            t("Kraft / black base, per unit", "크라프트 / 블랙 상자 단가"),
            "$1.20 / $1.60",
          ],
          [t("Setup per base variant", "상자 종류별 준비비"), "$30.00"],
          [t("Own label, per unit", "개별 라벨 단가"), "$0.15"],
          [
            t("Black branded sleeve, per unit", "블랙 브랜드 슬리브 단가"),
            "$0.35",
          ],
          [t("Shipping to each brand", "브랜드별 배송비"), "$8.00"],
          [t("Production lead time", "제작 기간"), t("7 days", "7일")],
        ].map(([key, value]) => (
          <div key={key}>
            <span>{key}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <p className="cg-dialog-note">
        {t(
          "Only matching base variants share the minimum. Setup is allocated by quantity in integer cents. The sleeve replaces the label for LUMA. Taxes and transit time are not modeled.",
          "같은 기본 상자만 최소 주문량으로 합산해요. 준비비는 수량에 비례해 센트 단위로 배분하고, LUMA의 슬리브는 라벨을 대체해요. 세금과 배송 기간은 별도로 검토해야 해요.",
        )}
      </p>
      <details className="cg-supplier-evidence">
        <summary>{t("A real manufacturing-constraint example", "실제 제작 조건의 예")}<ChevronDown size={14}/></summary>
        <p>{t("Packhelp's Custom Rigid Magnetic Box lists a 20 × 20 × 9 cm option with a 120-unit minimum and increments of 30. This is one example of a product-specific production minimum.", "Packhelp의 Custom Rigid Magnetic Box는 20 × 20 × 9 cm 옵션에 최소 120개, 30개 단위 주문 조건을 안내해요. 제품별 최소 제작 수량이 있는 사례예요.")}</p>
        <a className="cg-text-link" href="https://packhelp.com/p/magnetic-box/custom/?sku=ph-432-13658" target="_blank" rel="noopener noreferrer">{t("View the supplier's product page", "공급자 상품 페이지 확인")}<ArrowUpRight size={13}/></a>
        <p>{t("Reference checked 8 Nov 2026. Our 100-unit, 7-day, $197 example is a separate fictional catalog. Shared production with different brands has not been verified for this product.", "2026년 11월 8일 확인한 참고 사례예요. 이 앱의 100개·7일·$197 조건은 별도의 가상 카탈로그이며, 해당 상품의 여러 브랜드 공동 제작 가능 여부는 확인되지 않았어요.")}</p>
      </details>
    </Dialog>
  );
}
