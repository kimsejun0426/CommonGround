"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, ArrowUpRight, Box, Check, CheckCheck, CheckCircle2, ChevronRight, CircleHelp, CreditCard, FileCheck2, Fingerprint, Globe2, Info, Layers3, LoaderCircle, LockKeyhole, PackageCheck, Pencil, RotateCcw, Settings2, ShieldCheck, Sparkles, Users, X } from "lucide-react";
import { BrandBox } from "@/components/brand-box";
import { applyConsent, createDemoScenario, evaluateScenario, getEffectiveConsent, parseScenario, proposeScenario, updateBuyer } from "@/lib/engine";
import type { Buyer, BuyerId, BuyerPatch, Proposal, Scenario } from "@/lib/domain";
import type { GroundedAISelection } from "@/lib/ai-proposal";

type Lang = "en" | "ko";
type Phase = "requests" | "proposal" | "checkout";
type PublicConfig = { aiReady: boolean; paypalReady: boolean; paypalClientId?: string; mode: "sandbox" };
type ServerProposal = { proposalId: string; fingerprint: string; mode: "rules_demo" | "live_ai"; proposal: Proposal; aiSelection?: GroundedAISelection | null };
type Receipt = { kind: "sample" | "sandbox"; amountCents: number; reference: string };
type QuoteStatus = { quoteId: string; scenario: Scenario; approvedBuyerIds: BuyerId[]; proposalId: string; fingerprint: string; mode: "rules_demo" | "live_ai"; current: boolean; readyToProceed: boolean; payments: { buyerId: BuyerId; orderId: string; approvalUrl?: string | null; status: string; amountCents: number; captureId?: string; verified: boolean }[] };
const checkoutStorageKey = "commonground-active-quote";
function verifiedReceipts(status: QuoteStatus): Partial<Record<BuyerId, Receipt>> {
  return Object.fromEntries(status.payments.filter(payment => payment.status === "COMPLETED" && payment.verified && payment.captureId).map(payment => [payment.buyerId, { kind: "sandbox", amountCents: payment.amountCents, reference: payment.captureId! }]));
}
const initialConfig: PublicConfig = { aiReady: false, paypalReady: false, mode: "sandbox" };
const brandDescriptions = {
  luma: { en: "Thoughtful objects for everyday rituals.", ko: "일상의 순간을 위한 라이프스타일 브랜드." },
  juniper: { en: "Botanical care, made in small batches.", ko: "소량으로 만드는 보태니컬 케어 브랜드." },
  forma: { en: "Little accessories. Big personality.", ko: "작은 소품에 개성을 담는 디자인 브랜드." },
};
const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, { method: body === undefined ? "GET" : "POST", credentials: "same-origin", headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  let data: Record<string, unknown>;
  try { data = await response.json(); } catch { throw new Error("The server could not be reached. Please try again."); }
  if (!response.ok) {
    const error = data.error;
    throw new Error(typeof error === "string" ? error : typeof error === "object" && error && "message" in error ? String(error.message) : String(data.message || "This request could not be completed."));
  }
  return data as T;
}
function Wordmark() {
  return <a className="wordmark" href="/" aria-label="CommonGround home"><span className="wordmark-symbol"><span /><span /><span /></span><span>common<span className="wordmark-light">ground</span><span className="wordmark-period">.</span></span></a>;
}
function BrandAvatar({ id, small = false }: { id: BuyerId; small?: boolean }) {
  return <span className={"brand-avatar " + id + (small ? " small" : "")}>{id === "luma" ? "L" : id === "juniper" ? "J" : "F"}</span>;
}
function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog className="modal" ref={dialog} onCancel={onClose} onClick={event => { if (event.target === dialog.current) onClose(); }}><div className="modal-heading"><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="Close"><X size={20} /></button></div>{children}</dialog>;
}

