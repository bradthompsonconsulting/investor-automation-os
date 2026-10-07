/** INV-95 offline handler regressions. Every outbound call is intercepted. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const APP = path.resolve(__dirname, '..');
/* Storage correction (PR #131): the ownership store is the REAL verified adapter over the REAL
   @netlify/blobs client and the wire harness (harness/v2-lambda-compat.cjs); the executed-artifact
   bytes live in their own real stores on the same wire. Handlers are modern-runtime functions on a
   published production deploy with an open activation (fixture records). `receipts` is the
   compat Map-like view of `iaos-ownership-v2`; `blobsData` below is a small view over the two
   executed-artifact stores so the existing byte-tampering cases keep their meaning. */
process.env.IAOS_ENV = 'test';
require('./harness/ts-loader.cjs');
const { createCompat, v2Id } = require('./harness/v2-lambda-compat.cjs');
const compat = createCompat();
const { receipts, wire } = compat;
const UPLOADS = 'iaos-executed-artifact-uploads';
const ARTIFACTS = 'iaos-executed-artifacts';
const rawStore = (name) => { if (!wire.stores.has('site:' + name)) wire.stores.set('site:' + name, new Map()); return wire.stores.get('site:' + name); };
let tamperSeq = 0;
const blobsData = {
  has: (k) => rawStore(ARTIFACTS).has(k) || rawStore(UPLOADS).has(k),
  /** The whole stored record (bytes, etag, metadata) -- restored as-is by set(). */
  get: (k) => { const r = rawStore(ARTIFACTS).get(k) || rawStore(UPLOADS).get(k); return r ? { ...r } : undefined; },
  /** A record from get() restores it; a Buffer replaces only the bytes (metadata kept, new etag). */
  set: (k, v) => {
    const name = rawStore(UPLOADS).has(k) ? UPLOADS : ARTIFACTS;
    const cur = rawStore(name).get(k) || { meta: null, contentType: null };
    if (Buffer.isBuffer(v)) rawStore(name).set(k, { ...cur, body: v, etag: `"w-tamper-${++tamperSeq}"` });
    else if (v) rawStore(name).set(k, { ...v });
  },
  delete: (k) => { rawStore(ARTIFACTS).delete(k); rawStore(UPLOADS).delete(k); },
};
process.env.IAOS_APP_WRITE_GOOGLE_CLIENT_ID = 'offline-client';
process.env.IAOS_APP_WRITE_ALLOWED_ORIGIN = 'https://proof.example.invalid';
process.env.IAOS_APP_WRITE_BRAD_EMAILS = 'brad@example.invalid';
process.env.IAOS_APP_WRITE_SESSION_SECRET = 'offline-fixture-only-not-a-real-secret';

const load=name=>require('../src/lib/'+name+'.ts');
const config=require('../shared/ghl-config.ts').getConfig('test');
const { UNDER_CONTRACT_STAGE_NOT_PROVISIONED } = require('../shared/ghl-config.ts');
const auth=require('../netlify/functions/lib/app-write-auth.ts');
const handler=compat.handlerOf(require('../netlify/functions/ghl-write.ts'),'ghl-write');
const uploadHandler=compat.handlerOf(require('../netlify/functions/ghl-executed-artifact-upload.ts'),'ghl-executed-artifact-upload');
/* Storage correction: a test-only pass-through MutationGate for the direct GhlBoundary mechanism
   checks below (a gateless boundary refuses every mutation in v2). It admits, dispatches exactly
   one request and settles -- no storage, no G5. */
const passGate={admit:async()=>({held:null,sent:false,settled:false}),dispatching:async()=>{},send:async(p,owned,onDispatch,request)=>{p.sent=true;onDispatch();return request(undefined);},settle:async(p)=>{p.settled=true;}};
const gatedBoundary=()=>require('../netlify/functions/lib/ghl-write-boundary.ts').configuredBoundary(undefined,passGate);
const contact={id:config.documentsContracts.approvedTestContactId,locationId:config.locationId,customFields:[],firstName:'Jane',lastName:'Seller',email:'seller@example.com',address1:'123 Main St',city:'Austin',state:'TX',postalCode:'78701'};
const opportunity={id:'fixture-opportunity',contactId:contact.id,locationId:config.locationId,customFields:[],pipelineId:config.pipelines.sellerLeads,pipelineStageId:config.stages.newLeadSeller};
// Gate-review closure -- a SECOND fixture opportunity (same contact, its
// own id) so a cross-opportunity session-reuse attempt can be proven
// against a real, independently-resolvable opportunity rather than an
// opaque string the boundary would refuse for unrelated reasons.
const opportunity2={id:'fixture-opportunity-2',contactId:contact.id,locationId:config.locationId,customFields:[],pipelineId:config.pipelines.sellerLeads,pipelineStageId:config.stages.newLeadSeller};
const fixture=require('./write-contract-fixture.cjs').contractFixture(load,opportunity.id);
let notes=[...fixture.notes],writes=0;const at='2026-09-18T01:00:00.000Z',docId='fixture-document';
const requiredResult=load('contract-signer-mapping-model').buildRequiredSignerSet(fixture.report);
const required=requiredResult.signers,buyerRole=requiredResult.buyerRole,buyerDisplayName=requiredResult.buyerDisplayName,buyerEmail=requiredResult.buyerEmail;
const recipients=required.map((s,i)=>({id:i===0?contact.id:'fixture-recipient-'+i,hasCompleted:true,signedDate:at,role:'signer',contactName:s.displayName}));
let documents=[{documentId:docId,locationId:config.locationId,status:'completed',documentRevision:1,updatedAt:at,deleted:false,recipients,links:[{createdBy:config.documentsContracts.senderUserId}],fillableFields:[{isRequired:true}]}];
const reply=data=>({ok:true,status:200,json:async()=>structuredClone(data),text:async()=>JSON.stringify(data)});
const failResponse=(status,body)=>({ok:false,status,json:async()=>body,text:async()=>JSON.stringify(body)});
// Gate-review closure -- stage-transition PUT/readback failure-injection.
// 'apply' (default, normal): PUT mutates opportunity.pipelineStageId and
// every readback reflects it. 'reject': the PUT itself fails (network/HTTP
// error, never applied). 'ignore': PUT reports success but does NOT
// mutate the opportunity (simulates a GHL write that silently didn't
// take). 'wrong-pipeline'/'wrong-stage': the READBACK (a GET, issued
// strictly after the PUT in `transitionOpportunityStage`) reports
// different pipeline/stage data than what was actually requested.
let stagePutMode='apply';
let putIssuedThisAttempt=false;
let failNextNotePost=false;
// Gate-review closure -- fresh stage-reverification-before-disposition-
// write repair, Required Test item 8 ("missing opportunity, or failed
// read creates no handoff note"). Targets requireUnderContractStageConfirmed's
// OWN fresh read specifically (the SECOND GET of this opportunity within
// one validateDerivedNote call -- the FIRST is currentContractContext's
// own earlier, unrelated read), never a PUT, so it never interferes with
// the stage-transition PUT/readback tests above (their own stagePutMode
// toggle) or with currentContractContext's own read succeeding normally.
let opportunityGetCallCount=0;
let failOpportunityGetCallNumber=0;
/* Storage correction: blob traffic that does not go through the verified adapter (the raw SDK read of the
   preserved artifact in write-derived-note.ts) reaches global fetch; it is routed to the same wire. */
global.fetch=async(url,init={})=>{const u=new URL(url);if(u.origin===wire.EDGE||u.origin===wire.UNCACHED)return wire.fetch(url,init);assert.equal(u.origin,'https://services.leadconnectorhq.com');if(u.pathname==='/proposals/document')return reply({documents});if(u.pathname==='/opportunities/'+opportunity.id){
  if(init.method!=='PUT'){opportunityGetCallCount++;if(opportunityGetCallCount===failOpportunityGetCallNumber)return failResponse(503,{error:'simulated transient GHL outage'});}
  if(init.method==='PUT'){
    putIssuedThisAttempt=true;
    if(stagePutMode==='reject')return failResponse(500,{error:'simulated GHL failure'});
    const b=JSON.parse(init.body);
    if(typeof b.pipelineStageId==='string' && stagePutMode!=='ignore')opportunity.pipelineStageId=b.pipelineStageId;
    return reply({opportunity});
  }
  if(putIssuedThisAttempt && stagePutMode==='wrong-pipeline')return reply({opportunity:{...opportunity,pipelineId:'some-other-pipeline-from-readback'}});
  if(putIssuedThisAttempt && stagePutMode==='wrong-stage')return reply({opportunity:{...opportunity,pipelineStageId:config.stages.sellerClosedWon}});
  return reply({opportunity});
}if(u.pathname==='/opportunities/'+opportunity2.id)return reply({opportunity:opportunity2});if(u.pathname==='/contacts/'+contact.id)return reply({contact});if(u.pathname==='/contacts/'+contact.id+'/notes'){if(init.method==='POST'){if(failNextNotePost){failNextNotePost=false;return failResponse(500,{error:'simulated note-write failure'});}writes++;const note={id:'note-'+notes.length,body:JSON.parse(init.body).body};notes.push(note);return reply({note});}return reply({notes});}throw Error('Unexpected request '+u.pathname);};
const outcome=()=>({kind:'http_response',status:200,body:{documents}});
const summary=load('contract-send-model').classifyDocumentReadback({expectedDocumentId:docId,expectedRecipientId:contact.id,expectedSenderUserId:config.documentsContracts.senderUserId,expectedLocationId:config.locationId,outcome:outcome()}).summary;
const send={opportunityId:opportunity.id,at,operator:'brad',attemptId:at,status:'accepted',version:fixture.version,templateName:config.documentsContracts.expectedTemplateName,templateSource:'ghl_documents_contracts',requestedTemplateId:config.documentsContracts.templateId,authorizedAt:fixture.authorization.at,authorizedArtifactSha256:fixture.authorization.artifactSha256,signers:required,confirmedRecipientId:contact.id,expirationAt:'2026-10-20T00:00:00.000Z',requestAt:at,iaosObservedAcceptanceAt:at,providerResponse:summary,failureReason:null};
const sendNote=load('contract-send-carriers').formatContractSendNote;
notes.push({body:sendNote({...send,status:'in_progress',confirmedRecipientId:null,iaosObservedAcceptanceAt:null,providerResponse:null})});
const mapping=load('contract-signer-mapping-model').buildSignerMappingAttestationRecordArgs({opportunityId:opportunity.id,version:fixture.version,agreementAt:fixture.version.agreementAt,providerDocumentId:docId,providerDocumentRevision:1,acceptedSendAttemptId:at,attestedAt:at,requiredSigners:required,availableProviderRecipientIds:recipients.map(r=>r.id),assignments:required.map((s,i)=>({role:s.role,providerRecipientId:recipients[i].id})),evidenceSummary:'Synthetic operator mapping'});
assert.equal(mapping.ok,true,JSON.stringify(mapping));
const hash=require('node:crypto').createHash('sha256').update('%PDF-1.4 synthetic offline fixture').digest('hex');
const checklist=load('contract-executed-terms-attestation-model').buildExecutedTermsChecklist({agreement:{price:190000,propertyAddress:'123 Main St, Austin, TX, 78701',parties:[]},buyerIdentity:'BTC LLC',expectedSigners:required});
const attestation=load('contract-executed-terms-attestation-model').buildExecutedTermsAttestationRecordArgs({opportunityId:opportunity.id,version:fixture.version,agreementAt:fixture.version.agreementAt,providerDocumentId:docId,providerDocumentRevision:1,selectedArtifactSha256:hash,attestedAt:at,requiredItems:checklist,responses:checklist.map(i=>({kind:i.kind,signerRole:i.signerRole,result:'MATCHES'})),evidenceSummary:'Synthetic visual comparison'});assert.equal(attestation.ok,true);
const observed=load('contract-lifecycle-model').buildProviderObservationRecordFromReadback({opportunityId:opportunity.id,version:fixture.version,expectedDocumentId:docId,expectedLocationId:config.locationId,acceptedSend:send,outcome:outcome(),iaosObservedAt:at,evidenceSummary:'Synthetic provider evidence',relatedPriorRecordId:null});assert.equal(observed.ok,true,JSON.stringify(observed));
const rows=load('contract-execution-model').extractProviderSignerRowsFromListDocumentsBody({body:{documents},expectedDocumentId:docId,expectedLocationId:config.locationId});assert.equal(rows.ok,true);
const execution=load('contract-execution-model').buildVerifiedUnderContractRecord({opportunityId:opportunity.id,agreementAt:fixture.version.agreementAt,version:fixture.version,acceptedSend:send,requiredSigners:required,buyerSignerRole:buyerRole,authorizedBuyerName:buyerDisplayName,authorizedBuyerEmail:buyerEmail,signerMappingAttestation:mapping.value,providerRecipients:rows.rows,lifecycleHistory:[observed.value],manualArtifactOutcome:{kind:'selected',sha256:hash,fileName:'fixture.pdf',mimeType:'application/pdf',pageCount:5},selectedForDocumentId:docId,selectedForVersion:fixture.version,executedTermsAttestation:attestation.value,iaosVerifiedAt:at,evidenceSummary:'Synthetic joint verification',relatedPriorRecordId:null});assert.equal(execution.ok,true,JSON.stringify(execution));
let n=0,count=0;
async function invoke(body){return handler({blobs:Buffer.from(JSON.stringify({url:'https://blobs.example.invalid',
 token:'offline-blob-fixture'})).toString('base64'),httpMethod:'POST',
 headers:{'x-nf-site-id':'offline-site','x-nf-deploy-id':'offline-deploy',origin:process.env.IAOS_APP_WRITE_ALLOWED_ORIGIN,authorization:'Bearer '+auth.issueAppSession('brad@example.invalid').token},body:JSON.stringify({operation:'note.create',targetId:contact.id,args:{body},requestId:(++n,v2Id())})});}
