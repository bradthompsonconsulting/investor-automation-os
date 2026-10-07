/** INV-95 offline handler regressions. Every outbound call is intercepted. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const APP = path.resolve(__dirname, '..');
/* Storage correction (PR #131): ghl-disposition is a modern-runtime function whose ownership storage
   (lock v2, admission tickets) runs on the REAL @netlify/blobs client over the wire harness. The two
   repo-root webhooks below are unchanged Lambda handlers that use no Blob store. */
const { setupV2Env } = require('./harness/v2-env.cjs');
const v2env = setupV2Env();
process.env.IAOS_ENV = 'test';
process.env.IAOS_APP_WRITE_GOOGLE_CLIENT_ID = 'offline-client';
process.env.IAOS_APP_WRITE_BRAD_EMAILS = 'brad@example.invalid';
process.env.IAOS_APP_WRITE_SESSION_SECRET = 'offline-fixture-only-not-a-real-secret';
process.env.IAOS_GHL_TOKEN_V2 = 'offline-fixture';
process.env.GHL_API_TOKEN = 'offline-fixture';

const {getConfig}=require('../shared/ghl-config.ts');const config=getConfig('test');
const phone=require('../../netlify/functions/phone-lookup.ts').handler;
const motivation=require('../../netlify/functions/motivation-score.ts').handler;
const dispositionMod=require('../netlify/functions/ghl-disposition.ts');const disposition=(e)=>v2env.invoke(dispositionMod,{fn:'ghl-disposition',...e});
const secret='offline-synthetic-webhook-secret-only';
process.env.IAOS_PHONE_LOOKUP_WEBHOOK_SECRET=secret;process.env.IAOS_MOTIVATION_WEBHOOK_SECRET=secret;process.env.IAOS_WEBHOOK_SECRET=secret;
process.env.TWILIO_ACCOUNT_SID='offline-fixture';process.env.TWILIO_AUTH_TOKEN='offline-fixture';
const contact={id:'fixture-contact',locationId:config.locationId,phone:'+15555550101',customFields:[],tags:['unrelated']};
let fields=[{id:'phone-type-field',fieldKey:'contact.phone_type'},{id:'motivation-field',fieldKey:'contact.motivation_score'}];
let calls=[],writes=[],notes=[],omit=false;const response=data=>({ok:true,status:200,json:async()=>structuredClone(data),text:async()=>JSON.stringify(data)});
v2env.hooks.ghlFetch=async(url,init={})=>{const u=new URL(url);const method=init.method||'GET';calls.push({origin:u.origin,path:u.pathname,method});
if(u.origin==='https://lookups.twilio.com'){assert.equal(method,'GET');return response({line_type_intelligence:{type:'mobile'}});}
assert.equal(u.origin,'https://services.leadconnectorhq.com');
if(method!=='GET')writes.push({path:u.pathname,method,body:JSON.parse(init.body)});
if(u.pathname==='/locations/'+config.locationId+'/customFields')return response({customFields:fields});
if(u.pathname==='/contacts/'+contact.id+'/tags'){const tags=JSON.parse(init.body).tags;assert(tags.every(t=>['hot','warm','low'].includes(t)));if(!omit)contact.tags=method==='POST'?[...new Set([...contact.tags,...tags])]:contact.tags.filter(t=>!tags.includes(t));return response({tags:contact.tags});}
if(u.pathname==='/contacts/'+contact.id+'/notes'){if(method==='POST'){const note={id:'note-'+notes.length,body:JSON.parse(init.body).body,dateAdded:new Date().toISOString()};notes.push(note);return response({note});}return response({notes});}
if(u.pathname==='/contacts/'+contact.id){if(method==='PUT'&&!omit)for(const f of JSON.parse(init.body).customFields){contact.customFields=contact.customFields.filter(c=>c.id!==f.id);contact.customFields.push({id:f.id,value:f.field_value});}return response({contact});}
throw new Error('Unexpected offline request '+u.pathname);};
const ghlAndTwilio=v2env.hooks.ghlFetch;global.fetch=(url,init)=>ghlAndTwilio(url,init);
const event=body=>({httpMethod:'POST',headers:{'x-iaos-secret':secret},body:JSON.stringify(body)});let count=0;
/* Each check runs on its own: a failure is recorded and the suite continues (Bones finding 6: the scoring
   handler must be exercised independently, not skipped after an earlier failure). */
