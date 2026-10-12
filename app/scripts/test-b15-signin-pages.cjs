/**
 * Board 15 B5 / INV-127 (B15-18, Pass 1 F1-F3, F57-F58) -- sign-in
 * presentation and hidden empty pages.
 *
 * Offline source-text checks, following this repository's convention for UI
 * wiring. The change is PRESENTATION ONLY: separate read and write
 * authorization (Jess ruling 2026-10-04) must be unchanged underneath, so the
 * endpoints, popup checks, timers and request calls the components use are
 * asserted here by string, and the components are asserted to make no other
 * request.
 */
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(APP, rel), 'utf8').replace(/\r\n/g, '\n');
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '');

const layout = strip(read('src/components/Layout.tsx'));
const readAccess = strip(read('src/components/ReadAccess.tsx'));
const writeAccess = strip(read('src/components/AppWriteAccess.tsx'));
const sidebar = strip(read('src/components/Sidebar.tsx'));
const accessStatus = strip(read('src/components/access-status.ts'));
const app = strip(read('src/App.tsx'));
const readSession = read('src/lib/read-session.ts');

let checks = 0;
let failures = 0;
function check(name, actual, expected) {
  checks += 1;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n      expected ${JSON.stringify(expected)}\n      actual   ${JSON.stringify(actual)}`}`);
}
const count = (src, re) => (src.match(re) || []).length;

// -- Read and write authorization unchanged underneath ---------------------
check('read session endpoint is still app-read-session',
  readSession.includes('export const READ_SESSION_ENDPOINT = "/.netlify/functions/app-read-session";'), true);
check('ReadAccess makes exactly its two existing requests (status GET, sign-out DELETE)',
  [...readAccess.matchAll(/fetch\(([^)]*)\)/g)].map((m) => m[1]),
  ['READ_SESSION_ENDPOINT, { cache: "no-store", credentials: "same-origin" }', 'READ_SESSION_ENDPOINT, { method: "DELETE", credentials: "same-origin" }']);
check('ReadAccess still checks once on mount', /useEffect\(\(\) => \{ void check\(\); \}, \[check\]\);/.test(readAccess), true);
check('ReadAccess read popup unchanged (/app-read-login.html)',
  readAccess.includes('window.open("/app-read-login.html", "iaos-app-read-signin", "popup,width=480,height=620")'), true);
check('ReadAccess popup message still checked for origin, source and type, then re-checked with the server',
  /event\.origin !== location\.origin \|\| !popup\.current \|\| event\.source !== popup\.current \|\| event\.data\?\.type !== "iaos-app-read-signed-in"/.test(readAccess)
  && /popup\.current\.close\(\); popup\.current = null;\s*void check\(\);/.test(readAccess), true);
check('ReadAccess session-lost listener and expiry timer unchanged',
  readAccess.includes('window.addEventListener(READ_SESSION_LOST_EVENT, lost);')
  && readAccess.includes('setTimeout(() => { void check("Read session expired. Sign in to continue."); }, Math.max(0, expiresAt - Date.now()))'), true);
check('AppWriteAccess makes no request of its own', /fetch\(/.test(writeAccess), false);
check('AppWriteAccess write popup unchanged (/app-write-login.html)',
  count(writeAccess, /window\.open\("\/app-write-login\.html", "iaos-app-write-signin", "popup,width=480,height=620"\)/g), 1);
check('AppWriteAccess popup message still checked for origin, source, type and shape before the session is set',
  /event\.origin !== location\.origin \|\| !popup\.current \|\| event\.source !== popup\.current \|\| event\.data\?\.type !== "iaos-app-write-session"/.test(writeAccess)
  && /typeof value\?\.token !== "string" \|\| !Number\.isFinite\(Date\.parse\(value\.expiresAt\)\)\) return;\s*setAppWriteSession\(value\);/.test(writeAccess), true);
check('AppWriteAccess write expiry timer still clears the in-memory session',
  /setTimeout\(\(\) => \{ setAppWriteSession\(null\); setExpires\(0\);[^}]*\}, Math\.max\(0, expires - Date\.now\(\)\)\)/.test(writeAccess), true);
