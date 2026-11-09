"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from "react";
import { applyConsent, createDemoScenario, evaluateScenario, getEffectiveConsent, parseScenario, proposeScenario } from "@/lib/engine";
import type { BuyerId, Evaluation, Proposal, Scenario } from "@/lib/domain";
import type { GroundedAISelection } from "@/lib/ai-proposal";
import { ClientApiError, clientApi } from "@/lib/client-api";

export type Lang = "en" | "ko";
export type PaymentMode = "sample" | "sandbox";
export type CalculationSource = "local" | "server" | "ai";
export type BuyerApprovals = Partial<Record<BuyerId, boolean>>;
export type Receipt = { kind: PaymentMode; amountCents: number; reference: string };
export type PublicConfig = { aiReady: boolean; paypalReady: boolean; mode: "sandbox" };
export type ServerProposal = {
  proposalId: string; fingerprint: string; mode: "rules_demo" | "live_ai"; proposal: Proposal;
  aiSelection?: GroundedAISelection | null; expiresAt?: number;
  guidanceStatus?: "ready" | "not_configured" | "skipped" | "error" | "limited"; guidanceError?: string;
};
export type QuotePayment = {
  buyerId: BuyerId; orderId: string | null; paypalOrderId?: string | null; approvalUrl?: string | null;
  status: string; amountCents: number; totalCents?: number; captureId?: string | null; verified: boolean;
};
export type QuoteStatus = {
  quoteId: string; scenario: Scenario; approvedBuyerIds: BuyerId[]; proposalId: string; fingerprint: string;
  mode: "rules_demo" | "live_ai"; current: boolean; readyToProceed: boolean; payments: QuotePayment[];
  evaluation?: Evaluation; expiresAt?: number;
  cohortStatus?: "STALE" | "COMPLETED" | "PARTIALLY_PAID" | "UNPAID";
};
type CreatedOrder = { orderId: string; approvalUrl: string | null; status: string; verified?: boolean; paymentCompleted?: boolean };

export const CHECKOUT_STORAGE_KEY = "commonground-active-quote";
export const PREVIOUS_QUOTE_STORAGE_KEY = "commonground-previous-quote";
const INITIAL_CONFIG: PublicConfig = { aiReady: false, paypalReady: false, mode: "sandbox" };
const LONG_REQUEST = { timeoutMs: 55_000 };

export function sandboxApprovalUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return ["https://www.sandbox.paypal.com", "https://sandbox.paypal.com"].includes(url.origin) ? url.toString() : null;
  } catch { return null; }
}

/** Browser storage and return URL parameters never create a paid receipt. */
export function verifiedReceipts(status: QuoteStatus): Partial<Record<BuyerId, Receipt>> {
  const evaluation = evaluateScenario(parseScenario(status.scenario));
  return Object.fromEntries(status.payments.filter(payment => {
    const quote = evaluation.buyerQuotes.find(item => item.buyerId === payment.buyerId);
    return payment.status === "COMPLETED" && payment.verified && payment.captureId && quote && payment.amountCents === quote.totalCents;
  }).map(payment => [payment.buyerId, { kind: "sandbox", amountCents: payment.amountCents, reference: payment.captureId! }]));
}

function errorMessage(error: unknown, fallback: string): string { return error instanceof Error ? error.message : fallback; }
function storeQuoteReference(id: string): void {
  try { sessionStorage.setItem(CHECKOUT_STORAGE_KEY, id); }
  catch { throw new ClientApiError("Allow this site's session storage before starting Sandbox checkout so the saved payment can be recovered.", { code: "CHECKOUT_STORAGE_UNAVAILABLE" }); }
}

