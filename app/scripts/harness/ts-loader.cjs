/** Registers a `.ts` require hook (transpile-only, CommonJS), as the existing offline suites do inline. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
if (!Module._extensions['.ts'] || !Module._extensions['.ts'].__iaos) {
  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function (name, parent, ...rest) {
    if (name.startsWith('.') && parent && parent.filename) {
      const candidate = path.resolve(path.dirname(parent.filename), name + '.ts');
      if (fs.existsSync(candidate)) return candidate;
    }
    return originalResolve.call(this, name, parent, ...rest);
  };
  const hook = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
  hook.__iaos = true;
  Module._extensions['.ts'] = hook;
}
module.exports = {};
