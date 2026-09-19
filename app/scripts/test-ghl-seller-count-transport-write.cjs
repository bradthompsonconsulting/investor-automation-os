/** V1: projection computation remains; GHL transport writers are retired. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const client = read('src/lib/ghl.ts');
const ui = read('src/pages/ContractWorkspace.tsx');
let checks = 0;
function check(name, value) {
  assert(value, name); checks++; console.log('PASS ' + name);
}
for (const method of ['syncContractProjectionFields', 'setContractDraftRequest']) {
  check('client has no ' + method, !client.includes(method));
  check('workspace has no ' + method, !ui.includes(method));
}
for (const operation of ['contract.projection', 'contract.draftRequest']) {
  check('server operation absent: ' + operation,
    !read('netlify/functions/lib/write-contracts.ts').includes(operation));
}
check('manual GHL upload/send notice is present',
  ui.includes('contract-manual-send-notice') && ui.includes('send it manually'));
check('old send control and handler absent',
  !/contract-send-button|handleSend|proposals\.(send|reserveSend)/.test(ui));
check('client has no reserve/execute endpoint',
  !/ghl-contract-send-(reserve|execute)/.test(client));
check('client retains independent document readback',
  client.includes('ghl-contract-send-readback') && client.includes('listDocuments:'));
const model = read('src/lib/contract-ghl-projection-model.ts').replace(/\r\n/g, '\n');
check('canonical projection computation unchanged from authorized PR head',
  crypto.createHash('sha256').update(model).digest('hex') ===
  '8fb14afa3092e739d4e0aad826e4bc18aba3643ea872e7b8408d273eb8951a68');
check('generic request receipts and contact locks remain',
  /export async function claimWrite/.test(read('netlify/functions/lib/write-receipts.ts')) &&
  /export async function lockContact/.test(read('netlify/functions/lib/write-receipts.ts')));
// Scan executable string/template literals, ignoring historical comments.
const ts = require('typescript');
const sendLiterals = [];
function scan(directory) {
  for (const item of fs.readdirSync(directory, {withFileTypes: true})) {
    const file = path.join(directory, item.name);
    if (item.isDirectory()) scan(file);
    else if (/\.tsx?$/.test(item.name)) {
      const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'),
        ts.ScriptTarget.Latest, true);
      function visit(node) {
        if ((ts.isStringLiteralLike(node) || ts.isTemplateLiteralToken(node)) &&
            node.text.includes('/proposals/templates/send')) sendLiterals.push(file);
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
  }
}
scan(path.join(root, 'src'));
scan(path.join(root, 'netlify/functions'));
check('runtime has no executable template-send endpoint literal', sendLiterals.length === 0);
assert.equal(checks, 13);
console.log(checks + ' V1 transport retirement checks passed');
