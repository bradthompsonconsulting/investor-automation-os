# INV-95 note-only Chrome proof procedure (NOT EXECUTED)

Prepared for Brad's review. No live execution, push, configuration change,
deployment, credential access or cleanup is authorized by this document.

## Deployment gate

Approve publication and isolated redeployment of the corrected PR head first.
Set IAOS_APP_WRITE_ALLOWED_ORIGIN, Functions scope, exact branch only, to:
https://codex-inv-95-write-boundaries--iaos-app-test.netlify.app
This is a single origin, without a trailing slash or wildcard.
Verify the deployed commit, IAOS_ENV=test and the approved Test location.
No other context or site is configured by this patch.

## Secure session binding

Use Brad's Chrome tab on the exact origin above. Never copy a token, request
Authorization header, cookie, HAR, or DevTools Scope contents. No console
logging of session objects. The application keeps its session in a module
closure; a console fetch by itself does NOT inherit that bearer session.

The procedure must bind the app's existing appWriteFetch function, not
construct Authorization headers. A reviewer must identify that function in
the exact deployed bundle (search its "Sign in for application writes"
error string). Minified identifiers vary by build.

In Chrome Sources, place a breakpoint immediately after the session
assignment in setAppWriteSession. At the next operator-authorized normal
sign-in, pause there, select that module's call frame and bind the reviewed
factory below to its appWriteFetch function. Do not expand credential
variables. Resume before running asynchronous proof requests.
This is a future manual binding gate, not a request to repeat sign-in now.
If that function cannot be identified unambiguously, STOP.
Do not use a dashboard/contact note control to reach a breakpoint.

Paste the factory body below as an expression and pass the verified
appWriteFetch function as its argument; save only the returned methods as
window.inv95NoteProof. The helper retains the function, never reads or
copies the underlying credential. Binding alone performs no requests.

```js
(send => {
  const origin =
    'https://codex-inv-95-write-boundaries--iaos-app-test.netlify.app';
  const targetId = 'muwyvqMrvE3i1kEPksCD';
  const locationId = 'SoTgVoaFGHtBdRFvXWQV';
  const requestId = crypto.randomUUID();
  const body = 'INV-95 TEST ONLY - DISPOSABLE NOTE - ' + requestId;
  const request = {operation:'note.create',targetId,requestId,args:{body}};
  const wire = JSON.stringify(request);
  let attempted = false;
  let confirmed = false;
  const evidence = {targetId,requestId,body,results:[]};
  function guard() {
    if (location.origin !== origin) throw Error('Wrong Test origin');
  }
  async function read(path) {
    guard();
    const r = await fetch('/.netlify/functions/ghl-proxy?path=' +
      encodeURIComponent(path), {cache:'no-store'});
    if (!r.ok) throw Error('Read refused: ' + r.status);
    return r.json();
  }
  async function matches() {
    const data = await read('/contacts/' + targetId + '/notes');
    if (!Array.isArray(data.notes)) throw Error('Invalid notes readback');
    return data.notes.filter(n => n.body === body).map(n => n.id);
  }
  return {
    evidence: () => structuredClone(evidence),
    async writeOnce() {
      guard();
      if (attempted) throw Error('Already attempted; inspect before retry');
      const data = await read('/contacts/' + targetId);
      if (data.contact?.id !== targetId ||
          data.contact?.locationId !== locationId) {
        throw Error('Contact/location mismatch');
      }
      if ((await matches()).length) throw Error('Note already exists');
      attempted = true;
      const r = await send('/.netlify/functions/ghl-write', {
        method:'POST',headers:{'Content-Type':'application/json'},body:wire
      });
      const result = await r.json();
      const ids = await matches();
      evidence.results.push({step:'write',status:r.status,noteIds:ids});
      const id = result.note?.id ?? result.id;
      if (r.status !== 200 || ids.length !== 1 || ids[0] !== id) {
        throw Error('Unconfirmed write; stop and inspect, do not retry');
      }
      confirmed = true;
      return structuredClone(evidence);
    },
    async replay() {
      guard();
      if (!confirmed) throw Error('First write not confirmed');
      const r = await send('/.netlify/functions/ghl-write', {
        method:'POST',headers:{'Content-Type':'application/json'},body:wire
      });
      const result = await r.json();
      const ids = await matches();
      evidence.results.push({step:'replay',status:r.status,noteIds:ids,
        outcome:result.outcome,error:result.error});
      if (r.status !== 409 || result.outcome !== 'indeterminate' ||
          result.error !==
            'Duplicate or unresolved request; read back before retrying' ||
          ids.length !== 1) throw Error('Replay proof failed; stop');
      return structuredClone(evidence);
    }
  };
})
```

## Operator sequence after separate authorization

1. Refresh read-only eligibility of this contact only. Brad released its
   former proof dependency. Stop if new workflows/opportunities/documents
   appeared. Do not clear them.
2. Bind the factory as above. Call inv95NoteProof.writeOnce() once.
   Retain its non-secret evidence: exact body, request ID, note ID, status.
   On uncertainty, stop; no new request ID and no blind retry.
3. Call inv95NoteProof.replay(). Expect 409 and exactly the same single note.
4. Independently inspect that note in GHL Test. Confirm fields unchanged.
5. Inspect only this request's receipt in iaos-app-test's
   iaos-write-receipts store, with authorized management access.
   Key formula: SHA256("test:" + authorized-email + ":note.create:" +
   contact-id + ":" + request-id). Value: fingerprint and claimedAt.
   Fingerprint is SHA256 of the exact JSON request string above.
   This hashes proof payload, never credentials. Do not list unrelated data.
6. Inspect absence of lock/SHA256(Test-location-id + contact-id).
   A successful write plus subsequent replay implies lock acquisition and
   release in this code. It does not independently prove concurrent-writer
   exclusion. Do not fabricate a lock or delete an unresolved one.
7. Record only the note, receipt, and transient helper for later cleanup.
   Stop before deleting anything. No contact-field restoration is expected.

Missing/wrong Origin with valid auth is covered offline. Chrome controls
the Origin header; do not claim to test it by setting a forbidden header
in fetch. No credential extraction for curl, and no other contact/location
access to manufacture a live wrong-location case. Such live probes remain
separate tooling gates. Retired endpoints retain their offline proofs.

## Review limits

This factory is prepared, not executed in Brad's authenticated Chrome.
The per-bundle function binding and live Blob management access still need
verification. It adds no runtime route, global hook, build flag or UI control
to the application. It submits only note.create to the approved contact.
