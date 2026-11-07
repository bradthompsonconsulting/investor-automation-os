/**
 * G5 / B15-22 (INV-131) -- Spock's hosted finding: Underwriting showed the Seller MAO "calculated now" $428,648 with the
 * note "Not yet approved — differs from approved $428,648". Both figures are SHOWN in whole dollars; the comparison was
 * exact, and the engine does not round, so a difference below a dollar read as "different" next to two equal figures.
 * The comparison now uses the figures as shown. Values, calculations, approval, gates and writes are unchanged.
 *
 * The REAL lib/authoritative-figures.ts and components/AuthoritativeFigures.tsx, bundled with esbuild (as
 * test-b15-22-authoritative-figures.cjs does) and rendered with react-dom/server:
 *   G1  recorded $428,648 vs calculated 428,648.37 (the finding): r2 (Bones REVISE P2) -- the figures agree only at
 *       whole dollars, and the note says exactly that and that the figure calculated now is not itself approved;
 *       it never says "Matches" and never claims approval
 *   G2  rendered: the rail shows $428,648, the decision panel shows $428,648, the note is NOT green and has no "differs"
 *   G3  consistency sweep (recorded 428,648 vs calculated 428,646.51 .. 428,649.49 in cents): "differs" EXACTLY when the
 *       figures are shown differently; otherwise "Matches" ONLY at exact equality, else the rounded-only note;
 *       an exact match keeps the green "Matches the approved underwriting on record"
 *   G4  whole-dollar differences, nothing recorded and no live figure: wording unchanged from B15-22
 *   G5  values untouched: the recorded text is money(recorded); the inputs are not modified
 *   W   no network request
 *
 * NEGATIVE CONTROLS: --before=<rev> bundles <rev>'s authoritative-figures.ts; with 9e8c8fd (exact comparison: "differs")
 * and with 69551b6 (r1: the green "Matches" at whole dollars), G1, G2 and G3 must FAIL.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const APP = path.resolve(__dirname, '..');
const beforeArg = process.argv.find((a) => a.startsWith('--before='));
const BEFORE = beforeArg ? beforeArg.slice('--before='.length) : null;
const esbuild = require(path.join(APP, 'node_modules', '.pnpm', 'esbuild@0.25.12', 'node_modules', 'esbuild'));
const FLOOR = 14;   // literal count of check() calls executed on a full run; a shorter run fails (r2: +2)
let checks = 0, failures = 0;
function check(name, ok, detail) { checks += 1; if (!ok) failures += 1; console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`); }
if (BEFORE) console.log(`NEGATIVE CONTROL: authoritative-figures.ts from ${BEFORE}; this run must fail.`);

const requests = [];
globalThis.fetch = async (url) => { requests.push(String(url)); throw new Error('offline'); };

// inside the app's node_modules/.cache (git-ignored) so the bundles resolve the app's own react; removed at the end
fs.mkdirSync(path.join(APP, 'node_modules', '.cache'), { recursive: true });
const TMP = fs.mkdtempSync(path.join(APP, 'node_modules', '.cache', 'g5-mao-'));
try {
  const LIB = path.join(APP, 'src', 'lib', 'authoritative-figures.ts');
  let libFile = LIB;
  if (BEFORE) { libFile = path.join(TMP, 'authoritative-figures.before.ts'); fs.writeFileSync(libFile, execFileSync('git', ['show', `${BEFORE}:app/src/lib/authoritative-figures.ts`], { cwd: APP, encoding: 'utf8' })); }
  const bundle = (entry, out) => esbuild.buildSync({ entryPoints: [entry], outfile: path.join(TMP, out), bundle: true, platform: 'node', format: 'cjs',
    jsx: 'automatic', target: 'es2022', logLevel: 'silent', external: ['react', 'react-dom', 'react/jsx-runtime'] });
  // the REAL component; for --before, a copy in TMP whose one import points at <rev>'s library (the sync API has no plugins)
  let compFile = path.join(APP, 'src', 'components', 'AuthoritativeFigures.tsx');
  if (BEFORE) { const src = fs.readFileSync(compFile, 'utf8'); const n = src.split('"../lib/authoritative-figures"').length - 1; if (n !== 1) throw new Error('component import not found'); compFile = path.join(TMP, 'AuthoritativeFigures.tsx'); fs.writeFileSync(compFile, src.replace('"../lib/authoritative-figures"', '"./authoritative-figures.before"')); }
  bundle(libFile, 'lib.cjs');
  bundle(compFile, 'components.cjs');
  const req = (m) => require(require.resolve(m, { paths: [APP] }));
  const F = require(path.join(TMP, 'lib.cjs'));
  const C = require(path.join(TMP, 'components.cjs'));
  const React = req('react'); const { renderToStaticMarkup } = req('react-dom/server');
  const h = React.createElement;
  const testId = (html, id) => { const m = html.match(new RegExp(`data-testid="${id}"[^>]*>([^<]*)<`)); return m ? m[1] : null; };
  const money = (n) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 });

  // G1 / G2 -- the finding
  const g = F.compareSellerMao({ recorded: 428648, live: 428648.37 });
  check('G1 recorded $428,648 vs calculated 428,648.37: the note says they agree only at whole dollars and the figure calculated now is not itself approved',
    g.token === 'matches_rounded' && g.liveNote === 'Same as the approved $428,648 only when rounded to the whole dollar — the figure calculated now is not itself approved', g);
  check('G1 ...and it never says "Matches" or claims the figure calculated now is approved',
    !!g.liveNote && !/matches/i.test(g.liveNote) && /not itself approved/.test(g.liveNote) && !/underwriting on record/.test(g.liveNote), g.liveNote);
  const rail = renderToStaticMarkup(h(C.RecordedSellerMaoCell, { comparison: g, waiting: null }));
  const live = renderToStaticMarkup(h(C.LiveSellerMaoFigure, { text: money(428648.37), comparison: g }));
  check('G2 rendered: rail $428,648 and decision panel $428,648; the note is not green (amber) and has no "differs"',
    testId(rail, 'underwriting-rail-recorded-mao-value') === '$428,648' && testId(live, 'underwriting-live-mao-value').trim() === '$428,648' && !/differs/.test(live)
      && /data-mao-comparison="matches_rounded"[^>]*color:#F59E0B/.test(live) && !/#22C55E/.test(live),
    { rail: testId(rail, 'underwriting-rail-recorded-mao-value'), live: testId(live, 'underwriting-live-mao-value'), note: testId(live, 'underwriting-live-mao-note') });

  // G3 -- the note agrees with what is shown, across the cent boundary on both sides
  const bad = [];
  for (let cents = 42864651; cents <= 42864949; cents += 1) {
    const v = cents / 100; const c = F.compareSellerMao({ recorded: 428648, live: v });
    const shownDiffer = money(v) !== money(428648);
    const want = shownDiffer ? 'differs' : (v === 428648 ? 'matches' : 'matches_rounded');
    if (c.token !== want || (shownDiffer && c.liveNote !== 'Not yet approved — differs from approved $428,648')) bad.push([v, money(v), c.token, want]);
  }
  check('G3 across 299 calculated values around $428,648: "differs" exactly when shown differently; "Matches" only at exact equality; otherwise the rounded-only note', bad.length === 0, bad.slice(0, 5));
  const up = F.compareSellerMao({ recorded: 428648, live: 428648.5 });
  check('G3 calculated 428,648.50 is shown $428,649: it still differs from the approved $428,648', up.token === 'differs' && money(428648.5) === '$428,649', { up, shown: money(428648.5) });
  const down = F.compareSellerMao({ recorded: 428648.4, live: 428647.6 });
  check('G3 recorded with cents too (428,648.40 vs 428,647.60, both shown $428,648): the rounded-only note, not "Matches"', down.token === 'matches_rounded', down);
  const exact = F.compareSellerMao({ recorded: 428648, live: 428648 });
  const exactHtml = renderToStaticMarkup(h(C.LiveSellerMaoFigure, { text: money(428648), comparison: exact }));
  check('G3 an EXACT match keeps the green "Matches the approved underwriting on record" (B15-22)', exact.token === 'matches' && exact.liveNote === 'Matches the approved underwriting on record' && /color:#22C55E/.test(exactHtml), exact);

  // G4 -- B15-22 wording unchanged
  check('G4 whole-dollar difference: "Not yet approved — differs from approved $150,000"', F.compareSellerMao({ recorded: 150000, live: 165000 }).liveNote === 'Not yet approved — differs from approved $150,000');
  check('G4 equal whole dollars: matches', F.compareSellerMao({ recorded: 165000, live: 165000 }).token === 'matches');
  const none = F.compareSellerMao({ recorded: null, live: 165000 });
  check('G4 nothing recorded: "Not yet approved — no approved underwriting recorded yet"', none.token === 'none' && none.liveNote === 'Not yet approved — no approved underwriting recorded yet', none);
  const noLive = F.compareSellerMao({ recorded: 150000, live: null });
  check('G4 no live figure: no note', noLive.token === 'no_live' && noLive.liveNote === null, noLive);
  check('G4 a recorded 0 is a value: $0; 0 vs 0.40 (both shown $0) is the rounded-only note', F.compareSellerMao({ recorded: 0, live: 0.4 }).recordedText === '$0' && F.compareSellerMao({ recorded: 0, live: 0.4 }).token === 'matches_rounded');

  // G5 -- values untouched
  const input = { recorded: 428648, live: 428648.37 }; const copy = JSON.stringify(input); const r = F.compareSellerMao(input);
  check('G5 the recorded text is money(recorded) and the inputs are not modified', r.recordedText === '$428,648' && JSON.stringify(input) === copy, r);
  check('W no network request', requests.length === 0, requests);
} catch (e) {
  check(`run completed (${String(e && e.message).split('\n')[0]})`, false);
} finally {
  fs.rmSync(TMP, { recursive: true, force: true });
}
if (checks < FLOOR) check(`at least ${FLOOR} checks ran`, false, checks);
console.log(`\nG5 Seller MAO display: ${checks - failures}/${checks} checks passed${BEFORE ? ` (negative control vs ${BEFORE})` : ''}`);
process.exit(failures === 0 ? 0 : 1);
