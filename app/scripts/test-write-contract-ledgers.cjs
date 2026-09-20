/** INV-95 offline handler regressions. Every outbound call is intercepted. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const APP = path.resolve(__dirname, '..');
const originalResolve = Module._resolveFilename;
const originalLoad = Module._load;
const receipts = new Map();
Module._resolveFilename = function(name, parent, ...rest) {
  if (name.startsWith('.') && parent) {
    const candidate = path.resolve(path.dirname(parent.filename), name + '.ts');
    if (fs.existsSync(candidate)) return candidate;
  }
  return originalResolve.call(this, name, parent, ...rest);
};
Module._extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, filename);
Module._load = function(name, ...rest) {
  if (name === '@netlify/blobs') return {
    connectLambda: event => originalLoad.call(this, name, ...rest).connectLambda(event), getStore: () => ({ async get(key) { return receipts.get(key) ?? null; }, async delete(key) { receipts.delete(key); }, async setJSON(key, value, options) { if (options?.onlyIfNew && receipts.has(key)) return { modified: false }; receipts.set(key, value); return { modified: true }; } }) };
  return originalLoad.call(this, name, ...rest);
};
process.env.IAOS_ENV = 'test';
process.env.IAOS_APP_WRITE_GOOGLE_CLIENT_ID = 'offline-client';
process.env.IAOS_APP_WRITE_ALLOWED_ORIGIN = 'https://proof.example.invalid';
process.env.IAOS_APP_WRITE_BRAD_EMAILS = 'brad@example.invalid';
process.env.IAOS_APP_WRITE_SESSION_SECRET = 'offline-fixture-only-not-a-real-secret';
process.env.GHL_PRIVATE_API_KEY = 'offline-fixture';
process.env.GHL_API_TOKEN = 'offline-fixture';

const load=name=>require('../src/lib/'+name+'.ts');
const config=require('../shared/ghl-config.ts').getConfig('test');
const auth=require('../netlify/functions/lib/app-write-auth.ts');
const handler=require('../netlify/functions/ghl-write.ts').handler;
const contact={id:config.documentsContracts.approvedTestContactId,locationId:config.locationId,customFields:[],firstName:'Jane',lastName:'Seller',email:'seller@example.com',address1:'123 Main St',city:'Austin',state:'TX',postalCode:'78701'};
const opportunity={id:'fixture-opportunity',contactId:contact.id,locationId:config.locationId,customFields:[]};
const fixture=require('./write-contract-fixture.cjs').contractFixture(load,opportunity.id);
let notes=[...fixture.notes],writes=0;const at='2026-09-18T01:00:00.000Z',docId='fixture-document';
const requiredResult=load('contract-signer-mapping-model').buildRequiredSignerSet(fixture.report);
const required=requiredResult.signers,buyerRole=requiredResult.buyerRole,buyerDisplayName=requiredResult.buyerDisplayName,buyerEmail=requiredResult.buyerEmail;
const recipients=required.map((s,i)=>({id:i===0?contact.id:'fixture-recipient-'+i,hasCompleted:true,signedDate:at,role:'signer',contactName:s.displayName}));
let documents=[{documentId:docId,locationId:config.locationId,status:'completed',documentRevision:1,updatedAt:at,deleted:false,recipients,links:[{createdBy:config.documentsContracts.senderUserId}],fillableFields:[{isRequired:true}]}];
const reply=data=>({ok:true,status:200,json:async()=>structuredClone(data),text:async()=>JSON.stringify(data)});
global.fetch=async(url,init={})=>{const u=new URL(url);assert.equal(u.origin,'https://services.leadconnectorhq.com');if(u.pathname==='/proposals/document')return reply({documents});if(u.pathname==='/opportunities/'+opportunity.id)return reply({opportunity});if(u.pathname==='/contacts/'+contact.id)return reply({contact});if(u.pathname==='/contacts/'+contact.id+'/notes'){if(init.method==='POST'){writes++;const note={id:'note-'+notes.length,body:JSON.parse(init.body).body};notes.push(note);return reply({note});}return reply({notes});}throw Error('Unexpected request '+u.pathname);};
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
 headers:{'x-nf-site-id':'offline-site','x-nf-deploy-id':'offline-deploy',origin:process.env.IAOS_APP_WRITE_ALLOWED_ORIGIN,authorization:'Bearer '+auth.issueAppSession('brad@example.invalid').token},body:JSON.stringify({operation:'note.create',targetId:contact.id,args:{body},requestId:'ledger-'+(++n)})});}
async function check(name,fn){await fn();console.log('PASS '+name);count++;}
(async()=>{
await check('accepted send ledger requires fresh matching provider evidence',async()=>{const res=await invoke(sendNote(send));assert.equal(res.statusCode,200,res.body);});
await check('signer mapping attestation retained',async()=>{const res=await invoke(load('contract-signer-mapping-carriers').formatSignerMappingAttestationNote(mapping.value));assert.equal(res.statusCode,200,res.body);});
await check('executed terms attestation retained',async()=>{const res=await invoke(load('contract-executed-terms-attestation-carriers').formatExecutedTermsAttestationNote(attestation.value));assert.equal(res.statusCode,200,res.body);});
await check('provider lifecycle observation independently confirmed',async()=>{const res=await invoke(load('contract-lifecycle-carriers').formatContractLifecycleNote(observed.value));assert.equal(res.statusCode,200,res.body);});
await check('duplicate document identity refuses provider evidence',async()=>{documents.push({...documents[0]});const before=writes;assert.equal((await invoke(load('contract-lifecycle-carriers').formatContractLifecycleNote(observed.value))).statusCode,409);assert.equal(writes,before);documents.pop();});
await check('fabricated provider completion rejected',async()=>{const before=writes;const forged={...observed.value,providerReportedAt:'2026-09-19T00:00:00.000Z'};assert.equal((await invoke(load('contract-lifecycle-carriers').formatContractLifecycleNote(forged))).statusCode,409);assert.equal(writes,before);});
await check('Under Contract independently rebuilds all evidence',async()=>{const res=await invoke(load('contract-execution-carriers').formatUnderContractNote(execution.value));assert.equal(res.statusCode,200,res.body);});
await check('duplicate Under Contract rejected',async()=>{const before=writes;assert.equal((await invoke(load('contract-execution-carriers').formatUnderContractNote(execution.value))).statusCode,409);assert.equal(writes,before);});
await check('incomplete provider signer refuses execution',async()=>{documents[0].recipients[0].hasCompleted=false;const before=writes;assert.equal((await invoke(load('contract-execution-carriers').formatUnderContractNote({...execution.value,iaosVerifiedAt:'2026-09-18T02:00:00.000Z'}))).statusCode,409);assert.equal(writes,before);documents[0].recipients[0].hasCompleted=true;});
const report=fixture.report;
const handoff=load('contract-disposition-handoff-model').buildDispositionHandoffRecordArgs({handoffId:'fixture-handoff',createdAt:at,opportunityId:opportunity.id,contactId:contact.id,agreementAt:fixture.version.agreementAt,version:fixture.version,eligibility:{eligible:true},underContract:execution.value,propertyAddress:{kind:'populated',value:'123 Main St, Austin, TX, 78701',authority:'operator_attested',recordedAt:null},propertyLegalDescription:report.propertyLegalDescription,sellerContractPrice:190000,approvedArv:{amount:300000,approvalEvidenceState:null,approvalDecision:null,approvedAt:null},approvedRepairs:25000,closingDate:report.closingPossession.closingDate,possessionDetails:report.closingPossession.possessionDetails,accessShowingInformation:{kind:'unresolved'},sellerContact:{noticeAddress:report.noticeContact.sellerNoticeAddress,noticePhone:report.noticeContact.sellerNoticePhone,noticeEmail:report.noticeContact.sellerNoticeEmail},requiredSigners:required,documentReferences:[],documentReferencesNote:'No upstream reference carrier',evidenceSummary:'Synthetic canonical handoff'});assert.equal(handoff.ok,true,JSON.stringify(handoff));
await check('fabricated handoff price refused',async()=>{const before=writes;assert.equal((await invoke(load('contract-disposition-handoff-carriers').formatDispositionHandoffNote({...handoff.value,sellerContractPrice:1}))).statusCode,409);assert.equal(writes,before);});
await check('canonical disposition handoff retained',async()=>{const res=await invoke(load('contract-disposition-handoff-carriers').formatDispositionHandoffNote(handoff.value));assert.equal(res.statusCode,200,res.body);});
await check('duplicate handoff refused',async()=>{const before=writes;assert.equal((await invoke(load('contract-disposition-handoff-carriers').formatDispositionHandoffNote(handoff.value))).statusCode,409);assert.equal(writes,before);});
console.log(count+' offline contract ledger checks passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