let failures=0;
async function check(name,fn){try{await fn();console.log('PASS '+name);count++;}catch(e){failures++;console.error('FAIL '+name+'\n  '+(e&&e.stack?e.stack.split('\n').slice(0,3).join('\n  '):e));}}
const ghlCalls=()=>calls.filter(c=>c.origin==='https://services.leadconnectorhq.com');
const twilioCalls=()=>calls.filter(c=>c.origin.includes('twilio'));
const tagCalls=()=>calls.filter(c=>/\/tags$/.test(c.path));
/* Storage correction (Bones finding 6; Jess decision A pending): the two MARKETING webhooks have no reviewed
   write path under storage v2, so they are UNIFORMLY HELD -- refused (503) before the provider lookup and
   before ANY GHL read or write, tags included. Nothing partial can happen. Their approved functional checks
   (phone writes exactly phone_type; four score fields + one bucket tag; phone mismatch / foreign contact /
   ambiguous definition / readback mismatch / score extra fields) are SUSPENDED, not deleted: they return
   when a reviewed path is accepted. This is a regression in functionality, held fail-closed. */
const held=async(name,handler,payload)=>check(name+' is HELD: 503 before any provider or GHL call (tags included); nothing written',async()=>{
  const g=ghlCalls().length,t=twilioCalls().length,tg=tagCalls().length,w=writes.length;
  const res=await handler(event(payload));
  assert.equal(res.statusCode,503,res.body);assert.match(String(res.body),/held pending review/);
  assert.equal(ghlCalls().length,g,'no GHL call');assert.equal(twilioCalls().length,t,'no provider call');assert.equal(tagCalls().length,tg,'no tag call');assert.equal(writes.length,w,'no write');});
(async()=>{
for(const [name,handler,payload] of [['phone',phone,{contactId:contact.id,phone:contact.phone}],['score',motivation,{contactId:contact.id}],['disposition',disposition,{customData:{contact_id:contact.id,disposition:'No Answer',duration:'5'}}]]){
await check(name+' missing authentication has zero upstream calls',async()=>{const e=event(payload);e.headers={};const before=calls.length;assert.equal((await handler(e)).statusCode,401);assert.equal(calls.length,before);});
await check(name+' application session cannot authorize webhook',async()=>{const e=event(payload);e.headers={authorization:'Bearer application-session'};const before=calls.length;assert.equal((await handler(e)).statusCode,401);assert.equal(calls.length,before);});
}
await held('phone (authenticated)',phone,{contactId:contact.id,phone:contact.phone});
await held('score (authenticated; Bones finding 6 reproduction: no tag POST/DELETE)',motivation,{contactId:contact.id});
await held('phone mismatch',phone,{contactId:contact.id,phone:'+15555550202'});
await held('score with extra fields',motivation,{contactId:contact.id,score:100});
await check('phone unknown fields still refused 400 by shape before anything else',async()=>{const before=calls.length;assert.equal((await phone(event({contactId:contact.id,phone:contact.phone,pipelineStageId:'injected'}))).statusCode,400);assert.equal(calls.length,before);});
await check('static: no direct GHL mutating fetch remains in the marketing webhooks; tag changes go through the gated boundary',()=>{
  const fs=require('node:fs');const path=require('node:path');
  for(const f of ['phone-lookup.ts','motivation-score.ts']){const src=fs.readFileSync(path.join(__dirname,'../../netlify/functions',f),'utf8');assert.ok(!/fetch\([^)]*\/tags[\s\S]{0,120}method:\s*"(POST|DELETE|PUT)"/.test(src),f);}
  const m=fs.readFileSync(path.join(__dirname,'../../netlify/functions/motivation-score.ts'),'utf8');assert.ok(/\.addTags\(/.test(m)&&/\.removeTags\(/.test(m));});
await check('disposition retained authenticated operation',async()=>{const res=await disposition(event({customData:{contact_id:contact.id,disposition:'No Answer',duration:'5'}}));assert.equal(res.statusCode,200,res.body);});
await check('disposition workflow value refused',async()=>{const before=writes.length;assert.equal((await disposition(event({customData:{contact_id:contact.id,disposition:'Trigger Workflow',duration:'5'}}))).statusCode,403);assert.equal(writes.length,before);});
await check('disposition duplicate note preserves recovery without second note',async()=>{const before=notes.length;assert.equal((await disposition(event({customData:{contact_id:contact.id,disposition:'No Answer',duration:'5'}}))).statusCode,200);assert.equal(notes.length,before);});
console.log(count+' offline webhook checks passed, '+failures+' failed');process.exitCode=failures?1:0;
})().catch(e=>{console.error(e);process.exitCode=1;});