export default function Workspace() {
  const [lang, setLang] = useState<Lang>("en");
  const [scenario, setScenario] = useState<Scenario>(createDemoScenario);
  const [phase, setPhase] = useState<Phase>("requests");
  const [config, setConfig] = useState<PublicConfig>(initialConfig);
  const [busy, setBusy] = useState(false);
  const [serverProposal, setServerProposal] = useState<ServerProposal | null>(null);
  const [calculationSource, setCalculationSource] = useState<"local" | "server" | "ai">("local");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [modal, setModal] = useState<"about" | "supplier" | "connections" | "edit" | "archive" | null>(null);
  const [editBuyer, setEditBuyer] = useState<BuyerId>("luma");
  const [agreed, setAgreed] = useState<Partial<Record<BuyerId, boolean>>>({});
  const [receipts, setReceipts] = useState<Partial<Record<BuyerId, Receipt>>>({});
  const [paymentMode, setPaymentMode] = useState<"sample" | "sandbox">("sample");
  const [quoteId, setQuoteId] = useState<string | null>(null);
  const [orderIds, setOrderIds] = useState<Partial<Record<BuyerId, string>>>({});
  const [orderUrls, setOrderUrls] = useState<Partial<Record<BuyerId, string>>>({});
  const [paying, setPaying] = useState<BuyerId | null>(null);
  const [serverReady, setServerReady] = useState(false);
  const [paypalReturn, setPaypalReturn] = useState<"return" | "cancel" | null>(null);
  const [quoteCurrent, setQuoteCurrent] = useState(true);
  const [restoring, setRestoring] = useState(true);
  const [restoreError, setRestoreError] = useState("");
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const panel = useRef<HTMLDivElement>(null);
  const t = (en: string, ko: string) => lang === "en" ? en : ko;
  const current = useMemo(() => evaluateScenario(scenario), [scenario]);
  const proposal = useMemo(() => proposeScenario(scenario), [scenario]);
  const preview = proposal.candidate ?? current;
  const activeBuyers = scenario.buyers.filter(buyer => buyer.active);
  const accepted = getEffectiveConsent(scenario, "luma") === "accepted";
  const declined = getEffectiveConsent(scenario, "luma") === "declined";
  const allAgreed = activeBuyers.length > 0 && activeBuyers.every(buyer => agreed[buyer.id]);
  const paidCount = activeBuyers.filter(buyer => receipts[buyer.id]).length;
  const allPaid = activeBuyers.length > 0 && paidCount === activeBuyers.length && (paymentMode === "sample" || serverReady);
  const hasOrders = Object.values(orderIds).some(Boolean);
  const shownEvaluation = phase === "requests" ? current : current.feasible ? current : preview;
  const showSubstitution = scenario.buyers.some(buyer => buyer.id === "luma" && buyer.active) && (accepted || !current.feasible);
  const aiSelection = serverProposal?.mode === "live_ai" ? serverProposal.aiSelection : null;
  useEffect(() => {
    api<PublicConfig>("/api/config").then(setConfig).catch(() => setConfig(initialConfig));
    const savedLanguage = localStorage.getItem("commonground-language");
    if (savedLanguage === "ko" || savedLanguage === "en") setLang(savedLanguage);
    const params = new URLSearchParams(window.location.search);
    setPaypalReturn(params.has("paypal") ? params.get("paypal") === "cancel" ? "cancel" : "return" : null);
  }, []);
  useEffect(() => {
    let cancelled = false;
    async function restoreCheckout() {
      setRestoring(true); setRestoreError("");
      const storedQuote = sessionStorage.getItem(checkoutStorageKey);
      if (!storedQuote || new URLSearchParams(window.location.search).has("paypal")) { setRestoring(false); return; }
      try {
        const status = await api<QuoteStatus>("/api/quotes/" + encodeURIComponent(storedQuote));
        const restoredScenario = parseScenario(status.scenario);
        if (cancelled) return;
        setScenario(restoredScenario); setQuoteId(status.quoteId); setQuoteCurrent(status.current);
        setServerProposal({ proposalId: status.proposalId, fingerprint: status.fingerprint, mode: status.mode, proposal: proposeScenario(restoredScenario) });
        setCalculationSource("server"); setPaymentMode("sandbox"); setPhase("checkout");
        setAgreed(Object.fromEntries(status.approvedBuyerIds.map(id => [id, true])));
        setOrderIds(Object.fromEntries(status.payments.filter(payment => payment.orderId).map(payment => [payment.buyerId, payment.orderId])));
        setOrderUrls(Object.fromEntries(status.payments.filter(payment => payment.approvalUrl && ["https://www.sandbox.paypal.com", "https://sandbox.paypal.com"].includes(new URL(payment.approvalUrl).origin)).map(payment => [payment.buyerId, payment.approvalUrl!])));
        setReceipts(verifiedReceipts(status)); setServerReady(status.readyToProceed);
      } catch (err) { if (!cancelled) setRestoreError(err instanceof Error ? err.message : "Could not restore the saved checkout."); }
      finally { if (!cancelled) setRestoring(false); }
    }
    restoreCheckout();
    return () => { cancelled = true; };
  }, [restoreAttempt]);
  useEffect(() => { document.documentElement.lang = lang; localStorage.setItem("commonground-language", lang); }, [lang]);
  useEffect(() => { if (!notice) return; const id = setTimeout(() => setNotice(""), 6000); return () => clearTimeout(id); }, [notice]);
  function scrollToPanel() { setTimeout(() => panel.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 70); }
  async function invalidateSnapshot() {
    if (serverProposal?.proposalId) await api("/api/proposals/" + serverProposal.proposalId + "/invalidate", {});
  }
  async function changeScenario(next: Scenario): Promise<boolean> {
    if (hasOrders) { setError(t("A Sandbox checkout is already in progress. Finish it before changing this order.", "Sandbox 결제가 진행 중이야. 현재 결제를 마친 뒤 주문을 변경해 줘.")); return false; }
    try {
      await invalidateSnapshot();
      setScenario(next); setServerProposal(null); setCalculationSource("local"); setAgreed({}); setReceipts({}); setQuoteId(null); setQuoteCurrent(true); setOrderIds({}); setOrderUrls({}); setServerReady(false); setError(""); sessionStorage.removeItem(checkoutStorageKey);
      if (phase === "checkout") setPhase("proposal");
      return true;
    } catch (err) { setError(err instanceof Error ? err.message : "Could not update the order."); return false; }
  }
  async function findFit() {
    setBusy(true); setError(""); setPhase("proposal"); scrollToPanel();
    try {
      const result = await api<ServerProposal>("/api/propose", { scenario });
      setServerProposal(result); setCalculationSource(result.mode === "live_ai" ? "ai" : "server");
    } catch {
      setServerProposal(null); setCalculationSource("local");
      setNotice(t("Showing a local sample calculation. Server-connected proposals are not available in this preview.", "현재는 로컬 예시 계산을 보여주고 있어. 서버 연결 제안은 이 미리보기에서 사용할 수 없어."));
    } finally { setBusy(false); }
  }
  async function decide(decision: "accepted" | "declined" | "pending") { await changeScenario(applyConsent(scenario, "luma", decision)); }
  async function reset() {
    if (hasOrders && !allPaid) { setError(t("Finish the active Sandbox checkout before starting a new sample.", "진행 중인 Sandbox 결제를 마친 뒤 새 예시를 시작해 줘.")); return; }
    if (!hasOrders) { try { await invalidateSnapshot(); } catch (err) { setError(err instanceof Error ? err.message : "Could not reset."); return; } }
    clearWorkspace();
  }
  function clearWorkspace() {
    setScenario(createDemoScenario()); setPhase("requests"); setServerProposal(null); setCalculationSource("local"); setAgreed({}); setReceipts({}); setQuoteId(null); setQuoteCurrent(true); setOrderIds({}); setOrderUrls({}); setPaying(null); setServerReady(false); setError(""); setPaymentMode("sample"); setNotice(""); sessionStorage.removeItem(checkoutStorageKey); window.scrollTo({ top: 0, behavior: "smooth" });
  }
  async function archiveExpiredQuote() {
    if (!quoteId) return;
    try {
      const status = await api<QuoteStatus>("/api/quotes/" + encodeURIComponent(quoteId));
      if (status.current) throw new Error(t("This quote is still active. Finish the existing checkout first.", "이 견적은 아직 유효해요. 진행 중인 결제를 먼저 마쳐 주세요."));
      sessionStorage.setItem("commonground-previous-quote", quoteId);
      clearWorkspace(); setModal(null);
      setNotice(t("A new sample has started. Previous Sandbox payment records are unchanged.", "새 예시를 시작했어요. 기존 Sandbox 결제 기록은 그대로 유지돼요."));
    } catch (err) { setError(err instanceof Error ? err.message : "Could not close this view."); setModal(null); }
  }
  async function ensureQuote(): Promise<string> {
    if (quoteId) return quoteId;
    const saved = await api<ServerProposal>("/api/propose", { scenario });
    setServerProposal(saved);
    const quote = await api<{ quoteId: string }>("/api/quotes", { proposalId: saved.proposalId, fingerprint: saved.fingerprint, scenario, approvedBuyerIds: activeBuyers.filter(buyer => agreed[buyer.id]).map(buyer => buyer.id) });
    setQuoteId(quote.quoteId);
    setQuoteCurrent(true); sessionStorage.setItem(checkoutStorageKey, quote.quoteId);
    return quote.quoteId;
  }
  async function pay(buyerId: BuyerId) {
    if (!allAgreed || !current.feasible || !quoteCurrent || paying !== null) return;
    const buyerQuote = current.buyerQuotes.find(item => item.buyerId === buyerId)!;
    if (paymentMode === "sample") { setReceipts(previous => ({ ...previous, [buyerId]: { kind: "sample", amountCents: buyerQuote.totalCents, reference: "SAMPLE-" + buyerId.toUpperCase() } })); return; }
    if (!config.paypalReady) { setModal("connections"); return; }
    setPaying(buyerId); setError("");
    const checkoutWindow = window.open("about:blank", "commonground-paypal", "width=520,height=760");
    try {
      const id = await ensureQuote();
      const order = await api<{ orderId: string; approvalUrl: string }>("/api/paypal/orders", { quoteId: id, buyerId });
      const approval = new URL(order.approvalUrl);
      if (approval.protocol !== "https:" || !["www.sandbox.paypal.com", "sandbox.paypal.com"].includes(approval.hostname)) throw new Error("The checkout did not return a valid PayPal Sandbox address.");
      setOrderIds(previous => ({ ...previous, [buyerId]: order.orderId }));
      setOrderUrls(previous => ({ ...previous, [buyerId]: approval.toString() }));
      if (checkoutWindow) checkoutWindow.location.href = approval.toString();
      else window.open(approval.toString(), "_blank", "noopener,noreferrer");
      setNotice(t("Approve in the PayPal Sandbox window, then return here to check and complete your payment.", "PayPal Sandbox 창에서 승인한 후 이 화면으로 돌아와 결제를 확인해 줘."));
    } catch (err) { checkoutWindow?.close(); setError(err instanceof Error ? err.message : "Checkout failed."); }
    finally { setPaying(null); }
  }
  async function capture(buyerId: BuyerId) {
    const orderId = orderIds[buyerId]; if (!quoteId || !orderId) return;
    setPaying(buyerId); setError("");
    try {
      await api("/api/paypal/orders/" + encodeURIComponent(orderId) + "/capture", { quoteId });
      const status = await api<QuoteStatus>("/api/quotes/" + quoteId);
      const fresh = verifiedReceipts(status);
      setReceipts(fresh); setServerReady(status.readyToProceed); setQuoteCurrent(status.current);
      if (!fresh[buyerId]) setNotice(t("PayPal has not confirmed a completed payment yet. No order has been marked paid.", "PayPal이 결제 완료를 아직 확인하지 않았어. 주문을 결제 완료로 표시하지 않았어."));
    } catch (err) { setError(err instanceof Error ? err.message : "Payment could not be confirmed."); }
    finally { setPaying(null); }
  }
  function choosePaymentMode(mode: "sample" | "sandbox") { if (hasOrders) return; setPaymentMode(mode); setReceipts({}); setServerReady(false); }
  if (restoring || restoreError) return <main className="return-page"><Wordmark /><div className="return-card"><LoaderCircle size={32} className={restoring ? "spin" : ""} /><h1>{t("Restoring your checkout", "진행 중인 결제 불러오기")}</h1><p>{restoreError || t("Checking the saved quote and verified payments with the server.", "저장된 견적과 확인된 결제 기록을 서버에서 불러오고 있어요.")}</p>{restoreError && <button className="primary-button" onClick={() => setRestoreAttempt(value => value + 1)}>{t("Try again", "다시 시도")}</button>}</div></main>;
  if (paypalReturn) return <main className="return-page"><Wordmark /><div className="return-card">{paypalReturn === "cancel" ? <Info size={44} /> : <CheckCircle2 size={44} />}<h1>{paypalReturn === "cancel" ? t("Checkout was cancelled", "결제창에서 취소했어요") : t("Back to your shared order", "공동발주로 돌아가기")}</h1><p>{t("Return to your original tab and select “Check & complete payment” to verify your PayPal result.", "원래 탭의 ‘승인 확인 및 결제 완료’를 눌러 PayPal 결과를 확인해 줘.")}</p><p className="muted">{t("Returning here is not proof of payment.", "이 화면으로 돌아온 것만으로 결제가 완료되지는 않아.")}</p><button className="primary-button" onClick={() => { if (window.opener) { window.opener.focus(); window.close(); } else { const savedQuote = new URLSearchParams(window.location.search).get("quoteId"); if (savedQuote) sessionStorage.setItem(checkoutStorageKey, savedQuote); window.location.href = "/"; } }}>{t("Return to original tab", "원래 탭으로 돌아가기")}<ArrowUpRight size={17} /></button></div></main>;
  return <div className="site-shell">
    <header className="site-header"><div className="header-inner"><Wordmark /><nav aria-label={t("Main navigation", "주요 메뉴")}><a href="#workspace" className="nav-active">{t("Workspace", "워크스페이스")}</a><button onClick={() => setModal("about")}>{t("How it works", "이용 방법")}</button></nav><div className="header-actions"><button className="language-button" onClick={() => setLang(lang === "en" ? "ko" : "en")}><Globe2 size={15} />{lang === "en" ? "한국어" : "English"}</button><button className="icon-button connections-button" onClick={() => setModal("connections")} aria-label={t("Connection status", "연결 상태")}><Settings2 size={18} /><span className={config.aiReady && config.paypalReady ? "connection-dot ready" : "connection-dot"} /></button><span className="profile-avatar">S</span></div></div></header>
    <main className="main-container">
      <section className="intro"><div className="intro-copy"><div className="eyebrow"><span className="tiny-line" />{t("SMALL BRANDS. BIG POSSIBILITIES.", "작은 브랜드가 함께 만드는 가능성")}</div><h1>{t("Your brand.", "브랜드는 그대로.")}<br /><span>{t("Our buying power.", "구매력은 함께.")}</span></h1><p>{t("Bring small orders together without losing what makes each one yours.", "각자의 개성을 지키면서, 작은 주문을 함께 가능한 발주로 만들어 보세요.")}</p><div className="intro-meta"><span><Users size={14} />{t("Three independent brands", "서로 다른 세 브랜드")}</span><span className="meta-separator" /><span><ShieldCheck size={14} />{t("Your terms. Your approval.", "내 조건에 맞게, 직접 동의하고")}</span></div></div><div className="intro-art" aria-hidden="true"><span className="art-orbit orbit-one" /><span className="art-orbit orbit-two" /><div className="hero-box hero-juniper"><BrandBox brand="juniper" /></div><div className="hero-box hero-forma"><BrandBox brand="forma" /></div><div className="hero-box hero-luma"><BrandBox brand="luma" shared /></div><span className="art-note"><span className="note-star">✦</span>{t("Different brands. Common ground.", "다른 브랜드, 함께할 수 있는 주문.")}</span></div></section>
      <section id="workspace" className="workspace">
        <div className="workspace-bar"><div className="workspace-title"><Layers3 size={19} /><h2>{t("The shared order", "함께 만드는 주문")}</h2><span className="sample-badge">{t("INTERACTIVE SAMPLE", "인터랙티브 예시")}</span></div><button className="text-button" onClick={reset} disabled={busy || paying !== null}><RotateCcw size={14} />{t("Start over", "처음부터")}</button></div>
        <div className="stepper" aria-label={t("Order progress", "주문 진행 단계")}>{([["requests", t("Bring your requests", "요청 모으기")], ["proposal", t("Find common ground", "함께할 조건 찾기")], ["checkout", t("Agree & pay your part", "동의하고 각자 결제")]] as [Phase, string][]).map(([key,label],index) => <button key={key} className={"step " + (phase === key ? "active" : "") + (index < (phase === "requests" ? 0 : phase === "proposal" ? 1 : 2) ? " passed" : "")} disabled={(key === "checkout" && !current.feasible) || busy || hasOrders} onClick={() => { if (key === "proposal" && phase === "requests") { findFit(); return; } setPhase(key); if (key !== "requests") scrollToPanel(); }}><span className="step-number">{index < (phase === "requests" ? 0 : phase === "proposal" ? 1 : 2) ? <Check size={13} /> : "0" + (index + 1)}</span>{label}<ChevronRight className="step-chevron" size={15} /></button>)}</div>
        <div className="section-heading"><div><span className="section-kicker">{t("THE PEOPLE BEHIND THE ORDER", "주문을 함께할 브랜드")}</span><h3>{t("A little different. Better together.", "각자의 개성을 함께 담아요.")}</h3></div><span className="count-pill">{activeBuyers.length} {t("brands", "개 브랜드")}<span />{current.totalQuantity} {t("boxes", "개")}</span></div>
        <div className="brand-grid">{scenario.buyers.map(buyer => { const quote = shownEvaluation.buyerQuotes.find(item => item.buyerId === buyer.id); return <article key={buyer.id} className={"brand-card " + buyer.id + (!buyer.active ? " inactive" : "")}><div className="brand-card-top"><BrandAvatar id={buyer.id} /><span className="brand-category">{buyer.id === "luma" ? t("Lifestyle goods", "라이프스타일") : buyer.id === "juniper" ? t("Botanical care", "보태니컬 케어") : t("Design accessories", "디자인 소품")}</span><button className="icon-button" aria-label={t("Edit ", "수정: ") + buyer.name} disabled={hasOrders || busy} onClick={() => { setEditBuyer(buyer.id); setModal("edit"); }}><Pencil size={14} /></button></div><div className="card-illustration"><BrandBox brand={buyer.id} shared={accepted} /><span className="product-label">{buyer.id === "luma" ? accepted ? t("Kraft + signature sleeve", "크라프트 + 블랙 슬리브") : t("Signature black", "시그니처 블랙") : t("Natural kraft + own label", "크라프트 + 자체 라벨")}</span></div><div className="brand-details"><h4>{buyer.name}<span>{buyer.id === "luma" ? "STUDIO" : buyer.id === "juniper" ? "& CO." : "GOODS"}</span></h4><p>{brandDescriptions[buyer.id][lang]}</p><div className="brand-facts"><div><span>{t("Quantity", "수량")}</span><strong>{buyer.quantity}<small> {t("boxes", "개")}</small></strong></div><div><span>{t("Budget", "예산")}</span><strong>{money(buyer.budgetCents)}</strong></div><div><span>{t("Needed in", "희망 납기")}</span><strong>{buyer.maxLeadDays}<small> {t("days", "일")}</small></strong></div></div></div><div className={"brand-card-footer " + (!buyer.active ? "" : current.feasible ? "ready" : "waiting")}><span className="status-dot" />{!buyer.active ? t("Not in this order", "이번 발주에서 제외") : phase === "checkout" && receipts[buyer.id] ? t("Payment step complete", "결제 단계 완료") : current.feasible ? t("Fits the shared order", "공동발주 조건 충족") : t("Needs a workable order", "발주 조건 조율 필요")}<span className="brand-footer-price">{phase !== "requests" && quote ? money(quote.totalCents) : ""}</span></div></article>; })}</div>
        <div className="working-panel" ref={panel} aria-live="polite">
        {error && <div className="alert error" role="alert"><Info size={18} /><p>{error}</p><button className="icon-button" aria-label="Dismiss error" onClick={() => setError("")}><X size={15} /></button></div>}
        {phase === "requests" && <div className="starting-grid"><div className="starting-problem"><div className="panel-eyebrow"><span className="amber-dot" />{t("A SHARED OPPORTUNITY", "함께 풀 수 있는 문제")}</div><h3>{t("Enough demand.", "수요는 충분해요.")}<br />{t("Just not the same order.", "아직 조건이 맞지 않을 뿐.")}</h3><p>{t("This sample supplier needs 100 of the same base box. Different base colours cannot simply be added together.", "예시 공급자는 같은 기본 상자 100개부터 제작해요. 기본 상자의 종류가 다르면 수량을 단순히 더할 수 없어요.")}</p><div className="moq-bars">{current.groups.map(group => <div className="moq-row" key={group.baseVariant}><div><span className={"material-dot " + group.baseVariant} />{group.baseVariant === "black" ? t("Black base", "블랙 기본 상자") : t("Kraft base", "크라프트 기본 상자")}<strong>{group.quantity}<span> / {group.moq}</span></strong></div><div className="meter-track"><span style={{ width: Math.min(100, group.quantity / group.moq * 100) + "%" }} /></div></div>)}</div><button className="subtle-link" onClick={() => setModal("supplier")}>{t("See the sample supplier rules", "예시 공급 조건 보기")}<ArrowUpRight size={13} /></button></div><div className="discovery-card"><div className="discovery-top"><span className="sparkle-icon"><Sparkles size={24} /></span><span className="mode-chip">{config.aiReady ? t("AI CONNECTED", "AI 연결됨") : t("RULES DEMO", "규칙 기반 데모")}</span></div><h3>{t("Let’s find a way", "함께 가능한")}<br />{t("to order together.", "방법을 찾아요.")}</h3><p>{t("Keep each brand’s priorities. Explore compatible options. Ask before anything changes.", "각 브랜드가 지키고 싶은 것은 그대로. 함께 가능한 구성을 찾고, 바뀌는 부분은 먼저 확인해요.")}</p><div className="discovery-promises"><span><Check size={13} />{t("Individual branding", "각자의 브랜딩")}</span><span><Check size={13} />{t("Personal budgets", "개인별 예산")}</span><span><Check size={13} />{t("Explicit approval", "명시적인 동의")}</span></div><button className="light-button" onClick={findFit} disabled={busy || activeBuyers.length === 0}>{t("Find a shared order", "함께할 주문 찾기")}<ArrowRight size={18} /></button><span className="discovery-note">{t("Illustrative prices. No payment is made.", "예시 가격을 사용하며, 결제는 진행되지 않아요.")}</span></div></div>}
        {phase === "proposal" && <div className="proposal-section"><div className="proposal-heading"><div><span className="section-kicker"><Sparkles size={13} />{t("FINDING COMMON GROUND", "함께할 조건 찾기")}</span><h3>{busy ? t("Checking what fits…", "가능한 구성을 확인하고 있어요…") : current.feasible ? t("Different identities. One shared order.", "각자의 개성을 담은 하나의 발주.") : declined ? t("Your choice comes first.", "고객의 선택이 우선이에요.") : proposal.feasibleIfAccepted ? t("One change could bring it together.", "한 가지 변경으로 함께할 수 있어요.") : t("A few conditions still need work.", "아직 맞춰야 할 조건이 있어요.")}</h3></div><span className="calculation-pill">{busy ? <LoaderCircle size={13} className="spin" /> : <ShieldCheck size={13} />}{calculationSource === "ai" ? t("AI + checked rules", "AI + 규칙 검증") : calculationSource === "server" ? t("Server-checked sample", "서버에서 검증한 예시") : t("Local sample calculation", "로컬 예시 계산")}</span></div>{busy ? <div className="loading-panel"><LoaderCircle className="spin" size={32} /><h4>{t("Matching materials, budgets and timing", "소재·예산·일정을 확인 중이에요")}</h4><p>{t("Every brand keeps control of its own order.", "각 브랜드가 자기 주문을 직접 선택해요.")}</p></div> : <>{aiSelection && <div className="modal-note grounded-ai"><Sparkles size={18} /><div><strong>{t("AI-selected guidance, checked against supplier rules", "공급 조건으로 검증한 AI 안내")}</strong>{aiSelection.question && <p>{aiSelection.question}</p>}<p>{aiSelection.explanation}</p></div></div>}{showSubstitution ? <div className="proposal-grid"><div className="change-visual"><div className="change-topline"><span className="change-label">{t("LUMA’S PACKAGING", "LUMA의 포장 구성")}</span><span className={accepted ? "approved-tag" : "approval-tag"}>{accepted ? <Check size={12} /> : <Fingerprint size={12} />}{accepted ? t("Change accepted", "변경 동의 완료") : declined ? t("Original kept", "기존 구성 유지") : t("Your approval needed", "변경 동의 필요")}</span></div><div className="before-after"><div><span className="before-label">{t("ORIGINAL REQUEST", "처음 요청")}</span><BrandBox brand="luma" /><p>{t("Black box + own label", "블랙 상자 + 자체 라벨")}</p></div><span className="change-arrow"><ArrowRight size={19} /></span><div><span className="after-label">{t("PROPOSED OPTION", "제안하는 구성")}</span><BrandBox brand="luma" shared /><p>{t("Kraft box + black branded sleeve", "크라프트 상자 + 블랙 브랜드 슬리브")}</p></div></div><div className="preserved-row"><span><Check size={13} />{t("Own logo", "자체 로고")}</span><span><Check size={13} />{t("Order quantity", "주문 수량")}</span><span><Check size={13} />{t("Black branded exterior", "블랙 브랜드 외관")}</span></div><div className="change-disclosure"><Info size={15} /><span>{t("The base material and unwrapped appearance change. A black sleeve carries LUMA’s own branding.", "기본 상자 소재와 슬리브를 벗긴 모습이 바뀌어요. 블랙 슬리브에 LUMA의 브랜딩을 담아요.")}</span></div></div><div className="agreement-card"><div className="assistant-heading"><span className="assistant-avatar"><Sparkles size={17} /></span><div><strong>CommonGround</strong><span>{calculationSource === "ai" ? t("AI purchasing assistant", "AI 구매 도우미") : t("Guided sample proposal", "예시 조건에 따른 제안")}</span></div></div><p className="assistant-message">{declined ? t("We’ll keep LUMA’s original black box. This combination is still below the supplier’s minimum. You can adjust a request or reconsider the sleeve option.", "LUMA의 원래 블랙 상자를 유지할게요. 이 조합은 아직 최소 주문량에 못 미쳐요. 요청을 조정하거나 슬리브 구성을 다시 검토할 수 있어요.") : accepted ? t("LUMA has accepted the kraft base with a black branded sleeve. Let’s check everyone’s total and confirm each order before checkout.", "LUMA가 크라프트 상자와 블랙 브랜드 슬리브 구성에 동의했어요. 각자의 금액과 조건을 확인한 뒤 결제로 진행해요.") : t("What if LUMA keeps its black branded look with a sleeve? The brands could share the kraft base, while keeping their own identity.", "LUMA의 블랙 브랜드 외관을 슬리브로 유지하면 어떨까요? 크라프트 기본 상자를 함께 주문하면서 각자의 개성을 담을 수 있어요.")}</p><div className="proposal-metrics"><div><span>{t("Shared base order", "공통 상자 수량")}</span><strong>{preview.totalQuantity}<small> {t("boxes", "개")}</small></strong></div><div><span>{t("Sample total", "예시 총금액")}</span><strong>{money(preview.totalCents)}</strong></div></div>{proposal.feasibleIfAccepted || accepted ? <div className="agreement-actions">{accepted ? <button className="secondary-button" disabled={hasOrders} onClick={() => decide("pending")}><RotateCcw size={14} />{t("Review this choice", "변경 동의 다시 검토")}</button> : <><button className="primary-button" onClick={() => decide("accepted")}><Check size={16} />{t("LUMA accepts this change", "LUMA: 이 변경에 동의")}</button><button className="text-button" onClick={() => decide("declined")}>{t("Keep the original", "원래 구성 유지")}</button></>}</div> : declined ? <button className="secondary-button" onClick={() => decide("pending")}>{t("Reconsider the option", "제안 다시 검토")}<ArrowRight size={15} /></button> : <div className="blocked-explanation"><Info size={17} />{t("This option doesn’t meet every active request. Adjust the conditions before agreeing.", "이 구성은 모든 요청을 충족하지 못해요. 조건을 먼저 조정해 주세요.")}</div>}</div></div> : <div className="modal-note"><ShieldCheck size={22} /><div><h4>{current.feasible ? t("The original configurations already fit.", "원래 구성으로 조건을 충족해요.") : t("Review the participating brands’ conditions.", "참여 브랜드의 조건을 확인해요.")}</h4><p>{current.feasible ? t("No packaging change is needed. Review each brand’s configuration and total below.", "포장 구성을 바꿀 필요가 없어요. 아래에서 각자의 구성과 금액을 확인해 주세요.") : t("There is no eligible packaging substitution for these active requests. Adjust the quantity, budget or production time.", "현재 참여 요청에 적용할 포장 변경안이 없어요. 수량·예산·제작 기간을 조정해 주세요.")}</p></div></div>}
        {(current.feasible || proposal.candidate) && <div className="quote-summary"><div className="quote-summary-heading"><h4>{t("Every brand, clearly accounted for.", "각 브랜드의 금액을 분명하게.")}</h4><span>{t("USD · shipping included · sample prices", "USD · 배송비 포함 · 예시 가격")}</span></div><div className="quote-table-wrap"><table className="quote-table"><thead><tr><th>{t("Brand", "브랜드")}</th><th>{t("Boxes", "상자")}</th><th>{t("Branding", "브랜딩")}</th><th>{t("Setup share", "준비비 배분")}</th><th>{t("Shipping", "배송")}</th><th>{t("Your total", "개인별 합계")}</th><th>{t("Within budget", "예산 충족")}</th></tr></thead><tbody>{(current.feasible ? current : preview).buyerQuotes.map(quote => <tr key={quote.buyerId}><td><BrandAvatar id={quote.buyerId} small />{quote.buyerName}<small>{quote.quantity} {t("units", "개")}</small></td><td>{money(quote.baseCents)}</td><td>{money(quote.brandingCents)}</td><td>{money(quote.setupCents)}</td><td>{money(quote.shippingCents)}</td><td className="quote-total">{money(quote.totalCents)}</td><td className={quote.withinBudget ? "within-budget" : "over-budget"}>{quote.withinBudget ? <Check size={14} /> : <X size={14} />}{money(quote.budgetCents)}</td></tr>)}</tbody></table></div><div className="quote-footnote"><Info size={13} />{t("Each base variant’s $30 setup cost is shared by quantity. Branding and delivery stay individual. Taxes are not modeled in this sample.", "기본 상자 종류별 준비비 $30는 수량에 비례해 배분해요. 브랜딩과 배송은 개별 계산하며, 이 예시에는 세금이 포함되지 않아요.")}</div></div>}
        {!current.feasible && <div className="constraint-list">{(proposal.feasibleIfAccepted && !declined ? [{ code: "CONSENT", message: t("LUMA’s approval is the remaining step before this shared order can proceed.", "LUMA의 변경 동의가 있어야 이 공동발주를 진행할 수 있어요.") }] : (declined ? current.issues : preview.issues)).map((issue,index) => <div key={issue.code + index}><Info size={15} /><span>{issue.message}</span></div>)}</div>}
        <div className="proposal-bottom"><button className="subtle-link" onClick={() => setModal("supplier")}><FileCheck2 size={15} />{t("Why this combination works", "이 조합이 가능한 근거")}</button><button className="primary-button" disabled={!current.feasible} onClick={() => { setPhase("checkout"); scrollToPanel(); }}>{t("Review & pay your part", "확인하고 각자 결제하기")}<ArrowRight size={17} /></button></div></>}</div>}
        {phase === "checkout" && <div className="checkout-section"><div className="proposal-heading"><div><span className="section-kicker"><CreditCard size={13} />{t("YOUR ORDER. YOUR APPROVAL.", "내 주문에 직접 동의하고")}</span><h3>{allPaid ? t("A shared order, brought together.", "함께할 주문이 완성됐어요.") : t("Together on terms. Separate at checkout.", "조건은 함께 맞추고, 결제는 각자.")}</h3></div><div className="checkout-mode"><button className={paymentMode === "sample" ? "selected" : ""} disabled={hasOrders} onClick={() => choosePaymentMode("sample")}>{t("Sample checkout", "예시 결제 체험")}</button><button className={paymentMode === "sandbox" ? "selected" : ""} disabled={hasOrders} onClick={() => choosePaymentMode("sandbox")}>PayPal Sandbox</button></div></div>
          <div className={"checkout-disclosure " + (paymentMode === "sample" ? "" : "paypal-disclosure")}><Info size={17} /><p>{paymentMode === "sample" ? t("Sample checkout simulates the steps only. No PayPal request is sent and no money moves. You are trying all three buyer personas.", "예시 결제는 진행 흐름만 체험해요. PayPal 요청이나 금전 이동은 없으며, 한 사용자가 세 구매자 역할을 체험해요.") : config.paypalReady ? t("Sandbox test payments only. Each payment is separate; the group becomes ready when every payment is confirmed.", "Sandbox 테스트 결제예요. 각 결제는 개별 처리되며, 모든 결제 완료가 확인되어야 공동발주가 준비 완료로 바뀌어요.") : t("PayPal Sandbox is not connected yet. You can review the order or use sample checkout while credentials are configured.", "PayPal Sandbox가 아직 연결되지 않았어요. 주문을 검토하거나 예시 결제로 흐름을 체험할 수 있어요.")}</p>{paymentMode === "sandbox" && !config.paypalReady && <button className="subtle-link" onClick={() => setModal("connections")}>{t("Connection details", "연결 안내")}<ArrowUpRight size={13} /></button>}</div>
          {!quoteCurrent && <div className="alert error"><Info size={18} /><p>{t("This quote has expired or changed. New payments are blocked. Existing test payments remain separate and are not automatically refunded.", "견적이 만료되었거나 변경되어 새 결제는 할 수 없어요. 기존 테스트 결제는 유지되며 자동 환불되지 않아요.")}</p><button className="text-button" onClick={() => setModal("archive")}>{t("Close this view", "이 견적 화면 닫기")}</button></div>}<div className="checkout-grid">{current.buyerQuotes.map(quote => <div className={"checkout-card " + (receipts[quote.buyerId] ? "paid" : "")} key={quote.buyerId}><div className="checkout-card-title"><BrandAvatar id={quote.buyerId} /><div><h4>{quote.buyerName}</h4><span>{quote.quantity} {t("branded boxes", "개 브랜드 상자")}</span></div>{receipts[quote.buyerId] && <CheckCircle2 className="paid-check" size={22} />}</div><div className="checkout-price">{money(quote.totalCents)}<span>USD</span></div><div className="checkout-spec"><span><Box size={14} />{quote.substitutionApplied ? t("Kraft + black branded sleeve", "크라프트 + 블랙 브랜드 슬리브") : quote.baseVariant === "black" ? t("Black + own brand label", "블랙 + 자체 브랜드 라벨") : t("Kraft + own brand label", "크라프트 + 자체 브랜드 라벨")}</span><span><PackageCheck size={14} />{t("Sample production time: ", "예시 제작 기간: ")}{quote.leadDays}{t(" days", "일")}</span><span><ShieldCheck size={14} />{t("Within your ", "예산 ")}{money(quote.budgetCents)}{t(" budget", " 이내")}</span></div><label className={"approval-checkbox " + (agreed[quote.buyerId] ? "checked" : "")}><input type="checkbox" checked={Boolean(agreed[quote.buyerId])} disabled={hasOrders || Boolean(receipts[quote.buyerId])} onChange={event => setAgreed(previous => ({ ...previous, [quote.buyerId]: event.target.checked }))} /><span>{t("I approve this configuration and my ", "이 구성과 개인별 금액 ")}<strong>{money(quote.totalCents)}</strong>{t(" total.", "에 동의해요.")}</span></label>{receipts[quote.buyerId] ? <div className="receipt"><CheckCheck size={17} /><span>{receipts[quote.buyerId]!.kind === "sample" ? t("Sample step complete", "예시 결제 단계 완료") : t("Sandbox payment confirmed", "Sandbox 결제 확인 완료")}</span><small>{receipts[quote.buyerId]!.reference}</small></div> : orderIds[quote.buyerId] ? <><button className="paypal-button" disabled={paying !== null} onClick={() => capture(quote.buyerId)}>{paying === quote.buyerId ? <LoaderCircle size={16} className="spin" /> : <ShieldCheck size={16} />}{quoteCurrent ? t("Check & complete payment", "승인 확인 및 결제 완료") : t("Check existing payment", "기존 결제 확인")}</button>{quoteCurrent && orderUrls[quote.buyerId] && <a className="subtle-link" href={orderUrls[quote.buyerId]} target="_blank" rel="noopener noreferrer">{t("Reopen PayPal Sandbox", "PayPal Sandbox 다시 열기")}<ArrowUpRight size={13} /></a>}</> : <button className={paymentMode === "sample" ? "secondary-button sample-pay-button" : "paypal-button"} disabled={!allAgreed || !quoteCurrent || paying !== null || (paymentMode === "sandbox" && !config.paypalReady)} onClick={() => pay(quote.buyerId)}>{paying === quote.buyerId ? <LoaderCircle size={16} className="spin" /> : paymentMode === "sample" ? <CreditCard size={15} /> : <LockKeyhole size={15} />}{paymentMode === "sample" ? t("Complete sample purchase", "예시 구매 완료하기") : t("Continue with PayPal", "PayPal로 계속하기")}</button>}</div>)}</div>
          <div className={"cohort-summary " + (allPaid ? "complete" : "")}><div className="cohort-icon">{allPaid ? <PackageCheck size={26} /> : <Users size={26} />}</div><div className="cohort-copy"><h4>{allPaid ? paymentMode === "sample" ? t("Sample shared order complete", "예시 공동발주 완료") : t("All Sandbox payments confirmed", "모든 Sandbox 결제 확인 완료") : !allAgreed ? t("Every brand agrees before checkout.", "모든 브랜드가 동의한 뒤 결제해요.") : t("Each payment moves the order forward.", "각자의 결제가 발주를 완성해요.")}</h4><p>{allPaid ? t("Distinct branding, one shared base. No manufacturing order has been sent.", "브랜딩은 각자, 기본 상자는 함께. 실제 제조 발주는 전송되지 않았어요.") : !allAgreed ? t("Review and approve each buyer’s final configuration and amount.", "각 구매자의 최종 구성과 금액을 확인하고 동의해 주세요.") : t("The group is ready only after every individual payment is complete.", "모든 개별 결제가 완료되어야 공동발주가 준비돼요.")}</p></div><div className="cohort-progress"><strong>{paidCount}<span> / {activeBuyers.length}</span></strong><span>{paymentMode === "sample" ? t("sample steps complete", "예시 결제 단계 완료") : t("payments confirmed", "결제 확인")}</span></div><div className="cohort-total"><span>{t("Shared order total", "공동발주 총금액")}</span><strong>{money(current.totalCents)}</strong></div></div>
          {allPaid && <div className="completion-note"><Sparkles size={15} /><span>{t("Small orders became one workable plan — with each brand’s identity intact.", "각자의 개성을 지키면서 작은 주문들을 함께 가능한 발주로 만들었어요.")}</span></div>}
        </div>}
        </div>
        <footer className="workspace-footer"><span><LockKeyhole size={13} />{t("Your choices stay in your control.", "변경은 언제나 고객의 선택으로.")}</span><button onClick={() => setModal("supplier")}>{t("Fictional supplier & sample pricing", "가상 공급자·예시 가격 안내")}<CircleHelp size={13} /></button></footer>
      </section>
      <section className="closing-line"><span className="mini-wordmark">cg.</span><p>{t("The power of a bigger order. The freedom of your own brand.", "함께 주문하는 힘, 내 브랜드를 지키는 자유.")}</p><span>{t("Built for the PayPal AI Hackathon", "PayPal AI Hackathon 출품 준비")}</span></section>
    </main>
    {notice && <div className="toast" role="status"><Info size={17} /><span>{notice}</span><button className="icon-button" onClick={() => setNotice("")} aria-label="Dismiss notice"><X size={15} /></button></div>}
    {modal === "archive" && <Modal title={t("Close this expired quote", "만료된 견적 화면 닫기")} onClose={() => setModal(null)}><p className="modal-body">{t("Your existing Sandbox payments stay recorded against this quote. Starting a new sample will not refund, cancel or transfer any payment. Review any unfinished test payment in your PayPal Sandbox account.", "기존 Sandbox 결제는 이 견적에 기록된 채 유지돼요. 새 예시를 시작해도 결제를 환불·취소·이전하지 않아요. 미완료 테스트 결제는 PayPal Sandbox 계정에서 확인해 주세요.")}</p><p className="modal-body">{t("Saved quote: ", "저장된 견적: ")}{quoteId}</p><div className="modal-actions"><button className="secondary-button" onClick={() => setModal(null)}>{t("Keep this view", "이 화면 유지")}</button><button className="primary-button" onClick={archiveExpiredQuote}>{t("Start a new sample", "새 예시 시작")}</button></div></Modal>}
    {modal === "edit" && <EditRequest buyer={scenario.buyers.find(buyer => buyer.id === editBuyer)!} lang={lang} aiReady={config.aiReady} onClose={() => setModal(null)} onSave={async patch => { const ok = await changeScenario(updateBuyer(scenario, editBuyer, patch)); if (!ok) throw new Error(t("The saved order could not be updated.", "저장된 주문을 수정하지 못했어.")); setModal(null); setNotice(t("Request updated. Previous approvals and sample purchases have been cleared.", "요청을 수정했어. 이전 동의와 예시 결제 상태를 초기화했어.")); }} />}
    {modal === "supplier" && <Modal title={t("The rules behind this sample", "이 예시의 공급 조건")} onClose={() => setModal(null)}><div className="modal-note"><Info size={18} /><p>{t("Common Box Studio and all three brands are fictional. These are transparent test assumptions, not a supplier’s verified quote.", "Common Box Studio와 세 브랜드는 가상 사례예요. 아래 조건은 테스트 가정이며, 실제 공급자가 확인한 견적이 아니에요.")}</p></div><div className="rule-list"><div><span>{t("Minimum per base variant", "기본 상자 종류별 최소 수량")}</span><strong>100 {t("boxes", "개")}</strong></div><div><span>{t("Kraft / black base", "크라프트 / 블랙 상자")}</span><strong>$1.20 / $1.60</strong></div><div><span>{t("Setup per base variant", "기본 상자 종류별 준비비")}</span><strong>$30.00</strong></div><div><span>{t("Individual brand label", "개별 브랜드 라벨")}</span><strong>$0.15 / {t("unit", "개")}</strong></div><div><span>{t("Black branded sleeve", "블랙 브랜드 슬리브")}</span><strong>$0.35 / {t("unit", "개")}</strong></div><div><span>{t("Shipping to each brand", "브랜드별 배송비")}</span><strong>$8.00</strong></div><div><span>{t("Production lead time", "제작 기간")}</span><strong>7 {t("days", "일")}</strong></div></div><h4 className="modal-subheading">{t("What can be shared", "함께 주문할 수 있는 부분")}</h4><p className="modal-body">{t("Only matching base boxes count toward the same minimum. Labels and sleeves are added separately. Setup is allocated by quantity; every cent is accounted for. A request change requires a new check and approval.", "동일한 기본 상자만 같은 최소 주문량으로 합산해요. 라벨과 슬리브는 별도로 추가하고, 준비비는 수량에 비례해 센트 단위로 배분해요. 요청이 바뀌면 다시 검토하고 동의해야 해요.")}</p></Modal>}
    {modal === "about" && <Modal title={t("Small orders. Shared possibilities.", "작은 주문이 함께 만드는 가능성")} onClose={() => setModal(null)}><div className="how-steps"><div><span>01</span><h4>{t("Bring your own priorities", "각자의 조건을 모아요")}</h4><p>{t("Each brand sets a quantity, budget and timing. Its branding stays its own.", "각 브랜드가 수량·예산·일정을 정해요. 브랜드의 개성은 그대로 유지해요.")}</p></div><div><span>02</span><h4>{t("Find a compatible option", "함께 가능한 구성을 찾아요")}</h4><p>{t("Check supplier rules and explore an allowed change. Nothing changes without approval.", "공급 조건을 확인하고 가능한 변경을 제안해요. 동의하기 전에는 변경하지 않아요.")}</p></div><div><span>03</span><h4>{t("Agree, then pay your part", "동의하고 내 몫을 결제해요")}</h4><p>{t("Review each total. Individual payments complete a shared order.", "각자의 금액을 확인하고 결제해 하나의 공동발주를 완성해요.")}</p></div></div><div className="modal-note"><Info size={17} /><p>{t("This first version is an owner-operated demo with three buyer personas. It is not yet a multi-user marketplace.", "첫 버전에서는 한 사용자가 세 구매자 역할을 체험해요. 아직 여러 사용자가 참여하는 실제 마켓플레이스는 아니에요.")}</p></div></Modal>}
    {modal === "connections" && <Modal title={t("Connections & demo status", "연결 및 데모 상태")} onClose={() => setModal(null)}><div className="connection-card"><span className="assistant-avatar"><Sparkles size={18} /></span><div><h4>{t("AI purchasing assistant", "AI 구매 도우미")}</h4><p>{config.aiReady ? t("AI provider configured. It reads your written request and selects guidance from validated sample rules. Every change requires your review.", "AI 제공자가 설정되어 있어요. 자연어 요청을 읽고 검증된 예시 규칙에서 안내를 선택해요. 변경 사항은 직접 확인해야 해요.") : t("Not connected. The current experience uses disclosed sample rules, with no live model call.", "미연결 상태예요. 현재는 실제 모델 호출 없이 공개된 예시 규칙으로 동작해요.")}</p></div><span className={config.aiReady ? "connection-status connected" : "connection-status"}>{config.aiReady ? t("Configured", "설정됨") : t("Not connected", "미연결")}</span></div><div className="connection-card"><span className="paypal-mark">P</span><div><h4>PayPal Sandbox</h4><p>{config.paypalReady ? t("Sandbox credentials configured. Test checkout is available after all brands agree.", "Sandbox 인증 정보가 설정되어 있어요. 모든 동의 후 테스트 결제를 사용할 수 있어요.") : t("Not connected. Sample checkout simulates steps and does not move money.", "미연결 상태예요. 예시 결제는 진행 단계만 체험하며 금전 이동은 없어요.")}</p></div><span className={config.paypalReady ? "connection-status connected" : "connection-status"}>{config.paypalReady ? t("Configured", "설정됨") : t("Not connected", "미연결")}</span></div><p className="modal-body">{t("The server integration is prepared for secure environment configuration. Credentials are never entered into the purchasing flow. Real factory fulfillment is outside this demo.", "서버 연동은 안전한 환경 설정으로 연결하도록 준비되어 있어요. 구매 화면에서 인증 키를 입력하지 않으며, 실제 공장 발주는 이 데모에 포함되지 않아요.")}</p></Modal>}
  </div>;
}

