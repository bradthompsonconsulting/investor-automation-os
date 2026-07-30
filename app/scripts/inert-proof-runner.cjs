/* SKELETON — this file performs NO network calls yet. It is the dispatcher skeleton
   for the parameterized inert-proof runner per docs/PHASE_B_SPEC.md PB-D26 (stage
   ownership and boundaries), PB-D27 (one stage per process invocation), and PB-D28
   (field configuration is an in-file keyed registry). No proxy builder, no getJson,
   no GET, no PUT, no evidence writing, no stage logic — those arrive with their stages. */

const ORIGIN = "https://app.investorautomationos.com";
const LOC    = "jmHG4B8RdzwpfqruNf68";

// PB-D28 — in-file keyed field registry. Only observed values live here. tempValue,
// clearValue, restore strategy, and comparison rules are intentionally absent; they are
// not yet observed and will be added when the write stage is implemented.
const FIELDS = {
  arv:            { fieldId: "wMBTGWMs97yysQFx7Vad", dataType: "MONETORY", contactId: "9fbH2VCcZvzVNhsR9zjc" },
  property_notes: { fieldId: "k7O0TYVMpqCpnMHRLPol", dataType: "TEXT",     contactId: "9fbH2VCcZvzVNhsR9zjc" },
};

// PB-D26 — four stages, exclusive responsibilities. Bodies are placeholders only.
async function capture(config) {
  console.log(`capture — fieldKey ${config.fieldKey}`);
  // TODO: implement capture stage (before-state GETs, evidence write).
}

async function write(config) {
  console.log(`write — fieldKey ${config.fieldKey}`);
  // TODO: implement write stage (preconditions + exactly one PUT).
}

async function verify(config) {
  console.log(`verify — fieldKey ${config.fieldKey}`);
  // TODO: implement verify stage (poll + comparison).
}

async function restore(config) {
  console.log(`restore — fieldKey ${config.fieldKey}`);
  // TODO: implement restore stage (per PB-D24 restoration semantics).
}

const STAGES = { capture, write, verify, restore };

// PB-D27 — dispatcher: exactly two positional args <stage> <fieldKey>. Validation runs
// before any stage function; exactly one stage is invoked per process.
(async () => {
  const args = process.argv.slice(2);
  const stage = args[0];
  const fieldKey = args[1];

  if (!stage) { console.log("ABORT — missing stage argument; usage: <stage> <fieldKey>"); process.exit(10); }
  if (!Object.prototype.hasOwnProperty.call(STAGES, stage)) {
    console.log(`ABORT — unrecognized stage '${stage}'; expected one of capture|write|verify|restore`);
    process.exit(11);
  }
  if (args.length > 2) { console.log(`ABORT — too many positional args (${args.length}); expected exactly <stage> <fieldKey>`); process.exit(12); }
  if (!fieldKey || !Object.prototype.hasOwnProperty.call(FIELDS, fieldKey)) {
    console.log(`ABORT — unrecognized fieldKey '${fieldKey}'; expected one of ${Object.keys(FIELDS).join("|")}`);
    process.exit(13);
  }

  const config = { fieldKey, ...FIELDS[fieldKey], ORIGIN, LOC };
  await STAGES[stage](config);
})();
