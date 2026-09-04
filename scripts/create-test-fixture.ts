/**
 * Creates or binds the durable IAOS TEST-location proof fixture.
 * PB-D62 / INV-25 Tranche 1, Route A.
 *
 * ⚠ WHAT PROBLEM THIS SOLVES. Every Opportunity-side inert proof so far
 * (PB-D58, PB-D59, PB-D60) ran on `OcGWOP9n666i4Q1MLd31` in the PRODUCTION
 * location, because `scripts/harness-fixtures.json` carried a `production`
 * block and nothing else — so every proof suite refuses under `--env test`
 * at its own fixture lookup. That is why PB-D58 had to weigh contaminating a
 * live harness fixture, and why `estimated_repairs` never completed a live
 * round trip. This tool removes that constraint permanently: it binds a
 * disposable Test-location contact and opportunity that future authorized
 * Opportunity-field proofs reuse, so Production containment stops being the
 * price of every proof.
 *
 * ⚠ IDEMPOTENT BY IDENTITY, NOT BY COUNTER. The contact is identified by a
 * reserved-domain email and the opportunity by name-on-that-contact. Re-running
 * BINDS what exists and creates only what is missing, so a second run cannot
 * quietly produce a second fixture that a later proof might pick at random.
 *
 * ⚠ THE FIXTURE CARRIES NO REACHABLE CONTACT PATH. Email is on `example.com`,
 * reserved by RFC 2606 and undeliverable by construction, and NO PHONE NUMBER
 * IS SET AT ALL. There is no address by which this record could ever receive
 * a call, an SMS or a mailer, which is a stronger guarantee than "we intend not
 * to contact it."
 *
 * ⚠ IT CANNOT TOUCH PRODUCTION. `parseCommonArgs` refuses any `--env` but
 * `test` and any `--location` but the configured Test location, before the
 * credential is read. See `scripts/lib/ghl-test-proof.ts`.
 *
 * ⚠ IT DOES NOT EDIT harness-fixtures.json. It PRINTS the ids for a human to
 * place there deliberately. A tool that both creates a record and writes its
 * own identifier into the file the harnesses trust would close the loop that
 * makes the identifier reviewable.
 *
 * Usage, from the repository root:
 *   npx tsx scripts/create-test-fixture.ts --env test \
 *     --location <test location id> --credential-file .env.test [--out <path>]
 */

import {
  capture,
  die,
  evidencePath,
  ghlGet,
  ghlPost,
  loadToken,
  parseCommonArgs,
  readOpportunity,
  stamp,
  writeEvidence,
} from "./lib/ghl-test-proof.ts";
import { getConfig } from "../app/shared/ghl-config.ts";

/** Fixture identity. Changing either string orphans the existing fixture. */
const CONTACT_EMAIL = "iaos-underwriting-fixture@example.com";
const CONTACT_FIRST = "IAOS";
const CONTACT_LAST = "Test Probe";
const OPPORTUNITY_NAME = "IAOS Underwriting Test";

async function main(): Promise<void> {
  const args = parseCommonArgs(process.argv.slice(2));
  const token = loadToken(args.credentialFile);
  const config = getConfig("test") as Record<string, any>;

  const pipelineId = config.pipelines.sellerLeads;
  const stageId = config.stages.newLeadSeller;
  if (!pipelineId || !stageId) die("the Test config carries no sellerLeads pipeline or newLeadSeller stage.");

  // ── contact ───────────────────────────────────────────────────────────────
  const contactList = await ghlGet(token, `/contacts/?locationId=${args.location}&limit=100`);
  if (contactList.status !== 200) {
    die(`GET /contacts/ → ${contactList.status}: ${JSON.stringify(contactList.body).slice(0, 400)}`);
  }
  const existingContact = (contactList.body.contacts ?? []).find(
    (c: any) => String(c.email ?? "").toLowerCase() === CONTACT_EMAIL,
  );

  let contactId: string;
  let contactAction: "bound" | "created";
  if (existingContact) {
    contactId = existingContact.id;
    contactAction = "bound";
  } else {
    const created = await ghlPost(token, "/contacts/", {
      locationId: args.location,
      firstName: CONTACT_FIRST,
      lastName: CONTACT_LAST,
      email: CONTACT_EMAIL,
    });
    if (created.status !== 200 && created.status !== 201) {
      die(`POST /contacts/ → ${created.status}: ${JSON.stringify(created.body).slice(0, 600)}`);
    }
    contactId = (created.body.contact ?? created.body).id;
    contactAction = "created";
  }
  console.log(`contact  ${contactAction}: ${contactId}  (${CONTACT_EMAIL}, no phone)`);

  // ── opportunity ───────────────────────────────────────────────────────────
  const oppList = await ghlGet(token, `/opportunities/search?location_id=${args.location}&limit=100`);
  if (oppList.status !== 200) {
    die(`GET /opportunities/search → ${oppList.status}: ${JSON.stringify(oppList.body).slice(0, 400)}`);
  }
  const existingOpp = (oppList.body.opportunities ?? []).find(
    (o: any) => o.name === OPPORTUNITY_NAME && (o.contact?.id ?? o.contactId) === contactId,
  );

  let opportunityId: string;
  let opportunityAction: "bound" | "created";
  if (existingOpp) {
    opportunityId = existingOpp.id;
    opportunityAction = "bound";
  } else {
    const created = await ghlPost(token, "/opportunities/", {
      locationId: args.location,
      pipelineId,
      pipelineStageId: stageId,
      name: OPPORTUNITY_NAME,
      status: "open",
      contactId,
    });
    if (created.status !== 200 && created.status !== 201) {
      die(`POST /opportunities/ → ${created.status}: ${JSON.stringify(created.body).slice(0, 600)}`);
    }
    opportunityId = (created.body.opportunity ?? created.body).id;
    opportunityAction = "created";
  }
  console.log(`opportunity ${opportunityAction}: ${opportunityId}  ("${OPPORTUNITY_NAME}")`);

  // ── read the fixture back, so what is reported is what GHL holds ──────────
  const opportunity = await readOpportunity(token, opportunityId);
  const snapshot = capture(opportunity);
  console.log(`stage: ${snapshot.pipelineStageId}  status: ${snapshot.status}  customFields: ${snapshot.customFields.length}`);

  const arvId = config.opportunityFacts.arv;
  const arvEntry = snapshot.customFields.find((f) => f.id === arvId) ?? null;
  console.log(`ARV carrier ${arvId} on the fixture: ${arvEntry === null ? "ABSENT (absent-origin proof)" : JSON.stringify(arvEntry)}`);

  console.log("");
  console.log("Place these in scripts/harness-fixtures.json under the test block:");
  console.log(`  test.fixtureRecords.contacts.iaosTestProbe            = ${JSON.stringify(contactId)}`);
  console.log(`  test.fixtureRecords.opportunities.iaosUnderwritingTest = ${JSON.stringify(opportunityId)}`);

  writeEvidence(evidencePath(args, "iaos-test-fixture"), {
    step: "create-test-fixture",
    stampedAt: stamp(),
    environment: args.env,
    locationId: args.location,
    credentialFile: args.credentialFile,
    contact: { id: contactId, action: contactAction, email: CONTACT_EMAIL, phone: null },
    opportunity: { id: opportunityId, action: opportunityAction, name: OPPORTUNITY_NAME, pipelineId, stageId },
    fixtureAtRest: snapshot,
    arvCarrier: { id: arvId, entryAtRest: arvEntry },
  });
}

main();
