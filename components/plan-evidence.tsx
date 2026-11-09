import { ArrowRight, CheckCircle2, ChevronDown, CircleAlert, ShieldCheck } from "lucide-react";
import { buildPlanEvidence, type EvidenceGroup } from "@/lib/plan-evidence";
import type { PlanningOverview, PlanningPlan } from "@/lib/planning";

type Lang = "en" | "ko";
const amount = (cents: number) => new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD",
}).format(cents / 100);

function Group({ group, lang }: { group: EvidenceGroup; lang: Lang }) {
  const t = (en: string, ko: string) => lang === "en" ? en : ko;
  const name = group.baseVariant === "kraft" ? t("Kraft base", "크라프트 상자") : t("Black base", "검정 상자");
  return (
    <div className={`cg-evidence-group ${group.met ? "is-pass" : "is-fail"}`}>
      <div className="cg-evidence-group-top">
        <span>{name}</span>
        <strong>{group.quantity} <span>/ {group.minimum}</span></strong>
      </div>
      <div className="cg-evidence-meter" aria-hidden="true">
        <span className="cg-evidence-fill" style={{ width: `${group.fillPercent}%` }} />
      </div>
      <small>
        {group.met
          ? t("Production minimum met", "생산 최소 수량 충족")
          : t(`${group.shortfall} more needed for this material`, `이 소재로 ${group.shortfall}개 더 필요`)}
      </small>
    </div>
  );
}

function CheckLine({ pass, title, detail }: { pass: boolean; title: string; detail: string }) {
  const Icon = pass ? CheckCircle2 : CircleAlert;
  return (
    <li className={`cg-evidence-check ${pass ? "is-pass" : "is-fail"}`}>
      <Icon size={15} aria-hidden="true" />
      <div><strong>{title}</strong><span>{detail}</span></div>
    </li>
  );
}

