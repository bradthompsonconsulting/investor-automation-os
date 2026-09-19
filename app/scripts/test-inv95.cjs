/** Affected offline regression suites; never calls deployed endpoints. */
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const suites=["write-boundaries","write-webhooks","disposition-blob-context","write-contract-ledgers","arv-persist","repair-persist","legacy-repairs-writer-removed","current-offer-carrier","seller-call-negotiation","seller-call-negotiation-override-note","contract-authorization-model","contract-ghl-projection","contract-projection-sync-carriers","ghl-seller-count-transport-write","contract-send-model","contract-send-guard","contract-send-canonical-carriers","contract-send-reserve","contract-send-execute","contract-send-readback","contract-lifecycle-model","contract-execution-model","contract-disposition-handoff","contract-workspace-wiring","contract-draft-request","contract-ghl-transport-formatting","contract-seller-signing-model","contract-artifact-verification","generate-contract-pdf-endpoint"];
let failed=0;
for(const suite of suites){console.log('RUN test-'+suite);const r=spawnSync(process.execPath,[path.join(__dirname,'test-'+suite+'.cjs')],{stdio:'inherit'});console.log('exit='+r.status);if(r.status!==0)failed++;}
console.log('INV-95 suites='+suites.length+' failed='+failed);process.exitCode=failed?1:0;
