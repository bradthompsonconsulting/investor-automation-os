# IAOS Build Spec — MAO Deal Calculator (FINAL)

**Target:** `app/src/pages/MaoCalculator.tsx` + supporting Netlify functions
**Route:** app.investorautomationos.com/mao-calculator (nav slot "MAO Calculator" already exists in the shell)
**Prereq reading:** `docs/IAOS_Master_Architecture_Reference_V7.txt` — this build is the V7 "MAO in interface" item.
**Auth:** Phase A wide-open, single-tenant (existing Location API key via server-side proxy). No gating/login in this build.
**Build style:** Largest page yet. Build in the phases below, verify each phase before moving on, commit once verified end-to-end.

---

## 0. CORE PRINCIPLE (governs everything)

**The calculator is STANDALONE. It always calculates with zero GHL involvement.**

Open the page, type any numbers, get live MAO / margin / flip analysis — no contact, no search, no login. It is a fully functional calculator on its own (usable as a pure scratchpad).

**GHL is an OPTIONAL additive layer:**
- **Search → Prepopulate** only fills fields when the user chooses to search and select an existing contact.
- **Save Offer to GHL** is only enabled when a contact is linked via search.

No contact linked = the calc still works fully; you just can't prepopulate or save. That's the only difference. Never make a GHL contact a requirement for calculating.

**No "Create New Contact" anywhere.** The calc never creates contacts. It only reads from / saves to contacts that already exist in GHL (via search). If a lead isn't in GHL, the user creates them on the Contacts page first. This is NOT because a contact is required to calculate — it's that the calc never writes NEW contacts.

---

## 1. CONTEXT / REUSE

- GHL Location ID: `jmHG4B8RdzwpfqruNf68`
- Reuse the shared `app/src/lib/ghl.ts` + ghl-proxy pattern (token server-side, same as Contacts/Segmentation/Pipeline). Never client-side.
- Reference the existing `mao-webhook.ts` for field handling; this page does its own reads/writes via the proxy.
- Repair bid sheet data: place the provided JSON at `app/src/data/repair_bid_sheet.json` (12 categories, ~120 items with unit costs).

**Known SOURCE custom field IDs (prepopulate FROM these; never overwrite them on save):**
| Field | Object | ID |
|---|---|---|
| ARV | Opportunity | `cBkygqcHRseZUGCYYeba` |
| MAO | Opportunity | `Atu5XCjpFElY8H64VG4h` |
| Repair Estimate | Opportunity | `hId4Yog6u5GP1Iwz1aNx` |
| Wholesale Fee % | Opportunity | `RS2trZUHrZwaGxadLvHB` |
| Assignment Fee Target | Opportunity | `xwbPw1JVkgJevJTPNmxa` |
| Closing Costs | Opportunity | `N8Aa9t1SZhU7XnPPzxWk` |
| MAO Viability Flag | Contact | `o87cyzuCyScbY72VrOmq` |

---

## 2. FORMULAS

