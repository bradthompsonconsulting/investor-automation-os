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
let blobCalls = 0, blobConnections = 0;
const realBlobs = require('@netlify/blobs');
delete process.env.NETLIFY_BLOBS_CONTEXT;
const lambdaHeaders = {
  'x-nf-site-id': 'offline-site', 'x-nf-deploy-id': 'offline-deploy'
};
const lambdaBlobs = Buffer.from(JSON.stringify({
  url: 'https://blobs.example.invalid', token: 'offline-blob-fixture'
})).toString('base64');
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
    connectLambda: event => { blobConnections++; realBlobs.connectLambda(event); },
    getStore: () => { blobCalls++; realBlobs.getStore('iaos-write-receipts'); return ({ async get(key) { return receipts.get(key) ?? null; }, async delete(key) { receipts.delete(key); }, async setJSON(key, value, options) { if (options?.onlyIfNew && receipts.has(key)) return { modified: false }; receipts.set(key, value); return { modified: true }; } }); } };
  return originalLoad.call(this, name, ...rest);
};
process.env.IAOS_ENV = 'test';
process.env.IAOS_APP_WRITE_GOOGLE_CLIENT_ID = 'offline-client';
process.env.IAOS_APP_WRITE_ALLOWED_ORIGIN = 'https://proof.example.invalid';
process.env.IAOS_APP_WRITE_BRAD_EMAILS = 'brad@example.invalid';
process.env.IAOS_APP_WRITE_SESSION_SECRET = 'offline-fixture-only-not-a-real-secret';
process.env.GHL_PRIVATE_API_KEY = 'offline-fixture';
process.env.GHL_API_TOKEN = 'offline-fixture';
const auth = require('../netlify/functions/lib/app-write-auth.ts');
const contracts = require('../netlify/functions/lib/write-contracts.ts');
const { getConfig } = require('../shared/ghl-config.ts');
const config = getConfig('test');
const boundaryLib = {...require('../netlify/functions/lib/ghl-write-boundary.ts'),...require('../netlify/functions/lib/write-receipts.ts')};
const contact = { id: 'fixture-contact', locationId: config.locationId, customFields: [], tags: [], phone: '+15555550101' };
const opportunity = { id: 'fixture-opportunity', contactId: contact.id, locationId: config.locationId, customFields: [] };
let notes = [], calls = [], writes = 0, omitReadback = false;
const task = { id: 'fixture-task', contactId: contact.id, completed: false };
const reply = data => ({ ok: true, status: 200, json: async () => structuredClone(data), text: async () => JSON.stringify(data) });
global.fetch = async (url, init = {}) => {
  const parsed = new URL(url); const pathname = parsed.pathname; const method = init.method || 'GET';
  calls.push({ pathname, method });
  assert.equal(parsed.origin, 'https://services.leadconnectorhq.com', 'no external network');
  if (pathname === `/contacts/${contact.id}/notes`) {
    if (method === 'POST') { writes++; const note = { id: `note-${notes.length}`, body: JSON.parse(init.body).body }; notes.push(note); return reply({ note }); }
    return reply({ notes });
  }
  if (pathname === `/contacts/${contact.id}/tasks/${task.id}`) return reply({ task });
  if (pathname === `/contacts/${contact.id}/tasks/${task.id}/completed`) { writes++; task.completed = true; return reply({}); }
  const object = pathname === `/contacts/${contact.id}` ? contact : pathname === `/opportunities/${opportunity.id}` ? opportunity : null;
  if (!object) throw new Error('Unexpected mocked request: ' + pathname);
  if (method === 'PUT') {
    writes++;
    if (!omitReadback) for (const field of JSON.parse(init.body).customFields) {
      object.customFields = object.customFields.filter(f => f.id !== field.id);
      if (field.field_value !== '' && field.field_value !== null) object.customFields.push({ id: field.id, [object === contact ? 'value' : 'fieldValue']: field.field_value });
    }
  }
  return reply(object === contact ? { contact } : { opportunity });
};
const handler = require('../netlify/functions/ghl-write.ts').handler;
let count = 0;
function check(name, fn) { return Promise.resolve().then(fn).then(() => { count++; console.log('PASS ' + name); }); }
let sequence = 0;
function event(operation, targetId, args, requestId = `request-${++sequence}`) {
  return { blobs: lambdaBlobs, httpMethod: 'POST', headers: { ...lambdaHeaders, origin: process.env.IAOS_APP_WRITE_ALLOWED_ORIGIN, authorization: `Bearer ${auth.issueAppSession('brad@example.invalid').token}` }, body: JSON.stringify({ operation, targetId, args, requestId }) };
}
(async () => {

  await check('valid Lambda context initializes real SDK Blob access', async () => {
    delete process.env.NETLIFY_BLOBS_CONTEXT;
    const before = blobConnections;
    const e = event('note.create', contact.id, {body:'Lambda fixture'});
    assert.equal((await handler(e)).statusCode, 200);
    assert.equal(blobConnections, before + 1);
    let reads = 0;
    const store = realBlobs.getStore({name:'iaos-write-receipts',
      fetch: async (url, init) => {
        assert.equal(new URL(url).origin, 'https://blobs.example.invalid');
        assert.equal(init.method, 'get');
        reads++;
        return new Response(JSON.stringify({fixture:true}));
      }
    });
    assert.deepEqual(await store.get('fixture', {type:'json'}), {fixture:true});
    assert.equal(reads, 1);
  });
  for (const [label, mutate] of [
    ['missing', e => { delete e.blobs; }],
    ['invalid base64/JSON', e => { e.blobs = '%%%'; }],
    ['null JSON', e => { e.blobs = Buffer.from('null').toString('base64'); }],
    ['missing token', e => {
      e.blobs = Buffer.from(JSON.stringify({url:'https://blobs.example.invalid'}))
        .toString('base64');
    }],
    ['missing site', e => { delete e.headers['x-nf-site-id']; }]
  ]) await check('Lambda context fails closed: ' + label, async () => {
    // Seed a previous invocation to ensure bad context cannot reuse its access.
    realBlobs.connectLambda(event('note.create', contact.id, {body:'seed'}));
    const e = event('note.create', contact.id, {body:'must not write'});
    mutate(e);
    const before = {writes, receipts:[...receipts]};
    const result = await handler(e);
    assert.equal(result.statusCode, 409);
    assert.deepEqual(JSON.parse(result.body), {
      error:'Write refused or unconfirmed; refresh and inspect before retrying'
    });
    assert.deepEqual({writes, receipts:[...receipts]}, before);
  });
  for (const [label, status, mutate] of [
    ['method', 405, e => { e.httpMethod = 'GET'; }],
    ['auth', 401, e => { delete e.headers.authorization; }],
    ['origin', 403, e => { e.headers.origin = 'https://wrong.example.invalid'; }],
    ['JSON', 400, e => { e.body = '{'; }],
    ['operation', 400, e => {
      e.body = JSON.stringify({operation:'retired',targetId:contact.id,
        requestId:'offline-rejected',args:{}});
    }]
  ]) await check('rejection precedes Lambda/Blob access: ' + label, async () => {
    const e = event('note.create', contact.id, {body:'must not write'});
    delete e.blobs;
    mutate(e);
    const before = [calls.length, writes, blobCalls, blobConnections];
    assert.equal((await handler(e)).statusCode, status);
    assert.deepEqual([calls.length, writes, blobCalls, blobConnections], before);
  });

  // Origin failures must not instantiate Blob storage or call GHL.
  const approvedOrigin = process.env.IAOS_APP_WRITE_ALLOWED_ORIGIN;
  for (const origin of [
    undefined, '', 'null', 'https://wrong.example.invalid',
    approvedOrigin + '.attacker.invalid', approvedOrigin + '/',
    approvedOrigin + '/path', approvedOrigin + '?x=1',
    approvedOrigin + '#fragment', approvedOrigin + ':443',
    'http://proof.example.invalid', 'https://user@proof.example.invalid',
    ' https://proof.example.invalid', approvedOrigin + ', ' + approvedOrigin,
    ['https://proof.example.invalid'], 'not a URL',
  ]) {
    await check('Origin rejected: ' + JSON.stringify(origin), async () => {
      const e = event('note.create', contact.id, {body:'must not write'});
      if (origin === undefined) delete e.headers.origin;
      else e.headers.origin = origin;
      const before = [calls.length, blobCalls, writes, blobConnections];
      assert.equal((await handler(e)).statusCode, 403);
      assert.deepEqual([calls.length, blobCalls, writes, blobConnections], before);
    });
  }
  for (const headers of [
    {Origin: approvedOrigin},
    {multi: {Origin:[approvedOrigin, approvedOrigin]}},
    {multi: {origin:[approvedOrigin], Origin:[approvedOrigin]}},
    {multi: {origin:[]}},
  ]) await check('ambiguous Origin refused ' + JSON.stringify(headers), async()=>{
    const e = event('note.create',contact.id,{body:'must not write'});
    if (headers.multi) e.multiValueHeaders = headers.multi;
    else Object.assign(e.headers,headers);
    const before = [calls.length,blobCalls,writes,blobConnections];
    assert.equal((await handler(e)).statusCode,403);
    assert.deepEqual([calls.length,blobCalls,writes,blobConnections],before);
  });
  for (const setting of [undefined,'','*','https://*.example.invalid',
    approvedOrigin+'/',approvedOrigin+',https://other.example.invalid']) {
    await check('invalid origin configuration fails closed '+setting,async()=>{
      const e=event('note.create',contact.id,{body:'must not write'});
      if(setting===undefined)delete process.env.IAOS_APP_WRITE_ALLOWED_ORIGIN;
      else process.env.IAOS_APP_WRITE_ALLOWED_ORIGIN=setting;
      const before=[calls.length,blobCalls,writes,blobConnections];
      try {
        assert.equal((await handler(e)).statusCode,403);
        assert.deepEqual([calls.length,blobCalls,writes,blobConnections],before);
      } finally {process.env.IAOS_APP_WRITE_ALLOWED_ORIGIN=approvedOrigin;}
    });
  }
  for(const origin of [approvedOrigin,undefined,'https://wrong.example.invalid']){
    await check('unauthenticated retains 401 with Origin '+origin,async()=>{
      const e=event('note.create',contact.id,{body:'must not write'});
      e.headers=origin?{origin}:{};
      const before=[calls.length,blobCalls,writes,blobConnections];
      assert.equal((await handler(e)).statusCode,401);
      assert.deepEqual([calls.length,blobCalls,writes,blobConnections],before);
    });
  }
  await check('approved Origin reaches payload gate without upstream access',async()=>{
    const e=event('note.create',contact.id,{body:'must not write'});
    e.body='{';
    const before=[calls.length,blobCalls,writes,blobConnections];
    assert.equal((await handler(e)).statusCode,400);
    assert.deepEqual([calls.length,blobCalls,writes,blobConnections],before);
  });
  await check('capitalized Origin with consistent multi header writes note only',async()=>{
    const e=event('note.create',contact.id,{body:'origin fixture'});
    e.headers.Origin=e.headers.origin; delete e.headers.origin;
    e.multiValueHeaders={Origin:[approvedOrigin]};
    const before=calls.length;
    assert.equal((await handler(e)).statusCode,200);
    assert.deepEqual(calls.slice(before).filter(c=>c.method!=='GET'),
      [{pathname:'/contacts/'+contact.id+'/notes',method:'POST'}]);
  });

  await check('missing configuration fails closed', () => assert.throws(() => auth.appAuthConfig({})));
  await check('authorized application identity verifies', () => assert.equal(auth.requireAppWriter(event('', '', {})), 'brad@example.invalid'));
  await check('expired session refused', () => { const token = auth.issueAppSession('brad@example.invalid', process.env, Date.now() - 1000000).token; assert.throws(() => auth.requireAppWriter({ headers: { authorization: `Bearer ${token}` } })); });
  await check('voice audience refused even with valid app signature', () => {
    const crypto = require('node:crypto'); const parts = auth.issueAppSession('brad@example.invalid').token.split('.');
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url')); claims.aud = 'iaos-voice'; parts[1] = Buffer.from(JSON.stringify(claims)).toString('base64url'); parts[2] = crypto.createHmac('sha256', process.env.IAOS_APP_WRITE_SESSION_SECRET).update(parts.slice(0,2).join('.')).digest('base64url');
    assert.throws(() => auth.requireAppWriter({ headers: { authorization: `Bearer ${parts.join('.')}` } }));
  });
  await check('concurrent contact mutation refused until prior operation completes',async()=>{const release=await boundaryLib.lockContact(contact.id);const before=writes;assert.equal((await handler(event('contact.propertyNotes',contact.id,{value:'blocked'}))).statusCode,409);assert.equal(writes,before);await release();});
  const googleClaims={iss:'https://accounts.google.com',aud:process.env.IAOS_APP_WRITE_GOOGLE_CLIENT_ID,email:'brad@example.invalid',email_verified:true,exp:Math.floor(Date.now()/1000)+60};
  await check('Google-verified allowlisted application identity',async()=>assert.equal(await auth.googleAppIdentity('synthetic',async()=>reply(googleClaims)),'brad@example.invalid'));
  for(const [field,value] of [['aud','voice-client'],['email','other@example.invalid'],['email_verified',false],['iss','untrusted'],['exp',0]])await check('Google rejects invalid '+field,async()=>assert.rejects(()=>auth.googleAppIdentity('synthetic',async()=>reply({...googleClaims,[field]:value}))));
  const cases = [
    ['contact.lastCallAttempt', {value:'2026-09-18T01:00:00.000Z'}], ['contact.callback',{value:'2026-09-19T01:00:00.000Z'}],
    ['contact.propertyNotes',{value:'synthetic note'}], ['contact.arv',{value:250000}], ['contact.disposition',{value:'No Answer'}],
    ['contact.routing',{value:'Stay in Cold Outreach'}], ['contact.dispositionAt',{value:'2026-09-18T01:00:00.000Z'}], ['contact.occupancy',{value:'Vacant'}],
    ['opportunity.askingPrice',{value:100000}], ['opportunity.arv',{value:250000}], ['opportunity.repairs',{value:25000}],
    ['opportunity.currentOffer',{value:110000}], ['opportunity.assignmentMode',{value:'Standard'}],
    ['opportunity.underwriting',{endBuyerMaxPrice:150000,sellerMAO:130000,assignmentMode:'Standard'}],
    ['note.create',{body:'synthetic operator note'}], ['task.complete',{taskId:task.id}],
  ];
  // Labels come from the governed model, not an invented fixture option.
  const mode = require('../src/lib/underwriting/resolver-types.ts').ASSIGNMENT_MODE_OPTIONS[0][0];
  cases.find(c=>c[0]==='opportunity.assignmentMode')[1].value=mode;
  cases.find(c=>c[0]==='opportunity.underwriting')[1].assignmentMode=mode;
  for(const [op,args] of cases) await check('retained '+op, async () => {
    const res=await handler(event(op, op.startsWith('opportunity.')||op.startsWith('contract.')?opportunity.id:contact.id,args)); assert.equal(res.statusCode,200,res.body); assert.notEqual(JSON.parse(res.body).confirmed,false);
  });
  const arvNote=require('../src/lib/arv-persist.ts').formatArvApprovalNote({kind:'approved',amount:250000,recommendedArv:250000,revision:3},{approvedAt:'2026-09-04T20:00:00.000Z',operator:'Brad Thompson',opportunityId:opportunity.id,evidenceState:'HIGH',reconciliationOutcome:'RECOMMENDED',acceptedCompCount:4,searchLevel:'STANDARD',source:{kind:'PROPSTREAM_COMPARABLE_CSV',version:'propstream-comparable-csv-v1',fileName:'synthetic.csv',importedAt:'2026-09-04T19:00:00.000Z'}});
  await check('retained ARV approval with existing Brad display name',async()=>{const res=await handler(event('note.create',contact.id,{body:arvNote}));assert.equal(res.statusCode,200,res.body);});
  await check('ARV ledger cannot claim a different amount',async()=>{const before=writes;assert.equal((await handler(event('note.create',contact.id,{body:arvNote.replace('Approved ARV: 250000','Approved ARV: 1')}))).statusCode,409);assert.equal(writes,before);});
  for(const [name,mutate,status] of [
    ['extra envelope field',r=>({...r,method:'PUT'}),400], ['arbitrary operation',r=>({...r,operation:'workflow.execute'}),400],
    ['extra field',r=>({...r,args:{value:'x',pipelineStageId:'injected'}}),400], ['path traversal',r=>({...r,targetId:'../other'}),400],
    ['wrong identity',r=>({...r,targetId:'other-contact'}),409],
  ]) await check('reject '+name,async()=>{const e=event('contact.propertyNotes',contact.id,{value:'x'});e.body=JSON.stringify(mutate(JSON.parse(e.body)));const before=writes;assert.equal((await handler(e)).statusCode,status);assert.equal(writes,before);});
  await check('unauthenticated request makes zero upstream calls',async()=>{const e=event('contact.propertyNotes',contact.id,{value:'x'});e.headers={};const before=calls.length;assert.equal((await handler(e)).statusCode,401);assert.equal(calls.length,before);});
  await check('malformed JSON makes zero upstream calls',async()=>{const e=event('',contact.id,{});e.body='{';const before=calls.length;assert.equal((await handler(e)).statusCode,400);assert.equal(calls.length,before);});
  await check('duplicate request refused before a second write',async()=>{const e=event('note.create',contact.id,{body:'replay fixture'});assert.equal((await handler(e)).statusCode,200);const before=writes;assert.equal((await handler(e)).statusCode,409);assert.equal(writes,before);});


  await check('partial write is explicit and never confirmed',async()=>{omitReadback=true;const res=await handler(event('opportunity.repairs',opportunity.id,{value:999}));assert.equal(JSON.parse(res.body).confirmed,false);omitReadback=false;});
  await check('duplicate readback field rejected',()=>assert.throws(()=>boundaryLib.fieldValue([{id:'x',value:1},{id:'x',value:1}],'x','contact')));
  await check('wrong field representation rejected',()=>assert.throws(()=>boundaryLib.fieldValue([{id:'x',fieldValueNumber:1}],'x','opportunity')));
  await check('Production contract projection fails closed',()=>assert.throws(()=>contracts.planWrite('contract.projection',{entries:[{key:Object.keys(config.contractProjectionFields)[0],text:'synthetic'}],sellerCount:'One Seller'},getConfig('production'))));
  const fixture = require('./write-contract-fixture.cjs').contractFixture(name=>require('../src/lib/'+name+'.ts'), opportunity.id);
  Object.assign(contact,{firstName:'Jane',lastName:'Seller',email:'seller@example.com',address1:'123 Main St',city:'Austin',state:'TX',postalCode:'78701'});
  opportunity.customFields=opportunity.customFields.filter(f=>f.id!==config.opportunityFacts.currentOffer);
  opportunity.customFields.push({id:config.opportunityFacts.currentOffer,fieldValue:190000});
  for(const note of fixture.notes) await check('retained ledger '+note.body.split(' — ')[0],async()=>{const res=await handler(event('note.create',contact.id,{body:note.body}));assert.equal(res.statusCode,200,res.body);});
  const context = await require('../netlify/functions/lib/write-contract-context.ts').currentContractContext(boundaryLib.configuredBoundary(),opportunity.id);


  for (const environment of ['test', 'production']) {
    for (const [operation, args] of [
      ['contract.projection', {entries: context.projection.entries,
        sellerCount: context.sellerCount}],
      ['contract.draftRequest', {value: 'Requested'}],
      ['contract.draftRequest', {value: 'Idle'}],
    ]) await check('retired ' + operation + ' refused in ' + environment, async () => {
      process.env.IAOS_ENV = environment;
      const before = {calls: calls.length, writes, receipts: receipts.size};
      const response = await handler(event(operation, opportunity.id, args));
      assert.equal(response.statusCode, 400);
      assert.deepEqual({calls: calls.length, writes, receipts: receipts.size}, before);
      assert.throws(() => contracts.planWrite(operation, args, getConfig(environment)));
    });
  }
  process.env.IAOS_ENV = 'test';
  await check('canonical projection computation remains available',
    () => assert.equal(context.projection.ok, true));
  // Board #9 Phase B correction: the server now INDEPENDENTLY regenerates
  // the PDF from `context` to verify authorization currency (see
  // write-derived-note.ts / write-contract-context.ts), so a note claiming
  // a synthetic/fabricated artifact hash (the fixture's own placeholder)
  // can never pass. Build this note's claimed artifact facts from a REAL
  // regeneration against the same canonical context the server itself will
  // recompute, so this test still proves genuine end-to-end currency.
  const realArtifactFacts = await require('../netlify/functions/lib/write-contract-context.ts').currentGeneratedArtifactFacts(context);
  const realAuthorization = require('../src/lib/contract-authorization-model.ts').buildAuthorizationRecordArgs({opportunityId: opportunity.id, at: context.version.agreementAt, preview: context.preview, currentVersion: context.version, artifact: realArtifactFacts});
  assert.equal(realAuthorization.ok, true, JSON.stringify(realAuthorization));
  const authorization=require('../src/lib/contract-authorization-carriers.ts').formatBradContractAuthorizationNote(realAuthorization.value);
  await check('retained canonical Brad authorization',async()=>{const res=await handler(event('note.create',contact.id,{body:authorization}));assert.equal(res.statusCode,200,res.body);});
  await check('reject stale authorization content',async()=>{const before=writes;const res=await handler(event('note.create',contact.id,{body:authorization.replace('Jane Seller','Other Seller')}));assert.equal(res.statusCode,409);assert.equal(writes,before);});
  await check('freeze Current Offer after agreement',async()=>{const before=writes;assert.equal((await handler(event('opportunity.currentOffer',opportunity.id,{value:195000}))).statusCode,409);assert.equal(writes,before);});
  const sync={opportunityId:opportunity.id,at:'2026-09-18T01:00:00.000Z',attemptId:'2026-09-18T01:00:00.000Z',operator:'brad',status:'in_progress',version:fixture.version,entriesAttempted:context.projection.entries.length,entriesLanded:context.projection.entries.length,failedKeys:[],currentOfferCrossCheckOk:true,observedStateBeforeWrite:'Idle',intendedToState:'Requested',sentValue:null,observedValue:null,providerStatus:null,failureReason:null,sellerSigningEvidence:{sellerCountDiscriminator:'one_seller',seller1Ok:true,seller1ContactId:contact.id,seller1Capacity:'individual_own_capacity',seller2LegalName:null,seller2NormalizedEmail:null,seller2Capacity:null,printedPartyConsistencyOk:true,expectedSellerCountTransportValue:'One Seller',canonicalReady:true,sellerCountFieldProvisioned:true,sellerCountWriteReadbackOk:true,effectiveDateStatus:'pending_final_acceptance',recipientAssignmentStatus:'pending_manual_review',blockingReasons:[],sendOccurred:false}};
  const syncBody=require('../src/lib/contract-projection-sync-carriers.ts').formatContractProjectionSyncNote(sync);
  await check('retained projection reservation note',async()=>{const res=await handler(event('note.create',contact.id,{body:syncBody}));assert.equal(res.statusCode,200,res.body);});


  const proxy=require('../netlify/functions/ghl-proxy.ts').handler;
  for(const method of ['POST','PUT','PATCH','DELETE'])await check('generic proxy refuses '+method,async()=>{const before=calls.length;assert.equal((await proxy({httpMethod:method,queryStringParameters:{path:`/contacts/${contact.id}`},body:'{}'})).statusCode,403);assert.equal(calls.length,before);});
  // Encoding metadata alone never turns a bodyless GET into a write.
  for (const suffix of ['', '/notes']) {
    const pathname = '/contacts/' + contact.id + suffix;
    const base = {httpMethod:'GET', queryStringParameters:{path:pathname}};
    for (const body of [undefined, null, '']) {
      for (const flag of [undefined, false, true]) {
        await check('proxy GET ' + suffix + ' empty=' + String(body) +
          ' encoded=' + String(flag), async () => {
          const before = {calls:calls.length, writes, blobCalls};
          const input = {...base};
          if (body !== undefined) input.body = body;
          if (flag !== undefined) input.isBase64Encoded = flag;
          const result = await proxy(input);
          assert.equal(result.statusCode, 200, result.body);
          assert.deepEqual(calls.slice(before.calls),
            [{pathname, method:'GET'}]);
          assert.equal(writes, before.writes);
          assert.equal(blobCalls, before.blobCalls);
        });
      }
    }
    async function refused(label, extra) {
      await check('proxy refuses ' + suffix + ' ' + label, async () => {
        const before = {calls:calls.length, writes, blobCalls};
        const result = await proxy({...base, ...extra});
        assert.equal(result.statusCode, 403, result.body);
        assert.equal(JSON.parse(result.body).by, 'iaos-proxy-allowlist');
        assert.deepEqual({calls:calls.length, writes, blobCalls}, before);
      });
    }
    for (const body of ['{}', ' ', 'e30=', 'AA==', 0, false, {}, []]) {
      for (const flag of [false, true]) {
        await refused('body=' + JSON.stringify(body) + ' encoded=' + flag,
          {body, isBase64Encoded:flag});
      }
    }
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']) {
      for (const flag of [false, true]) {
        await refused(method + ' empty encoded=' + flag,
          {httpMethod:method, body:'', isBase64Encoded:flag});
      }
    }
    for (const key of ['method', 'body', 'locationId']) {
      await refused('extra query ' + key,
        {queryStringParameters:{path:pathname, [key]:'unexpected'}});
    }
    for (const key of ['locationId', 'location_id', 'locationid']) {
      await refused('foreign location ' + key,
        {queryStringParameters:{path:pathname + '?' + key + '=foreign'}});
    }
    await refused('path suffix',
      {queryStringParameters:{path:pathname + '/forbidden'}});
  }
  for (const pathname of ['/proposals/templates/send', '/contacts/x/tasks']) {
    await check('proxy keeps path retired/disallowed ' + pathname, async () => {
      const before = {calls:calls.length, writes, blobCalls};
      const result = await proxy({httpMethod:'GET', body:'',
        isBase64Encoded:true, queryStringParameters:{path:pathname}});
      assert.equal(result.statusCode, 403);
      assert.deepEqual({calls:calls.length, writes, blobCalls}, before);
    });
  }
  const {requireWebhook}=require('../netlify/functions/lib/write-webhook-auth.ts');
  await check('root webhook does not inherit app session',()=>assert.throws(()=>requireWebhook(event('', '', {}),'IAOS_PHONE_LOOKUP_WEBHOOK_SECRET')));
  await check('root webhook exact dedicated secret accepted',()=>{requireWebhook({headers:{'x-iaos-secret':'offline-webhook-fixture-only-long-secret'}},'IAOS_PHONE_LOOKUP_WEBHOOK_SECRET',{IAOS_PHONE_LOOKUP_WEBHOOK_SECRET:'offline-webhook-fixture-only-long-secret'});});
  console.log(`${count} offline boundary checks passed`);
})().catch(error=>{console.error(error);process.exitCode=1;});
