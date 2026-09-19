/** Offline refusal matrix for the removed V1 reserve/execute operations. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function(name, parent, ...rest) {
  if (name.startsWith('.') && parent) {
    const candidate = path.resolve(path.dirname(parent.filename), name + '.ts');
    if (fs.existsSync(candidate)) return candidate;
  }
  return originalResolve.call(this, name, parent, ...rest);
};
Module._extensions['.ts'] = (module, filename) => module._compile(
  ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020}
  }).outputText, filename);
module.exports = async function proveRetired(name) {
  let calls = 0, checks = 0;
  global.fetch = async () => { calls++; throw new Error('Network forbidden'); };
  process.env.IAOS_APP_WRITE_GOOGLE_CLIENT_ID = 'offline-client';
  process.env.IAOS_APP_WRITE_BRAD_EMAILS = 'brad@example.invalid';
  process.env.IAOS_APP_WRITE_SESSION_SECRET = 'offline-fixture-only-not-a-secret';
  const auth = require('../../netlify/functions/lib/app-write-auth.ts');
  const file = '../../netlify/functions/ghl-contract-send-' + name + '.ts';
  const source = fs.readFileSync(path.resolve(__dirname, file), 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const imports = ast.statements.filter(ts.isImportDeclaration)
    .map(s => s.moduleSpecifier.text);
  assert.deepEqual(imports, ['./lib/app-write-auth']);
  assert(!/fetch\s*\(|getStore|lockContact|claimWrite|templates\/send/.test(source));
  console.log('PASS endpoint has only application-auth dependency; no send/storage path');
  checks++;
  const {handler} = require(file);
  for (const environment of ['test', 'production']) {
    // Environment names only: no runtime deployment or real credentials are used.
    process.env.IAOS_ENV = environment;
    for (const authenticated of [false, true]) {
      for (const body of ['{}', '{', JSON.stringify({
        templateId: 'fixture', opportunityId: 'fixture-opportunity',
        attemptId: 'fixture-attempt', versionRaw: '{}', noteBody: 'fixture'
      })]) {
        const headers = authenticated ? {authorization:
          'Bearer ' + auth.issueAppSession('brad@example.invalid').token} : {};
        const result = await handler({httpMethod: 'POST', headers, body});
        assert.equal(result.statusCode, authenticated ? 410 : 401);
        assert.equal(calls, 0);
        console.log('PASS ' + name + ' ' + environment + ' auth=' + authenticated +
          ' refuses with zero upstream calls');
        checks++;
      }
    }
    for (const httpMethod of ['GET', 'PUT', 'DELETE', 'OPTIONS']) {
      assert.equal((await handler({httpMethod})).statusCode, 405);
      assert.equal(calls, 0);
      console.log('PASS ' + name + ' ' + environment + ' ' + httpMethod + ' refused');
      checks++;
    }
  }
  assert.equal(checks, 21);
  console.log(checks + ' retired endpoint checks passed; zero network calls');
};