type Interpretation = { quantity: number | null; budgetCents: number | null; maxLeadDays: number | null; priorities: string[]; unsupportedRequirements: string[]; evidence: { quantity?: string; budget?: string; leadTime?: string } };
function EditRequest({ buyer, lang, aiReady, onClose, onSave }: { buyer: Buyer; lang: Lang; aiReady: boolean; onClose: () => void; onSave: (patch: BuyerPatch) => Promise<void> }) {
  const [quantity, setQuantity] = useState(String(buyer.quantity));
  const [budget, setBudget] = useState(String(buyer.budgetCents / 100));
  const [days, setDays] = useState(String(buyer.maxLeadDays));
  const [active, setActive] = useState(buyer.active);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [brief, setBrief] = useState("");
  const [interpreting, setInterpreting] = useState(false);
  const [interpretation, setInterpretation] = useState<Interpretation | null>(null);
  const t = (en: string, ko: string) => lang === "en" ? en : ko;
  async function interpret() {
    setInterpreting(true); setError(""); setInterpretation(null);
    try { const result = await api<{ interpretation: Interpretation }>("/api/interpret", { buyerId: buyer.id, text: brief }); setInterpretation(result.interpretation); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not read this request."); }
    finally { setInterpreting(false); }
  }
  return <Modal title={t("Edit ", "요청 수정: ") + buyer.name} onClose={onClose}><form onSubmit={async event => { event.preventDefault(); setError(""); setSaving(true); try { const q = Number(quantity), b = Math.round(Number(budget) * 100), d = Number(days); if (!Number.isInteger(q) || q < 1 || !Number.isSafeInteger(b) || b < 1 || !Number.isInteger(d) || d < 1) throw new Error(t("Enter a positive whole quantity and day count, and a valid budget.", "수량과 기간은 양의 정수로, 예산은 올바른 금액으로 입력해 주세요.")); await onSave({ quantity: q, budgetCents: b, maxLeadDays: d, active }); } catch (err) { setError(err instanceof Error ? err.message : "Invalid request."); } finally { setSaving(false); } }}>
    <details className="intent-details"><summary><Sparkles size={15} />{t("Describe your request in your own words", "원하는 주문을 말로 설명하기")}<span>{aiReady ? t("AI connected", "AI 연결됨") : t("AI connection needed", "AI 연결 필요")}</span></summary><label className="form-field"><span>{t("Your request", "구매 요청")}</span><textarea rows={3} maxLength={3000} value={brief} placeholder={t("I need 40 branded boxes, budget $90 including delivery, and production within 10 days.", "브랜드 상자 40개가 필요해요. 배송비 포함 90달러, 제작은 10일 이내면 좋겠어요.")} onChange={event => { setBrief(event.target.value); setInterpretation(null); }} /></label><button type="button" className="secondary-button" disabled={!aiReady || !brief.trim() || interpreting} onClick={interpret}>{interpreting ? <LoaderCircle className="spin" size={15} /> : <Sparkles size={15} />}{t("Read my request", "요청 읽기")}</button>{!aiReady && <p className="modal-body">{t("Connect the AI provider to use this feature. You can edit the fields below now.", "이 기능은 AI 연결 후 사용할 수 있어요. 지금은 아래 값을 직접 수정할 수 있어요.")}</p>}{interpretation && <div className="intent-review"><h4>{t("Review what the AI understood", "AI가 읽은 내용을 확인해요")}</h4><p>{t("Quantity: ", "수량: ")}{interpretation.quantity ?? "—"} · {t("Budget: ", "예산: ")}{interpretation.budgetCents !== null ? money(interpretation.budgetCents) : "—"} · {t("Days: ", "기간: ")}{interpretation.maxLeadDays ?? "—"}</p>{Object.entries(interpretation.evidence).map(([key,value]) => value && <blockquote key={key}>{value}</blockquote>)}{interpretation.priorities.length > 0 && <p><strong>{t("Your priorities: ", "중요한 조건: ")}</strong>{interpretation.priorities.join(" · ")}</p>}{interpretation.unsupportedRequirements.length > 0 ? <div className="form-error">{t("Needs clarification before use: ", "사용 전 확인이 필요해요: ")}{interpretation.unsupportedRequirements.join("; ")}</div> : <button type="button" className="secondary-button" onClick={() => { if (interpretation.quantity !== null) setQuantity(String(interpretation.quantity)); if (interpretation.budgetCents !== null) setBudget(String(interpretation.budgetCents / 100)); if (interpretation.maxLeadDays !== null) setDays(String(interpretation.maxLeadDays)); setInterpretation(null); }}>{t("Use these values in the form", "확인한 값을 입력란에 적용")}<Check size={14} /></button>}</div>}</details>
    <p className="modal-body">{t("Try a different quantity, a tighter budget, or a shorter deadline. The order will be checked again.", "수량·예산·납기를 바꿔 보세요. 새로운 조건으로 발주 가능 여부를 다시 계산해요.")}</p><label className="form-field"><span>{t("Quantity · boxes", "수량 · 개")}</span><input type="number" min="1" max="10000" step="1" required value={quantity} onChange={event => setQuantity(event.target.value)} /></label><label className="form-field"><span>{t("Maximum budget · USD", "최대 예산 · USD")}</span><input type="number" min="0.01" max="1000000" step="0.01" required value={budget} onChange={event => setBudget(event.target.value)} /></label><label className="form-field"><span>{t("Maximum production time · days", "최대 제작 기간 · 일")}</span><input type="number" min="1" max="365" step="1" required value={days} onChange={event => setDays(event.target.value)} /></label><label className="include-checkbox"><input type="checkbox" checked={active} onChange={event => setActive(event.target.checked)} />{t("Include this brand in the shared order", "이번 공동발주에 참여")}</label>{error && <p className="form-error" role="alert">{error}</p>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>{t("Cancel", "취소")}</button><button type="submit" className="primary-button" disabled={saving}>{saving ? <LoaderCircle size={15} className="spin" /> : <Check size={15} />}{t("Save & recalculate", "저장하고 다시 계산")}</button></div></form></Modal>;
}