/** Mount once around the planner and checkout. This hook intentionally owns no modal or page phase. */
export function useOrderWorkspace() {
  const [lang, setLang] = useState<Lang>("en");
  const [scenario, setScenario] = useState<Scenario>(createDemoScenario);
  const [config, setConfig] = useState<PublicConfig>(INITIAL_CONFIG);
  const [serverProposal, setServerProposal] = useState<ServerProposal | null>(null);
  const [calculationSource, setCalculationSource] = useState<CalculationSource>("local");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [agreed, setAgreedState] = useState<BuyerApprovals>({});
  const [receipts, setReceipts] = useState<Partial<Record<BuyerId, Receipt>>>({});
  const [paymentMode, setPaymentMode] = useState<PaymentMode>("sample");
  const [quoteId, setQuoteId] = useState<string | null>(null);
  const [quoteExpiresAt, setQuoteExpiresAt] = useState<number | null>(null);
  const [orderIds, setOrderIds] = useState<Partial<Record<BuyerId, string>>>({});
  const [orderUrls, setOrderUrls] = useState<Partial<Record<BuyerId, string>>>({});
  const [paying, setPaying] = useState<BuyerId | null>(null);
  const [serverReady, setServerReady] = useState(false);
  const [quoteCurrent, setQuoteCurrent] = useState(true);
  const [restoring, setRestoring] = useState(true);
  const [restoreError, setRestoreError] = useState("");
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const [checkoutRecoveryStatus, setCheckoutRecoveryStatus] = useState<"checking" | "ready" | "unauthenticated" | "error" | "return_window">("checking");
  const [paypalReturn, setPaypalReturn] = useState<"return" | "cancel" | null>(null);
  const [shouldShowCheckout, setShouldShowCheckout] = useState(false);
  // An unresolved create attempt is locked even before PayPal returns an order ID.
  const [hasPaymentAttempt, setHasPaymentAttempt] = useState(false);
  const operation = useRef(false);
  const quoteIdRef = useRef<string | null>(null);
  const proposalRef = useRef<ServerProposal | null>(null);
  const scenarioRef = useRef(scenario);
  const hasOrdersRef = useRef(false);
  const approvalsRef = useRef(agreed);
  const t = (en: string, ko: string) => lang === "en" ? en : ko;

  const current = useMemo(() => evaluateScenario(scenario), [scenario]);
  const proposal = useMemo(() => proposeScenario(scenario), [scenario]);
  const activeBuyers = scenario.buyers.filter(buyer => buyer.active);
  const accepted = getEffectiveConsent(scenario, "luma") === "accepted";
  const declined = getEffectiveConsent(scenario, "luma") === "declined";
  const allAgreed = activeBuyers.length > 0 && activeBuyers.every(buyer => agreed[buyer.id]);
  const paidCount = activeBuyers.filter(buyer => receipts[buyer.id]).length;
  const allPaid = activeBuyers.length > 0 && paidCount === activeBuyers.length && (paymentMode === "sample" || serverReady);
  const hasOrders = hasPaymentAttempt || Object.values(orderIds).some(Boolean);
  const locked = restoring || Boolean(restoreError) || busy || paying !== null || hasOrders;
  const aiSelection = serverProposal?.mode === "live_ai" ? serverProposal.aiSelection ?? null : null;
  scenarioRef.current = scenario;
  approvalsRef.current = agreed;
  hasOrdersRef.current = hasOrders;

  const acceptStatus = useCallback((status: QuoteStatus) => {
    const restoredScenario = parseScenario(status.scenario);
    const fresh = verifiedReceipts(status);
    const savedProposal: ServerProposal = {
      proposalId: status.proposalId, fingerprint: status.fingerprint, mode: status.mode,
      proposal: proposeScenario(restoredScenario), expiresAt: status.expiresAt,
      ...(proposalRef.current?.proposalId === status.proposalId ? { aiSelection: proposalRef.current.aiSelection } : {}),
    };
    const ids = Object.fromEntries(status.payments.filter(payment => payment.orderId).map(payment => [payment.buyerId, payment.orderId!])) as Partial<Record<BuyerId, string>>;
    const urls = Object.fromEntries(status.payments.map(payment => [payment.buyerId, sandboxApprovalUrl(payment.approvalUrl)]).filter(([, url]) => url)) as Partial<Record<BuyerId, string>>;
    const attemptsExist = status.payments.some(payment => payment.status !== "NOT_STARTED" || Boolean(payment.orderId));
    scenarioRef.current = restoredScenario; quoteIdRef.current = status.quoteId; proposalRef.current = savedProposal;
    hasOrdersRef.current = attemptsExist;
    const approved = Object.fromEntries(status.approvedBuyerIds.map(id => [id, true])) as BuyerApprovals;
    approvalsRef.current = approved;
    setScenario(restoredScenario); setQuoteId(status.quoteId); setQuoteCurrent(status.current); setQuoteExpiresAt(status.expiresAt ?? null);
    setServerProposal(savedProposal); setCalculationSource(savedProposal.mode === "live_ai" && savedProposal.aiSelection ? "ai" : "server"); setPaymentMode("sandbox");
    setAgreedState(approved); setOrderIds(ids); setOrderUrls(urls); setHasPaymentAttempt(attemptsExist);
    setReceipts(fresh); setServerReady(status.readyToProceed); setShouldShowCheckout(true);
    return fresh;
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    clientApi<PublicConfig>("/api/config", undefined, { timeoutMs: 20_000, signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) setConfig(value); })
      .catch(() => { if (!controller.signal.aborted) setConfig(INITIAL_CONFIG); });
    try {
      const saved = localStorage.getItem("commonground-language");
      if (saved === "ko" || saved === "en") setLang(saved);
    } catch { /* Language persistence is optional. */ }
    const params = new URLSearchParams(window.location.search);
    setPaypalReturn(params.has("paypal") ? params.get("paypal") === "cancel" ? "cancel" : "return" : null);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    async function restoreCheckout() {
      setRestoring(true); setRestoreError(""); setCheckoutRecoveryStatus("checking");
      let stored: string | null = null;
      try {
        if (new URLSearchParams(window.location.search).has("paypal")) { setCheckoutRecoveryStatus("return_window"); return; }
        try { stored = sessionStorage.getItem(CHECKOUT_STORAGE_KEY); } catch { /* Server discovery does not depend on browser storage. */ }
        const active = await clientApi<{ checkout: QuoteStatus | null }>("/api/checkout/active", undefined, { signal: controller.signal });
        // The server's active checkout takes priority over a tab's older reference.
        let status = active.checkout;
        if (!status && stored) {
          try {
            status = await clientApi<QuoteStatus>("/api/quotes/" + encodeURIComponent(stored), undefined, { signal: controller.signal });
          } catch (cause) {
            if (!(cause instanceof ClientApiError) || cause.status !== 404 || cause.code !== "QUOTE_NOT_FOUND") throw cause;
            // This authenticated owner has no active checkout and cannot access the tab's old quote.
            try {
              if (sessionStorage.getItem(CHECKOUT_STORAGE_KEY) === stored) sessionStorage.removeItem(CHECKOUT_STORAGE_KEY);
            } catch { /* Tab storage is optional. */ }
          }
        }
        if (!controller.signal.aborted) {
          if (status) {
            acceptStatus(status);
            try { sessionStorage.setItem(CHECKOUT_STORAGE_KEY, status.quoteId); } catch { /* The authenticated server can recover it again. */ }
          }
          setCheckoutRecoveryStatus("ready");
        }
      } catch (cause) {
        if (!controller.signal.aborted) {
          if (cause instanceof ClientApiError && cause.status === 401) {
            setCheckoutRecoveryStatus("unauthenticated");
            // Keep a remembered checkout protected until its owner signs back in.
            if (stored) setRestoreError(cause.message);
          } else {
            setCheckoutRecoveryStatus("error");
            setRestoreError(errorMessage(cause, "Could not restore the saved checkout."));
          }
        }
      } finally { if (!controller.signal.aborted) setRestoring(false); }
    }
    void restoreCheckout();
    return () => controller.abort();
  }, [restoreAttempt, acceptStatus]);

  useEffect(() => {
    document.documentElement.lang = lang;
    try { localStorage.setItem("commonground-language", lang); } catch { /* Optional preference. */ }
  }, [lang]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 8_000);
    return () => clearTimeout(timer);
  }, [notice]);

  function refuseWhileWorking(allowOrders = false): boolean {
    if (operation.current || restoring || restoreError) return true;
    if (!allowOrders && hasOrdersRef.current) {
      setError(t("A Sandbox checkout is already in progress. Keep its quote unchanged until it is resolved.", "Sandbox 결제가 진행 중이야. 결제 상태를 확인할 때까지 견적을 변경할 수 없어."));
      return true;
    }
    return false;
  }
  function setAgreed(value: SetStateAction<BuyerApprovals>) {
    if (refuseWhileWorking()) return;
    setAgreedState(previous => {
      const next = typeof value === "function" ? value(previous) : value;
      approvalsRef.current = next;
      return next;
    });
  }
  async function invalidateSnapshot() {
    if (proposalRef.current?.proposalId) await clientApi("/api/proposals/" + encodeURIComponent(proposalRef.current.proposalId) + "/invalidate", {});
  }
  async function recoverProtectedCheckout(cause: unknown): Promise<boolean> {
    if (!(cause instanceof ClientApiError) || cause.code !== "CHECKOUT_IN_PROGRESS") return false;
    try {
      const active = await clientApi<{ checkout: QuoteStatus | null }>("/api/checkout/active");
      if (!active.checkout) throw new Error("The protected checkout could not be found. Retry recovery before changing the plan.");
      acceptStatus(active.checkout);
      try { sessionStorage.setItem(CHECKOUT_STORAGE_KEY, active.checkout.quoteId); } catch { /* Server recovery remains available. */ }
      setCheckoutRecoveryStatus("ready");
      setNotice(t("Recovered the Sandbox checkout already started in this workspace. Its payment records and quote were preserved.", "다른 탭에서 시작한 Sandbox 결제를 복구했어. 기존 결제 기록과 견적을 그대로 유지했어."));
    } catch (error) {
      setCheckoutRecoveryStatus("error"); setRestoreError(errorMessage(error, "Could not recover the protected checkout."));
    }
    return true;
  }
  function clearCheckoutState() {
    quoteIdRef.current = null; proposalRef.current = null; approvalsRef.current = {}; hasOrdersRef.current = false;
    setServerProposal(null); setCalculationSource("local"); setAgreedState({}); setReceipts({});
    setQuoteId(null); setQuoteExpiresAt(null); setQuoteCurrent(true); setOrderIds({}); setOrderUrls({}); setHasPaymentAttempt(false);
    setServerReady(false); setShouldShowCheckout(false); setError("");
    try { sessionStorage.removeItem(CHECKOUT_STORAGE_KEY); } catch { /* Authenticated server discovery remains authoritative. */ }
  }
  function clearWorkspace() {
    clearCheckoutState();
    const next = createDemoScenario(); scenarioRef.current = next; setScenario(next);
    setPaying(null); setPaymentMode("sample"); setNotice("");
  }
  async function changeScenario(next: Scenario): Promise<boolean> {
    if (refuseWhileWorking()) return false;
    operation.current = true; setBusy(true); setError("");
    try {
      const checked = parseScenario(next);
      await invalidateSnapshot();
      clearCheckoutState(); scenarioRef.current = checked; setScenario(checked);
      return true;
    } catch (cause) { await recoverProtectedCheckout(cause); setError(errorMessage(cause, "Could not update the order.")); return false; }
    finally { operation.current = false; setBusy(false); }
  }
  async function findFit(): Promise<ServerProposal | null> {
    if (refuseWhileWorking()) return null;
    operation.current = true; setBusy(true); setError("");
    try {
      // A newly activated proposal replaces any unstarted saved checkout.
      if (quoteIdRef.current) { await invalidateSnapshot(); clearCheckoutState(); }
      const saved = await clientApi<ServerProposal>("/api/propose", { scenario: scenarioRef.current }, LONG_REQUEST);
      proposalRef.current = saved; setServerProposal(saved); setCalculationSource(saved.mode === "live_ai" ? "ai" : "server");
      if (saved.guidanceStatus === "error") setNotice(t("AI guidance is unavailable. These are verified supplier-rule calculations, without an AI recommendation.", "AI 안내를 받지 못했어. AI 추천 대신 공급자 규칙으로 검증한 계산을 보여주고 있어."));
      if (saved.guidanceStatus === "limited") setNotice(t("Daily AI limit reached. You can still compare these plans and review permissions.", "AI 일일 한도에 도달했어요. 계속해서 구성을 비교하고 변경 조건을 검토할 수 있어요."));
      return saved;
    } catch (cause) {
      if (await recoverProtectedCheckout(cause)) return proposalRef.current;
      // Keep the private reference for later invalidation, but never relabel an older AI answer as this failed request.
      setServerProposal(null); setCalculationSource("local");
      setNotice(t("Showing a local sample calculation. A live server proposal was not returned.", "실제 서버 제안을 받지 못해 로컬 예시 계산을 보여주고 있어."));
      setError(errorMessage(cause, "Could not retrieve a server proposal."));
      return null;
    } finally { operation.current = false; setBusy(false); }
  }
  async function decide(decision: "accepted" | "declined" | "pending"): Promise<boolean> {
    try { return await changeScenario(applyConsent(scenarioRef.current, "luma", decision)); }
    catch (cause) { setError(errorMessage(cause, "Could not update the choice.")); return false; }
  }
  async function reset(): Promise<boolean> {
    if (refuseWhileWorking(true)) return false;
    if (hasOrdersRef.current && !allPaid) { setError(t("Resolve the existing Sandbox checkout before starting a new sample.", "기존 Sandbox 결제 상태를 확인한 뒤 새 예시를 시작해 줘.")); return false; }
    operation.current = true; setBusy(true);
    try {
      await invalidateSnapshot();
      if (quoteIdRef.current && hasOrdersRef.current) sessionStorage.setItem(PREVIOUS_QUOTE_STORAGE_KEY, quoteIdRef.current);
      clearWorkspace(); return true;
    } catch (cause) { setError(errorMessage(cause, "Could not reset the order.")); return false; }
    finally { operation.current = false; setBusy(false); }
  }
  async function archiveExpiredQuote(): Promise<boolean> {
    if (!quoteIdRef.current || refuseWhileWorking(true)) return false;
    operation.current = true; setBusy(true); setError("");
    try {
      const id = quoteIdRef.current;
      const status = await clientApi<QuoteStatus>("/api/quotes/" + encodeURIComponent(id));
      if (status.current) throw new Error(t("This quote is still active. Resolve its checkout first.", "이 견적은 아직 유효해. 기존 결제 상태를 먼저 확인해 줘."));
      // Only closes the active pointer. Immutable payments remain attached to the old quote.
      await invalidateSnapshot();
      sessionStorage.setItem(PREVIOUS_QUOTE_STORAGE_KEY, id);
      clearWorkspace();
      setNotice(t("A new sample has started. Previous Sandbox payments were not refunded, cancelled or transferred.", "새 예시를 시작했어. 기존 Sandbox 결제를 환불·취소·이전한 것은 아니야."));
      return true;
    } catch (cause) { setError(errorMessage(cause, "Could not close the expired quote.")); return false; }
    finally { operation.current = false; setBusy(false); }
  }

  async function closeUnpaidQuote(): Promise<boolean> {
    if (!quoteIdRef.current || refuseWhileWorking(true)) return false;
    operation.current = true; setBusy(true); setError("");
    const id = quoteIdRef.current;
    try {
      await clientApi("/api/quotes/" + encodeURIComponent(id) + "/close-unpaid", {}, LONG_REQUEST);
      try { sessionStorage.setItem(PREVIOUS_QUOTE_STORAGE_KEY, id); } catch { /* Immutable server records are retained. */ }
      clearCheckoutState();
      setNotice(t("The unpaid quote is closed. Your requests are kept; review and approve a new quote before paying.", "미결제 견적을 닫았어. 구매 조건은 유지했으니 새 견적을 검토하고 다시 동의해 줘."));
      return true;
    } catch (cause) {
      try { await refreshQuote(id); } catch { /* Keep existing references and lock until reconciliation. */ }
      setError(errorMessage(cause, "The quote could not be closed. Its payment records were preserved."));
      return false;
    } finally { operation.current = false; setBusy(false); }
  }

  async function ensureQuoteInternal(): Promise<string> {
    if (quoteIdRef.current) {
      if (!quoteCurrent) throw new Error(t("This quote expired or changed. New payments are blocked.", "견적이 만료되었거나 변경되어 새 결제를 할 수 없어."));
      storeQuoteReference(quoteIdRef.current);
      return quoteIdRef.current;
    }
    const next = scenarioRef.current;
    const evaluation = evaluateScenario(next);
    const approved = evaluation.buyerQuotes.filter(item => approvalsRef.current[item.buyerId]).map(item => item.buyerId);
    if (!evaluation.feasible || approved.length !== evaluation.activeBuyerCount) throw new Error(t("Approve every buyer's final configuration and price before checkout.", "모든 구매자의 최종 구성과 금액에 동의한 뒤 결제해 줘."));
    const saved = await clientApi<ServerProposal>("/api/propose", { scenario: next, guidance: false });
    proposalRef.current = saved; setServerProposal(saved); setCalculationSource(saved.mode === "live_ai" ? "ai" : "server");
    const status = await clientApi<QuoteStatus>("/api/quotes", {
      proposalId: saved.proposalId, fingerprint: saved.fingerprint, scenario: next, approvedBuyerIds: approved,
    });
    storeQuoteReference(status.quoteId);
    quoteIdRef.current = status.quoteId; setQuoteId(status.quoteId); setQuoteCurrent(status.current); setQuoteExpiresAt(status.expiresAt ?? null); setShouldShowCheckout(true);
    return status.quoteId;
  }
  async function ensureQuote(): Promise<string> {
    if (refuseWhileWorking(true)) throw new Error("The checkout is still being checked. Please wait.");
    operation.current = true; setBusy(true);
    try { return await ensureQuoteInternal(); }
    finally { operation.current = false; setBusy(false); }
  }
  async function refreshQuote(id: string): Promise<QuoteStatus> {
    const status = await clientApi<QuoteStatus>("/api/quotes/" + encodeURIComponent(id));
    acceptStatus(status);
    return status;
  }
  async function pay(buyerId: BuyerId): Promise<void> {
    if (refuseWhileWorking(true) || !allAgreed || !current.feasible || !quoteCurrent || receipts[buyerId]) return;
    const buyerQuote = current.buyerQuotes.find(item => item.buyerId === buyerId);
    if (!buyerQuote) return;
    if (paymentMode === "sample") {
      setReceipts(previous => ({ ...previous, [buyerId]: { kind: "sample", amountCents: buyerQuote.totalCents, reference: "SAMPLE-" + buyerId.toUpperCase() } }));
      setShouldShowCheckout(true); return;
    }
    if (!config.paypalReady) {
      setError(t("PayPal Sandbox is not configured. No payment was started.", "PayPal Sandbox가 연결되지 않았어. 결제를 시작하지 않았어."));
      setNotice(t("You can use the separately labeled sample checkout.", "별도로 표시된 예시 결제로 흐름을 체험할 수 있어.")); return;
    }
    operation.current = true; setPaying(buyerId); setError("");
    const checkoutWindow = window.open("about:blank", "commonground-paypal", "width=520,height=760");
    let paymentRequested = false;
    try {
      const id = await ensureQuoteInternal();
      paymentRequested = true; hasOrdersRef.current = true; setHasPaymentAttempt(true);
      const order = await clientApi<CreatedOrder>("/api/paypal/orders", { quoteId: id, buyerId }, LONG_REQUEST);
      if (!/^[A-Z0-9]{8,64}$/.test(order.orderId)) throw new Error("The server returned an invalid PayPal order reference.");
      setOrderIds(previous => ({ ...previous, [buyerId]: order.orderId }));
      if (order.paymentCompleted && order.verified) {
        await refreshQuote(id); checkoutWindow?.close(); return;
      }
      const approval = sandboxApprovalUrl(order.approvalUrl);
      if (!approval) throw new Error("The checkout did not return a valid PayPal Sandbox address.");
      setOrderUrls(previous => ({ ...previous, [buyerId]: approval }));
      if (checkoutWindow) checkoutWindow.location.href = approval;
      else window.open(approval, "_blank", "noopener,noreferrer");
      setNotice(t("Approve in PayPal Sandbox, then return to check and complete this same payment.", "PayPal Sandbox에서 승인한 뒤 돌아와 같은 결제를 확인하고 완료해 줘."));
    } catch (cause) {
      checkoutWindow?.close();
      if (!paymentRequested) await recoverProtectedCheckout(cause);
      if (paymentRequested && quoteIdRef.current) {
        try { await refreshQuote(quoteIdRef.current); }
        catch { setRestoreError(t("The payment result is uncertain. Retry the saved-checkout lookup before changing any order.", "결제 결과를 아직 확인할 수 없어. 주문을 변경하기 전에 저장된 결제 조회를 다시 시도해 줘.")); }
      }
      setError(errorMessage(cause, "Checkout could not be started."));
    } finally { operation.current = false; setPaying(null); }
  }
  async function capture(buyerId: BuyerId): Promise<void> {
    if (refuseWhileWorking(true)) return;
    const id = quoteIdRef.current;
    const orderId = orderIds[buyerId];
    if (!id || !orderId) return;
    if (!config.paypalReady) { setError(t("Connect PayPal Sandbox before checking this payment.", "이 결제를 확인하려면 PayPal Sandbox 연결이 필요해.")); return; }
    operation.current = true; setPaying(buyerId); setError("");
    try {
      const response = await clientApi<{ cohort: QuoteStatus }>("/api/paypal/orders/" + encodeURIComponent(orderId) + "/capture", { quoteId: id }, LONG_REQUEST);
      const fresh = acceptStatus(response.cohort);
      if (!fresh[buyerId]) setNotice(t("PayPal has not confirmed a completed payment yet.", "PayPal이 아직 결제 완료를 확인하지 않았어."));
    } catch (cause) {
      // A timed-out capture can still have completed remotely. Only the server's saved proof restores a receipt.
      try { await refreshQuote(id); } catch { /* Keep the immutable order reference and permit a later retry. */ }
      setError(errorMessage(cause, "Payment could not be confirmed."));
    } finally { operation.current = false; setPaying(null); }
  }
  function choosePaymentMode(mode: PaymentMode): boolean {
    if (refuseWhileWorking()) return false;
    if (mode !== "sample" && mode !== "sandbox") return false;
    if (paymentMode !== mode) { setPaymentMode(mode); setReceipts({}); setServerReady(false); setError(""); }
    return true;
  }
  function restoreRetry() {
    if (operation.current) return;
    setRestoring(true); setRestoreError(""); setRestoreAttempt(value => value + 1);
  }

  return {
    lang, scenario, config, serverProposal, calculationSource, busy, error, notice, agreed, receipts,
    paymentMode, quoteId, quoteExpiresAt, orderIds, orderUrls, paying, serverReady, quoteCurrent, restoring, restoreError, checkoutRecoveryStatus,
    paypalReturn, shouldShowCheckout, current, proposal, preview: proposal.candidate ?? current,
    activeBuyers, accepted, declined, allAgreed, paidCount, allPaid, hasOrders, locked, aiSelection,
    setLang, setAgreed, setError, setNotice, setShouldShowCheckout,
    changeScenario, findFit, decide, reset, ensureQuote, pay, capture, choosePaymentMode, restoreRetry, archiveExpiredQuote, closeUnpaidQuote,
  };
}

export type OrderWorkspace = ReturnType<typeof useOrderWorkspace>;
