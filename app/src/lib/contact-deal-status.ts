/**
 * Board 15 / Pass 1 F38 (INV-130) -- the contact page's read-only deal status.
 *
 * Pass 1: a contact with signed documents in its email history showed no
 * contract status and a stage of New Lead. Jess (2026-10-04/05): show the
 * independently read deal stage. Contract state must come ONLY from the
 * Contract Workspace's governing derivation (its scope / version /
 * correction / rescission rules) -- never from a simpler reading of
 * whichever notes are present, and never from a signed-document email.
 *
 * That derivation needs the Contract Workspace's own inputs (the current
 * agreement, the document version, the lifecycle records), which the contact
 * page does not hold. So the contact page states NO contract status of its
 * own: it shows the deal stage and sends the operator to the Contract
 * Workspace, which is the only place contract status is established.
 *
 * Pure. No I/O, no GHL ids, no writes, no note parsing.
 */

export type ContactDealStatusInput = {
  /** The opportunity's stage name from the pipeline's own stage list; null when the stage id is not in that list. */
  stageName: string | null;
};

export type ContactDealStatus = {
  stage: string;
  contract: string;
};

export const STAGE_UNKNOWN = "Stage not recognised — open the deal in GHL";
export const CONTRACT_STATUS_POINTER = "Open Contract Workspace to check contract status.";

export function contactDealStatus(input: ContactDealStatusInput): ContactDealStatus {
  return { stage: input.stageName ?? STAGE_UNKNOWN, contract: CONTRACT_STATUS_POINTER };
}
