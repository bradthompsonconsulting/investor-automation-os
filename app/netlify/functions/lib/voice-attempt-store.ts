import { createHash } from "node:crypto";
import { getStore } from "@netlify/blobs";
import {
  canTransitionVoiceState,
  isTerminalVoiceState,
  reduceProviderStatus,
  type VoiceCallState,
  type VoiceAttemptView,
} from "../../../shared/voice-call-contract";

export interface VoiceAttemptRecord {
  attemptId: string;
  contactBinding: string;
  providerCallId: string | null;
  providerChildCallId: string | null;
  timestamps: {
    createdAt: string;
    updatedAt: string;
    dialConsumedAt: string | null;
    providerObservedAt: string | null;
  };
  providerState: {
    state: VoiceCallState;
    rawStatus: string | null;
    sequence: number | null;
  };
}

export interface VersionedAttempt { record: VoiceAttemptRecord; etag: string }
export interface AttemptStore {
  read(key: string): Promise<VersionedAttempt | null>;
  create(key: string, record: VoiceAttemptRecord): Promise<boolean>;
  replace(key: string, record: VoiceAttemptRecord, etag: string): Promise<boolean>;
}

export function attemptKey(contactId: string): string {
  return `contact/${createHash("sha256").update(contactId).digest("hex")}`;
}

export function toAttemptView(record: VoiceAttemptRecord): VoiceAttemptView {
  return {
    attemptId: record.attemptId,
    contactBinding: record.contactBinding,
    state: record.providerState.state,
    createdAt: record.timestamps.createdAt,
    updatedAt: record.timestamps.updatedAt,
    providerCallId: record.providerCallId,
    providerChildCallId: record.providerChildCallId,
  };
}

export function newAttempt(contactId: string, attemptId: string, now: string): VoiceAttemptRecord {
  return {
    attemptId,
    contactBinding: contactId,
    providerCallId: null,
    providerChildCallId: null,
    timestamps: { createdAt: now, updatedAt: now, dialConsumedAt: null, providerObservedAt: null },
    providerState: { state: "authorizing", rawStatus: null, sequence: null },
  };
}

export function netlifyAttemptStore(): AttemptStore {
  const store: any = getStore("iaos-voice-attempts");
  return {
    async read(key) {
      const result = await store.getWithMetadata(key, { type: "json", consistency: "strong" });
      if (!result) return null;
      return { record: result.data as VoiceAttemptRecord, etag: String(result.etag) };
    },
    async create(key, record) {
      const result = await store.setJSON(key, record, { onlyIfNew: true });
      return result.modified === true;
    },
    async replace(key, record, etag) {
      const result = await store.setJSON(key, record, { onlyIfMatch: etag });
      return result.modified === true;
    },
  };
}

export async function acquireAttempt(store: AttemptStore, contactId: string, attemptId: string, now: string): Promise<{ record: VoiceAttemptRecord; created: boolean }> {
  const key = attemptKey(contactId);
  for (let turn = 0; turn < 5; turn += 1) {
    const current = await store.read(key);
    if (!current) {
      const record = newAttempt(contactId, attemptId, now);
      if (await store.create(key, record)) return { record, created: true };
      continue;
    }
    if (current.record.contactBinding !== contactId) throw new Error("Attempt contact binding mismatch");
    if (current.record.attemptId === attemptId) return { record: current.record, created: false };
    const state = current.record.providerState.state;
    if (!isTerminalVoiceState(state)) throw new Error(`Contact has unresolved voice attempt in state ${state}`);
    const replacement = newAttempt(contactId, attemptId, now);
    if (await store.replace(key, replacement, current.etag)) return { record: replacement, created: true };
  }
  throw new Error("Voice attempt lock contention");
}

export async function transitionAttempt(store: AttemptStore, contactId: string, attemptId: string, state: VoiceCallState, now: string): Promise<VoiceAttemptRecord> {
  const key = attemptKey(contactId);
  for (let turn = 0; turn < 5; turn += 1) {
    const current = await store.read(key);
    if (!current || current.record.attemptId !== attemptId || current.record.contactBinding !== contactId) throw new Error("Voice attempt not found");
    if (!canTransitionVoiceState(current.record.providerState.state, state)) throw new Error(`Invalid voice transition ${current.record.providerState.state} -> ${state}`);
    const record: VoiceAttemptRecord = {
      ...current.record,
      timestamps: { ...current.record.timestamps, updatedAt: now },
      providerState: { ...current.record.providerState, state },
    };
    if (await store.replace(key, record, current.etag)) return record;
  }
  throw new Error("Voice attempt update contention");
}

/** One successful CAS is the only authority to emit the single provider Dial. */
export async function consumeDial(store: AttemptStore, contactId: string, attemptId: string, providerCallId: string, now: string): Promise<VoiceAttemptRecord | null> {
  const key = attemptKey(contactId);
  for (let turn = 0; turn < 5; turn += 1) {
    const current = await store.read(key);
    if (!current || current.record.attemptId !== attemptId || current.record.contactBinding !== contactId) return null;
    if (current.record.timestamps.dialConsumedAt) return null;
    if (current.record.providerState.state !== "ready") return null;
    const record: VoiceAttemptRecord = {
      ...current.record,
      providerCallId: providerCallId || current.record.providerCallId,
      timestamps: { ...current.record.timestamps, dialConsumedAt: now, updatedAt: now },
      providerState: { state: "initiating", rawStatus: "initiated", sequence: null },
    };
    if (await store.replace(key, record, current.etag)) return record;
  }
  return null;
}

export async function applyProviderCallback(
  store: AttemptStore,
  contactId: string,
  attemptId: string,
  input: { status: string; providerCallId?: string; providerChildCallId?: string; sequence?: number | null; observedAt: string },
): Promise<VoiceAttemptRecord> {
  const key = attemptKey(contactId);
  for (let turn = 0; turn < 5; turn += 1) {
    const current = await store.read(key);
    if (!current || current.record.attemptId !== attemptId || current.record.contactBinding !== contactId) throw new Error("Voice attempt not found");
    const previousSequence = current.record.providerState.sequence;
    if (input.sequence != null && previousSequence != null && input.sequence < previousSequence) return current.record;
    const sameSequenceConflict = input.sequence != null && previousSequence != null && input.sequence === previousSequence &&
      current.record.providerState.rawStatus !== input.status;
    const providerIdentityConflict = Boolean(
      (input.providerCallId && current.record.providerCallId && input.providerCallId !== current.record.providerCallId) ||
      (input.providerChildCallId && current.record.providerChildCallId && input.providerChildCallId !== current.record.providerChildCallId)
    );
    if (input.sequence != null && previousSequence != null && input.sequence === previousSequence && !sameSequenceConflict && !providerIdentityConflict) return current.record;
    const reduced = sameSequenceConflict || providerIdentityConflict
      ? { kind: "unknown" as const, reason: "conflicting-terminal" as const }
      : reduceProviderStatus(current.record.providerState.state, input.status);
    if (reduced.kind === "ignore") return current.record;
    const state = reduced.kind === "apply" ? reduced.state : "provider-unknown";
    const record: VoiceAttemptRecord = {
      ...current.record,
      providerCallId: current.record.providerCallId || input.providerCallId || null,
      providerChildCallId: current.record.providerChildCallId || input.providerChildCallId || null,
      timestamps: { ...current.record.timestamps, updatedAt: input.observedAt, providerObservedAt: input.observedAt },
      providerState: { state, rawStatus: input.status, sequence: input.sequence ?? previousSequence },
    };
    if (await store.replace(key, record, current.etag)) return record;
  }
  throw new Error("Voice provider callback contention");
}
