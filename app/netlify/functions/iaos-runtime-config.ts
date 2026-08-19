/**
 * IAOS runtime configuration — Gate 4B-5. GET only, read-only, no credential.
 *
 * Serves the browser the configuration it used to receive by build-time
 * substitution of VITE_IAOS_ENV. main.tsx fetches this before it dynamically
 * imports App, so the frontend artifact is now identical across environments
 * and the environment is decided at request time instead of at build time.
 *
 * FAILS CLOSED AT LOAD, NOT PER REQUEST. getConfig runs at MODULE SCOPE, so an
 * absent or unrecognized IAOS_ENV kills this function when it is loaded rather
 * than letting it serve a default — the same doctrine as ghl-proxy and every
 * other function in this tree. There is no default and no fallback.
 *
 * RETURNS ONLY WHAT THE BROWSER CONSUMES. The payload is projected through
 * RUNTIME_GROUPS in shared/ghl-config.ts, which is the same shape the browser
 * validates against, so the served and checked shapes cannot drift. No token,
 * no secret, no server-only key: pipelines, customValues.mailerDigestRecipient
 * and the seven unread contact fields are all deliberately excluded.
 *
 * PB-D57: browser-facing, read-only, positive allowlist of non-secret and
 * non-personal data. This response contains configuration identifiers only —
 * no contact data of any kind.
 *
 * Cache-Control: private, no-store. A stale configuration is a correctness bug,
 * not a performance trade-off. Caching gets optimised after isolation is
 * proven, not before.
 */

import { getConfig, projectRuntimeConfig } from "../../shared/ghl-config";

// Module scope, deliberately — see the header.
const PAYLOAD = projectRuntimeConfig(getConfig(process.env.IAOS_ENV));

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const handler = async (event: any) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, headers: CORS, body: "Method Not Allowed" };
  }
  return {
    statusCode: 200,
    headers: {
      ...CORS,
      "Content-Type": "application/json",
      "Cache-Control": "private, no-store",
    },
    body: JSON.stringify(PAYLOAD),
  };
};