export default function PlanEvidence({
  overview,
  plan,
  lang,
}: {
  overview: PlanningOverview;
  plan: PlanningPlan;
  lang: Lang;
}) {
  const t = (en: string, ko: string) => lang === "en" ? en : ko;
  const evidence = buildPlanEvidence(overview, plan);
  const ready = evidence.state === "ready-for-review";
  const comparison = evidence.originalMaterialComparison;
  const showQuantityComparison = Boolean(comparison && comparison.fewerTotalBoxesInSelectedPlan > 0);
  const StatusIcon = ready ? CheckCircle2 : CircleAlert;
  const headline = evidence.state === "empty"
    ? t("Add a brand to compare a batch.", "참여 브랜드를 선택하면 비교할 수 있어요.")
    : evidence.originalRequestFeasible
      ? t("The original request already fits.", "원래 요청도 생산 조건에 맞아요.")
      : ready
        ? t("See what makes this batch possible.", "이 발주가 가능해지는 조건을 확인하세요.")
        : t("See why this plan still needs work.", "이 계획에서 아직 맞지 않는 조건을 확인하세요.");
  return (
    <section className="cg-evidence" aria-label={t("Supplier-rule comparison", "공급 조건에 따른 비교")}>
      <div className="cg-evidence-header">
        <div>
          <span className="cg-eyebrow">{t("THE BATCH, BEFORE & AFTER", "발주 조건, 변경 전과 후")}</span>
          <h3>{headline}</h3>
        </div>
        <span className={`cg-evidence-status ${ready ? "is-pass" : "is-fail"}`}>
          <StatusIcon size={14} aria-hidden="true" />
          {ready ? t("Rules fit · review required", "수치 조건 충족 · 동의 필요")
            : evidence.state === "empty" ? t("No active brands", "참여 브랜드 없음")
              : t("Unresolved conditions", "해결할 조건 있음")}
        </span>
      </div>

      {evidence.state === "empty" ? (
        <p className="cg-evidence-empty">{t("No quantity, budget or production claim is made without an active buyer.", "참여 브랜드가 있어야 수량·예산·생산 조건을 검토할 수 있어요.")}</p>
      ) : <>
        <div className="cg-evidence-flow">
          <div className="cg-evidence-side">
            <div className="cg-evidence-side-heading">
              <span>{t("Original request", "원래 요청")}</span>
              <strong>{evidence.requestedTotal} {t("boxes", "개")}</strong>
            </div>
            {evidence.originalGroups.map((group) => <Group key={group.baseVariant} group={group} lang={lang} />)}
          </div>
          <ArrowRight className="cg-evidence-arrow" size={22} aria-hidden="true" />
          <div className="cg-evidence-side selected">
            <div className="cg-evidence-side-heading">
              <span>{t("Selected plan · estimate", "선택한 계획 · 예상")}</span>
              <strong>{evidence.selectedTotal} {t("boxes", "개")}</strong>
            </div>
            {evidence.selectedGroups.map((group) => <Group key={group.baseVariant} group={group} lang={lang} />)}
          </div>
        </div>

        {showQuantityComparison && comparison && (
          <>
            <div className="cg-evidence-metrics">
              <div className="cg-evidence-metric">
                <span>{t("Original materials at MOQ", "원래 소재별 최소 수량")}</span>
                <strong>{comparison.totalQuantity}<small>{t("boxes", "개")}</small></strong>
              </div>
              <div className="cg-evidence-metric">
                <span>{t("This proposed batch", "선택한 계획의 총수량")}</span>
                <strong>{evidence.selectedTotal}<small>{t("boxes", "개")}</small></strong>
              </div>
              <div className="cg-evidence-metric difference">
                <span>{t("Fewer total boxes", "비교안보다 적은 총수량")}</span>
                <strong>{comparison.fewerTotalBoxesInSelectedPlan}<small>{t("boxes", "개")}</small></strong>
              </div>
            </div>
            <p className="cg-evidence-footnote">
              {comparison.comparisonFitsBuyerRules
                ? t("Quantity comparison against meeting each original material’s minimum. Both plans still require final buyer approval.", "원래 소재별 최소 수량을 충족하는 안과의 수량 비교예요. 어느 안이든 최종 구매자 승인이 필요해요.")
                : t("The original-material MOQ scenario exceeds saved buyer conditions. It is a quantity comparison, not an approved alternative or a measured saving.", "원래 소재의 최소 수량을 맞춘 비교안은 저장된 구매 조건을 초과해요. 승인된 대안이나 실측 절감액이 아닌 수량 비교예요.")}
              {evidence.additionalUnitsByBuyer > 0 && evidence.reducedUnitsByBuyer > 0 && " " + t(
                `This plan also reallocates quantities: ${evidence.additionalUnitsByBuyer} extra and ${evidence.reducedUnitsByBuyer} fewer across individual brands.`,
                `선택한 계획에서는 브랜드별로 ${evidence.additionalUnitsByBuyer}개 추가·${evidence.reducedUnitsByBuyer}개 감소하는 조정도 있어요.`,
              )}
            </p>
          </>
        )}

        <details className="cg-evidence-details">
          <summary>
            <ShieldCheck size={17} aria-hidden="true" />
            <span>{ready ? t("Check each brand’s conditions", "브랜드별 조건 확인") : t("See what still needs to change", "아직 해결되지 않은 조건 확인")}</span>
            <ChevronDown size={16} aria-hidden="true" />
          </summary>
          {evidence.brands.map((buyer) => (
            <div className="cg-evidence-buyer" key={buyer.buyerId}>
              <div className="cg-evidence-buyer-heading">
                <strong>{buyer.name}</strong>
                <span>{buyer.quantityDelta === 0
                  ? t(`${buyer.proposedQuantity} boxes · unchanged`, `${buyer.proposedQuantity}개 · 수량 유지`)
                  : t(`${buyer.requestedQuantity} → ${buyer.proposedQuantity} boxes`, `${buyer.requestedQuantity} → ${buyer.proposedQuantity}개`)}</span>
              </div>
              <ul className="cg-evidence-checks">
                <CheckLine pass={buyer.quantityWithinBounds}
                  title={t("Quantity", "수량")}
                  detail={buyer.quantityWithinBounds ? t("Within saved quantity limits", "저장된 수량 조건 안") : t("Outside saved quantity limits", "저장된 수량 조건 초과")} />
                <CheckLine pass={buyer.withinBudget}
                  title={t("Budget", "예산")}
                  detail={t(`${amount(buyer.totalCents)} of ${amount(buyer.budgetCents)}`, `${amount(buyer.budgetCents)} 중 ${amount(buyer.totalCents)}`)} />
                <CheckLine pass={buyer.withinProductionTime}
                  title={t("Production time", "제작 기간")}
                  detail={t(`${buyer.productionDays} days · limit ${buyer.maximumProductionDays}`, `${buyer.productionDays}일 · 허용 ${buyer.maximumProductionDays}일`)} />
              </ul>
              {buyer.materialChangeDeclined ? (
                <p className="cg-evidence-approval is-fail">{t("This brand declined the material change. Its decision must be explicitly reopened before this plan can proceed.", "이 브랜드는 소재 변경을 거절했어요. 직접 변경 검토를 다시 열기 전에는 진행할 수 없어요.")}</p>
              ) : buyer.quantityApprovalRequired || buyer.materialApprovalRequired ? (
                <p className="cg-evidence-approval">
                  {buyer.quantityApprovalRequired && buyer.materialApprovalRequired
                    ? t("Quantity and material changes need this brand’s approval.", "이 브랜드의 수량·소재 변경 동의가 필요해요.")
                    : buyer.quantityApprovalRequired
                      ? t("The new quantity needs this brand’s approval.", "이 브랜드의 새 수량에 대한 동의가 필요해요.")
                      : t("The new material needs this brand’s approval.", "이 브랜드의 소재 변경 동의가 필요해요.")}
                  {!buyer.quantityWithinBounds && " " + t("Approval alone cannot widen a saved quantity limit.", "동의만으로 저장된 수량 범위를 넓힐 수는 없어요.")}
                </p>
              ) : null}
            </div>
          ))}
          <p className="cg-evidence-footnote">{t("Checks use the sample supplier rulebook. Every final itemized price still needs buyer approval; production is not booked.", "검사는 예시 공급 조건을 사용해요. 최종 세부 견적은 구매자가 각각 승인해야 하며, 생산은 예약되지 않아요.")}</p>
        </details>
      </>}
    </section>
  );
}