async function check(name,fn){await fn();console.log('PASS '+name);count++;}
// A case left failing as a SUSPECTED PRODUCTION BUG (reported, not adjusted): it is recorded and the run
// continues so the remaining cases still execute; the suite then exits non-zero.
const suspected=[];
async function checkSuspectedBug(name,fn){try{await fn();console.log('PASS '+name);count++;}catch(e){suspected.push(name);console.log('FAIL (suspected production bug) '+name+'\n  '+String(e&&e.message||e).split('\n').join('\n  '));process.exitCode=1;}}
async function invokeOp(operation,targetId,args){return handler({blobs:Buffer.from(JSON.stringify({url:'https://blobs.example.invalid',
 token:'offline-blob-fixture'})).toString('base64'),httpMethod:'POST',
 headers:{'x-nf-site-id':'offline-site','x-nf-deploy-id':'offline-deploy',origin:process.env.IAOS_APP_WRITE_ALLOWED_ORIGIN,authorization:'Bearer '+auth.issueAppSession('brad@example.invalid').token},body:JSON.stringify({operation,targetId,args,requestId:(++n,v2Id())})});}
async function invokeUpload(body){return uploadHandler({blobs:Buffer.from(JSON.stringify({url:'https://blobs.example.invalid',
 token:'offline-blob-fixture'})).toString('base64'),httpMethod:'POST',
 headers:{'x-nf-site-id':'offline-site','x-nf-deploy-id':'offline-deploy',origin:process.env.IAOS_APP_WRITE_ALLOWED_ORIGIN,authorization:'Bearer '+auth.issueAppSession('brad@example.invalid').token},body:JSON.stringify(body)});}
// Board #9 Phase B gate-review, item D -- downstream-control render-gate
// sequence, proven against REAL parsed durable records written through the
// actual server handler above (never hand-typed structural stand-ins; see
// contract-workspace-view.ts's own predicate unit tests for that separate,
// narrower coverage). Snapshots are taken at each real milestone below.
const authNote={body:load('contract-authorization-carriers').formatBradContractAuthorizationNote(fixture.authorization)};
let notesAtAuthorizedOnly,notesAtAcceptedSend,notesAtUnderContract;

