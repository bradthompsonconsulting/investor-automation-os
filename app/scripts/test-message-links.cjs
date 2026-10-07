/**
 * B15-23 (INV-132) -- usable email links in Conversations.
 *
 * Offline. Compiles the pure splitter (src/lib/message-links.ts) and runs
 * table-driven cases, then checks the Conversations wiring by source text,
 * following this repository's convention for UI wiring (there is no browser
 * rendering harness; see test-deal-calculator-wiring.cjs). Proves: http(s)
 * URLs become labeled links, nothing else does, body text is preserved
 * exactly, and the page renders links as escaped React anchors that open in
 * a new tab with no opener -- never as injected HTML.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const TMP = path.join(APP, '.tmp-message-links-test');
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(path.join(TMP, 'package.json'), '{"type":"commonjs"}');
try {
  execFileSync(process.execPath, [
    path.join(APP, 'node_modules', 'typescript', 'bin', 'tsc'),
    path.join(APP, 'src/lib/message-links.ts'),
    '--outDir', TMP, '--rootDir', APP, '--module', 'commonjs',
    '--target', 'es2020', '--strict', '--skipLibCheck',
  ], { cwd: APP, stdio: 'inherit' });
} catch (error) {
  console.error('ABORT: TypeScript compilation failed. Nothing tested.');
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(10);
}

const { splitMessageLinks, safeHttpHref, linkLabel } = require(path.join(TMP, 'src/lib/message-links.js'));
fs.rmSync(TMP, { recursive: true, force: true });

/** Literal call-site count taken from the finished file, never back-filled from a passing run. */
const FLOOR = 31;
let checks = 0;
let failures = 0;
function check(name, actual, expected) {
  checks += 1;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ` expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`}`);
  if (!ok) failures += 1;
}
const rejoin = (segs) => segs.map((s) => (s.kind === 'text' ? s.text : s.source)).join('');
const links = (segs) => segs.filter((s) => s.kind === 'link').map((s) => ({ href: s.href, label: s.label }));

// ============================================================
// Recognised link shapes.
// ============================================================
{
  const bracketed = 'DOCUMENT SIGNED SUCCESSFULLY\nView document [https://link.example.com/documents/abc?x=1]\nThanks';
  const segs = splitMessageLinks(bracketed);
  check('bracketed URL becomes one labeled link', links(segs), [{ href: 'https://link.example.com/documents/abc?x=1', label: 'Open link (link.example.com)' }]);
  check('bracketed URL: no raw bracket or URL left in the text', segs.filter((s) => s.kind === 'text').map((s) => s.text).join(''), 'DOCUMENT SIGNED SUCCESSFULLY\nView document \nThanks');
  check('bracketed URL: body reproduces exactly', rejoin(segs), bracketed);

  const md = 'Please [Review and sign](https://docs.example.com/s/123) today.';
  check('markdown link keeps its own label', links(splitMessageLinks(md)), [{ href: 'https://docs.example.com/s/123', label: 'Review and sign' }]);
  check('markdown link: body reproduces exactly', rejoin(splitMessageLinks(md)), md);

  const angle = 'Copy: <https://www.example.com/a/b>';
  check('angle-bracketed URL becomes a link, www. dropped from the label', links(splitMessageLinks(angle)), [{ href: 'https://www.example.com/a/b', label: 'Open link (example.com)' }]);

  const bare = 'See https://example.com/path.';
  const bareSegs = splitMessageLinks(bare);
  check('bare URL becomes a link without the sentence period', links(bareSegs), [{ href: 'https://example.com/path', label: 'Open link (example.com)' }]);
  check('bare URL: the period stays text after the link', bareSegs[bareSegs.length - 1], { kind: 'text', text: '.' });
  check('bare URL: body reproduces exactly', rejoin(bareSegs), bare);

  const paren = '(see https://example.com/x)';
  check('bare URL inside parentheses drops the closing paren', links(splitMessageLinks(paren)), [{ href: 'https://example.com/x', label: 'Open link (example.com)' }]);
  check('parenthesised URL: body reproduces exactly', rejoin(splitMessageLinks(paren)), paren);

  const two = 'A [https://a.example.com/1] and B [https://b.example.com/2]';
  check('two links in one body both render, in order', links(splitMessageLinks(two)).map((l) => l.label), ['Open link (a.example.com)', 'Open link (b.example.com)']);

  check('http (not only https) is a link', links(splitMessageLinks('[http://example.com/]')).length, 1);
  check('uppercase scheme is still recognised', links(splitMessageLinks('[HTTPS://EXAMPLE.COM/A]')).length, 1);
}

// ============================================================
// Safety: only http(s) URLs become links; nothing else changes.
// ============================================================
{
  const js = 'Click [javascript:alert(1)] or [x](javascript:alert(1))';
  check('javascript: in brackets or markdown is never a link', links(splitMessageLinks(js)), []);
  check('javascript: text reproduces exactly', rejoin(splitMessageLinks(js)), js);
  check('data: URL is never a link', links(splitMessageLinks('<data:text/html,hi>')), []);
  check('markdown with a non-http href is never a link', links(splitMessageLinks('[ok](mailto:a@b.com)')), []);
  check('safeHttpHref rejects javascript:', safeHttpHref('javascript:alert(1)'), null);
  check('safeHttpHref rejects a scheme with no host', safeHttpHref('https://'), null);
  check('safeHttpHref accepts https', safeHttpHref('https://example.com/a'), 'https://example.com/a');

  const html = 'Hi <b>there</b> <script>x</script> [https://example.com/doc]';
  const htmlSegs = splitMessageLinks(html);
  check('HTML-looking text stays text, verbatim', htmlSegs[0], { kind: 'text', text: 'Hi <b>there</b> <script>x</script> ' });
  check('HTML-looking body reproduces exactly', rejoin(htmlSegs), html);

  check('a body with no URL is one unchanged text segment', splitMessageLinks('Call me back tomorrow [after 5]'), [{ kind: 'text', text: 'Call me back tomorrow [after 5]' }]);
  check('an empty body yields no segments', splitMessageLinks(''), []);
  check('linkLabel names the host', linkLabel('https://sub.example.org/x'), 'Open link (sub.example.org)');
}

// ============================================================
// Conversations wiring (source text). Expand/collapse logic untouched.
// ============================================================
{
  const conv = fs.readFileSync(path.join(APP, 'src/pages/Conversations.tsx'), 'utf8').replace(/\r\n/g, '\n');
  const emailBody = (conv.match(/function EmailBody\([\s\S]*?\n}\n/) || [''])[0];
  check('Conversations imports splitMessageLinks', /import \{ splitMessageLinks \} from "\.\.\/lib\/message-links";/.test(conv), true);
  check('email bubbles render through EmailBody; SMS bodies stay plain', /\? \(isSms \? m\.body : <EmailBody body=\{m\.body\} \/>\)/.test(conv), true);
  check('links open in a new tab with no opener or referrer', /target="_blank"\s+rel="noopener noreferrer"/.test(emailBody), true);
  check('EmailBody injects no raw HTML', /dangerouslySetInnerHTML|innerHTML/.test(conv), false);
  check('Expand still measures the unmodified body and clamps to CLAMP_LINES', /\}, \[m\.body, collapsible\]\);/.test(conv) && /WebkitLineClamp: CLAMP_LINES/.test(conv) && /\{expanded \? "Show less" : "Expand"\}/.test(conv), true);
}

console.log('');
console.log('checksRun=' + checks + ' failures=' + failures + ' floor=' + FLOOR);
if (checks !== FLOOR) {
  console.error('FAILED: expected exactly ' + FLOOR + ' checks, ran ' + checks + '. A case was added or removed without updating FLOOR.');
  process.exit(2);
}
if (failures > 0) {
  console.error('FAILED');
  process.exit(1);
}
console.log('OK');
