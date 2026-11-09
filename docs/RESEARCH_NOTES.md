# CommonGround — research notes and limits

Reviewed: 2026-11-07. These sources inform the design; they do not establish CommonGround's efficacy, novelty, supplier coverage, or customer demand. The prototype's supplier, buyers, prices, and manufacturing conditions are synthetic.

The six papers below were inspected beyond their titles: methods, results, and stated limitations were checked in their original text. The 2021 paper is included deliberately because its industrial mechanism is directly relevant; it is not relabeled as recent AI research.

## 1. Customized orders can share a production process

**基于ERP与MES信息交互的板式定制家具揉单排产技术** / *Mixing and Scheduling Technology Based on Information Interaction between ERP and MES for Customized Panel-Furnitures* (2021).

Authors: 袁莹莹, 熊先青, 龚建钊. Affiliations: Nanjing Forestry University and Suofeiya Home Furnishing Hubei Co., Ltd. DOI: `10.12326/j.2096-9694.2020122`.

- Original: https://www.mckx.net/zh/article/doi/10.12326/j.2096-9694.2020122/?viewType=HTML
- Evidence: an industrial implementation case in a customized-furniture company.
- Method: combine compatible components from multiple orders using material, dimensions, process routes, edge-banding, capacity, and delivery constraints; later restore the individual orders for packing and delivery. ERP/MES synchronization supplies the production facts.
- Result: the paper reports improved scheduling after implementation. Its within-company before/after observations do not isolate a causal effect from other changes.
- Application: preserve separate branded outcomes while sharing a supplier-approved base process.
- Limit: furniture production inside one enterprise does not prove that unrelated packaging buyers will accept a shared batch. Our fictional packaging rules are not copied factory capabilities.

## 2. Give an LLM grounded candidate actions

**A Large Language Model-based multi-agent manufacturing system for intelligent shopfloors** (first preprint 2024; revised 2025).

Affiliations include Nanjing University of Aeronautics and Astronautics and Yangzhou University.

- Original PDF: https://arxiv.org/pdf/2405.16887
- Evidence: scheduling benchmarks plus a physical manufacturing laboratory in Wuxi, China.
- Method: machine agents report capability and state; heuristics generate reference choices; LLM modules reason about and check decisions.
- Result: in the reported FIFO condition, Hunyuan with reference answers reached 583.4 seconds makespan, versus 990.4 without reference answers. The competitive WINQ heuristic reached 594.6 seconds. Each condition was repeated five times.
- Application: supply explicit allowed configurations and deterministic checks before asking the model to explain a proposal.
- Limit: the large ablation gap is not a gain over the strongest non-LLM baseline. This is not a purchasing conversion experiment. Its reported output-error rate is not a general proof of correct manufacturing decisions.

## 3. Industrial recommendations need source-level checks

**IndustryBench: Probing the Industrial Knowledge Boundaries of LLMs** (2026).

Affiliation: Multimodal and Industrial AI Team, Taobao & Tmall, Alibaba Group.

- Original: https://arxiv.org/html/2605.10267v3
- Evidence: offline benchmark, not live procurement deployment.
- Method: 2,049 questions grounded in Chinese GB/T standards and industrial product records; score answer quality separately from source-contradicting safety violations.
- Result: external verification rejected 70.3% of candidate questions surviving earlier LLM filters. The highest adjusted score among the tested models was 2.083 on a 0–3 scale.
- Application: a plausible explanation must not override a supplier constraint. Keep the source of each permitted configuration visible.
- Limit: evaluated models answered without retrieval or tools. These results do not measure a grounded agent's transaction success or establish performance under non-Chinese standards.

## 4. Customer verification belongs before manufacturing

**A framework and implementation of the Customer-to-Manufacturer (C2M) paradigm** (2024).

Affiliations: Southern University of Science and Technology and Tsinghua AIR. DOI: `10.55092/am20240004`.

- Original: https://www.elspub.com/doi/10.55092/am20240004
- Full PDF: https://pdf.elspublishing.com/paper/journal/open/AM/2024/am20240004.pdf
- Evidence: a framework/review with a garment-customization laboratory implementation.
- Method: connect demand definition to product attributes, design, customer verification, manufacturing, and delivery; the case includes body estimation, pattern adjustment, and virtual try-on.
- Result: a laboratory implementation demonstrates the chain from customer input to production-oriented design data. It does not report measured commercial cost or conversion improvements.
- Application: ask the buyer to approve the changed specification, then use that specification as the basis for quotation and payment.
- Limit: not a production-scale or multi-buyer pooling study.

## 5. Supplier capability information matters, but text is not certification

**用户直连制造电商平台产品销量影响因素研究——以必要商城为例** (2023).

Authors: 华迎, 郭可欣, 杨科. Affiliation: School of Information, University of International Business and Economics. DOI: `10.13504/j.cnki.issn1008-2700.2023.04.006`.

- Original PDF: https://journal.cueb.edu.cn/docs/20230919125706591627.pdf
- Evidence: observational analysis of real Biyao marketplace data collected in 2021.
- Method: 21,930 panel observations covering 3,655 products from 116 factories; derive capability features from factory self-description and relate them to a sales proxy.
- Result: manufacturing/R&D capability signals and service-related factors were positively associated with the sales proxy; production duration was not statistically significant.
- Application: show the basis of a supplier capability claim alongside a proposed alternative.
- Limit: capability features come from text; sales are proxied by review-count changes. Association does not prove causation, actual audited capacity, or buyer willingness to wait for a shared batch.

## 6. Partial relevance is weaker than satisfying every condition

**ShopSimulator: Evaluating and Exploring RL-Driven LLM Agent for Shopping Assistants** (2026).

Affiliation: Alibaba Group.

- Original: https://arxiv.org/html/2601.18225v1
- Evidence: a simulator using real Taobao product records; simulated shoppers, not a customer conversion trial.
- Method: shopping tasks with explicit or gradually revealed requirements; compare partial matching with success on the complete requirement set.
- Result: the strongest evaluated model's complete-success rate remained below 35% in the main evaluation. Partial-match scores can conceal failures on detailed constraints.
- Application: count a CommonGround batch as feasible only when all required supplier and buyer conditions hold.
- Limit: the benchmark gives each task a target product. It does not evaluate mutually accepted redesigns, shared manufacturing, or group payments.

## Design conclusions — our interpretation

These are product design choices derived from the papers, not findings the papers directly tested:

1. **Supplier facts define the option space.** The model may explain or select within that space; it does not author new factory capabilities.
2. **The buyer owns the changed requirement.** Preserving a stated goal does not automatically make a new specification acceptable.
3. **Feasibility is joint.** Every quantity, base variant, budget, deadline, consent, and payment state matters. A high average score cannot compensate for a failed mandatory condition.

The demo makes one narrow assumption explicit: this fictional supplier permits a common kraft base with different approved branding treatments. Real use would require supplier confirmation of that exact capability, not a general inference from these papers.

## Evaluation plan for this prototype

Use deterministic fixtures to compare exact-spec matching, similarity-based grouping, and supplier-constrained proposals with explicit consent. Include a declined change, an unsupported configuration, insufficient quantity, a tight budget, an impossible deadline, and partial payment.

Record feasible cases found, false feasible results, changes without consent, and whether a question changes the attainable outcome. Keep synthetic evaluation separate from live API verification and from future customer research. No percentage improvement for CommonGround should appear until a reproducible test has actually measured it.