### 2a. Wholesale MAO (IAOS — unchanged)
```
MAO = (ARV × wholesale_pct / 100) − repair_total − assignment_fee
```
Default `wholesale_pct` = **70** (keep 70, NOT FMTM's 75 — we take a wholesale cut FMTM does not). Viability: `viable = MAO > (closing_costs + assignment_fee)`.

### 2b. Deal Summary — Potential Margin (net win/loss) — CORRECTED
The "what's on the bone for the BUYER" number — **your wholesale cut comes out FIRST**, so it's what a cash buyer nets after paying you:
```
potential_margin =
    ARV
  − offer_to_seller
  − wholesale_fee            ← your cut removed first
  − repair_total
  − holding_costs
  − financing_costs
  − selling_costs
  − other_costs              ← catch-all line (§2e)
```
Empty flip inputs = 0, so quick wholesale use reduces to `ARV − offer − wholesale_fee − repairs`. GREEN when ≥ 0, RED when < 0. Screenshot-ready buyer-marketing number.

### 2c. FMTM flip cost formulas (EXACT — transcribed from FMTM "Quick bid" sheet)
```
all_in_cost      = offer_to_seller + repair_total + purchase_closing_costs
purchase_closing = offer_to_seller × 2%        (FMTM "Rate" field, default 0.02 — editable)
escrow_deposit   = min(offer_to_seller × 1%, $1,000)   (informational context)
holding_costs    = (utilities_monthly + insurance_yearly/12 + taxes_yearly/12) × hold_months
selling_costs    = ARV × 5% (realtor) + ARV × 1.23% (sale escrow)
total_project_cost = all_in_cost + holding_costs + selling_costs + other_costs
```
> Utilities entered MONTHLY; insurance and taxes entered YEARLY and ÷12 (per FMTM). Keep labels exact.

### 2d. Financing types
**CASH (FMTM exact):**
```
cash_profit = ARV − selling_costs − all_in_cost
cash_roi    = cash_profit / all_in_cost         (guard /0 → "—")
```

**HARD MONEY (FMTM exact):**
```
total_borrowed   = min(all_in_cost, lender_LTV × ARV)
monthly_pmt      = total_borrowed × lender_rate / 12
cost_of_points   = total_borrowed × lender_points% / 100
total_money_cost = (monthly_pmt × hold_months) + lender_addl_fees + cost_of_points
hm_profit        = cash_profit − total_money_cost
hm_roi           = hm_profit / all_in_cost
cash_needed_up   = (1 − lender_LTV) × total_borrowed
ltv_check        = (lender_LTV × ARV > all_in_cost) ? "Yes" : "No"
```

**PRIVATE MONEY (standard PMT — NOT FMTM's table):**
> FMTM's private branch referenced a `PML Amort` lookup table MISSING from the source file. Per decision, rebuild with the standard amortization formula (mathematically correct, computed live). Comment in code that this is standard PMT, not FMTM's table.
```
Inputs: loan_amount, annual_rate, amortization_years (default 30), lender_points, interest_only (toggle), months_held (= hold_months)

if interest_only:  monthly_pmt = loan_amount × (annual_rate/100) / 12
else:              monthly_pmt = P × r / (1 − (1+r)^−n)
                   where r = annual_rate/100/12, n = amortization_years × 12, P = loan_amount

points_cost   = loan_amount × lender_points% / 100
total_finance = (monthly_pmt × months_held) + points_cost
pm_profit     = cash_profit − total_finance
pm_roi        = pm_profit / all_in_cost
```

### 2e. Other / Misc costs
Editable **"Other / Misc costs"** line (realtor oddities, unexpected expenses) feeding `other_costs` in §2b margin and §2c total_project_cost. Default 0.

---

## 3. PHASE 1 — Create `offer_` custom fields (prerequisite)

Create via GHL API on **BOTH Contact AND Opportunity** (Location `jmHG4B8RdzwpfqruNf68`). Exact names:
```
offer_price (currency), offer_mao (currency), offer_wholesale_fee (number),
offer_repair_total (currency), offer_margin (currency), offer_arv (currency), offer_date (date)
```
Group in a folder named **"Offer"** so they render as a distinct section. **Report the new field IDs back before wiring saves.**

---

## 4. PHASE 2 — Page shell + Deal Summary header

Always-visible header, 4 LIVE numbers updating on any input change:
1. **Offer to Seller** — editable; defaults to calculated MAO, user can override (saved as `offer_price`).
2. **Your Wholesale Fee** — editable, default 70%.
3. **Total Potential Resale** — = ARV.
4. **Potential Margin (net win/loss)** — §2b; GREEN positive / RED negative.

Header must look clean enough to screenshot standalone (buyer marketing).

---

## 5. PHASE 3 — Two calc sections (BOTH always visible — NO toggle)

- **Section A — Wholesale:** ARV, asking price, assignment fee (default 5000), wholesale % (default 70), closing costs (default 2500) → MAO + viability badge. Reuse existing `deal-analyzer.html` logic.
- **Section B — Flip Analysis:** all §2c–2e inputs → holding, selling, all-in, total project cost, and per financing type (Cash / Hard Money / Private Money) the profit + ROI. User picks financing type; show that type's outputs.

---

## 6. PHASE 4 — Shared Repair Estimator (feeds BOTH sections)

- **Quick mode:** single "Total Repair Estimate" number.
- **Granular mode:** expand into bid sheet from `app/src/data/repair_bid_sheet.json` — qty per line (line = qty × unit_cost), category subtotals, **+10% fudge factor** → repair_total.
- **Expand control OBVIOUS and inviting** but NOT labeled "go granular" — e.g. **"Itemize repairs ▾"** with a short helper line.
- Quick vs granular must be clear which drives `repair_total` (no silent double-count).

---

## 7. PHASE 5 — GHL Search + Prepopulate

- Search by seller **NAME or property ADDRESS** (either finds the lead). Reuse ghl.ts/proxy + contacts pattern.
- Select → load contact + opportunity, prepopulate known fields (incl. existing `offer_` values). Leave unknowns blank.
- **OVERWRITE POPUP:** typed data + selecting a contact → confirm *"Load [name]'s saved info into the calculator?"*
  - **Yes** → fill ONLY fields the contact has data for; never blank a typed value where the contact is empty.
  - **No** → change nothing; just link the contact (enables Save).
- **Default state = BLANK.** No auto-remember. Pre-load ONLY via Phase 7 handoff.

---

## 8. PHASE 6 — Save Offer + Clear

**"Save Offer to GHL":**
- Writes `offer_` fields to linked Contact AND Opportunity. **Overwrite each save — NO history, latest only.** `offer_date` = now.
- Enabled only when a contact is linked (disabled otherwise; calc still works standalone).

**CRITICAL GUARDRAIL — saving is an "offer SUGGESTION" only:**
- Must NOT move pipeline stage, NOT add `offer-made`, NOT trigger Seller 7 / mail-exit. Those stay tied to the deliberate "Seller Offer Sent" move (V7 §14d). Writing `offer_` fields must not touch source fields or any workflow trigger.

**"Clear":** wipe all fields + unlink contact (confirm first).

---

## 9. PHASE 7 — Handoff button

On **Contacts** and **Pipeline** pages, add **"Analyze in Deal Calculator"** per contact/row → opens this page pre-loaded with that contact (pass contact ID; page reads on mount, prepopulates). ONLY thing that pre-loads a contact; otherwise page opens blank.

---

## 10. ACCEPTANCE CHECKLIST (before commit)

- [ ] No contact: type numbers → MAO, margin, flip all calculate live (standalone works).
- [ ] Margin GREEN/RED, live, and **subtracts wholesale fee first**.
- [ ] Offer-to-Seller defaults to MAO, overridable, drives margin.
- [ ] Quick number and granular bid sheet each drive `repair_total` (no double-count); granular applies 10% fudge.
- [ ] Flip: Cash + Hard Money match FMTM (§2c/2d); Private Money uses standard PMT; "Other costs" feeds margin + project cost.
- [ ] Search by name AND address both work.
- [ ] Overwrite popup: Yes fills only contact-populated fields; No changes nothing.
- [ ] Save writes `offer_` fields to BOTH Contact and Opportunity, overwrites on re-save.
- [ ] **Save does NOT move stage / tag offer-made / fire Seller 7** — verify in GHL.
- [ ] Save disabled with no linked contact; calc still fully works.
- [ ] No "create new contact" control anywhere.
- [ ] "Analyze in Deal Calculator" pre-loads; direct open is blank.
- [ ] `tsc -b` + `vite build` clean; commit on its own; verify live on the app deploy.
