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
  if (name === '@netlify/blobs') return { getStore: () => ({ async get(key) { return receipts.get(key) ?? null; }, async delete(key) { receipts.delete(key); }, async setJSON(key, value, options) { if (options?.onlyIfNew && receipts.has(key)) return { modified: false }; receipts.set(key, value); return { modified: true }; } }) };
  return originalLoad.call(this, name, ...rest);
};
process.env.IAOS_ENV = 'test';
process.env.IAOS_APP_WRITE_GOOGLE_CLIENT_ID = 'offline-client';
process.env.IAOS_APP_WRITE_BRAD_EMAILS = 'brad@example.invalid';
process.env.IAOS_APP_WRITE_SESSION_SECRET = 'offline-fixture-only-not-a-real-secret';
process.env.GHL_PRIVATE_API_KEY = 'offline-fixture';
process.env.GHL_API_TOKEN = 'offline-fixture';

const {getConfig}=require('../shared/ghl-config.ts');const config=getConfig('test');
const phone=require('../../netlify/functions/phone-lookup.ts').handler;
const motivation=require('../../netlify/functions/motivation-score.ts').handler;
const disposition=require('../netlify/functions/ghl-disposition.ts').handler;
const secret='offline-synthetic-webhook-secret-only';
process.env.IAOS_PHONE_LOOKUP_WEBHOOK_SECRET=secret;process.env.IAOS_MOTIVATION_WEBHOOK_SECRET=secret;process.env.IAOS_WEBHOOK_SECRET=secret;
process.env.TWILIO_ACCOUNT_SID='offline-fixture';process.env.TWILIO_AUTH_TOKEN='offline-fixture';
const contact={id:'fixture-contact',locationId:config.locationId,phone:'+15555550101',customFields:[],tags:['unrelated']};
let fields=[{id:'phone-type-field',fieldKey:'contact.phone_type'},{id:'motivation-field',fieldKey:'contact.motivation_score'}];
let calls=[],writes=[],notes=[],omit=false;const response=data=>({ok:true,status:200,json:async()=>structuredClone(data),text:async()=>JSON.stringify(data)});
global.fetch=async(url,init={})=>{const u=new URL(url);const method=init.method||'GET';calls.push({origin:u.origin,path:u.pathname,method});
if(u.origin==='https://lookups.twilio.com'){assert.equal(method,'GET');return response({line_type_intelligence:{type:'mobile'}});}
assert.equal(u.origin,'https://services.leadconnectorhq.com');
if(method!=='GET')writes.push({path:u.pathname,method,body:JSON.parse(init.body)});
if(u.pathname==='/locations/'+config.locationId+'/customFields')return response({customFields:fields});
if(u.pathname==='/contacts/'+contact.id+'/tags'){const tags=JSON.parse(init.body).tags;assert(tags.every(t=>['hot','warm','low'].includes(t)));if(!omit)contact.tags=method==='POST'?[...new Set([...contact.tags,...tags])]:contact.tags.filter(t=>!tags.includes(t));return response({tags:contact.tags});}
if(u.pathname==='/contacts/'+contact.id+'/notes'){if(method==='POST'){const note={id:'note-'+notes.length,body:JSON.parse(init.body).body,dateAdded:new Date().toISOString()};notes.push(note);return response({note});}return response({notes});}
if(u.pathname==='/contacts/'+contact.id){if(method==='PUT'&&!omit)for(const f of JSON.parse(init.body).customFields){contact.customFields=contact.customFields.filter(c=>c.id!==f.id);contact.customFields.push({id:f.id,value:f.field_value});}return response({contact});}
throw new Error('Unexpected offline request '+u.pathname);};
const event=body=>({httpMethod:'POST',headers:{'x-iaos-secret':secret},body:JSON.stringify(body)});let count=0;
async function check(name,fn){await fn();console.log('PASS '+name);count++;}
(async()=>{
for(const [name,handler,payload] of [['phone',phone,{contactId:contact.id,phone:contact.phone}],['score',motivation,{contactId:contact.id}],['disposition',disposition,{customData:{contact_id:contact.id,disposition:'No Answer',duration:'5'}}]]){
await check(name+' missing authentication has zero upstream calls',async()=>{const e=event(payload);e.headers={};const before=calls.length;assert.equal((await handler(e)).statusCode,401);assert.equal(calls.length,before);});
await check(name+' application session cannot authorize webhook',async()=>{const e=event(payload);e.headers={authorization:'Bearer application-session'};const before=calls.length;assert.equal((await handler(e)).statusCode,401);assert.equal(calls.length,before);});
await check(name+' retained authenticated operation',async()=>{const res=await handler(event(payload));assert.equal(res.statusCode,200,res.body);});
}
await check('phone writes exactly phone_type',()=>{const write=writes.find(w=>w.body.customFields?.some(f=>f.id==='phone-type-field'));assert.deepEqual(write.body,{customFields:[{id:'phone-type-field',field_value:'Mobile'}]});});
await check('score writes exactly four named score fields',()=>{const write=writes.find(w=>w.body.customFields?.length===4);assert.deepEqual(write.body.customFields.map(f=>f.id).sort(),['motivation-field',config.fields.dealScore,config.fields.combinedScore,config.fields.dataCompletenessScore].sort());assert(contact.tags.includes('unrelated'));assert.equal(contact.tags.filter(t=>['hot','warm','low'].includes(t)).length,1);});
await check('phone mismatch refuses before provider lookup',async()=>{const before=writes.length, providers=calls.filter(c=>c.origin.includes('twilio')).length;assert.equal((await phone(event({contactId:contact.id,phone:'+15555550202'}))).statusCode,403);assert.equal(writes.length,before);assert.equal(calls.filter(c=>c.origin.includes('twilio')).length,providers);});
await check('phone unknown fields refused',async()=>{const before=writes.length;assert.equal((await phone(event({contactId:contact.id,phone:contact.phone,pipelineStageId:'injected'}))).statusCode,400);assert.equal(writes.length,before);});
await check('foreign contact refused before writes',async()=>{const location=contact.locationId;contact.locationId='foreign';const before=writes.length;assert.equal((await phone(event({contactId:contact.id,phone:contact.phone}))).statusCode,403);assert.equal(writes.length,before);contact.locationId=location;});
await check('phone ambiguous field definition refused',async()=>{fields.push({...fields[0]});const before=writes.length;assert.equal((await phone(event({contactId:contact.id,phone:contact.phone}))).statusCode,500);assert.equal(writes.length,before);fields.pop();});
await check('phone mismatched readback never succeeds',async()=>{contact.customFields=[];omit=true;assert.equal((await phone(event({contactId:contact.id,phone:contact.phone}))).statusCode,500);omit=false;});
await check('score extra fields refused before writes',async()=>{const before=writes.length;assert.equal((await motivation(event({contactId:contact.id,score:100}))).statusCode,500);assert.equal(writes.length,before);});
await check('disposition workflow value refused',async()=>{const before=writes.length;assert.equal((await disposition(event({customData:{contact_id:contact.id,disposition:'Trigger Workflow',duration:'5'}}))).statusCode,403);assert.equal(writes.length,before);});
await check('disposition duplicate note preserves recovery without second note',async()=>{const before=notes.length;assert.equal((await disposition(event({customData:{contact_id:contact.id,disposition:'No Answer',duration:'5'}}))).statusCode,200);assert.equal(notes.length,before);});
console.log(count+' offline webhook checks passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