check('Layout, Sidebar and access-status make no request',
  [layout, sidebar, accessStatus].map((s) => /fetch\(|XMLHttpRequest|setInterval|\.netlify\/functions/.test(s)), [false, false, false]);

// -- F1/F2: no session -> one landing, no nav, no write prompt -------------
check('routed pages still mount inside the read gate', /<ReadAccess>\s*<Outlet \/>\s*<\/ReadAccess>/.test(layout), true);
check('no read session: ReadAccess renders one "Sign in to IAOS" landing with the existing sign-in action',
  /if \(!wasSignedIn\) \{[\s\S]*?<h1[^>]*>Sign in to IAOS<\/h1>[\s\S]*?<button onClick=\{signIn\}[\s\S]*?\}/.test(readAccess), true);
check('Layout derives readSignedIn only from what ReadAccess reports',
  /const \[read, setRead\] = useState<ReadView>\(\{ kind: "checking" \}\);/.test(layout)
  && /const readSignedIn = read\.kind === "signed_in";/.test(layout)
  && /<ReadViewReport\.Provider value=\{setRead\}>/.test(layout), true);
check('ReadAccess reports its existing status to Layout',
  /const report = useContext\(ReadViewReport\);/.test(readAccess) && /report\(status\.kind === "signed_in"/.test(readAccess), true);
check('no read session: write prompt renders nothing (AppWriteAccess returns null unless reads are signed in or saving is on)',
  /if \(!readSignedIn && !expires\) return null;/.test(writeAccess) && /<AppWriteAccess readSignedIn=\{readSignedIn\}>/.test(layout), true);
check('AppWriteAccess hides only AFTER all its hooks (listener and timer stay mounted)',
  writeAccess.indexOf('if (!readSignedIn && !expires) return null;') > writeAccess.lastIndexOf('useEffect('), true);
check('no read session: sidebar shows no nav links',
  /<Sidebar navEnabled=\{readSignedIn\} \/>/.test(layout) && /\{navEnabled && <nav/.test(sidebar) && /\{!navEnabled && <div data-testid="sidebar-locked"/.test(sidebar), true);

// -- F1/F3: one compact status line ----------------------------------------
check('exactly one status line element across Layout and AppWriteAccess',
  count(layout, /role="status"/g) + count(writeAccess, /role="status"/g), 1);
check('ReadAccess no longer renders its own signed-in bar (it returns only the page)',
  // Board 15 cleanup: the page is one fixed-key wrapper (kept mounted behind the recovery screen on a lapse, never remounted).
  /if \(status\.kind === "signed_in"\) return <>\{null\}\{page\}<\/>;/.test(readAccess) && /const page = <div key="page"[^>]*>\s*<ReadRecovered\.Provider value=\{epoch\}>\{children\}<\/ReadRecovered\.Provider>\s*<\/div>;/.test(readAccess) && !/Reading as Brad/.test(readAccess), true);
check('status line: read part shows "Signed in until <time>" with Sign out of reads',
  /\{read\.kind === "signed_in" && <span data-testid="read-access-signed-in">\s*Signed in until \{new Date\(read\.expiresAt\)\.toLocaleTimeString\(\)\} <button onClick=\{read\.signOut\}>Sign out<\/button>/.test(layout), true);
check('status line: view only offers "Enable saving" (existing write popup)',
  /<button title="Sign in for application writes" onClick=\{\(\) => \{ popup\.current = window\.open\("\/app-write-login\.html"/.test(writeAccess)
  && />Enable saving<\/button>/.test(writeAccess) && /useState\("View only\."\)/.test(writeAccess), true);
check('status line: saving enabled shows its expiry and keeps sign-out of writes',
  /Saving enabled until \{new Date\(expires\)\.toLocaleTimeString\(\)\}/.test(writeAccess)
  && /<button onClick=\{\(\) => \{ setAppWriteSession\(null\); setExpires\(0\);[^}]*\}\}>Turn off saving<\/button>/.test(writeAccess), true);
check('read sign-out still calls the existing signOut (DELETE + re-check)',
  /signOut: \(\) => \{ void signOutRef\.current\(\); \}/.test(readAccess)
  && /async function signOut\(\) \{[\s\S]*?method: "DELETE"[\s\S]*?await check\("Signed out of reads\."\);/.test(readAccess), true);
check('old stacked banners are gone', /Read access\. Sign in to save changes\.|Sign in for writes<\/button>/.test(writeAccess), false);

// -- F57/F58: Map and Settings hidden, routes kept --------------------------
const navLabels = [...sidebar.matchAll(/\{ label: "([^"]+)"/g)].map((m) => m[1]);
check('sidebar nav list (Map and Settings removed, nothing else)', navLabels,
  ['Dashboard', 'Deal Calculator', 'Contacts', 'Conversations', 'Calendars', 'Pipeline', 'Mailers', 'Segmentation', 'Add Leads']);
check('sidebar has no /map or /settings link', /to: "\/(map|settings)"/.test(sidebar), false);
check('/map and /settings routes still exist',
  /<Route path="map"\s+element=\{<MapPage \/>\} \/>/.test(app) && /<Route path="settings"\s+element=\{<Settings \/>\} \/>/.test(app), true);

console.log(`\n${failures ? 'FAIL' : 'PASS'}  Board 15 B5 sign-in presentation and hidden pages: ${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
