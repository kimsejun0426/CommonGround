"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ArrowRight, Check, CircleHelp, Fingerprint, LoaderCircle, Sparkles } from "lucide-react";
import type { BuyerId, Evaluation } from "@/lib/domain";
import type { NegotiationOption } from "@/lib/negotiation";

const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
const rangeLabel = (range: { min: number; max: number }) => range.min === range.max ? String(range.min) : `${range.min}–${range.max}`;

export default function NegotiationPanel({
  options,
  baselineEvaluation,
  lang,
  disabled,
  aiSelection,
  onApply,
}: {
  options: NegotiationOption[];
  baselineEvaluation: Evaluation;
  lang: "en" | "ko";
  disabled: boolean;
  aiSelection?: { optionId?: string; inputFingerprint?: string } | null;
  onApply: (option: NegotiationOption, approved: BuyerId[]) => Promise<void>;
}) {
  const t = (en: string, ko: string) => lang === "en" ? en : ko;
  const headingId = useId();
  const reviewRef = useRef<HTMLDivElement>(null);
  const mounted = useRef(true);
  const [review, setReview] = useState<{ optionId: string; fingerprint: string; approved: BuyerId[] } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const selected = options.find(option => option.id === review?.optionId && option.inputFingerprint === review.fingerprint);
  const suggested = options.find(option => option.id === aiSelection?.optionId && option.inputFingerprint === aiSelection?.inputFingerprint);
  const approved = selected ? review?.approved ?? [] : [];
  const complete = selected && selected.requiredApprovals.every(id => approved.includes(id));

  function choose(option: NegotiationOption) {
    setReview({ optionId: option.id, fingerprint: option.inputFingerprint, approved: [] });
    setError("");
    requestAnimationFrame(() => {
      reviewRef.current?.focus({ preventScroll: true });
      reviewRef.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "nearest" });
    });
  }

  async function save() {
    if (!selected || !complete || disabled || saving) return;
    setSaving(true);
    setError("");
    try {
      await onApply(selected, approved);
      if (mounted.current) setReview(null);
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : t("The reviewed conditions could not be saved.", "확인한 조건을 저장하지 못했어요."));
    } finally {
      if (mounted.current) setSaving(false);
    }
  }

  if (!options.length) return null;
  return (
    <section className="cg-panel cg-negotiation" aria-labelledby={headingId}>
      <div className="cg-negotiation-heading">
        <span className="cg-eyebrow">{t("A QUESTION COULD OPEN THE WAY", "함께할 방법을 여는 질문")}</span>
        <h2 id={headingId}>{t("What could each brand reconsider?", "각자 무엇을 조정할 수 있을까요?")}</h2>
        <p>{t("The saved conditions do not fit yet. These calculated comparisons show which new permissions could help.", "저장된 조건으로는 아직 맞지 않아요. 어떤 변경을 허용하면 가능해지는지 계산해 봤어요.")}</p>
      </div>
      <div className="cg-negotiation-options">
        {options.map(option => (
          <article className={`cg-negotiation-option ${selected?.id === option.id ? "selected" : ""} ${suggested?.id === option.id ? "suggested" : ""}`} key={option.id}>
            <div className="cg-negotiation-label">
              <span>{t("CONDITIONAL COMPARISON", "조건 변경을 가정한 비교")}</span>
              {suggested?.id === option.id && <span className="cg-negotiation-suggestion"><Sparkles size={13} />{t("AI suggests asking this first", "AI가 먼저 확인할 질문으로 선택")}</span>}
            </div>
            <h3>{option.title[lang]}</h3>
            <p>{option.question[lang]}</p>
            <dl className="cg-negotiation-quotes">
              {option.evaluation.buyerQuotes.map(quote => (
                <div key={quote.buyerId}>
                  <dt>{quote.buyerName}<small>{quote.quantity} {t("boxes", "개")}</small></dt>
                  <dd>{money(quote.totalCents)}<small>{t("incl. delivery", "배송비 포함")}</small></dd>
                </div>
              ))}
            </dl>
            <div className="cg-negotiation-total"><span>{option.evaluation.totalQuantity} {t("boxes together", "개 공동 제작")}</span><strong>{money(option.evaluation.totalCents)}</strong></div>
            <button type="button" className={`cg-btn ${selected?.id === option.id ? "secondary" : "primary"}`} disabled={disabled || saving} aria-expanded={selected?.id === option.id} onClick={() => choose(option)}>
              {selected?.id === option.id ? t("Reviewing these conditions", "이 조건을 확인하는 중") : t("Review this question", "이 질문 검토하기")}<ArrowRight size={15} />
            </button>
          </article>
        ))}
      </div>
      {selected && (
        <div className="cg-negotiation-review" ref={reviewRef} tabIndex={-1}>
          <div className="cg-negotiation-review-heading"><Fingerprint size={21} /><div><h3>{t("Each affected brand decides.", "변경되는 브랜드가 각각 확인해요.")}</h3><p>{selected.explanation[lang]}</p></div></div>
          <div className="cg-negotiation-changes">
            {selected.changes.map(change => {
              const quote = selected.evaluation.buyerQuotes.find(item => item.buyerId === change.buyerId)!;
              const baseline = baselineEvaluation.buyerQuotes.find(item => item.buyerId === change.buyerId);
              const difference = baseline ? quote.totalCents - baseline.totalCents : null;
              const needsPermission = selected.requiredApprovals.includes(change.buyerId);
              const checked = approved.includes(change.buyerId);
              return (
                <article className="cg-negotiation-change" key={change.buyerId}>
                  <div className="cg-negotiation-change-head"><strong>{change.buyerName}</strong><span>{quote.quantity} {t("boxes", "개")} · {money(quote.totalCents)}</span></div>
                  <dl>
                    <div><dt>{t("Requested quantity", "희망 수량")}</dt><dd>{change.fromQuantity} {t("boxes · stays saved", "개 · 저장값 유지")}</dd></div>
                    {selected.kind === "budget" ? (
                      <div><dt>{t("Budget limit to review", "검토할 예산 상한")}</dt><dd>{money(change.fromBudgetCents)} <ArrowRight size={12} /> <strong>{money(change.toBudgetCents)}</strong></dd></div>
                    ) : (
                      <div><dt>{t("Quantity range to review", "검토할 수량 범위")}</dt><dd>{rangeLabel(change.fromRange)} <ArrowRight size={12} /> <strong>{rangeLabel(change.toRange)} {t("boxes", "개")}</strong></dd></div>
                    )}
                    <div><dt>{t("This comparison", "이번 비교안")}</dt><dd>{change.fromQuantity === change.toQuantity ? t("Quantity unchanged", "수량 유지") : `${change.toQuantity - change.fromQuantity > 0 ? "+" : ""}${change.toQuantity - change.fromQuantity} ${t("boxes", "개")}`}{difference !== null && difference !== 0 && <> · {difference > 0 ? "+" : "−"}{money(Math.abs(difference))}</>}</dd></div>
                  </dl>
                  {needsPermission ? (
                    <label className={`cg-negotiation-permission ${checked ? "checked" : ""}`}>
                      <input type="checkbox" checked={checked} disabled={disabled || saving} onChange={event => setReview(previous => previous && previous.optionId === selected.id && previous.fingerprint === selected.inputFingerprint ? { ...previous, approved: event.target.checked ? [...previous.approved.filter(id => id !== change.buyerId), change.buyerId] : previous.approved.filter(id => id !== change.buyerId) } : previous)} />
                      <span>{selected.kind === "budget"
                        ? t(`As ${change.buyerName}, I allow a budget up to ${money(change.toBudgetCents)} including delivery.`, `${change.buyerName} 역할로, 배송비 포함 ${money(change.toBudgetCents)}까지 예산 변경을 허용해요.`)
                        : t(`As ${change.buyerName}, I allow proposals within ${rangeLabel(change.toRange)} boxes. I will review the exact quantity next.`, `${change.buyerName} 역할로, ${rangeLabel(change.toRange)}개 범위의 제안을 허용해요. 실제 수량은 다음 단계에서 확인해요.`)}</span>
                    </label>
                  ) : <p className="cg-small-note">{t("This quantity is already inside the saved range. The concrete allocation still needs approval.", "이미 저장된 허용 범위 안의 수량이에요. 구체적인 배분은 다음 단계에서 동의해야 해요.")}</p>}
                </article>
              );
            })}
          </div>
          <p className="cg-negotiation-basis">{t("Price differences compare the same shared base at the requested quantities. All amounts use the sample supplier's rules.", "금액 차이는 동일한 공통 상자에 원래 희망 수량을 적용한 비교안 기준이에요. 모든 금액은 예시 공급 조건으로 계산해요.")}</p>
          <div className="cg-negotiation-next"><CircleHelp size={16}/><p>{t("Saving opens these conditions for planning. Packaging changes, the chosen quantities, and each final quote still need their own review.", "저장하면 이 조건으로 구성을 검토해요. 포장 변경·실제 수량·각자의 최종 견적은 별도로 확인하고 동의해야 해요.")}</p></div>
          {error && <p className="cg-error" role="alert">{error}</p>}
          <div className="cg-negotiation-actions">
            <span>{approved.length}/{selected.requiredApprovals.length} {t("brands allow these conditions", "개 브랜드의 조건 변경 허용")}</span>
            <button type="button" className="cg-btn primary" disabled={!complete || disabled || saving} onClick={save}>{saving ? <LoaderCircle className="cg-spin" size={16}/> : <Check size={16}/>} {t("Save permissions & compare plans", "허용 조건 저장하고 구성 비교")}</button>
          </div>
        </div>
      )}
      <p className="cg-negotiation-disclosure">{t("Conditional estimates from a fictional supplier. One operator reviews each brand's role in this demo.", "가상 공급자의 조건부 예상금액이에요. 이 데모에서는 한 사용자가 각 브랜드의 역할로 검토해요.")}</p>
    </section>
  );
}
