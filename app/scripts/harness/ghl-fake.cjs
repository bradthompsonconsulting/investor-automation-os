/**
 * A small in-memory GHL fake (contacts, notes, opportunities, tasks) for the
 * storage-correction endpoint suites. Records every mutating request; can hold
 * a request, fail it before sending, apply it and lose the response, or hang.
 */
'use strict';
function createGhl(locationId) {
  const contacts = {}; const opps = {}; const writes = []; const rules = [];
  const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
  function addContact(id, extra = {}) { contacts[id] = { id, locationId, customFields: [], notes: [], tags: [], ...extra }; return contacts[id]; }
  function addOpp(id, contactId, extra = {}) { opps[id] = { id, locationId, contactId, pipelineId: 'p', pipelineStageId: 's', customFields: [], ...extra }; return opps[id]; }
  function on(match, action, times = 1) { rules.push({ match, action, times, used: 0 }); }
  async function fetchImpl(url, init = {}) {
    const u = new URL(String(url));
    if (u.origin !== 'https://services.leadconnectorhq.com') throw new Error('ghl-fake: no route ' + url);
    const method = String(init.method || 'GET').toUpperCase();
    const body = init.body ? JSON.parse(init.body) : null;
    const req = { method, path: u.pathname, body };
    const rule = rules.find((r) => r.used < r.times && r.match(req));
    if (rule) {
      rule.used++;
      if (rule.action === 'failBefore') throw new TypeError('ghl-fake: unreachable');
      if (rule.action === 'hang') await new Promise((_, rej) => { if (init.signal) init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true }); });
      if (typeof rule.action === 'function') await rule.action(req);
    }
    let m;
    if ((m = u.pathname.match(/^\/contacts\/([^/]+)\/notes$/))) {
      const c = contacts[m[1]]; if (!c) return reply({}, 404);
      if (method === 'POST') {
        writes.push({ ...req, kind: 'note', contact: c.id });
        const note = { id: `${c.id}-note-${c.notes.length}`, body: body.body, dateAdded: new Date().toISOString() }; c.notes.push(note);
        if (rule && rule.action === 'lose') throw new TypeError('ghl-fake: response lost');
        return reply({ note });
      }
      return reply({ notes: c.notes });
    }
    if ((m = u.pathname.match(/^\/contacts\/([^/]+)$/))) {
      const c = contacts[m[1]]; if (!c) return reply({}, 404);
      if (method === 'PUT') {
        writes.push({ ...req, kind: 'fields', contact: c.id });
        for (const f of body.customFields || []) { c.customFields = c.customFields.filter((x) => x.id !== f.id); if (f.field_value !== '' && f.field_value !== null) c.customFields.push({ id: f.id, value: f.field_value }); }
        if (rule && rule.action === 'lose') throw new TypeError('ghl-fake: response lost');
      }
      return reply({ contact: { id: c.id, locationId: c.locationId, customFields: c.customFields, tags: c.tags } });
    }
    if ((m = u.pathname.match(/^\/opportunities\/([^/]+)$/))) {
      const o = opps[m[1]]; if (!o) return reply({}, 404);
      if (method === 'PUT') {
        writes.push({ ...req, kind: 'opportunity', opp: o.id });
        if (body.customFields) for (const f of body.customFields) { o.customFields = o.customFields.filter((x) => x.id !== f.id); o.customFields.push({ id: f.id, fieldValue: f.field_value }); }
        if (body.pipelineStageId) o.pipelineStageId = body.pipelineStageId;
        if (rule && rule.action === 'lose') throw new TypeError('ghl-fake: response lost');
      }
      return reply({ opportunity: { ...o } });
    }
    throw new Error('ghl-fake: unexpected ' + method + ' ' + u.pathname);
  }
  return { contacts, opps, writes, addContact, addOpp, on, fetch: fetchImpl, clear() { for (const k of Object.keys(contacts)) delete contacts[k]; for (const k of Object.keys(opps)) delete opps[k]; writes.length = 0; rules.length = 0; } };
}
module.exports = { createGhl };
