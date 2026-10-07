/** The exact `storage_capability` request shape (pure; shared by capability.ts and production-write-scope.ts). */
export function isCapabilityRequest(body: unknown): body is { action: "storage_capability"; nonce?: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const keys = Object.keys(body).sort().join();
  const b = body as any;
  if (b.action !== "storage_capability") return false;
  if (keys === "action") return true;
  return keys === "action,nonce" && typeof b.nonce === "string" && /^[A-Za-z0-9:_-]{1,128}$/.test(b.nonce);
}
