/**
 * B15-03 / INV-103 slice C -- the real client for Seller Call "Save at Summary".
 *
 * Sends ONLY through the existing named server operations (`note.create`,
 * `contact.occupancy`) via `writeCommand` -- the same authenticated, Origin-checked
 * ghl-write path every other Seller Call write uses -- and classifies each
 * response itself (`classifyWriteResponse`) instead of throwing, so the page can
 * report confirmed / refused / uncertain per item.
 *
 * Every operation carries the explicit request id the coordinator gives it: the
 * coordinator, not a pending-id map, decides whether something may be sent again
 * (an uncertain item never is). When the page stops waiting (SAVE_TIMEOUT_MS) the
 * request itself is NOT abandoned: its own eventual answer is classified and
 * handed back (`onLate`), the only late evidence the coordinator accepts for that
 * operation (Bones C1). Reads for Check again are the existing GET helpers; they
 * never write.
 */
import { writeCommand } from "./write-command";
import { AppWriteSignInRequired } from "./app-write-session";
import { ghl, OCCUPANCY_STATUS_ID } from "./ghl";
import { classifyWriteResponse, withTimeout, SaveTimeout, type SaveClient, type SendOutcome } from "./seller-conversation-save";

export const SAVE_TIMEOUT_MS = 30_000;

export function createSellerConversationSaveClient(timeoutMs: number = SAVE_TIMEOUT_MS): SaveClient {
  return {
    requestId: () => crypto.randomUUID(),
    async send(operation, targetId, args, requestId, onLate): Promise<SendOutcome> {
      // The whole attempt, classified; it never rejects, so it can be awaited late.
      const attempt: Promise<SendOutcome> = (async () => {
        let res: Response;
        try {
          res = await writeCommand(operation, targetId, args, requestId);
        } catch (e) {
          if (e instanceof AppWriteSignInRequired) return { kind: "refused", message: e.message };
          return { kind: "uncertain", message: `Network error (${(e as Error)?.message ?? "no response"}); it may have been saved.` };
        }
        let text: string;
        try { text = await res.text(); } catch { return { kind: "uncertain", message: `The answer could not be read (status ${res.status}); it may have been saved.` }; }
        return classifyWriteResponse(res.status, text);
      })();
      try {
        return await withTimeout(attempt, timeoutMs);
      } catch (e) {
        if (e instanceof SaveTimeout) {
          if (onLate) void attempt.then(onLate);
          return { kind: "uncertain", message: `${e.message}; it may have been saved. The request is still open; its own answer will settle this.` };
        }
        return { kind: "uncertain", message: `Network error (${(e as Error)?.message ?? "no response"}); it may have been saved.` };
      }
    },
    async readNotes(contactId) {
      return (await ghl.notes.list(contactId)).notes ?? [];
    },
    async readOccupancy(contactId) {
      const c = await ghl.contacts.getDetail(contactId);
      const raw = c.customFields.find((f) => f.id === OCCUPANCY_STATUS_ID)?.value;
      const v = Array.isArray(raw) ? raw[0] : raw;
      return v === undefined || v === null || v === "" ? null : String(v);
    },
    now: () => new Date().toISOString(),
  };
}