(async()=>{
notesAtAuthorizedOnly=[...notes,authNote];
await check('accepted send ledger requires fresh matching provider evidence',async()=>{const res=await invoke(sendNote(send));assert.equal(res.statusCode,200,res.body);});
notesAtAcceptedSend=[...notes,authNote];
await check('signer mapping attestation retained',async()=>{const res=await invoke(load('contract-signer-mapping-carriers').formatSignerMappingAttestationNote(mapping.value));assert.equal(res.statusCode,200,res.body);});
await check('executed terms attestation retained',async()=>{const res=await invoke(load('contract-executed-terms-attestation-carriers').formatExecutedTermsAttestationNote(attestation.value));assert.equal(res.statusCode,200,res.body);});
// Gate-review closure -- narrow post-attestation safety repair. DEFECT:
// a second click of "Record attestation" had nothing server-side
// stopping a duplicate durable write for the exact same evidence. A
// fresh requestId each call (see invoke()) means claimWrite's own
// per-requestId idempotency cannot be what refuses this -- only the new
// write-note-guard.ts duplicate-evidence check can.
await check('duplicate executed-terms attestation for the exact same evidence is refused -- no second note written',async()=>{const before=writes;const res=await invoke(load('contract-executed-terms-attestation-carriers').formatExecutedTermsAttestationNote(attestation.value));assert.equal(res.statusCode,409,res.body);assert.equal(writes,before);});
await check('provider lifecycle observation independently confirmed',async()=>{const res=await invoke(load('contract-lifecycle-carriers').formatContractLifecycleNote(observed.value));assert.equal(res.statusCode,200,res.body);});
await check('duplicate document identity refuses provider evidence',async()=>{documents.push({...documents[0]});const before=writes;assert.equal((await invoke(load('contract-lifecycle-carriers').formatContractLifecycleNote(observed.value))).statusCode,409);assert.equal(writes,before);documents.pop();});
await check('fabricated provider completion rejected',async()=>{const before=writes;const forged={...observed.value,providerReportedAt:'2026-09-19T00:00:00.000Z'};assert.equal((await invoke(load('contract-lifecycle-carriers').formatContractLifecycleNote(forged))).statusCode,409);assert.equal(writes,before);});
await check('Under Contract independently rebuilds all evidence',async()=>{const res=await invoke(load('contract-execution-carriers').formatUnderContractNote(execution.value));assert.equal(res.statusCode,200,res.body);});
notesAtUnderContract=[...notes,authNote];
await check('duplicate Under Contract rejected',async()=>{const before=writes;assert.equal((await invoke(load('contract-execution-carriers').formatUnderContractNote(execution.value))).statusCode,409);assert.equal(writes,before);});
await check('incomplete provider signer refuses execution',async()=>{documents[0].recipients[0].hasCompleted=false;const before=writes;assert.equal((await invoke(load('contract-execution-carriers').formatUnderContractNote({...execution.value,iaosVerifiedAt:'2026-09-18T02:00:00.000Z'}))).statusCode,409);assert.equal(writes,before);documents[0].recipients[0].hasCompleted=true;});
// Gate-review closure (§5 ruling) -- the disposition-handoff checks that
// USED to run here have been moved to the end of this file. The server
// now independently re-verifies the preserved artifact AND the live GHL
// stage before permitting a handoff write, so those checks can only run
// once fixture.version has BOTH established -- i.e. after the artifact-
// preservation and stage-transition sections below.

// ============================================================
// Board #9 Phase B gate-review, item D -- render-gate sequence, against
// the REAL parsed records durably written above (never a hand-typed
// stand-in). Each stage recomputes `screen` fresh from that stage's own
// notes snapshot via the SAME canonical resolution functions
// ContractWorkspace.tsx itself uses (latestBradContractAuthorizationForOpportunity,
// latestContractSendForOpportunity, allUnderContractRecordsForOpportunity),
// proving later controls genuinely do not appear before their own
// preceding durable evidence exists -- not merely that the pure boolean
// predicates return the right answer for a synthetic input.
// ============================================================
{
  const V=load('contract-workspace-view');
  const screenFor=(notesSnapshot)=>V.computeContractScreenState({loading:false,fetchError:null,candidates:[{id:opportunity.id}],selected:{id:opportunity.id},notes:notesSnapshot,propertyAddress:'123 Main St, Austin, TX, 78701'});

  const screen0=screenFor(notesAtAuthorizedOnly);
  const record0=load('contract-authorization-carriers').latestBradContractAuthorizationForOpportunity(notesAtAuthorizedOnly,opportunity.id);
  const send0=load('contract-send-carriers').latestContractSendForOpportunity(notesAtAuthorizedOnly,opportunity.id);
  const uc0=load('contract-execution-carriers').allUnderContractRecordsForOpportunity(notesAtAuthorizedOnly,opportunity.id)[0]??null;
  await check('stage 1 (authorized, no send yet): Record GHL Send is offered',async()=>{assert.equal(V.showRecordGhlSendControl(screen0,record0,send0),true);});
  await check('stage 1: Verify Execution is NOT offered -- no send exists yet',async()=>{assert.equal(V.showVerifyExecutionControl(send0),false);});
  await check('stage 1: Start Disposition is NOT offered -- no Under Contract record exists yet',async()=>{assert.equal(V.showDispositionHandoffControl(uc0),false);});

  const screen1=screenFor(notesAtAcceptedSend);
  const record1=load('contract-authorization-carriers').latestBradContractAuthorizationForOpportunity(notesAtAcceptedSend,opportunity.id);
  const send1=load('contract-send-carriers').latestContractSendForOpportunity(notesAtAcceptedSend,opportunity.id);
  const uc1=load('contract-execution-carriers').allUnderContractRecordsForOpportunity(notesAtAcceptedSend,opportunity.id)[0]??null;
  await check('stage 2 (send accepted, verified live by the server above): Record GHL Send steps aside',async()=>{assert.equal(V.showRecordGhlSendControl(screen1,record1,send1),false);});
  await check('stage 2: Verify Execution & Under Contract is now offered',async()=>{assert.equal(V.showVerifyExecutionControl(send1),true);});
  await check('stage 2: Start Disposition is STILL NOT offered -- no Under Contract record exists yet',async()=>{assert.equal(V.showDispositionHandoffControl(uc1),false);});

  const uc2=load('contract-execution-carriers').allUnderContractRecordsForOpportunity(notesAtUnderContract,opportunity.id)[0]??null;
  await check('stage 3 (Under Contract independently rebuilt and verified by the server above): Start Disposition is now offered',async()=>{assert.equal(V.showDispositionHandoffControl(uc2),true);});
  await check('stage 3: the resolved Under Contract record is the REAL server-verified one, not a stand-in',async()=>{assert.equal(uc2!==null&&uc2.iaosVerifiedAt===execution.value.iaosVerifiedAt,true);});
}

// ============================================================
// B9-13/INV-96 manual GHL send bridge -- server-level coverage. A
// completed, externally (Brad-)performed GHL send, never dispatched by
// IAOS's own automated sender identity -- see contract-manual-send-model.ts
// and write-note-guard.ts/write-derived-note.ts's own manual-bridge
// branches. Distinct document id, never reused from the automated-path
// fixture above.
// ============================================================
const manualDocId='fixture-document-manual';
documents.push({documentId:manualDocId,locationId:config.locationId,status:'completed',documentRevision:1,updatedAt:at,deleted:false,recipients:[{id:'whoever-brad-actually-sent-to'}],links:[{createdBy:'brads-own-human-ghl-user-id'}],fillableFields:[{isRequired:true}]});
const manualAt='2026-09-20T15:28:00.000Z';
// A DISTINCT contract version (a same-agreement re-entry, not a new
// agreement) -- the automated-path check above already recorded an
// ACCEPTED send for fixture.version itself, and only one accepted send
// may ever exist per exact version (write-note-guard.ts's own conflict
// guard, exercised below). Reusing fixture.version here would collide
// with that fixture, not with anything this repair is actually testing.
const manualVersion=load('board9-contract-model').nextVersionIdentity(fixture.version,{kind:'same_agreement_reentry'},null).value;
const manualAuthorizedRecord=Object.assign({},fixture.authorization,{version:manualVersion});
const buildManual=(over)=>load('contract-manual-send-model').buildManualContractSendRecordArgs(Object.assign({
  opportunityId:opportunity.id,agreementAt:fixture.version.agreementAt,version:manualVersion,requestAt:manualAt,expirationAt:null,
  providerDocumentId:manualDocId,providerDocumentReference:null,providerDocumentRevision:1,recipients:required,
  authorizedRecord:manualAuthorizedRecord,templateName:config.documentsContracts.expectedTemplateName,
  requestedTemplateId:config.documentsContracts.templateId,readbackLocationId:config.locationId,operator:'brad',recordedAt:manualAt,
},over||{}));
const manualBuilt=buildManual();
assert.equal(manualBuilt.ok,true,JSON.stringify(manualBuilt));
await check('manual send: success -- independently confirmed against live provider evidence, no reservation note required',async()=>{
  const res=await invoke(sendNote(manualBuilt.value));assert.equal(res.statusCode,200,res.body);
});
await check('manual send: duplicate (same attemptId) refused',async()=>{
  const before=writes;assert.equal((await invoke(sendNote(manualBuilt.value))).statusCode,409);assert.equal(writes,before);
});
await check('manual send: a second, DIFFERENT attemptId accepted for the same exact version is a conflicting duplicate, refused',async()=>{
  const before=writes;const conflicting=buildManual({requestAt:'2026-09-20T15:29:00.000Z',recordedAt:'2026-09-20T15:29:00.000Z'});assert.equal(conflicting.ok,true);
  assert.equal((await invoke(sendNote(conflicting.value))).statusCode,409);assert.equal(writes,before);
});
await check('manual send: mismatch -- claimed document does not exist live, refused',async()=>{
  const before=writes;const wrong=buildManual({requestAt:'2026-09-20T15:30:00.000Z',recordedAt:'2026-09-20T15:30:00.000Z',providerDocumentId:'document-that-was-never-sent'});assert.equal(wrong.ok,true);
  assert.equal((await invoke(sendNote(wrong.value))).statusCode,409);assert.equal(writes,before);
});
await check('manual send: stale -- entered revision no longer matches the live document revision, refused',async()=>{
  const before=writes;const stale=buildManual({requestAt:'2026-09-20T15:31:00.000Z',recordedAt:'2026-09-20T15:31:00.000Z',providerDocumentRevision:99});assert.equal(stale.ok,true);
  assert.equal((await invoke(sendNote(stale.value))).statusCode,409);assert.equal(writes,before);
});
await check('manual send: malformed -- wrong requestedTemplateId (config drift/forgery) refused',async()=>{
  const before=writes;const wrongTemplate={...manualBuilt.value,attemptId:'2026-09-20T15:32:00.000Z',requestAt:'2026-09-20T15:32:00.000Z',requestedTemplateId:'not-the-configured-template'};
  assert.equal((await invoke(sendNote(wrongTemplate))).statusCode,409);assert.equal(writes,before);
});
await check('manual send: readback failure -- live provider fetch itself errors, refused (write never trusts an unconfirmed claim)',async()=>{
  const before=writes;const savedFetch=global.fetch;
  global.fetch=async(url)=>{const u=new URL(url);if(u.pathname==='/proposals/document')return{ok:false,status:503,json:async()=>({}),text:async()=>'{}'};return savedFetch(url);};
  try{
    const failed=buildManual({requestAt:'2026-09-20T15:33:00.000Z',recordedAt:'2026-09-20T15:33:00.000Z'});assert.equal(failed.ok,true);
    assert.equal((await invoke(sendNote(failed.value))).statusCode,409);
  }finally{global.fetch=savedFetch;}
  assert.equal(writes,before);
});

// ============================================================
// Gate-review closure -- PR #85 live-Test proof, attempt #3. The exact
// "Ambiguous document readback" condition, proven and repaired:
// `providerOutcome`'s uniqueness check used to scan the ENTIRE
// `/proposals/document` listing for ANY duplicate (or any entry missing
// a) documentId, unrelated to the document actually being verified --
// so an unrelated pair of documents elsewhere in the location's history
// could block confirmation of a completely unambiguous target. Fixed to
// scope the uniqueness check to exactly the submitted providerDocumentId
// (write-derived-note.ts). These checks use FRESH contract versions
// (chained off manualVersion) so each is isolated from the
// already-accepted send at manualVersion above.
// ============================================================
{
  const B9c = load('board9-contract-model');
  const v1 = B9c.nextVersionIdentity(manualVersion, { kind: 'same_agreement_reentry' }, null).value;
  const v2 = B9c.nextVersionIdentity(v1, { kind: 'same_agreement_reentry' }, null).value;
  const v3 = B9c.nextVersionIdentity(v2, { kind: 'same_agreement_reentry' }, null).value;
  const v4 = B9c.nextVersionIdentity(v3, { kind: 'same_agreement_reentry' }, null).value;
  const v5 = B9c.nextVersionIdentity(v4, { kind: 'same_agreement_reentry' }, null).value;
  const v6 = B9c.nextVersionIdentity(v5, { kind: 'same_agreement_reentry' }, null).value;
  function captureConsoleError(run) {
    const calls = []; const original = console.error;
    console.error = (...args) => { calls.push(args); };
    return Promise.resolve().then(run).finally(() => { console.error = original; }).then(() => calls);
  }
  const authFor = (v) => Object.assign({}, fixture.authorization, { version: v });
  const buildManualFor = (v, over) => load('contract-manual-send-model').buildManualContractSendRecordArgs(Object.assign({
    opportunityId: opportunity.id, agreementAt: fixture.version.agreementAt, version: v, requestAt: over.requestAt, expirationAt: null,
    providerDocumentId: manualDocId, providerDocumentReference: null, providerDocumentRevision: 1, recipients: required,
    authorizedRecord: authFor(v), templateName: config.documentsContracts.expectedTemplateName,
    requestedTemplateId: config.documentsContracts.templateId, readbackLocationId: config.locationId, operator: 'brad', recordedAt: over.requestAt,
  }, over));

  await check('manual send readback: two UNRELATED documents elsewhere in the listing sharing one id does not block confirmation of the actual (uniquely-identified) target', async () => {
    documents.push({ documentId: 'unrelated-duplicate-id', locationId: config.locationId, status: 'completed', documentRevision: 1, updatedAt: at, deleted: false, recipients: [], links: [], fillableFields: [{ isRequired: true }] });
    documents.push({ documentId: 'unrelated-duplicate-id', locationId: config.locationId, status: 'completed', documentRevision: 1, updatedAt: at, deleted: false, recipients: [], links: [], fillableFields: [{ isRequired: true }] });
    try {
      const built = buildManualFor(v1, { requestAt: '2026-09-21T21:00:00.000Z' });
      assert.equal(built.ok, true, JSON.stringify(built));
      const res = await invoke(sendNote(built.value));
      assert.equal(res.statusCode, 200, res.body);
    } finally {
      documents.splice(documents.length - 2, 2);
    }
  });

  await check('manual send readback: several older, unrelated completed documents (all distinct ids) do not interfere with the target', async () => {
    const injected = [
      { documentId: 'older-completed-1', locationId: config.locationId, status: 'completed', documentRevision: 1, updatedAt: at, deleted: false, recipients: [], links: [], fillableFields: [{ isRequired: true }] },
      { documentId: 'older-completed-2', locationId: config.locationId, status: 'completed', documentRevision: 1, updatedAt: at, deleted: false, recipients: [], links: [], fillableFields: [{ isRequired: true }] },
      { documentId: 'older-draft-1', locationId: config.locationId, status: 'draft', documentRevision: 1, updatedAt: at, deleted: false, recipients: [], links: [], fillableFields: [] },
    ];
    documents.push(...injected);
    try {
      const built = buildManualFor(v2, { requestAt: '2026-09-21T21:01:00.000Z' });
      assert.equal(built.ok, true, JSON.stringify(built));
      const res = await invoke(sendNote(built.value));
      assert.equal(res.statusCode, 200, res.body);
    } finally {
      documents.splice(documents.length - injected.length, injected.length);
    }
  });

  await check('manual send readback: TWO entries sharing the exact submitted providerDocumentId is a genuine conflict, fails closed', async () => {
    const dup = documents.find((d) => d.documentId === manualDocId);
    documents.push(Object.assign({}, dup));
    try {
      const before = writes;
      const built = buildManualFor(v3, { requestAt: '2026-09-21T21:02:00.000Z' });
      assert.equal(built.ok, true, JSON.stringify(built));
      const res = await invoke(sendNote(built.value));
      assert.equal(res.statusCode, 409, res.body);
      assert.equal(writes, before);
    } finally {
      documents.pop();
    }
  });

  await check('manual send readback: a non-array documents[] in the provider response still fails closed', async () => {
    const before = writes; const savedFetch = global.fetch;
    global.fetch = async (url) => { const u = new URL(url); if (u.pathname === '/proposals/document') return { ok: true, status: 200, json: async () => ({ documents: 'not-an-array' }), text: async () => '{}' }; return savedFetch(url); };
    try {
      const built = buildManualFor(v4, { requestAt: '2026-09-21T21:03:00.000Z' });
      assert.equal(built.ok, true, JSON.stringify(built));
      const res = await invoke(sendNote(built.value));
      assert.equal(res.statusCode, 409, res.body);
    } finally { global.fetch = savedFetch; }
    assert.equal(writes, before);
  });

  await check('manual send readback: existing exact-id-absent refusal is unchanged by the scoped fix', async () => {
    const before = writes;
    const missing = buildManualFor(v1, { requestAt: '2026-09-21T21:04:00.000Z', providerDocumentId: 'document-that-was-never-sent-either' });
    assert.equal(missing.ok, true, JSON.stringify(missing));
    assert.equal((await invoke(sendNote(missing.value))).statusCode, 409);
    assert.equal(writes, before);
  });

  // ============================================================
  // Gate-review closure -- Finding H, requirement 5. A provider HTTP
  // failure (401/403/...) must be classified explicitly, never collapsed
  // into "Ambiguous document readback". The client-facing response body
  // is unchanged (still the same generic 409) -- the distinction is
  // proven via the diagnostic log's own errorMessage field.
  // ============================================================
  for (const status of [401, 403]) {
    await check(`manual send readback: provider HTTP ${status} is classified explicitly, never collapsed into "Ambiguous document readback"`, async () => {
      const before = writes; const savedFetch = global.fetch;
      global.fetch = async (url) => { const u = new URL(url); if (u.pathname === '/proposals/document') return { ok: false, status, json: async () => ({ message: 'refused' }), text: async () => '{"message":"refused"}' }; return savedFetch(url); };
      try {
        const built = buildManualFor(status === 401 ? v5 : v6, { requestAt: `2026-09-21T21:0${status === 401 ? 5 : 6}:00.000Z` });
        assert.equal(built.ok, true, JSON.stringify(built));
        const logCalls = await captureConsoleError(async () => {
          const res = await invoke(sendNote(built.value));
          assert.equal(res.statusCode, 409, res.body);
        });
        assert.equal(logCalls.length, 1, 'exactly one diagnostic log entry');
        const logged = JSON.parse(logCalls[0][1]);
        assert.equal(logged.errorMessage, `Provider document readback failed (HTTP ${status})`);
        assert.notEqual(logged.errorMessage, 'Ambiguous document readback');
        assert.equal(JSON.stringify(logged).includes('refused'), false, 'the provider response body is never logged');
      } finally { global.fetch = savedFetch; }
      assert.equal(writes, before);
    });
  }
}

// ============================================================
// Board #9 Phase B (B9-13) -- executed-PDF chunked preservation, server
// level. Uses `fixture.version` -- by this point in the file it already
// carries a durably-written, server-verified Under Contract record
// (`execution.value`, "Under Contract independently rebuilds all
// evidence" above), which is exactly the record the stage-transition
// tests below need too.
// ============================================================
{
  const cryptoMod = require('node:crypto');
  const pdfBytes = Buffer.from('%PDF-1.4\n' + 'A'.repeat(500) + '\n%%EOF');
  const CHUNK = 137; // small and deliberate -- forces a real multi-chunk reassembly for a ~514-byte fixture, without needing a multi-MB test payload.
  const splitChunks = (buf, size) => { const out = []; for (let i = 0; i < buf.length; i += size) out.push(buf.subarray(i, i + size)); return out; };
  const sha256Hex = (buf) => cryptoMod.createHash('sha256').update(buf).digest('hex');
  // Gate-review closure -- PR #85 chunk-ingestion redesign. Every chunk
  // (and finalize) request now carries its own complete, immutable
  // description of the upload it belongs to -- including the FULL
  // file's expected SHA-256, computed here exactly as the real client
  // computes it during local selection, before any chunk is ever sent.
  const uploadChunks = async (uploadId, buf, fileName, version) => {
    version = version || fixture.version;
    const chunks = splitChunks(buf, CHUNK);
    const expectedFullSha256 = sha256Hex(buf);
    for (let i = 0; i < chunks.length; i++) {
      const res = await invokeUpload({ phase: 'chunk', opportunityId: opportunity.id, agreementAt: fixture.version.agreementAt, version, uploadId, chunkIndex: i, chunkCount: chunks.length, totalByteCount: buf.length, originalFileName: fileName, expectedFullSha256, chunkBase64: chunks[i].toString('base64') });
      if (res.statusCode !== 200) throw new Error('chunk ' + i + ' rejected: ' + res.body);
    }
    return chunks.length;
  };
  const finalizeArgs = (uploadId, buf, fileName, version, providerDocumentId, overrides) => Object.assign({
    phase: 'finalize', opportunityId: opportunity.id, agreementAt: fixture.version.agreementAt, version: version || fixture.version,
    uploadId, providerDocumentId, chunkCount: splitChunks(buf, CHUNK).length, totalByteCount: buf.length, originalFileName: fileName, expectedFullSha256: sha256Hex(buf),
  }, overrides || {});

  await check('artifact upload: unauthenticated request refused before any chunk is touched', async () => {
    const res = await uploadHandler({ blobs: Buffer.from(JSON.stringify({ url: 'https://blobs.example.invalid', token: 'offline-blob-fixture' })).toString('base64'), httpMethod: 'POST', headers: { origin: process.env.IAOS_APP_WRITE_ALLOWED_ORIGIN }, body: JSON.stringify({ phase: 'chunk', opportunityId: opportunity.id, agreementAt: fixture.version.agreementAt, version: fixture.version, uploadId: 'unauth', chunkIndex: 0, chunkCount: 1, totalByteCount: 1, originalFileName: 'x.pdf', expectedFullSha256: 'a'.repeat(64), chunkBase64: 'AA==' }) });
    assert.equal(res.statusCode, 401, res.body);
  });

  await check('artifact upload: success -- all chunks accepted, finalize locates every one independently, reassembles, hashes, stores, and independently re-reads/re-verifies before recording metadata', async () => {
    await uploadChunks('upload-1', pdfBytes, 'executed.pdf');
    const res = await invokeUpload(finalizeArgs('upload-1', pdfBytes, 'executed.pdf', fixture.version, docId));
    assert.equal(res.statusCode, 200, res.body);
    const body = JSON.parse(res.body);
    assert.equal(body.preserved, true);
    assert.equal(body.alreadyPreserved, false);
    assert.equal(body.byteCount, pdfBytes.length);
    assert.equal(body.sha256, sha256Hex(pdfBytes));
    assert.equal(body.artifact.originalFileName, 'executed.pdf');
    assert.equal(body.artifact.providerDocumentId, docId);
  });

  // Gate-review closure -- PR #85 preservation-sequencing repair,
  // requirements 8-9. This point in the file already carries a durably-
  // written, server-verified Under Contract record for fixture.version,
  // written BEFORE this preservation just now (out-of-order, mirroring
  // the real live Test note JzKxKVFS5GxYiuWHpfTD). Preservation landing
  // AFTER it must reconcile the exact evidence without ever writing a
  // second Under Contract note -- the server never enforced write
  // ordering between these two note kinds to begin with, so this proves
  // the existing historical-evidence note is genuinely untouched.
  await check('preservation-sequencing repair: an existing (out-of-order) Under Contract record reconciles with LATER-recorded preservation, never duplicated', async () => {
    const B9d = load('board9-contract-model');
    const ucRecords = load('contract-execution-carriers').allUnderContractRecordsForOpportunity(notes, opportunity.id)
      .filter((r) => r.agreementAt === fixture.version.agreementAt && B9d.isSameContractVersion(r.version, fixture.version));
    assert.equal(ucRecords.length, 1, 'exactly one Under Contract record for this exact evidence, never duplicated by a later preservation');
    assert.equal(ucRecords[0].iaosVerifiedAt, execution.value.iaosVerifiedAt, 'the pre-existing Under Contract record itself is untouched -- same verified-at identity as originally written');
    const preserved = load('contract-executed-artifact-carriers').latestPreservedExecutedArtifactForVersion(notes, opportunity.id, fixture.version.agreementAt, fixture.version);
    assert.equal(preserved !== null, true, 'the preservation record now also exists for this exact evidence -- sequence-complete');
  });

  // ============================================================
  // Gate-review closure -- PR #85 chunk-ingestion redesign. The prior
  // (already-repaired) bounded-retry design still required chunk N to
  // read a manifest chunk N-1 had just written and raced Netlify Blobs'
  // eventual consistency in the real Test environment (proven live:
  // chunk 1 refused OUT_OF_ORDER_CHUNK immediately after chunk 0's own
  // 200, THREE separate times, invocation 140cf61f among them). This
  // redesign removes that dependency structurally: a chunk is accepted
  // purely against its OWN deterministic key, with no ordering
  // requirement of any kind.
  // ============================================================
  await check('chunk-ingestion redesign: chunks 1, 2, and 3 each succeed with NO prior chunk ever sent and no manifest of any kind readable -- proving requirement 1/13 directly', async () => {
    const chunks = splitChunks(pdfBytes, CHUNK); // 4 chunks for this fixture
    const expectedFullSha256 = sha256Hex(pdfBytes);
    for (const i of [1, 2, 3]) {
      const res = await invokeUpload({ phase: 'chunk', opportunityId: opportunity.id, agreementAt: fixture.version.agreementAt, version: fixture.version, uploadId: 'no-chunk-0-ever-sent', chunkIndex: i, chunkCount: chunks.length, totalByteCount: pdfBytes.length, originalFileName: 'executed.pdf', expectedFullSha256, chunkBase64: chunks[i].toString('base64') });
      assert.equal(res.statusCode, 200, res.body);
      assert.equal(JSON.parse(res.body).duplicate, false);
    }
    await invokeUpload({ phase: 'abort', opportunityId: opportunity.id, agreementAt: fixture.version.agreementAt, version: fixture.version, uploadId: 'no-chunk-0-ever-sent' });
  });

  await check('chunk-ingestion redesign: out-of-order arrival (3, 1, 0, 2) is entirely safe -- finalize still locates and reassembles every chunk correctly regardless of arrival order', async () => {
    const uploadId = 'out-of-order-arrival';
    const chunks = splitChunks(pdfBytes, CHUNK);
    const expectedFullSha256 = sha256Hex(pdfBytes);
    for (const i of [3, 1, 0, 2]) {
      const res = await invokeUpload({ phase: 'chunk', opportunityId: opportunity.id, agreementAt: fixture.version.agreementAt, version: fixture.version, uploadId, chunkIndex: i, chunkCount: chunks.length, totalByteCount: pdfBytes.length, originalFileName: 'executed.pdf', expectedFullSha256, chunkBase64: chunks[i].toString('base64') });
      assert.equal(res.statusCode, 200, res.body);
    }
    const res = await invokeUpload(finalizeArgs(uploadId, pdfBytes, 'executed.pdf', fixture.version, docId));
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(JSON.parse(res.body).alreadyPreserved, true); // fixture.version already preserved above; still a correct, verified no-op
  });

  await check('chunk-ingestion redesign: finalization waits for/handles a chunk not yet visible -- bounded visibility handling resolves a simulated delayed-visibility chunk without needing any ordering guarantee', async () => {
    const uploadId = 'finalize-bounded-visibility';
    const chunks = splitChunks(pdfBytes, CHUNK);
    const expectedFullSha256 = sha256Hex(pdfBytes);
    const chunkKeys = [];
    const B9k = load('board9-contract-model');
    for (let i = 0; i < chunks.length; i++) {
      const res = await invokeUpload({ phase: 'chunk', opportunityId: opportunity.id, agreementAt: fixture.version.agreementAt, version: fixture.version, uploadId, chunkIndex: i, chunkCount: chunks.length, totalByteCount: pdfBytes.length, originalFileName: 'executed.pdf', expectedFullSha256, chunkBase64: chunks[i].toString('base64') });
      assert.equal(res.statusCode, 200, res.body);
    }
    // Simulate the LAST chunk's own key not yet being visible to finalize's
    // own read for its first two attempts -- a genuine eventual-consistency
    // delay, never dependent on any OTHER chunk or a shared manifest.
    const lastChunkKey = `sessions/${opportunity.id}/${load('contract-executed-artifact-storage-model').contractVersionStorageKey(fixture.version)}/${uploadId}/chunk-${chunks.length - 1}`;
    /* Storage correction: chunk reads are strong in v2 (no eventual fallback); the delayed visibility
       is now a real 404 on the strong (uncached) origin for the key's first two reads, on the wire. */
    const delayed = wire.on(wire.get(UPLOADS, lastChunkKey), wire.status(404), 2);
    try {
      const res = await invokeUpload(finalizeArgs(uploadId, pdfBytes, 'executed.pdf', fixture.version, docId));
      assert.equal(res.statusCode, 200, res.body);
    } finally {
      assert.equal(delayed.used, 2, 'the injected delayed visibility was genuinely exercised by the bounded retry, never skipped');
    }
  });

  await check('abandoned session: an orphaned partial upload (chunk 0 only, never finalized or aborted) never counts as preserved evidence and never blocks a fresh attempt under a new uploadId', async () => {
    const chunks = splitChunks(pdfBytes, CHUNK);
    const expectedFullSha256 = sha256Hex(pdfBytes);
    const orphanRes = await invokeUpload({ phase: 'chunk', opportunityId: opportunity.id, agreementAt: fixture.version.agreementAt, version: fixture.version, uploadId: 'abandoned-orphan-session', chunkIndex: 0, chunkCount: chunks.length, totalByteCount: pdfBytes.length, originalFileName: 'executed.pdf', expectedFullSha256, chunkBase64: chunks[0].toString('base64') });
    assert.equal(orphanRes.statusCode, 200, orphanRes.body);
    // Preserved evidence is resolved ONLY from durable notes -- an orphaned
    // pending session in the uploads store can never be mistaken for it.
    const preserved = load('contract-executed-artifact-carriers').latestPreservedExecutedArtifactForVersion(notes, opportunity.id, fixture.version.agreementAt, fixture.version);
    assert.equal(preserved !== null, true, 'the earlier, genuine preservation for fixture.version is unaffected by the orphan');
    // A completely fresh attempt under a NEW uploadId is entirely unaffected.
    const freshFirstChunk = await invokeUpload({ phase: 'chunk', opportunityId: opportunity.id, agreementAt: fixture.version.agreementAt, version: fixture.version, uploadId: 'fresh-after-orphan', chunkIndex: 0, chunkCount: chunks.length, totalByteCount: pdfBytes.length, originalFileName: 'executed.pdf', expectedFullSha256, chunkBase64: chunks[0].toString('base64') });
    assert.equal(freshFirstChunk.statusCode, 200, freshFirstChunk.body);
    // Bounded cleanup: the abort phase discovers (by listing this
    // uploadId's own key prefix, never a manifest) and safely discards an
    // abandoned session's pending data.
    const abortRes = await invokeUpload({ phase: 'abort', opportunityId: opportunity.id, agreementAt: fixture.version.agreementAt, version: fixture.version, uploadId: 'abandoned-orphan-session' });
    assert.equal(abortRes.statusCode, 200, abortRes.body);
    assert.equal(JSON.parse(abortRes.body).aborted, true);
    const chunk0Key = `sessions/${opportunity.id}/${load('contract-executed-artifact-storage-model').contractVersionStorageKey(fixture.version)}/abandoned-orphan-session/chunk-0`;
    assert.equal(blobsData.has(chunk0Key), false, 'abort genuinely removed this orphaned chunk\'s stored bytes');
    await invokeUpload({ phase: 'abort', opportunityId: opportunity.id, agreementAt: fixture.version.agreementAt, version: fixture.version, uploadId: 'fresh-after-orphan' });
  });

  await check('artifact upload: identical re-upload (same bytes, same version) is a no-op success -- no duplicate note written', async () => {
    const before = writes;
    await uploadChunks('upload-2', pdfBytes, 'executed.pdf');
    const res = await invokeUpload(finalizeArgs('upload-2', pdfBytes, 'executed.pdf', fixture.version, docId));
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(JSON.parse(res.body).alreadyPreserved, true);
    assert.equal(writes, before);
  });

  await check('artifact upload: conflicting duplicate (different bytes, same exact version) refused, existing artifact untouched', async () => {
    const differentPdf = Buffer.from('%PDF-1.4\n' + 'B'.repeat(500) + '\n%%EOF');
    const before = writes;
    await uploadChunks('upload-3', differentPdf, 'executed.pdf');
    const res = await invokeUpload(finalizeArgs('upload-3', differentPdf, 'executed.pdf', fixture.version, docId));
    assert.equal(res.statusCode, 409, res.body);
    assert.equal(writes, before);
  });

  await check('artifact upload: a missing chunk at finalization returns a safe, specific reason (MISSING_CHUNKS) and creates no receipt', async () => {
    const chunks = splitChunks(pdfBytes, CHUNK);
    const expectedFullSha256 = sha256Hex(pdfBytes);
    await invokeUpload({ phase: 'chunk', opportunityId: opportunity.id, agreementAt: fixture.version.agreementAt, version: fixture.version, uploadId: 'upload-4', chunkIndex: 0, chunkCount: chunks.length, totalByteCount: pdfBytes.length, originalFileName: 'executed.pdf', expectedFullSha256, chunkBase64: chunks[0].toString('base64') });
    const before = writes;
    const res = await invokeUpload(finalizeArgs('upload-4', pdfBytes, 'executed.pdf', fixture.version, docId));
    assert.equal(res.statusCode, 409, res.body);
    const body = JSON.parse(res.body);
    assert.equal(body.error, 'Not all chunks received');
    assert.equal(Array.isArray(body.reasons), true);
    assert.equal(body.reasons[0].code, 'MISSING_CHUNKS');
    assert.equal(typeof body.reasons[0].message, 'string');
    assert.equal(writes, before, 'no receipt/note was created');
    const afterFailure = load('contract-executed-artifact-carriers').latestPreservedExecutedArtifactForVersion(notes, opportunity.id, fixture.version.agreementAt, fixture.version);
    assert.equal(afterFailure.sha256, sha256Hex(pdfBytes), 'the EXISTING fixture.version artifact (from an earlier test) is unaffected -- never a NEW/different one created');
  });

  await check('artifact upload: an oversized declared total is refused before any chunk touches storage', async () => {
    const res = await invokeUpload({ phase: 'chunk', opportunityId: opportunity.id, agreementAt: fixture.version.agreementAt, version: fixture.version, uploadId: 'upload-7', chunkIndex: 0, chunkCount: 1, totalByteCount: 999999999, originalFileName: 'executed.pdf', expectedFullSha256: 'a'.repeat(64), chunkBase64: Buffer.from('x').toString('base64') });
    assert.equal(res.statusCode, 409, res.body);
  });

  await check('artifact upload: download-chunk readback reconstructs the exact preserved bytes for Brad', async () => {
    const res = await invokeUpload({ phase: 'download-chunk', opportunityId: opportunity.id, agreementAt: fixture.version.agreementAt, version: fixture.version, chunkIndex: 0 });
    assert.equal(res.statusCode, 200, res.body);
    const body = JSON.parse(res.body);
    assert.equal(body.chunkCount, 1);
    assert.equal(Buffer.from(body.chunkBase64, 'base64').toString(), pdfBytes.toString());
  });

  // ============================================================
  // Gate-review closure, requirement 3 -- upload-boundary proof, beyond
  // what the earlier "success"/"conflict"/"missing chunks" checks above
  // already cover.
  // ============================================================

  await check('artifact upload: a same-uploadId chunk claiming a DIFFERENT opportunity is a completely independent, isolated key namespace -- both succeed on their own, neither can continue, corrupt, or borrow the other\'s data', async () => {
    const chunks = splitChunks(pdfBytes, CHUNK);
    const expectedFullSha256 = sha256Hex(pdfBytes);
    const sharedUploadId = 'cross-opportunity-reuse-attempt';
    const first = await invokeUpload({ phase: 'chunk', opportunityId: opportunity.id, agreementAt: fixture.version.agreementAt, version: fixture.version, uploadId: sharedUploadId, chunkIndex: 0, chunkCount: chunks.length, totalByteCount: pdfBytes.length, originalFileName: 'executed.pdf', expectedFullSha256, chunkBase64: chunks[0].toString('base64') });
    assert.equal(first.statusCode, 200, first.body);
    // The SAME uploadId AND chunkIndex, claiming opportunity2 instead --
    // this computes a COMPLETELY DIFFERENT deterministic key (opportunityId
    // is part of the key itself), so it is accepted as its OWN, genuinely
    // independent chunk 0 -- never silently merged with, nor blocked by,
    // opportunity A's own chunk 0 under the same uploadId.
    const isolated = await invokeUpload({ phase: 'chunk', opportunityId: opportunity2.id, agreementAt: fixture.version.agreementAt, version: fixture.version, uploadId: sharedUploadId, chunkIndex: 0, chunkCount: chunks.length, totalByteCount: pdfBytes.length, originalFileName: 'executed.pdf', expectedFullSha256, chunkBase64: chunks[0].toString('base64') });
    assert.equal(isolated.statusCode, 200, isolated.body);
    // opportunity A's own session is completely unaffected -- its next
    // chunk is still accepted normally, and a retry of ITS OWN chunk 0 is
    // still recognized as an identical, idempotent no-op (never disturbed
    // by opportunity2's own same-index write).
    const legitNext = await invokeUpload({ phase: 'chunk', opportunityId: opportunity.id, agreementAt: fixture.version.agreementAt, version: fixture.version, uploadId: sharedUploadId, chunkIndex: 1, chunkCount: chunks.length, totalByteCount: pdfBytes.length, originalFileName: 'executed.pdf', expectedFullSha256, chunkBase64: chunks[1].toString('base64') });
    assert.equal(legitNext.statusCode, 200, legitNext.body);
    const legitRetry = await invokeUpload({ phase: 'chunk', opportunityId: opportunity.id, agreementAt: fixture.version.agreementAt, version: fixture.version, uploadId: sharedUploadId, chunkIndex: 0, chunkCount: chunks.length, totalByteCount: pdfBytes.length, originalFileName: 'executed.pdf', expectedFullSha256, chunkBase64: chunks[0].toString('base64') });
    assert.equal(legitRetry.statusCode, 200, legitRetry.body);
    assert.equal(JSON.parse(legitRetry.body).duplicate, true);
    // Clean up both isolated sessions.
    await invokeUpload({ phase: 'abort', opportunityId: opportunity.id, agreementAt: fixture.version.agreementAt, version: fixture.version, uploadId: sharedUploadId });
    await invokeUpload({ phase: 'abort', opportunityId: opportunity2.id, agreementAt: fixture.version.agreementAt, version: fixture.version, uploadId: sharedUploadId });
  });

  await check('artifact upload: invalid PDF magic bytes -- valid chunk set, but reassembled content is not a PDF, refused at finalize', async () => {
    const notAPdf = Buffer.from('This is definitely not a PDF file, just plain text.'.repeat(10));
    const before = writes;
    await uploadChunks('upload-not-pdf', notAPdf, 'not-a-pdf.pdf');
    const res = await invokeUpload(finalizeArgs('upload-not-pdf', notAPdf, 'not-a-pdf.pdf', fixture.version, docId));
    assert.equal(res.statusCode, 409, res.body);
    assert.equal(writes, before);
  });

  await check('artifact upload: declared total-byte-count does not match the ACTUAL reassembled size, refused at finalize', async () => {
    // All declared chunks present and self-consistent with EACH OTHER
    // (and with finalize's own declared total), but the declared
    // totalByteCount understates what was actually sent -- finalize must
    // catch this from the real reassembled length, never trust the claim.
    const uploadId = 'upload-bytecount-mismatch';
    const chunks = splitChunks(pdfBytes, CHUNK);
    const falseTotal = pdfBytes.length - 50;
    const expectedFullSha256 = sha256Hex(pdfBytes); // well-formed; the byte-count check is reached and fails BEFORE the hash check either way
    for (let i = 0; i < chunks.length; i++) {
      await invokeUpload({ phase: 'chunk', opportunityId: opportunity.id, agreementAt: fixture.version.agreementAt, version: fixture.version, uploadId, chunkIndex: i, chunkCount: chunks.length, totalByteCount: falseTotal, originalFileName: 'executed.pdf', expectedFullSha256, chunkBase64: chunks[i].toString('base64') });
    }
    const before = writes;
    const res = await invokeUpload({ phase: 'finalize', opportunityId: opportunity.id, agreementAt: fixture.version.agreementAt, version: fixture.version, uploadId, providerDocumentId: docId, chunkCount: chunks.length, totalByteCount: falseTotal, originalFileName: 'executed.pdf', expectedFullSha256 });
    assert.equal(res.statusCode, 409, res.body);
    assert.equal(writes, before);
  });

  await check('artifact upload: an IDENTICAL retry of an already-uploaded chunk (same bytes, same index) is idempotent -- accepted, not re-stored, not an error', async () => {
    const uploadId = 'upload-idempotent-chunk-retry';
    const chunks = splitChunks(pdfBytes, CHUNK);
    const expectedFullSha256 = sha256Hex(pdfBytes);
    const first = await invokeUpload({ phase: 'chunk', opportunityId: opportunity.id, agreementAt: fixture.version.agreementAt, version: fixture.version, uploadId, chunkIndex: 0, chunkCount: chunks.length, totalByteCount: pdfBytes.length, originalFileName: 'executed.pdf', expectedFullSha256, chunkBase64: chunks[0].toString('base64') });
    assert.equal(first.statusCode, 200, first.body);
    assert.equal(JSON.parse(first.body).duplicate, false);
    const retry = await invokeUpload({ phase: 'chunk', opportunityId: opportunity.id, agreementAt: fixture.version.agreementAt, version: fixture.version, uploadId, chunkIndex: 0, chunkCount: chunks.length, totalByteCount: pdfBytes.length, originalFileName: 'executed.pdf', expectedFullSha256, chunkBase64: chunks[0].toString('base64') });
    assert.equal(retry.statusCode, 200, retry.body);
    assert.equal(JSON.parse(retry.body).duplicate, true);
    await invokeUpload({ phase: 'abort', opportunityId: opportunity.id, agreementAt: fixture.version.agreementAt, version: fixture.version, uploadId });
  });

  await check('artifact upload: DIFFERENT bytes retried at the SAME chunk index are refused -- an index is never silently overwritten with new content', async () => {
    const uploadId = 'upload-different-bytes-same-index';
    const chunks = splitChunks(pdfBytes, CHUNK);
    const expectedFullSha256 = sha256Hex(pdfBytes);
    const first = await invokeUpload({ phase: 'chunk', opportunityId: opportunity.id, agreementAt: fixture.version.agreementAt, version: fixture.version, uploadId, chunkIndex: 0, chunkCount: chunks.length, totalByteCount: pdfBytes.length, originalFileName: 'executed.pdf', expectedFullSha256, chunkBase64: chunks[0].toString('base64') });
    assert.equal(first.statusCode, 200, first.body);
    const differentChunk0 = Buffer.from('DIFFERENT CONTENT AT INDEX 0'.padEnd(chunks[0].length, 'x'));
    const overwriteAttempt = await invokeUpload({ phase: 'chunk', opportunityId: opportunity.id, agreementAt: fixture.version.agreementAt, version: fixture.version, uploadId, chunkIndex: 0, chunkCount: chunks.length, totalByteCount: pdfBytes.length, originalFileName: 'executed.pdf', expectedFullSha256, chunkBase64: differentChunk0.toString('base64') });
    assert.equal(overwriteAttempt.statusCode, 409, overwriteAttempt.body);
    assert.equal(JSON.parse(overwriteAttempt.body).reasons[0].code, 'DUPLICATE_CHUNK');
    await invokeUpload({ phase: 'abort', opportunityId: opportunity.id, agreementAt: fixture.version.agreementAt, version: fixture.version, uploadId });
  });

  await check('artifact download: unauthenticated download-chunk request refused -- Brad-only auth is enforced for READ, not merely upload', async () => {
    const res = await uploadHandler({ blobs: Buffer.from(JSON.stringify({ url: 'https://blobs.example.invalid', token: 'offline-blob-fixture' })).toString('base64'), httpMethod: 'POST', headers: { origin: process.env.IAOS_APP_WRITE_ALLOWED_ORIGIN }, body: JSON.stringify({ phase: 'download-chunk', opportunityId: opportunity.id, agreementAt: fixture.version.agreementAt, version: fixture.version, chunkIndex: 0 }) });
    assert.equal(res.statusCode, 401, res.body);
  });

  await check('artifact upload: a caller-supplied blobKey-shaped field has NO effect -- the server always uses its own derived key', async () => {
    const src = fs.readFileSync(path.join(APP, 'netlify/functions/ghl-executed-artifact-upload.ts'), 'utf8');
    assert.equal(/request\.blobKey|body\.blobKey|request\.key\b/.test(src), false, 'the endpoint source must never read a client-supplied blob key field');
    // Runtime corroboration: inject a bogus blobKey field into a real
    // upload; the artifact still lands at, and is only ever read back
    // from, the server's own derived key.
    const uploadId = 'upload-injected-blobkey-attempt';
    const chunks = splitChunks(pdfBytes, CHUNK);
    const expectedFullSha256 = sha256Hex(pdfBytes);
    for (let i = 0; i < chunks.length; i++) {
      await invokeUpload({ phase: 'chunk', opportunityId: opportunity.id, agreementAt: fixture.version.agreementAt, version: fixture.version, uploadId, chunkIndex: i, chunkCount: chunks.length, totalByteCount: pdfBytes.length, originalFileName: 'executed.pdf', expectedFullSha256, chunkBase64: chunks[i].toString('base64'), blobKey: '../../attacker/controlled/path' });
    }
    const before = writes;
    const res = await invokeUpload(finalizeArgs(uploadId, pdfBytes, 'executed.pdf', fixture.version, docId, { blobKey: '../../attacker/controlled/path' }));
    // Same bytes as the already-preserved fixture.version artifact -> a
    // no-op success, exactly as an ordinary identical re-upload would be
    // (the injected field changed nothing about which key was used).
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(JSON.parse(res.body).alreadyPreserved, true);
    assert.equal(writes, before);
  });

  // ============================================================
  // Gate-review closure, requirement 4 -- partial-failure safety.
  // ============================================================

  await check('partial failure: final blob storage succeeds but the durable metadata note write fails -- never reported as preserved, and a later retry self-heals', async () => {
    // nextVersionIdentity is PURE/deterministic -- chained twice past
    // fixture.version to land on a version genuinely distinct from
    // `manualVersion` (the manual-send section above already occupies
    // fixture.version's immediate next versionSeq).
    const B9 = load('board9-contract-model');
    const freshVersion = B9.nextVersionIdentity(B9.nextVersionIdentity(fixture.version, { kind: 'same_agreement_reentry' }, null).value, { kind: 'same_agreement_reentry' }, null).value;
    const uploadId = 'upload-note-write-fails';
    await uploadChunks(uploadId, pdfBytes, 'executed.pdf', freshVersion);
    failNextNotePost = true;
    const before = writes;
    const failedFinalize = await invokeUpload(finalizeArgs(uploadId, pdfBytes, 'executed.pdf', freshVersion, docId));
    assert.equal(failedFinalize.statusCode, 409, failedFinalize.body);
    assert.equal(writes, before); // the note truly never landed
    const afterFailure = load('contract-executed-artifact-carriers').latestPreservedExecutedArtifactForVersion(notes, opportunity.id, fixture.version.agreementAt, freshVersion);
    assert.equal(afterFailure, null, 'no preserved-artifact record may exist for the new version after the note-write failure');

    /* Storage correction: a GHL 500 on the note POST is an AMBIGUOUS send (it may have applied), so the
       v2 write gate leaves that note's admission ticket `uncertain` -- a durable barrier on the contact.
       A retry is refused, before anything is sent, until the uncertain write is resolved. Restated: the
       retry is first proven refused with nothing written; then the fixture models the operator's
       resolution (the uncertain ticket removed from the admission record) and the retry self-heals. */
    const blockedUploadId = 'upload-note-write-retry-while-uncertain';
    await uploadChunks(blockedUploadId, pdfBytes, 'executed.pdf', freshVersion);
    const blocked = await invokeUpload(finalizeArgs(blockedUploadId, pdfBytes, 'executed.pdf', freshVersion, docId));
    assert.equal(blocked.statusCode, 409, blocked.body);
    assert.equal(JSON.parse(blocked.body).code, 'in_progress');
    assert.equal(writes, before);
    const admission = wire.json(compat.S, 'authz/admission');
    const uncertain = Object.keys(admission.tickets).filter((id) => admission.tickets[id].state === 'uncertain');
    assert.equal(uncertain.length, 1, 'exactly the one ambiguous note write is held uncertain');
    for (const id of uncertain) delete admission.tickets[id];
    wire.seed(compat.S, 'authz/admission', admission);

    // A fresh retry (new session, same file, same version) self-heals:
    // the deterministic blob key is safely overwritten with the same
    // bytes, and the note write is attempted again.
    const retryUploadId = 'upload-note-write-retry';
    await uploadChunks(retryUploadId, pdfBytes, 'executed.pdf', freshVersion);
    const retryRes = await invokeUpload(finalizeArgs(retryUploadId, pdfBytes, 'executed.pdf', freshVersion, docId));
    assert.equal(retryRes.statusCode, 200, retryRes.body);
    assert.equal(JSON.parse(retryRes.body).alreadyPreserved, false);
  });

  await check('partial failure: durable metadata exists but the stored bytes are MISSING -- the identical-re-upload no-op path fails closed, never reports preserved', async () => {
    const existing = load('contract-executed-artifact-carriers').latestPreservedExecutedArtifactForVersion(notes, opportunity.id, fixture.version.agreementAt, fixture.version);
    assert.equal(existing !== null, true, 'fixture.version must have an existing preserved artifact to corrupt for this proof');
    const savedBytes = blobsData.get(existing.blobKey);
    blobsData.delete(existing.blobKey); // simulate the bytes vanishing from storage
    try {
      const before = writes;
      await uploadChunks('upload-missing-bytes-reverify', pdfBytes, 'executed.pdf');
      const res = await invokeUpload(finalizeArgs('upload-missing-bytes-reverify', pdfBytes, 'executed.pdf', fixture.version, docId));
      assert.equal(res.statusCode, 409, res.body);
      assert.equal(writes, before);
    } finally {
      blobsData.set(existing.blobKey, savedBytes); // restore -- later tests (stage transition) depend on this artifact
    }
  });

  await check('partial failure: durable metadata exists but the stored bytes are CORRUPTED (wrong hash) -- the identical-re-upload no-op path fails closed, never reports preserved', async () => {
    const existing = load('contract-executed-artifact-carriers').latestPreservedExecutedArtifactForVersion(notes, opportunity.id, fixture.version.agreementAt, fixture.version);
    const savedBytes = blobsData.get(existing.blobKey);
    blobsData.set(existing.blobKey, Buffer.from('corrupted bytes, wrong content entirely'));
    try {
      const before = writes;
      await uploadChunks('upload-corrupted-bytes-reverify', pdfBytes, 'executed.pdf');
      const res = await invokeUpload(finalizeArgs('upload-corrupted-bytes-reverify', pdfBytes, 'executed.pdf', fixture.version, docId));
      assert.equal(res.statusCode, 409, res.body);
      assert.equal(writes, before);
    } finally {
      blobsData.set(existing.blobKey, savedBytes);
    }
  });

  await check('partial failure: durable metadata exists but the stored bytes are MISSING -- download-chunk fails closed, never serves wrong/absent bytes as if verified', async () => {
    const existing = load('contract-executed-artifact-carriers').latestPreservedExecutedArtifactForVersion(notes, opportunity.id, fixture.version.agreementAt, fixture.version);
    const savedBytes = blobsData.get(existing.blobKey);
    blobsData.delete(existing.blobKey);
    try {
      const res = await invokeUpload({ phase: 'download-chunk', opportunityId: opportunity.id, agreementAt: fixture.version.agreementAt, version: fixture.version, chunkIndex: 0 });
      assert.equal(res.statusCode, 409, res.body);
    } finally {
      blobsData.set(existing.blobKey, savedBytes);
    }
  });

  await check('partial failure: durable metadata exists but the stored bytes are CORRUPTED -- download-chunk fails closed rather than silently serving wrong bytes', async () => {
    const existing = load('contract-executed-artifact-carriers').latestPreservedExecutedArtifactForVersion(notes, opportunity.id, fixture.version.agreementAt, fixture.version);
    const savedBytes = blobsData.get(existing.blobKey);
    blobsData.set(existing.blobKey, Buffer.from('corrupted bytes, wrong content entirely'));
    try {
      const res = await invokeUpload({ phase: 'download-chunk', opportunityId: opportunity.id, agreementAt: fixture.version.agreementAt, version: fixture.version, chunkIndex: 0 });
      assert.equal(res.statusCode, 409, res.body);
    } finally {
      blobsData.set(existing.blobKey, savedBytes);
    }
  });

  await check('partial failure: chunk cleanup fails partway through AFTER a successful finalize -- the genuine success is still reported, cleanup failure never masks it', async () => {
    // Chained three steps past fixture.version -- distinct from both
    // `manualVersion` and `freshVersion` above.
    const B9b = load('board9-contract-model');
    const step2 = B9b.nextVersionIdentity(fixture.version, { kind: 'same_agreement_reentry' }, null).value;
    const step3 = B9b.nextVersionIdentity(step2, { kind: 'same_agreement_reentry' }, null).value;
    const freshVersion2 = B9b.nextVersionIdentity(step3, { kind: 'same_agreement_reentry' }, null).value;
    const uploadId = 'upload-cleanup-partial-failure';
    await uploadChunks(uploadId, pdfBytes, 'executed.pdf', freshVersion2);
    // fires on the FIRST cleanup delete call, which happens strictly after the note write above has already succeeded
    /* Storage correction: the injected delete failure is a real wire fault on the upload store (a 503 on the first chunk DELETE). */
    const cleanupFault = wire.on((req) => req.method === 'DELETE' && req.store === 'site:' + UPLOADS, wire.status(503), 1);
    const res = await invokeUpload(finalizeArgs(uploadId, pdfBytes, 'executed.pdf', freshVersion2, docId));
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(JSON.parse(res.body).preserved, true);
    const recorded = load('contract-executed-artifact-carriers').latestPreservedExecutedArtifactForVersion(notes, opportunity.id, fixture.version.agreementAt, freshVersion2);
    assert.equal(recorded !== null, true, 'the artifact for the new version must be genuinely durably recorded despite the cleanup hiccup');
    assert.equal(cleanupFault.used, 1, 'the injected cleanup failure was genuinely exercised');
  });
}

// ============================================================
// Board #9 Phase B (B9-13) -- the Under Contract GHL opportunity-stage
// transition, server level. By this point `fixture.version` durably
// carries BOTH a server-verified Under Contract record (above) AND a
// server-verified preserved executed artifact (immediately above) --
// exactly the joint gate `verifyUnderContractStageTransitionReady`
// requires before any transition is attempted.
// ============================================================
{
  await check('GhlBoundary.transitionOpportunityStage refuses the forbidden stage id directly, independent of the HTTP dispatch or config wiring', async () => {
    const { configuredBoundary } = require('../netlify/functions/lib/ghl-write-boundary.ts');
    const boundary = configuredBoundary();
    await assert.rejects(
      boundary.transitionOpportunityStage(opportunity.id, config.pipelines.sellerLeads, config.stages.sellerClosedWon, [config.stages.sellerClosedWon]),
      /forbidden/,
    );
  });

  // Gate-review closure -- INV-98 stage-sentinel defense repair. The
  // Production Under Contract stage sentinel (UNDER_CONTRACT_STAGE_NOT_PROVISIONED)
  // was previously renamed (INV-98 Phase 1, PR #87) from its old
  // PRODUCTION_-prefixed literal without updating this file's own
  // sentinel-shape check, which silently degraded to a no-op for the
  // current sentinel value -- OBSERVED directly by re-reading the source
  // during the INV-98 B9-14 read-only preflight; no prior test anywhere in
  // this repository exercised this exact path. This is a direct regression
  // test for that exact drift, proving the code itself refuses BEFORE any
  // GHL call is ever attempted -- never relying on GHL's own API rejection
  // of a malformed stage id as the only defense.
  await check('GhlBoundary.transitionOpportunityStage refuses the exact current Production Under Contract stage sentinel, before any GHL network call', async () => {
    const { configuredBoundary } = require('../netlify/functions/lib/ghl-write-boundary.ts');
    const boundary = configuredBoundary();
    const savedFetch = global.fetch;
    global.fetch = async () => { throw new Error('transitionOpportunityStage must never reach the network for an unprovisioned sentinel stage'); };
    try {
      await assert.rejects(
        boundary.transitionOpportunityStage(opportunity.id, config.pipelines.sellerLeads, UNDER_CONTRACT_STAGE_NOT_PROVISIONED, []),
        /not provisioned/i,
      );
    } finally {
      global.fetch = savedFetch;
    }
  });

  // Regression sanity assertion -- documents WHY the prior check silently
  // stopped working: the current sentinel does not begin with the obsolete
  // "PRODUCTION_" prefix the old check compared against. If this ever
  // becomes false again (a future rename), it is a signal the equality
  // check above must be re-verified against the new literal value.
  await check('the current Production Under Contract stage sentinel does not begin with the obsolete "PRODUCTION_" prefix (documents why the old prefix check was silently inert)', () => {
    assert.equal(UNDER_CONTRACT_STAGE_NOT_PROVISIONED.startsWith('PRODUCTION_'), false);
  });

  await check('stage transition: success -- transitions to the exact Under Contract stage id, readback confirms pipeline AND stage', async () => {
    const res = await invokeOp('opportunity.underContractStage', opportunity.id, { agreementAt: fixture.version.agreementAt, version: fixture.version });
    assert.equal(res.statusCode, 200, res.body);
    const body = JSON.parse(res.body);
    assert.equal(body.confirmed, true);
    assert.equal(body.alreadyInStage, false);
    assert.equal(body.readback.pipelineId, config.pipelines.sellerLeads);
    assert.equal(body.readback.pipelineStageId, config.stages.underContract);
    assert.equal(opportunity.pipelineStageId, config.stages.underContract);
  });

  await check('stage transition: idempotent -- calling again while already in the target stage is a no-op success, never a redundant write', async () => {
    const res = await invokeOp('opportunity.underContractStage', opportunity.id, { agreementAt: fixture.version.agreementAt, version: fixture.version });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(JSON.parse(res.body).alreadyInStage, true);
  });

  // Gate-review closure -- PR #85 attempt #3, same scoped-uniqueness fix
  // mirrored in verifyUnderContractStageTransitionReady's own inline copy
  // of the readback check.
  await check('stage transition readback: an unrelated duplicate id elsewhere in the listing does not block re-verification of the real accepted-send document', async () => {
    documents.push({ documentId: 'stage-unrelated-dup', locationId: config.locationId, status: 'completed', documentRevision: 1, updatedAt: at, deleted: false, recipients: [], links: [], fillableFields: [{ isRequired: true }] });
    documents.push({ documentId: 'stage-unrelated-dup', locationId: config.locationId, status: 'completed', documentRevision: 1, updatedAt: at, deleted: false, recipients: [], links: [], fillableFields: [{ isRequired: true }] });
    try {
      const res = await invokeOp('opportunity.underContractStage', opportunity.id, { agreementAt: fixture.version.agreementAt, version: fixture.version });
      assert.equal(res.statusCode, 200, res.body);
    } finally {
      documents.splice(documents.length - 2, 2);
    }
  });

  await check('stage transition readback: TWO entries sharing the exact accepted-send documentId is a genuine conflict, fails closed', async () => {
    const dup = documents.find((d) => d.documentId === docId);
    documents.push(Object.assign({}, dup));
    try {
      const res = await invokeOp('opportunity.underContractStage', opportunity.id, { agreementAt: fixture.version.agreementAt, version: fixture.version });
      assert.equal(res.statusCode, 409, res.body);
    } finally {
      documents.pop();
    }
  });

  await check('stage transition readback: provider HTTP 403 is classified explicitly, never collapsed into "Ambiguous document readback"', async () => {
    const savedFetch = global.fetch;
    global.fetch = async (url) => { const u = new URL(url); if (u.pathname === '/proposals/document') return { ok: false, status: 403, json: async () => ({ message: 'refused' }), text: async () => '{"message":"refused"}' }; return savedFetch(url); };
    const originalConsoleError = console.error;
    const logCalls = [];
    console.error = (...args) => { logCalls.push(args); };
    try {
      const res = await invokeOp('opportunity.underContractStage', opportunity.id, { agreementAt: fixture.version.agreementAt, version: fixture.version });
      assert.equal(res.statusCode, 409, res.body);
    } finally {
      console.error = originalConsoleError;
      global.fetch = savedFetch;
    }
    assert.equal(logCalls.length, 1, 'exactly one diagnostic log entry');
    const logged = JSON.parse(logCalls[0][1]);
    assert.equal(logged.errorMessage, 'Provider document readback failed (HTTP 403)');
    assert.notEqual(logged.errorMessage, 'Ambiguous document readback');
    assert.equal(JSON.stringify(logged).includes('refused'), false, 'the provider response body is never logged');
  });

  await check('stage transition: wrong-environment (opportunity belongs to a different pipeline) refused', async () => {
    const saved = opportunity.pipelineId;
    opportunity.pipelineId = 'some-other-pipeline-entirely';
    const res = await invokeOp('opportunity.underContractStage', opportunity.id, { agreementAt: fixture.version.agreementAt, version: fixture.version });
    assert.equal(res.statusCode, 409, res.body);
    opportunity.pipelineId = saved;
  });

  await check('stage transition: provider-failure -- live document readback no longer independently confirms execution, refused', async () => {
    const savedStage = opportunity.pipelineStageId;
    const target = documents.find((d) => d.documentId === docId);
    target.recipients[0].hasCompleted = false;
    opportunity.pipelineStageId = config.stages.sellerOfferSent; // not yet in the target stage, so a real transition attempt is made
    const res = await invokeOp('opportunity.underContractStage', opportunity.id, { agreementAt: fixture.version.agreementAt, version: fixture.version });
    assert.equal(res.statusCode, 409, res.body);
    target.recipients[0].hasCompleted = true;
    opportunity.pipelineStageId = savedStage;
  });
}

// ============================================================
// Gate-review closure, requirement 2 -- stage-transition failure proof.
// Direct `GhlBoundary.transitionOpportunityStage` calls, isolating the
// write+readback mechanism itself from the independent-re-verification
// gate already proven above.
// ============================================================
{
  const { configuredBoundary } = require('../netlify/functions/lib/ghl-write-boundary.ts');
  /* Storage correction: a boundary built without a write gate is read-only in v2 -- it refuses every
     mutation before any I/O. These direct calls isolate the write+readback MECHANISM, so they use a
     test-only pass-through gate (admits, sends exactly once, records nothing); the real gate is
     exercised end-to-end through ghl-write elsewhere in this file. */
  await check('stage transition: a boundary WITHOUT a write gate refuses the PUT before any GHL call (v2 read-only default)', async () => {
    const saved = opportunity.pipelineStageId;
    opportunity.pipelineStageId = config.stages.sellerOfferSent; putIssuedThisAttempt = false;
    try {
      await assert.rejects(configuredBoundary().transitionOpportunityStage(opportunity.id, config.pipelines.sellerLeads, config.stages.underContract, [config.stages.sellerClosedWon]), /no write gate/);
      assert.equal(putIssuedThisAttempt, false);
      assert.equal(opportunity.pipelineStageId, config.stages.sellerOfferSent);
    } finally { opportunity.pipelineStageId = saved; }
  });

  await check('stage transition failure: the GHL PUT itself fails -- fails closed, opportunity stage left unchanged', async () => {
    const saved = opportunity.pipelineStageId;
    opportunity.pipelineStageId = config.stages.sellerOfferSent; // not yet in target, so a real PUT is attempted
    stagePutMode = 'reject'; putIssuedThisAttempt = false;
    const boundary = gatedBoundary();
    await assert.rejects(boundary.transitionOpportunityStage(opportunity.id, config.pipelines.sellerLeads, config.stages.underContract, [config.stages.sellerClosedWon]));
    assert.equal(opportunity.pipelineStageId, config.stages.sellerOfferSent, 'a rejected PUT must never be treated as having changed the stage');
    stagePutMode = 'apply'; opportunity.pipelineStageId = saved;
  });

  await check('stage transition failure: PUT reports success but the readback still shows the PRIOR stage -- fails uncertain/closed, no success is emitted', async () => {
    const saved = opportunity.pipelineStageId;
    opportunity.pipelineStageId = config.stages.sellerOfferSent;
    stagePutMode = 'ignore'; putIssuedThisAttempt = false;
    const boundary = gatedBoundary();
    await assert.rejects(
      boundary.transitionOpportunityStage(opportunity.id, config.pipelines.sellerLeads, config.stages.underContract, [config.stages.sellerClosedWon]),
      /readback/i,
    );
    stagePutMode = 'apply'; opportunity.pipelineStageId = saved;
  });

  await check('stage transition failure: readback reports the WRONG PIPELINE -- refused, never a false success', async () => {
    const saved = opportunity.pipelineStageId;
    opportunity.pipelineStageId = config.stages.sellerOfferSent;
    stagePutMode = 'wrong-pipeline'; putIssuedThisAttempt = false;
    const boundary = gatedBoundary();
    await assert.rejects(
      boundary.transitionOpportunityStage(opportunity.id, config.pipelines.sellerLeads, config.stages.underContract, [config.stages.sellerClosedWon]),
      /readback/i,
    );
    stagePutMode = 'apply'; opportunity.pipelineStageId = saved;
  });

  await check('stage transition failure: readback reports SELLER CLOSED-WON instead of Under Contract -- refused, never a false success', async () => {
    const saved = opportunity.pipelineStageId;
    opportunity.pipelineStageId = config.stages.sellerOfferSent;
    stagePutMode = 'wrong-stage'; putIssuedThisAttempt = false;
    const boundary = gatedBoundary();
    await assert.rejects(
      boundary.transitionOpportunityStage(opportunity.id, config.pipelines.sellerLeads, config.stages.underContract, [config.stages.sellerClosedWon]),
      /readback/i,
    );
    stagePutMode = 'apply'; opportunity.pipelineStageId = saved;
  });

  await check('stage transition failure: end-to-end through the real HTTP operation dispatch -- a readback mismatch never reaches a 200/confirmed response', async () => {
    const saved = opportunity.pipelineStageId;
    opportunity.pipelineStageId = config.stages.sellerOfferSent;
    stagePutMode = 'wrong-stage'; putIssuedThisAttempt = false;
    const res = await invokeOp('opportunity.underContractStage', opportunity.id, { agreementAt: fixture.version.agreementAt, version: fixture.version });
    assert.equal(res.statusCode, 409, res.body);
    const body = JSON.parse(res.body);
    assert.equal(body.confirmed, undefined, 'no success field may appear on a refused response');
    stagePutMode = 'apply';
    // Restore to the genuinely correct stage via a real, successful transition -- leaves shared fixture state consistent for anything that runs after.
    opportunity.pipelineStageId = saved;
    if (saved !== config.stages.underContract) {
      const fix = await invokeOp('opportunity.underContractStage', opportunity.id, { agreementAt: fixture.version.agreementAt, version: fixture.version });
      assert.equal(fix.statusCode, 200, fix.body);
    }
  });
}

// ============================================================
// Disposition handoff -- moved here (gate-review closure, §5 ruling):
// the server now independently re-verifies the preserved artifact AND
// the live GHL stage before permitting a handoff write, so fixture.version
// must have BOTH established first, which only holds from this point in
// the file onward (after the artifact-preservation and stage-transition
// sections above).
// ============================================================
{
  const report = fixture.report;
  const handoff = load('contract-disposition-handoff-model').buildDispositionHandoffRecordArgs({handoffId:'fixture-handoff',createdAt:at,opportunityId:opportunity.id,contactId:contact.id,agreementAt:fixture.version.agreementAt,version:fixture.version,eligibility:{eligible:true},underContract:execution.value,propertyAddress:{kind:'populated',value:'123 Main St, Austin, TX, 78701',authority:'operator_attested',recordedAt:null},propertyLegalDescription:report.propertyLegalDescription,sellerContractPrice:190000,approvedArv:{amount:300000,approvalEvidenceState:null,approvalDecision:null,approvedAt:null},approvedRepairs:25000,closingDate:report.closingPossession.closingDate,possessionDetails:report.closingPossession.possessionDetails,accessShowingInformation:{kind:'unresolved'},sellerContact:{noticeAddress:report.noticeContact.sellerNoticeAddress,noticePhone:report.noticeContact.sellerNoticePhone,noticeEmail:report.noticeContact.sellerNoticeEmail},requiredSigners:required,documentReferences:[],documentReferencesNote:'No upstream reference carrier',evidenceSummary:'Synthetic canonical handoff'});
  assert.equal(handoff.ok, true, JSON.stringify(handoff));

  await check('fabricated handoff price refused', async () => { const before = writes; assert.equal((await invoke(load('contract-disposition-handoff-carriers').formatDispositionHandoffNote({ ...handoff.value, sellerContractPrice: 1 }))).statusCode, 409); assert.equal(writes, before); });

  // INV-98 Board #9 review package -- further altered-snapshot, stale-lifecycle
  // and stale-agreement refusals, each against the SAME real canonical body,
  // with only the one condition under test broken.
  const handoffCarriers = load('contract-disposition-handoff-carriers');
  for (const [label, altered] of [
    ['approved repairs altered', { ...handoff.value, approvedRepairs: handoff.value.approvedRepairs + 1 }],
    ['approved ARV amount altered', { ...handoff.value, approvedArv: { ...handoff.value.approvedArv, amount: handoff.value.approvedArv.amount + 1 } }],
    ['contact altered', { ...handoff.value, contactId: 'fixture-other-contact' }],
    ['agreement timestamp altered', { ...handoff.value, agreementAt: '2026-09-01T00:00:00.000Z' }],
  ]) {
    await check('altered handoff snapshot refused: ' + label, async () => {
      const before = writes;
      const res = await invoke(handoffCarriers.formatDispositionHandoffNote(altered));
      assert.equal(res.statusCode, 409, res.body); assert.equal(writes, before);
    });
  }
  await check('disposition refused: a Rescission lifecycle record exists for this exact contract version (stale lifecycle)', async () => {
    const lifecycleModel = load('contract-lifecycle-model');
    const rescission = lifecycleModel.buildRescissionRecord({ opportunityId: opportunity.id, version: fixture.version, reason: 'Synthetic rescission for the refusal proof', authorizedBy: 'brad', authorizedAt: '2026-09-18T02:00:00.000Z', acceptedSend: send, iaosObservedAt: '2026-09-18T02:00:00.000Z', evidenceSummary: 'Synthetic rescission', relatedPriorRecordId: null });
    assert.equal(rescission.ok, true, JSON.stringify(rescission));
    const injected = { id: 'injected-rescission', body: load('contract-lifecycle-carriers').formatContractLifecycleNote(rescission.value) };
    notes.push(injected);
    try {
      const before = writes;
      const res = await invoke(handoffCarriers.formatDispositionHandoffNote(handoff.value));
      assert.equal(res.statusCode, 409, res.body); assert.equal(writes, before);
    } finally { notes.splice(notes.indexOf(injected), 1); }
  });
  await check('disposition refused: a NEWER accepted agreement supersedes the one the handoff names (stale agreement)', async () => {
    const outcomeLib = load('seller-call-outcome');
    const original = fixture.notes.map((n) => outcomeLib.parseOutcomeNote(n.body)).find((r) => r && r.kind === 'accept' && r.opportunityId === opportunity.id);
    assert.ok(original, 'the fixture carries an accept outcome');
    const injected = { id: 'injected-newer-accept', body: outcomeLib.formatOutcomeNote({ opportunityId: opportunity.id, at: '2026-09-18T03:00:00.000Z', operator: 'brad', kind: 'accept', reason: null, followUpAt: null, snapshot: original.snapshot }) };
    notes.push(injected);
    try {
      const before = writes;
      const res = await invoke(handoffCarriers.formatDispositionHandoffNote(handoff.value));
      assert.equal(res.statusCode, 409, res.body); assert.equal(writes, before);
    } finally { notes.splice(notes.indexOf(injected), 1); }
  });
  // The same real canonical body against the Production proof write scope --
  // the gate ghl-write.ts evaluates first, before these server checks run.
  await check('Production scope gate: the real canonical handoff body passes only for the pinned pair, and a foreign contact is refused', () => {
    const G = require('../shared/ghl-config.ts');
    const scopeLib = require('../netlify/functions/lib/production-write-scope.ts');
    const prod = JSON.parse(JSON.stringify(G.getConfig('production')));
    prod.contractProductionEnabled = G.CONTRACT_PRODUCTION_ENABLED;
    prod.productionProofScope = { enabled: G.PRODUCTION_PROOF_SCOPE_ENABLED, contactId: contact.id, opportunityId: opportunity.id };
    const decide = (config, targetId, value) => scopeLib.evaluateProductionGhlWriteScope(config, { operation: 'note.create', targetId, args: { body: handoffCarriers.formatDispositionHandoffNote(value) } });
    assert.deepEqual(decide(prod, contact.id, handoff.value), { ok: true });
    assert.deepEqual(decide(prod, contact.id, { ...handoff.value, contactId: 'fixture-other-contact' }), { ok: false, code: 'TARGET_NOT_PINNED' });
    const otherPins = { ...prod, productionProofScope: { ...prod.productionProofScope, opportunityId: 'fixture-other-opportunity' } };
    assert.deepEqual(decide(otherPins, contact.id, handoff.value), { ok: false, code: 'TARGET_NOT_PINNED' });
    // INV-98 Board #9 enable commit: the committed Production config is ENABLED but pinned to the REAL
    // synthetic fixture, so this suite's Test-fixture pair is refused as not pinned.
    assert.deepEqual(decide(G.getConfig('production'), contact.id, handoff.value), { ok: false, code: 'TARGET_NOT_PINNED' }, 'the committed Production config admits only its own pinned pair');
  });

  // ============================================================
  // Gate-review closure, requirement 6 -- server refusal proof. Each
  // refuses BEFORE the canonical "success" case below establishes the
  // fully-satisfied prerequisite state, using the SAME real handoff note
  // body each time (only the durable prerequisite under test is broken).
  // ============================================================
  await check('disposition refused: PDF metadata is absent (the preserved-artifact note is momentarily missing, everything else about the chain stays genuinely valid)', async () => {
    const artifactNoteIndex = notes.findIndex((n) => {
      const parsed = load('contract-executed-artifact-carriers').parsePreservedExecutedArtifactNote(n.body);
      return parsed && parsed.opportunityId === opportunity.id && load('board9-contract-model').isSameContractVersion(parsed.version, fixture.version);
    });
    assert.notEqual(artifactNoteIndex, -1, 'fixture.version must have a preserved-artifact note to remove for this proof');
    const [removedNote] = notes.splice(artifactNoteIndex, 1);
    try {
      const before = writes;
      const res = await invoke(load('contract-disposition-handoff-carriers').formatDispositionHandoffNote(handoff.value));
      assert.equal(res.statusCode, 409, res.body);
      assert.equal(writes, before);
    } finally {
      notes.splice(artifactNoteIndex, 0, removedNote);
    }
  });

  await check('disposition refused: PDF bytes are absent (metadata exists, blob missing)', async () => {
    const existing = load('contract-executed-artifact-carriers').latestPreservedExecutedArtifactForVersion(notes, opportunity.id, fixture.version.agreementAt, fixture.version);
    assert.equal(existing !== null, true);
    const saved = blobsData.get(existing.blobKey);
    blobsData.delete(existing.blobKey);
    try {
      const before = writes;
      const res = await invoke(load('contract-disposition-handoff-carriers').formatDispositionHandoffNote(handoff.value));
      assert.equal(res.statusCode, 409, res.body);
      assert.equal(writes, before);
    } finally { blobsData.set(existing.blobKey, saved); }
  });

  await check('disposition refused: PDF bytes are CORRUPTED (wrong hash)', async () => {
    const existing = load('contract-executed-artifact-carriers').latestPreservedExecutedArtifactForVersion(notes, opportunity.id, fixture.version.agreementAt, fixture.version);
    const saved = blobsData.get(existing.blobKey);
    blobsData.set(existing.blobKey, Buffer.from('corrupted bytes, not the real executed PDF'));
    try {
      const before = writes;
      const res = await invoke(load('contract-disposition-handoff-carriers').formatDispositionHandoffNote(handoff.value));
      assert.equal(res.statusCode, 409, res.body);
      assert.equal(writes, before);
    } finally { blobsData.set(existing.blobKey, saved); }
  });

  await check('disposition refused: opportunity remains in Seller Offer Sent (never transitioned)', async () => {
    const saved = opportunity.pipelineStageId;
    opportunity.pipelineStageId = config.stages.sellerOfferSent;
    const before = writes;
    const res = await invoke(load('contract-disposition-handoff-carriers').formatDispositionHandoffNote(handoff.value));
    assert.equal(res.statusCode, 409, res.body);
    assert.equal(writes, before);
    opportunity.pipelineStageId = saved;
  });

  await check('disposition refused: opportunity is in Seller Closed-Won (wrong terminal stage)', async () => {
    const saved = opportunity.pipelineStageId;
    opportunity.pipelineStageId = config.stages.sellerClosedWon;
    const before = writes;
    const res = await invoke(load('contract-disposition-handoff-carriers').formatDispositionHandoffNote(handoff.value));
    assert.equal(res.statusCode, 409, res.body);
    assert.equal(writes, before);
    opportunity.pipelineStageId = saved;
  });

  await check('disposition refused: opportunity is in the WRONG PIPELINE entirely', async () => {
    const saved = opportunity.pipelineId;
    opportunity.pipelineId = 'some-other-pipeline-entirely';
    const before = writes;
    const res = await invoke(load('contract-disposition-handoff-carriers').formatDispositionHandoffNote(handoff.value));
    assert.equal(res.statusCode, 409, res.body);
    assert.equal(writes, before);
    opportunity.pipelineId = saved;
  });

  // Gate-review closure -- fresh stage-reverification-before-disposition-
  // write repair, Required Test item 8. `requireUnderContractStageConfirmed`
  // (write-derived-note.ts) issues a genuinely fresh `boundary.opportunity()`
  // read immediately before a disposition note may be created -- distinct
  // from the "wrong pipeline"/"wrong stage" cases above (a PRESENT but
  // incorrect opportunity), this proves a failed/unavailable read is ALSO
  // fail-closed, with no note created, never silently treated as confirmed.
  await check('disposition refused: the fresh authoritative stage read itself fails (GHL unavailable) -- fails closed, never silently treated as confirmed', async () => {
    // THREE opportunity GETs occur for a disposition-handoff write, in
    // order: (1) validateLedgerNote's own contactId-ownership check,
    // (2) currentContractContext's (inside validateDerivedNote), and
    // (3) requireUnderContractStageConfirmed's OWN fresh read -- the one
    // under test here. The first two are left to succeed normally so
    // this failure is attributable specifically to the stage-
    // reverification call this repair is about.
    opportunityGetCallCount = 0;
    failOpportunityGetCallNumber = 3;
    const before = writes;
    let res;
    try {
      res = await invoke(load('contract-disposition-handoff-carriers').formatDispositionHandoffNote(handoff.value));
    } finally {
      failOpportunityGetCallNumber = 0;
    }
    assert.equal(res.statusCode, 409, res.body);
    assert.equal(writes, before);
    assert.equal(opportunityGetCallCount >= 3, true, 'requireUnderContractStageConfirmed\'s own fresh read must actually have been attempted');
  });

  await check('canonical disposition handoff retained -- only once execution, preserved artifact, AND live Under Contract stage all independently re-verify', async () => {
    const res = await invoke(load('contract-disposition-handoff-carriers').formatDispositionHandoffNote(handoff.value));
    assert.equal(res.statusCode, 200, res.body);
  });
  await check('duplicate handoff refused', async () => { const before = writes; assert.equal((await invoke(load('contract-disposition-handoff-carriers').formatDispositionHandoffNote(handoff.value))).statusCode, 409); assert.equal(writes, before); });
}

// ============================================================
// INV-98 -- durable "Under Contract stage transition unresolved" marker.
// ============================================================
/* Storage correction: the marker is stage marker v2 (lib/stage-marker-v2.ts) in iaos-ownership-v2:
   `stage-unresolved/<sha256(env:locationId:opportunityId)>` holding {v:2,state,...}. It is NEVER
   deleted: confirmation moves it to `state: "resolved"` (compare-and-swap), and a claim succeeds only
   when it is absent or resolved. "Has the marker" below therefore means "holds an UNRESOLVED marker".
   `receipts.delete(markerKey)` remains only as a FIXTURE reset between cases (direct wire edit, never
   the code under test). Direct claims go through claimStageMarker on a real verified store. */
{
  const markerLib = require('../netlify/functions/lib/stage-marker-v2.ts');
  const markerKey = markerLib.stageMarkerKey('test', config.locationId, opportunity.id);
  const markerUnresolved = () => { const r = receipts.get(markerKey); return !!r && r.state !== 'resolved'; };
  const claimDirect = (rid) => { const st = compat.store(); return markerLib.claimStageMarker(st, st.scope, markerKey, rid); };
  /* Storage correction: an uncertain stage PUT also leaves the v2 write gate's admission ticket
     `uncertain` on `opportunity:<id>` -- a second, independent barrier. Between cases (and before the
     cases that isolate the MARKER as the barrier under test) the fixture models that ticket's
     resolution by removing it from the admission record. */
  const clearUncertainTickets = () => {
    const admission = wire.json(compat.S, 'authz/admission');
    let changed = false;
    for (const id of Object.keys(admission.tickets || {})) if (admission.tickets[id].state !== 'admitted') { delete admission.tickets[id]; changed = true; }
    if (changed) wire.seed(compat.S, 'authz/admission', admission);
  };
  const stageArgs = () => ({ agreementAt: fixture.version.agreementAt, version: fixture.version });
  const resetStage = (stage) => { opportunity.pipelineStageId = stage; stagePutMode = 'apply'; putIssuedThisAttempt = false; receipts.delete(markerKey); clearUncertainTickets(); };
  async function invokeOpAs(email, operation, targetId, args) {
    return handler({blobs:Buffer.from(JSON.stringify({url:'https://blobs.example.invalid',token:'offline-blob-fixture'})).toString('base64'),httpMethod:'POST',
      headers:{'x-nf-site-id':'offline-site','x-nf-deploy-id':'offline-deploy',origin:process.env.IAOS_APP_WRITE_ALLOWED_ORIGIN,authorization:'Bearer '+auth.issueAppSession(email).token},
      body:JSON.stringify({operation,targetId,args,requestId:(++n,v2Id())})});
  }
  // Counts every outbound GHL request made while fn runs (blob-wire traffic is storage, not GHL).
  async function countingGhl(fn) {
    const inner = global.fetch; let ghlCalls = 0;
    global.fetch = async (url, init) => { if (new URL(url).origin === 'https://services.leadconnectorhq.com') ghlCalls++; return inner(url, init); };
    try { return { result: await fn(), ghlCalls: () => ghlCalls }; } finally { global.fetch = inner; }
  }

  await check('marker key: one per opportunity in this env+location; independent of operator, session and requestId; carries no raw id', async () => {
    assert.equal(markerLib.stageMarkerKey('test', config.locationId, opportunity.id), markerKey);
    assert.ok(markerKey.startsWith(markerLib.STAGE_MARKER_PREFIX));
    assert.ok(!markerKey.includes(opportunity.id));
    assert.notEqual(markerLib.stageMarkerKey('test', config.locationId, opportunity2.id), markerKey);
    assert.notEqual(markerLib.stageMarkerKey('production', config.locationId, opportunity.id), markerKey);
    /* Storage correction: the old claim took (opportunityId, requestId, operator) and stored their digests;
       v2's key takes ONLY (env, locationId, opportunityId), and the request id enters the record solely as
       an opaque attempt hash (operator is not recorded at all). */
    assert.equal(markerLib.stageMarkerKey.length, 3, 'operator and requestId are never part of the key');
  });

  await check('claim point: never claimed on a pre-write refusal or when already in the stage', async () => {
    const boundary = gatedBoundary();
    let claims = 0; const hooks = { beforePut: async () => { claims++; } };
    resetStage(config.stages.sellerOfferSent);
    await assert.rejects(boundary.transitionOpportunityStage(opportunity.id, config.pipelines.sellerLeads, config.stages.sellerClosedWon, [config.stages.sellerClosedWon], hooks));
    await assert.rejects(boundary.transitionOpportunityStage(opportunity.id, 'some-other-pipeline', config.stages.underContract, [config.stages.sellerClosedWon], hooks));
    resetStage(config.stages.underContract);
    const idem = await boundary.transitionOpportunityStage(opportunity.id, config.pipelines.sellerLeads, config.stages.underContract, [config.stages.sellerClosedWon], hooks);
    assert.equal(idem.alreadyInStage, true);
    assert.equal(claims, 0);
    assert.equal(receipts.has(markerKey), false);
  });

  await check('claim point: claimed immediately BEFORE the PUT, confirmed hook only AFTER the exact readback', async () => {
    const boundary = gatedBoundary(); const order = [];
    resetStage(config.stages.sellerOfferSent);
    await boundary.transitionOpportunityStage(opportunity.id, config.pipelines.sellerLeads, config.stages.underContract, [config.stages.sellerClosedWon], {
      beforePut: async () => { order.push('claim:putIssued=' + putIssuedThisAttempt); },
      afterConfirmed: async () => { order.push('confirmed:stage=' + (opportunity.pipelineStageId === config.stages.underContract)); },
    });
    assert.deepEqual(order, ['claim:putIssued=false', 'confirmed:stage=true']);
    resetStage(config.stages.underContract);
  });

  await check('an interrupted function leaves the marker: claimed, PUT never returns, nothing clears it', async () => {
    resetStage(config.stages.sellerOfferSent);
    const inner = global.fetch;
    global.fetch = async (url, init) => (init?.method === 'PUT' && new URL(url).origin === 'https://services.leadconnectorhq.com' ? new Promise(() => {}) : inner(url, init));
    const boundary = gatedBoundary();
    let claimed = null;
    const pending = boundary.transitionOpportunityStage(opportunity.id, config.pipelines.sellerLeads, config.stages.underContract, [config.stages.sellerClosedWon], {
      beforePut: async () => { claimed = await claimDirect('v2-interrupted-request'); },
      afterConfirmed: async () => { await claimed.resolve(); },
    });
    for (let i = 0; i < 200 && !(markerUnresolved() && putIssuedThisAttempt); i++) await new Promise((r) => setTimeout(r, 5));
    global.fetch = inner;
    assert.equal(markerUnresolved(), true, 'the marker must already be durable while the PUT is still outstanding');
    const stored = receipts.get(markerKey);
    /* Storage correction: v2 record shape {v:2,state:"unresolved",attemptHash,claimedAt} (was
       {claimedAt,kind,operatorDigest,requestIdDigest}); still no raw operator or request id. */
    assert.deepEqual(Object.keys(stored).sort(), ['attemptHash', 'claimedAt', 'state', 'v']);
    assert.equal(stored.v, 2); assert.equal(stored.state, 'unresolved');
    assert.ok(!JSON.stringify(stored).includes('brad@example.invalid') && !JSON.stringify(stored).includes('interrupted-request'));
    void pending; // deliberately never settles: models the platform killing the function
    resetStage(config.stages.underContract);
  });

  await check('exact confirmation through ghl-write clears the marker', async () => {
    resetStage(config.stages.sellerOfferSent);
    const res = await invokeOp('opportunity.underContractStage', opportunity.id, stageArgs());
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(JSON.parse(res.body).confirmed, true);
    assert.equal(opportunity.pipelineStageId, config.stages.underContract);
    /* Storage correction: "cleared" is now state "resolved" (markers are never deleted). */
    assert.equal(markerUnresolved(), false);
    assert.equal(receipts.get(markerKey).state, 'resolved');
  });

  for (const [mode, label] of [['reject', 'the GHL PUT fails'], ['ignore', 'readback still shows the prior stage'], ['wrong-stage', 'readback shows Seller Closed-Won'], ['wrong-pipeline', 'readback shows another pipeline']]) {
    await check('uncertain outcome leaves the marker: ' + label, async () => {
      resetStage(config.stages.sellerOfferSent); stagePutMode = mode;
      const res = await invokeOp('opportunity.underContractStage', opportunity.id, stageArgs());
      assert.equal(res.statusCode, 409, res.body);
      assert.equal(JSON.parse(res.body).outcome, 'indeterminate');
      assert.equal(markerUnresolved(), true);
      resetStage(config.stages.underContract);
    });
  }

  await checkSuspectedBug('an exception after the claim (confirm hook itself fails) leaves the marker and is never success', async () => {
    resetStage(config.stages.sellerOfferSent);
    /* Storage correction: the confirm hook is now the marker's compare-and-swap to `resolved` (there is
       no delete to fail); the injected failure is a 503 on every write of the marker key after the claim. */
    let claimSeen = false;
    const fault = wire.on((req) => { if (req.method !== 'PUT' || req.store !== 'site:' + compat.S || req.key !== markerKey) return false; if (!claimSeen) { claimSeen = true; return false; } return true; }, wire.status(503), 1000);
    let res;
    try { res = await invokeOp('opportunity.underContractStage', opportunity.id, stageArgs()); }
    finally { fault.times = 0; }
    assert.ok(fault.used >= 1, 'the injected confirm-hook failure was genuinely exercised');
    assert.equal(markerUnresolved(), true);
    assert.equal(res.statusCode, 409, res.body);
    assert.equal(JSON.parse(res.body).confirmed, undefined);
    resetStage(config.stages.underContract);
  });

  await check('while unresolved: a later request with a NEW requestId is refused before ANY GHL call', async () => {
    resetStage(config.stages.sellerOfferSent); stagePutMode = 'reject';
    await invokeOp('opportunity.underContractStage', opportunity.id, stageArgs());
    assert.equal(markerUnresolved(), true);
    clearUncertainTickets(); // isolate the MARKER as the barrier under test (see clearUncertainTickets)
    stagePutMode = 'apply';
    const { result: res, ghlCalls } = await countingGhl(() => invokeOp('opportunity.underContractStage', opportunity.id, stageArgs()));
    assert.equal(res.statusCode, 409, res.body);
    assert.deepEqual(JSON.parse(res.body).by, 'iaos-stage-transition-unresolved');
    assert.equal(JSON.parse(res.body).outcome, 'indeterminate');
    assert.equal(ghlCalls(), 0);
    assert.equal(opportunity.pipelineStageId, config.stages.sellerOfferSent);
  });

  await check('while unresolved: another allowlisted operator is refused the same way, before any GHL call', async () => {
    const saved = process.env.IAOS_APP_WRITE_BRAD_EMAILS;
    process.env.IAOS_APP_WRITE_BRAD_EMAILS = 'brad@example.invalid,second-operator@example.invalid';
    try {
      const { result: res, ghlCalls } = await countingGhl(() => invokeOpAs('second-operator@example.invalid', 'opportunity.underContractStage', opportunity.id, stageArgs()));
      assert.equal(res.statusCode, 409, res.body);
      assert.equal(JSON.parse(res.body).by, 'iaos-stage-transition-unresolved');
      assert.equal(ghlCalls(), 0);
    } finally { process.env.IAOS_APP_WRITE_BRAD_EMAILS = saved; }
  });

  await check('while unresolved: refused even when GHL now shows Under Contract -- a later read never settles the marker', async () => {
    opportunity.pipelineStageId = config.stages.underContract;
    const { result: res, ghlCalls } = await countingGhl(() => invokeOp('opportunity.underContractStage', opportunity.id, stageArgs()));
    assert.equal(res.statusCode, 409, res.body);
    assert.equal(JSON.parse(res.body).by, 'iaos-stage-transition-unresolved');
    assert.equal(ghlCalls(), 0);
    assert.equal(markerUnresolved(), true);
  });

  await check('the marker blocks ONLY this opportunity\'s stage transition: other writes and other opportunities are unaffected', async () => {
    assert.equal(markerUnresolved(), true);
    assert.equal(await markerLib.stageMarkerUnresolved(compat.store(), markerLib.stageMarkerKey('test', config.locationId, opportunity2.id)), false);
    resetStage(config.stages.underContract);
  });

  await check('concurrent claims: exactly one wins, the other is StageTransitionUnresolved', async () => {
    receipts.delete(markerKey);
    const results = await Promise.allSettled([claimDirect('v2-request-a'), claimDirect('v2-request-b')]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    const lost = results.find((r) => r.status === 'rejected');
    /* Storage correction: the losing claim's error class is StageMarkerHeld (was StageTransitionUnresolved). */
    assert.ok(lost.reason instanceof markerLib.StageMarkerHeld);
    receipts.delete(markerKey);
  });

  await check('concurrent attempts at the boundary: exactly ONE PUT is issued', async () => {
    resetStage(config.stages.sellerOfferSent);
    const inner = global.fetch; let puts = 0;
    global.fetch = async (url, init) => { if (init?.method === 'PUT' && new URL(url).origin === 'https://services.leadconnectorhq.com') puts++; return inner(url, init); };
    try {
      const attempt = (rid) => { let claimed = null; return gatedBoundary().transitionOpportunityStage(opportunity.id, config.pipelines.sellerLeads, config.stages.underContract, [config.stages.sellerClosedWon], {
        beforePut: async () => { claimed = await claimDirect(rid); },
        afterConfirmed: async () => { await claimed.resolve(); },
      }); };
      const results = await Promise.allSettled([attempt('v2-concurrent-a'), attempt('v2-concurrent-b')]);
      assert.equal(puts, 1);
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
      assert.ok(results.find((r) => r.status === 'rejected').reason instanceof markerLib.StageMarkerHeld);
    } finally { global.fetch = inner; }
    resetStage(config.stages.underContract);
  });
}

/* Storage correction: no ownership read ever reached the cached (eventual) origin. */
assert.deepEqual(wire.violations,[],'ownership reads must be strong');
console.log(count+' offline contract ledger checks passed'+(suspected.length?'; '+suspected.length+' FAILED (suspected production bug): '+suspected.join(' | '):''));
})().catch(e=>{console.error(e);process.exitCode=1;});
