/** INV-95 fixture setup for existing contract endpoint regressions. No live identity. */
const Module = require('node:module');
const load = Module._load;
const claims = new Set();
Module._load = function(name, ...rest) {
  if (name === '@netlify/blobs') return { getStore: () => ({ async delete(key) { claims.delete(key); }, async setJSON(key, value, options) { if(options?.onlyIfNew && claims.has(key))return {modified:false};claims.add(key);return {modified:true}; } }) };
  return load.call(this, name, ...rest);
};
process.env.IAOS_APP_WRITE_GOOGLE_CLIENT_ID='offline-client';
process.env.IAOS_APP_WRITE_BRAD_EMAILS='brad@example.invalid';
process.env.IAOS_APP_WRITE_SESSION_SECRET='offline-fixture-only-not-a-real-secret';
exports.authorizedModule = (filename) => {
  const original = require(filename);
  const auth = require(require('node:path').join(require('node:path').dirname(filename),'lib','app-write-auth.js'));
  return {...original, handler: event => original.handler({...event,headers:{...event.headers,authorization:`Bearer ${auth.issueAppSession('brad@example.invalid').token}`}})};
};
exports.resetClaims = () => claims.clear();
exports.targetRead = (url, config) => {
  const pathname = new URL(url).pathname;
  if(pathname === "/proposals/templates") return {data:[{id:config.documentsContracts.templateId,name:config.documentsContracts.expectedTemplateName,deleted:false}]};
  if (/^\/opportunities\/[^/]+$/.test(pathname)) return {opportunity:{id:pathname.split('/')[2],contactId:config.documentsContracts.approvedTestContactId,locationId:config.locationId,customFields:[]}};
  if (pathname === `/contacts/${config.documentsContracts.approvedTestContactId}`) return {contact:{id:config.documentsContracts.approvedTestContactId,locationId:config.locationId,customFields:[],firstName:"Jane",lastName:"Seller",email:"seller@example.com",address1:"123 Main St",city:"Austin",state:"TX",postalCode:"78701"}};
  return null;
};
