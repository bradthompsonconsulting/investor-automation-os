/** INV-95 dedicated server-to-server identity. Never accepts application/voice tokens. */
import { createHash, timingSafeEqual } from "node:crypto";
export function requireWebhook(event: any, name: "IAOS_MOTIVATION_WEBHOOK_SECRET" | "IAOS_PHONE_LOOKUP_WEBHOOK_SECRET", env = process.env) {
  const expected = env[name];
  const actual = event.headers?.["x-iaos-secret"] ?? event.headers?.["X-IAOS-Secret"];
  if (typeof expected !== "string" || expected.length < 32 || typeof actual !== "string" ||
    !timingSafeEqual(createHash("sha256").update(expected).digest(), createHash("sha256").update(actual).digest())) throw new Error("Webhook authorization refused");
}
