'use strict';
const { setupV2Env } = require('./harness/v2-env.cjs');
const env = setupV2Env();
const { getConfig } = require('../shared/ghl-config.ts');
const config = getConfig('test');
const A = 'fixture-contact-a';
env.hooks.ghlFetch = async (url) => {
  const u = new URL(url);
  if (u.pathname === `/contacts/${A}`) return new Response(JSON.stringify({ contact: { id: A, locationId: config.locationId, customFields: [] } }), { status: 200 });
  throw new Error('unexpected ' + url);
};
const mod = require('../netlify/functions/call-log-barrier.ts');
const { callLogNote } = require('../src/lib/call-outcome-copy.ts');
(async () => {
  const op = 'v2-' + require('crypto').randomUUID();
  const get = await env.invoke(mod, { fn: 'call-log-barrier', httpMethod: 'GET', headers: { cookie: env.readCookie() }, queryStringParameters: { contactId: A } });
  console.log('GET', get.statusCode, get.body);
  const begin = await env.invoke(mod, { fn: 'call-log-barrier', httpMethod: 'POST', headers: env.writeHeaders(), body: JSON.stringify({ action: 'begin', contactId: A, operationId: op, result: 'No Answer', body: callLogNote('No Answer', '') }) });
  console.log('BEGIN', begin.statusCode, begin.body);
  const cap = await env.invoke(mod, { fn: 'call-log-barrier', httpMethod: 'POST', headers: { ...env.writeHeaders(), cookie: env.readCookie() }, body: JSON.stringify({ action: 'storage_capability' }) });
  console.log('CAP', cap.statusCode, cap.headers['x-iaos-storage'], cap.body.slice(0, 200));
  const prev = await env.invoke(mod, { fn: 'call-log-barrier', httpMethod: 'POST', headers: env.writeHeaders(), body: JSON.stringify({ action: 'begin', contactId: A, operationId: 'v2-' + require('crypto').randomUUID(), result: 'No Answer', body: callLogNote('No Answer', '') }) }, env.deployContext({ context: 'deploy-preview' }));
  console.log('PREVIEW', prev.statusCode, prev.body);
  console.log('lock', JSON.stringify(env.wire.keys(env.S).filter((k) => k.startsWith('lock2/')).map((k) => env.wire.json(env.S, k).state)));
})().catch((e) => { console.error(e); process.exit(1); });
