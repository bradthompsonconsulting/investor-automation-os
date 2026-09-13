/**
 * Browser-only SHA-256 for the manual executed-artifact bridge. B9-10 /
 * INV-65, Jess Gate repair round, 2026-09-13, item 1.
 *
 * Uses ONLY `globalThis.crypto.subtle.digest` -- the standard Web Crypto
 * API every modern browser implements -- NEVER Node's `crypto` module
 * (`contract-execution-model.ts`, the pure model this hash feeds into, is
 * imported by browser-facing UI code and must never pull in a Node
 * built-in; see that module's own header). This file exists specifically
 * so that dependency lives in exactly one place, named honestly, rather
 * than inlined ad hoc inside a React component.
 *
 * Node has supported `globalThis.crypto.subtle` natively since v19 (no
 * flag, no polyfill) -- this module's own deterministic test harness
 * (`test-browser-artifact-hash.cjs`) calls this EXACT function, in Node,
 * proving it produces correct SHA-256 output without needing an actual
 * browser to verify the browser-compatible code path.
 */

/** Deterministic SHA-256 over exactly the bytes supplied, via the standard Web Crypto API. Async -- `crypto.subtle.digest` returns a Promise in every environment that implements it. */
export async function computeManualArtifactSha256Hex(bytes: Uint8Array): Promise<string> {
  const digestBuffer = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  const digestBytes = new Uint8Array(digestBuffer);
  let hex = "";
  for (let i = 0; i < digestBytes.length; i++) {
    hex += digestBytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}
