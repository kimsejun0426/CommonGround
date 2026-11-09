# CommonGround judge walkthrough

## Open the live demo

Open CommonGround in English. The public sample lets you compare plans, review changes and complete a simulated checkout without an account. For actual OpenAI and PayPal actions, choose **Sign in with ChatGPT** on the hosted site. Each authenticated visitor gets their own workspace. Sandbox approval also requires a PayPal Sandbox buyer account. [CommonGround live demo](https://commonground-sejun-2026.pplower.chatgpt.site)

You can also run the project locally. Install from the checked-in lockfile, build the Worker, initialize a fresh local D1 database and launch the portable dev server. Follow the [repository setup instructions](../README.md#local-setup).

## Follow one shared order

One operator plays LUMA, JUNIPER and FORMA. The supplier, prices and requests are fictional. The example assumes the kraft cartons have compatible dimensions and construction.

1. Select **Compare shared plans**. LUMA requests 40 black cartons. JUNIPER and FORMA request 35 and 25 kraft cartons. Both carton types fall short of the supplier’s minimum of 100 per type.
2. Choose **$80 · quantities fixed**. A shared kraft carton with LUMA’s own black sleeve would cost LUMA $82 for 40 boxes. Its budget is $80. The app shows two possible requests for permission. One would raise LUMA’s budget. The other would change quantity boundaries for LUMA and FORMA.
3. Under **Keep every budget limit**, select **Review this question**. Approve the range for LUMA alone and check that saving remains disabled. Also approve FORMA, then select **Save permissions & compare plans**. The desired quantities remain 40, 35 and 25. LUMA now permits 38–40 and FORMA permits 25–27. The **$80 · two brands can adjust** preset is a separate shortcut that starts FORMA at 25–30.
4. Review the proposed quantities and prices below. Select **Review the changes together**, check the quantity changes and LUMA’s kraft carton with black sleeve, then select **Use the agreed configuration**. Approve two final quotes and check that checkout remains blocked. Approve the third quote.

   | Brand | Proposed quantity | Share, including delivery |
   | --- | ---: | ---: |
   | LUMA | 38 | $78.30 |
   | JUNIPER | 35 | $65.75 |
   | FORMA | 27 | $52.55 |
   | **Total** | **100** | **$196.60** |

5. Choose **Sample checkout** for the simulation. Use **Complete sample step** for LUMA. Check for one of three complete, $78.30 completed, and $118.30 remaining. Complete the other two steps. Check that the outstanding balance is $0.00.
6. Select **View the production brief**. Find the three quantities, three approvals and three sample records. Choose **Text record (.txt)** and compare the downloaded total with the checkout. You can also print the brief to PDF. In the English Chromium sample run the A4 output spanned two pages and retained all three prices, the $196.60 total and the sample labels. The brief is for supplier review. No order is sent to a factory.

**Standard case.** In a session without an unresolved Sandbox attempt, reset to the original $90 / $70 / $55 budgets. At quantities 40 / 35 / 25 the shared base yields $82.00 / $65.75 / $49.25, or $197.00. LUMA still decides whether to adopt the kraft carton. These totals describe two different allocations under synthetic prices.

## Exercise OpenAI on a configured server

1. Start from the standard case and open **Start with your words** for LUMA. Enter the following request.

   > Exactly 40 boxes, budget $80 including delivery, production within 10 days.

2. Choose **Read my brief**. After a successful response, inspect the source phrases for quantity 40, budget $80 and production time 10 days. The fixed quantity should stay exact. Choose **Apply reviewed values**, inspect the editor, then **Save & recheck the plans**.
3. Inspect the two computed questions. A successful guidance selection identifies one current card with **AI suggests asking this first**. Either choice can be valid. A separate test with an unavailable model displayed **AI guidance is unavailable for this request**, both rule-based choices and no AI suggestion badge.
4. To test a range instead, enter “I want 40 boxes and can accept 38–40 boxes, budget $80 including delivery, production within 10 days.” Review which original words support each bound. The range applies only to LUMA.

On November 9, 15 checks passed in the local Chromium → Worker → OpenAI → D1 flow. The English fixed quantity and Korean 38–40 range both reached review, application and save. For the fixed-quantity case, the model selected the $82 question and the server matched its evidence to the saved input. All three substitution decisions remained pending. Editing a request in flight also preserved the replacement text.

Interpretation and guidance share a limit of 20 outbound AI requests per signed-in user and 300 across the site each UTC day, including retries. When the daily budget is exhausted, enter values manually and continue through the rule-based questions, approvals and checkout. The AI budget resets at 00:00 UTC.

## Exercise PayPal on a configured server

Use a fresh run and finish the condition changes and final quote approvals from steps 1–4. In checkout, choose **PayPal Sandbox**. Use the designated Sandbox buyer account.

The two original dashboard accounts were a Korean Business seller and a Korean Personal buyer. The approval page reached email entry and showed no domestic-payment rejection. PayPal’s Korean FAQ states that payments between Korean-registered accounts are unavailable and that cross-border payments remain available. [PayPal Korea FAQ](https://www.paypal.com/kr/digital-wallet/system-enhancement-faq)

A US Personal Sandbox buyer was created for the cross-border test with the Korean Business seller. PayPal Developer confirmed creation and displayed the new US/Personal entry. The hosted run captured all three shares on one quote. When resuming an active quote, inspect its paid and outstanding shares before opening another order. [PayPal Sandbox accounts](https://developer.paypal.com/sandbox-testing/accounts)

1. Select **Pay with PayPal** for LUMA. Approve the order in PayPal, return to CommonGround and select **Check payment**.
2. Look for **Sandbox capture verified** and compare its amount with LUMA’s $78.30 share and the current quote. The remaining $118.30 belongs to JUNIPER and FORMA.
3. Reload and inspect the current quote and remaining shares. For a completed run, approve and check both remaining payments on that same quote. Compare the individual records and $196.60 total in the brief.

The CommonGround Merchant Sandbox app has been created and its two credentials are registered as server-side secrets. The hosted app created a Sandbox order for the $78.30 LUMA share and received a PayPal approval link with status `PAYER_ACTION_REQUIRED`. The buyer approved the order and returned to CommonGround. **Check payment** showed **Sandbox capture verified**. D1 recorded `COMPLETED`, USD 78.30, a capture reference and a verification time. It showed 1/3 paid with $118.30 outstanding. JUNIPER and FORMA then completed separate $65.75 and $52.55 captures on the same quote. The server verified three distinct order/capture pairs. The app displayed 3/3 complete, $196.60 verified and $0.00 remaining. Select **View the production brief**. In the verified hosted run it showed **Ready for supplier review** with three approvals, three Sandbox records, and 38, 35 and 27 cartons respectively. The V6 tests exercise the order and capture logic with injected provider responses. A sample reference beginning with `SAMPLE-` belongs to the simulation. Active payment attempts stay attached to their quote, and closing a quote does not refund a completed payment.
