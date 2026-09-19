import { requireAppWriter } from "./lib/app-write-auth";

/** V1 has no automated template send. Old clients fail closed. */
export const handler = async (event: any) => {
  const headers = { "Content-Type": "application/json",
    "Cache-Control": "no-store" };
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({
      error: "Method not allowed" }) };
  }
  try { requireAppWriter(event); } catch {
    return { statusCode: 401, headers, body: JSON.stringify({
      error: "Application write sign-in required" }) };
  }
  return { statusCode: 410, headers, body: JSON.stringify({
    error: "Automated contract sending is retired in V1.",
    nextStep: "Upload the reviewed PDF and send manually in GHL."
  }) };
};
