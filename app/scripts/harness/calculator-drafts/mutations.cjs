/**
 * B15-25 Phase 1 negative controls, shared by test-calculator-drafts.cjs (model) and
 * test-deal-calculator-drafts.cjs (real page). Each mutant is a copy of the real module or page with exact
 * replacements -- every replacement must match exactly once, or nothing is written. Mutant files live in
 * this folder only while a run uses them and are removed on exit.
 *
 *   model mutants  -> calculator-drafts.mutant.ts (copy of src/lib/calculator-drafts.ts)
 *   page mutants   -> DealCalculator.mutant.tsx  (copy of src/pages/DealCalculator.tsx, imports re-pointed)
 */
const fs = require('node:fs');
const path = require('node:path');

const APP = path.resolve(__dirname, '..', '..', '..');
const MODEL = path.join(APP, 'src/lib/calculator-drafts.ts');
const PAGE = path.join(APP, 'src/pages/DealCalculator.tsx');
const MODEL_MUTANT = path.join(__dirname, 'calculator-drafts.mutant.ts');
const PAGE_MUTANT = path.join(__dirname, 'DealCalculator.mutant.tsx');

const MODEL_MUTATIONS = {
  /* deal drafts ignore contact, property and deal: every deal shares one draft */
  'no-deal-isolation': [['deal: ["env", "operator", "contactId", "propertyId", "opportunityId"],', 'deal: ["env", "operator"],']],
  /* the key ignores its kind: scratch and deal drafts collide */
  'scratch-deal-shared': [['return `${KEY_PREFIX}${id.kind}|${values.join("|")}`;', 'return `${KEY_PREFIX}${values.slice(0, 2).join("|")}`;'],
    ['if (!a || typeof a !== "object" || (a as DraftIdentity).kind !== b.kind) return false;', 'if (!a || typeof a !== "object") return false;']],
  /* a GHL change is never seen: the draft silently wins */
  'draft-wins': [['export function compare(base: GhlValue | undefined, current: GhlValue | undefined): "same" | "changed" | "unavailable" {', 'export function compare(base: GhlValue | undefined, current: GhlValue | undefined): "same" | "changed" | "unavailable" { return "same";']],
  /* a GHL change silently replaces the draft */
  'ghl-wins': [['    const c = compare(d.base, ghl);', '    const c = compare(d.base, ghl);\n    if (c === "changed") { out[field] = { state: ghl.kind === "value" ? "ghl" : "empty", ghl }; continue; }']],
  /* saves report success but store nothing */
  'no-persist': [['storage.setItem(k, text); return storage.getItem(k) === text;', 'return true;']],
  /* a failing save is reported as kept */
  'save-unchecked': [['storage.setItem(k, text); return storage.getItem(k) === text; } catch { return false; }', 'storage.setItem(k, text); } catch { /* failure ignored */ } return true;']],
  /* a failing removal is reported as done */
  'remove-silent': [['storage.removeItem(k); return storage.getItem(k) === null; } catch { return false; }', 'storage.removeItem(k); } catch { /* failure ignored */ } return true;']],
  /* an unparsable contact seed is read as "nothing recorded" */
  'unparsable-seed-as-none': [['return Number.isFinite(n) ? { kind: "value", value: String(n) } : UNAVAILABLE;', 'return Number.isFinite(n) ? { kind: "value", value: String(n) } : NONE;']],
  /* Keep My Draft / Use GHL allowed while GHL is unreadable */
  'choices-unguarded': [['export function canResolve(ghlNow: GhlNow, field: DraftField): boolean { return ghlOf(ghlNow, field).kind !== "unavailable"; }', 'export function canResolve(ghlNow: GhlNow, field: DraftField): boolean { return true; }']],
};
const PAGE_MUTATIONS = {
  /* linking seeds over a restored (non-empty) draft value */
  'seed-over-draft': [['if (screen.arv.trim() === "" && seeds.arv !== null) setArvInput(String(seeds.arv));', 'if (seeds.arv !== null) setArvInput(String(seeds.arv));']],
  /* a contact seed is kept as if the operator had typed it */
  'seed-kept-as-draft': [['const atBaseline = snap[f] === baselineFor(f, ghlNow);', 'const atBaseline = snap[f] === DRAFT_DEFAULTS[f];']],
  /* leaving a deal carries its figures into the next deal or into scratch work */
  'deal-carries-over': [['const carry = !context || context.kind === "scratch";', 'const carry = true;']],
};

function applyAll(src, subs, name) {
  let out = src.replace(/\r\n/g, '\n');
  for (const [from, to] of subs) {
    const n = out.split(from).length - 1;
    if (n !== 1) throw new Error(`--mutate=${name} matched ${n} times, expected exactly 1`);
    out = out.replace(from, to);
  }
  return out;
}
function removeMutants() { for (const f of [MODEL_MUTANT, PAGE_MUTANT]) if (fs.existsSync(f)) fs.rmSync(f); }

/** Writes the named mutant; returns { kind: 'model'|'page', file }. Throws (writing nothing) on a miss. */
function writeMutant(name) {
  removeMutants();
  if (MODEL_MUTATIONS[name]) {
    fs.writeFileSync(MODEL_MUTANT, applyAll(fs.readFileSync(MODEL, 'utf8'), MODEL_MUTATIONS[name], name));
    return { kind: 'model', file: MODEL_MUTANT };
  }
  if (PAGE_MUTATIONS[name]) {
    const src = applyAll(fs.readFileSync(PAGE, 'utf8'), PAGE_MUTATIONS[name], name)
      .replace(/from "\.\.\/\.\.\/shared\//g, 'from "@@SHARED@@/').replace(/from "\.\.\//g, 'from "../../../src/').replace(/@@SHARED@@/g, '../../../shared');
    fs.writeFileSync(PAGE_MUTANT, src);
    return { kind: 'page', file: PAGE_MUTANT };
  }
  throw new Error(`unknown --mutate=${name}`);
}

module.exports = { MODEL_MUTATIONS, PAGE_MUTATIONS, MODEL_MUTANT, PAGE_MUTANT, writeMutant, removeMutants };
