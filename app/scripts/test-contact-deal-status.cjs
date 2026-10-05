/**
 * Board 15 / Pass 1 F38 (INV-130) — the contact page's read-only deal status.
 *
 * Jess (2026-10-04/05): contract status comes ONLY from the Contract
 * Workspace's governing derivation (scope / version / correction /
 * rescission). The contact page does not hold its inputs, so it shows the
 * independently read deal stage and "Open Contract Workspace to check
 * contract status." -- and derives no contract state of its own from notes
 * or emails.
 *
 * Offline. Compiles the real helper; checks the page wiring by source text.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const TMP = path.join(APP, '.tmp-contact-deal-status-test');
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(path.join(TMP, 'package.json'), '{"type":"commonjs"}');
try {
  execFileSync(process.execPath, [
    path.join(APP, 'node_modules', 'typescript', 'bin', 'tsc'),
    path.join(APP, 'src/lib/contact-deal-status.ts'),
    '--outDir', TMP, '--rootDir', APP, '--module', 'commonjs', '--target', 'es2020', '--strict', '--skipLibCheck',
  ], { cwd: APP, stdio: 'inherit' });
} catch (error) {
  fs.rmSync(TMP, { recursive: true, force: true });
  console.error('ABORT: TypeScript compilation failed. Nothing tested.');
  process.exit(10);
}
const { contactDealStatus, STAGE_UNKNOWN, CONTRACT_STATUS_POINTER } = require(path.join(TMP, 'src/lib/contact-deal-status.js'));

let checks = 0;
let failures = 0;
function check(label, actual, expected) {
  checks++;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      expected ${JSON.stringify(expected)}\n      actual   ${JSON.stringify(actual)}`}`);
}

// ── The helper ──────────────────────────────────────────────────────────────
check('stage comes straight from the pipeline name', contactDealStatus({ stageName: 'New Lead - Seller' }).stage, 'New Lead - Seller');
check('an unknown stage id is said to be unknown, not guessed', contactDealStatus({ stageName: null }).stage, STAGE_UNKNOWN);
check('the contract line is the pointer, in Jess\'s wording', CONTRACT_STATUS_POINTER, 'Open Contract Workspace to check contract status.');
check('the contract line is the pointer for every stage, including Under Contract',
  ['New Lead - Seller', 'Under Contract', 'Seller Closed-Won', null].map((stageName) => contactDealStatus({ stageName }).contract),
  Array(4).fill(CONTRACT_STATUS_POINTER));
{
  const helperSrc = fs.readFileSync(path.join(APP, 'src/lib/contact-deal-status.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  check('the helper parses no notes and imports no contract carrier',
    /^import /m.test(helperSrc) || /parse|Note|carrier/i.test(helperSrc.replace(/CONTRACT_STATUS_POINTER/g, '')), false);
}

// ── Page wiring (source text) ────────────────────────────────────────────────
{
  const page = fs.readFileSync(path.join(APP, 'src/pages/ContactWorkspace.tsx'), 'utf8');
  const start = page.indexOf('const dealStatus = useMemo(() => {');
  const end = page.indexOf('}, [railDeal, opps, pipelineStages]);', start);
  const body = start !== -1 && end > start ? page.slice(start, end) : '';
  check('page computes dealStatus from the opportunity stage and the pipeline stage list only',
    body.length > 0 && /contactDealStatus\(\{ stageName: pipelineStages\?\.find\(\(st\) => st\.id === opp\.stageId\)\?\.name \?\? null \}\)/.test(body), true);
  check('page derives no contract state from notes, emails or conversations',
    /notes|note|email|conversation|message|UnderContract|ContractSend|Outcome/i.test(body), false);
  check('page imports no contract or outcome carrier for this',
    /from "\.\.\/lib\/contract-send-carriers"|from "\.\.\/lib\/contract-execution-carriers"/.test(page), false);
  check('the contract line links to the Contract Workspace',
    /<Link data-testid="contact-contract-state" to=\{`\/contacts\/\$\{id\}\/contract`\}[^>]*>\{dealStatus\.contract\}<\/Link>/.test(page), true);
  check('stage names come from the same pipeline read as the opportunities',
    /\.then\(\(p\) => \{ setPipelineStages\(p\.stages\); setOpps\(opportunitiesForContact\(p\.opportunities, id\)\); \}\)/.test(page), true);
}

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\nF38 contact deal status: ${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
