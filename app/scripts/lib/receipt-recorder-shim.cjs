/**
 * TEST-ONLY adapter for suites that stub @netlify/blobs with an in-memory store (shared-receipt repair).
 *
 * The repaired write-receipts helpers no longer read a store's `{ modified }` result. They pass their own
 * recorder as `fetch` to getStore({ name, fetch }) and decide from the one real response status. A stub store
 * never calls that fetch, so for exactly those calls this adapter sends each operation THROUGH the recorder to a
 * sentinel origin, and a globalThis.fetch router answers it from the suite's OWN backing store with the status
 * the service would give: create 200, or 412 when the stub reports the key exists; delete 204. A stub that
 * throws makes the request throw, as a failed network request would.
 *
 * Every other getStore call, and every other fetch, is untouched. A suite that replaces, saves or restores
 * global.fetch keeps working: the router only wraps whatever function the suite last assigned.
 */
'use strict';
const SENTINEL = 'https://receipt-recorder-shim.invalid';
let suiteFetch = globalThis.fetch;
const pending = new Map(); let seq = 0;
Object.defineProperty(globalThis, 'fetch', {
  configurable: true,
  get() {
    const inner = suiteFetch;
    const routed = (url, init) => {
      const s = String(url && typeof url === 'object' && 'url' in url ? url.url : url);
      if (s.startsWith(`${SENTINEL}/`)) { const id = s.slice(SENTINEL.length + 1); const op = pending.get(id); pending.delete(id); return op ? op() : Promise.reject(new Error('receipt shim: unknown operation')); }
      return inner(url, init);
    };
    routed.__inner = inner;
    return routed;
  },
  set(f) { suiteFetch = f && f.__inner ? f.__inner : f; },
});

const recorded = (opts) => opts && typeof opts === 'object' && typeof opts.fetch === 'function';

/** Wrap a stubbed @netlify/blobs module: getStore({ name, fetch }) gets the adapter; every other call is the stub's own. */
function wrap(mod) {
  return {
    ...mod,
    getStore: (opts, ...rest) => {
      if (!recorded(opts)) return mod.getStore(opts, ...rest);
      const store = mod.getStore(opts.name);
      const via = (run) => { const id = String(++seq); pending.set(id, run); return opts.fetch(`${SENTINEL}/${id}`, { method: 'POST' }); };
      return {
        async setJSON(key, value, options) {
          const res = await via(async () => { const r = await store.setJSON(key, value, options); return new Response(null, { status: r && r.modified === false ? 412 : 200, headers: { etag: '"receipt-shim"' } }); });
          return { modified: res.status !== 412 };
        },
        async delete(key) {
          const res = await via(async () => { await store.delete(key); return new Response(null, { status: 204 }); });
          if (![200, 204, 404].includes(res.status)) throw new Error(`receipt shim: delete ${res.status}`);
        },
      };
    },
  };
}
module.exports = { wrap, SENTINEL };
