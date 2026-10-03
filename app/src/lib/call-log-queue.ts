/**
 * B14-12 / INV-94 — where the latest call result places a contact
 * (recording-only call log; queue behavior ruled by Jess, 2026-10-02).
 *
 * Pure and READ-ONLY: the Dashboard reads it; nothing here writes. Results no
 * longer move a deal's stage or phone status, so the queue reads the result
 * itself.
 *
 *   No Answer, Voicemail          stay in the cold-call queue; the existing
 *                                 12-hour pause after a touch still applies
 *   Not Interested,
 *   Incorrect Number              leave the cold-call queue
 *   Spoke with Seller, Follow Up  leave the cold-call queue; with no callback
 *                                 scheduled they show under "Needs Next Step"
 *                                 so they are not lost
 *
 * Any other value — including results recorded before the call log, such as
 * Requested Appointment — changes nothing here: the existing stage, callback
 * and phone-status exclusions still apply as before. Do Not Call is a separate
 * action and gets its own (DND-based) exclusion in its own PR.
 */
export type CallLogPlacement = "cold" | "out" | "needs_next_step";

export function callLogPlacement(result: string | null, hasCallback: boolean): CallLogPlacement {
  switch (result) {
    case "Not Interested":
    case "Incorrect Number":
      return "out";
    case "Spoke with Seller":
    case "Follow Up":
      return hasCallback ? "out" : "needs_next_step";
    default:
      return "cold";
  }
}
