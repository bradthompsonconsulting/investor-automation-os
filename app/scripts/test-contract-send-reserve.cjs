/** V1 retirement replaces the obsolete successful-send tests. */
require('./lib/test-retired-contract-endpoint.cjs')('reserve')
  .catch(error => { console.error(error); process.exitCode = 1; });
