import { useState } from "react";
import {
  OPENINGS, OPENING_THEN, QUESTIONS, SOURCE_LABEL, STATUS_LABEL, EMPTY_CONVERSATION,
  fillLine, withField, withMark, moveTo, questionStatus, nextOpenQuestion, noteFor,
  type AnswerStatus, type ConversationDraft, type OnRecord, type QuestionId, type AnswerField,
} from "../lib/seller-conversation";
import { CATEGORY_LABEL, type ReadinessResult } from "../lib/underwriting/offer-readiness";
import { CATEGORY_PRIORITY } from "../lib/underwriting/next-best-question";
import { type DealResults, type ItemResult, type PlanItem, type SaveAction, type SaveClient, type SavePlan, type SaveItemId, type SentRecord, type SellerConversationSaveCoordinator } from "../lib/seller-conversation-save";
import { LeaveGuard } from "../lib/leave-guard";
import "./SellerConversation.css";

/**
 * B15-03 slice C -- Save at Summary, wired by the page. `plan` builds this deal's save plan from the draft (the
 * page adds what is on record and, while Save is enabled, its own sections). With `enabled` false, Save only
 * shows the plan and says saving is not enabled: it makes no request.
 */
export type ConversationSave = {
  enabled: boolean;
  contactId: string;
  plan: (draft: ConversationDraft, callId: string) => SavePlan;
  coordinator: SellerConversationSaveCoordinator;
  client: SaveClient;
  onConfirmed: (dealKey: string, item: { id: SaveItemId; signature: string }, sent: SentRecord) => void;
};
const LEAVE_MESSAGE = "This call has unsaved work (the conversation, or answers not yet saved). Leave the Seller Call page anyway? Unsaved answers will be lost.";
const STATE_WORD: Record<SaveAction, [string, string]> = {
  write: ["Will save", "Would save"], done: ["Saved", "Saved"], none: ["No change", "No change"], not_saved: ["Not saved", "Not saved"], blocked: ["Uncertain", "Uncertain"],
};
const RESULT_WORD: Record<ItemResult["status"], string> = {
  saving: "Saving…", confirmed: "Confirmed", refused: "Refused", uncertain: "Uncertain", checking: "Checking…",
};

/**
 * B15-03 / INV-103 -- Revision 6 guided seller conversation, slices 1-2.
 *
 * DRAFT UNTIL SAVE. The answer controls here have no blur, Enter or change
 * handler other than updating this component's own state; moving, typing and
 * marking never write. The ONLY write path is the one Save button at Summary &
 * next step (slice C), which hands the page-built plan to the page's save
 * coordinator -- and only while the server-projected capability is enabled
 * (disabled in this slice: Save then shows the plan and sends nothing). The
 * page passes in what is already on record (read-only projection) and the
 * existing engines' results; this component never computes readiness.
 *
 * LEAVE WARNING (slice C): while the plan has unsaved work, leaving by an in-app
 * link asks first and reload/close gets the browser prompt (lib/leave-guard.ts,
 * including its documented limits: Back/Forward are not intercepted).
 *
 * NEVER BLOCKING. Previous, Next, jump, Skip, Seller doesn't know and Return to
 * unanswered never depend on an answer.
 *
 * Drafts are kept per deal (`dealKey` = contact + opportunity) for as long as
 * the page stays open; another deal or contact never sees them. `dealKey` is
 * null while the page has no fully loaded deal, and then no control renders.
 */
const STATUS_CLASS: Record<AnswerStatus, string> = {
  draft: "sc-chip sc-chip-draft", seller_doesnt_know: "sc-chip sc-chip-dk", skipped: "sc-chip sc-chip-skip",
  on_record: "sc-chip sc-chip-record", unanswered: "sc-chip sc-chip-open",
};
const READINESS_TEXT = { NOT_READY: "Not ready", REVIEW_NEEDED: "Review needed", OFFER_READY: "Offer ready (evidence)" } as const;

export function SellerConversation({ dealKey, firstName, street, onRecord, readiness, recommended, staleRead, repairsHref, save = null }: {
  dealKey: string | null;
  firstName: string | null;
  street: string | null;
  onRecord: OnRecord;
  readiness: ReadinessResult | null;
  recommended: QuestionId | null;
  staleRead: boolean;
  /** The existing Underwriting page for this contact (repair estimator); opened in a NEW TAB so this page and its drafts stay. */
  repairsHref: string | null;
  /** Slice C: null while no deal is loaded (then nothing can be saved). */
  save?: ConversationSave | null;
}) {
  const [drafts, setDrafts] = useState<Record<string, ConversationDraft>>({});
  /* Slice C: one call id per deal for this page visit; a re-save of the same call supersedes by it. */
  const [callIds] = useState(() => new Map<string, string>());
  const callIdFor = (k: string) => { let id = callIds.get(k); if (!id) { id = crypto.randomUUID(); callIds.set(k, id); } return id; };
  const [notEnabledShown, setNotEnabledShown] = useState<string | null>(null);
  const savePlan = dealKey && save ? save.plan(drafts[dealKey] ?? EMPTY_CONVERSATION, callIdFor(dealKey)) : null;
  const leaveGuarded = !!savePlan && (savePlan.unsaved || !!save?.coordinator.busy());
  if (!dealKey) {
    return (
      <section className="sc-wrap" data-testid="seller-conversation" aria-label="Seller conversation">
        <div className="sc-placeholder" data-testid="seller-conversation-waiting">The conversation opens once this seller's deal is loaded.</div>
      </section>
    );
  }
  const key = dealKey;
  const d = drafts[key] ?? EMPTY_CONVERSATION;
  const update = (fn: (prev: ConversationDraft) => ConversationDraft) =>
    setDrafts((all) => ({ ...all, [key]: fn(all[key] ?? EMPTY_CONVERSATION) }));

  const statuses = QUESTIONS.map((q) => questionStatus(q.id, d, onRecord));
  const q = QUESTIONS[d.current];
  const opening = OPENINGS.find((o) => o.id === d.opening) ?? OPENINGS[0];
  const spoken = q.id === "opening" ? fillLine(opening.say, { firstName, street }) : q.say;
  const then = q.id === "opening" ? OPENING_THEN.say : q.then;
  const lineSource = q.id === "opening" ? opening.source : q.source;
  const nextOpen = nextOpenQuestion(d.current, statuses);
  const answer = d.answers[q.id];
  const records = onRecord[q.id] ?? [];
  const note = noteFor(d);

  const go = (i: number) => update((p) => moveTo(p, i));
  const mark = (m: "skipped" | "seller_doesnt_know") => update((p) => moveTo(withMark(p, q.id, m), p.current + 1));

  return (
    <section className="sc-wrap" data-testid="seller-conversation" data-deal={key} aria-label="Seller conversation">
      <LeaveGuard active={leaveGuarded} message={LEAVE_MESSAGE} />
      <div className="sc-grid">
        <nav className="sc-nav" aria-label="Conversation questions" data-testid="sc-nav">
          <div className="sc-heading">Conversation</div>
          <ol>
            {QUESTIONS.map((item, i) => (
              <li key={item.id}>
                <button type="button" data-testid={`sc-nav-${item.id}`} aria-current={i === d.current ? "step" : undefined}
                  className={i === d.current ? "sc-nav-item sc-nav-current" : "sc-nav-item"} onClick={() => go(i)}>
                  <span className="sc-nav-title">{item.title}</span>
                  {recommended === item.id ? <span className="sc-star" data-testid={`sc-recommended-${item.id}`} title="Suggested next by Offer Readiness" aria-label="Suggested next">★</span> : null}
                  <span className={STATUS_CLASS[statuses[i]]} data-testid={`sc-status-${item.id}`}>{STATUS_LABEL[statuses[i]]}</span>
                </button>
              </li>
            ))}
          </ol>
        </nav>

        <div className="sc-card" data-testid="sc-card" data-question={q.id}>
          {q.id === "opening" ? (
            <div className="sc-openings" role="group" aria-label="Conversation type" data-testid="sc-openings">
              {OPENINGS.map((o) => (
                <button key={o.id} type="button" data-testid={`sc-opening-${o.id}`} aria-pressed={d.opening === o.id}
                  className={d.opening === o.id ? "sc-opening sc-opening-on" : "sc-opening"}
                  onClick={() => update((p) => ({ ...p, opening: o.id }))}>{o.label}</button>
              ))}
            </div>
          ) : null}
          <div className="sc-qhead">
            <h3 id="sc-question-title" className="sc-qtitle">{d.current === 0 ? q.title : `${d.current}. ${q.title}`}</h3>
            <span className={STATUS_CLASS[statuses[d.current]]} data-testid="sc-card-status">{STATUS_LABEL[statuses[d.current]]}</span>
          </div>
          <p className="sc-say" data-testid="sc-say">“{spoken}”</p>
          {(q.alternates ?? []).map((alt, i) => (
            <p key={i} className="sc-then" data-testid="sc-alternate">Or: “{alt}”</p>
          ))}
          {then ? <p className="sc-then" data-testid="sc-then">After listening: “{then}”</p> : null}
          <div className="sc-source" data-testid="sc-source">Suggested — say it your way · {SOURCE_LABEL[lineSource]}</div>
          {q.followUps.length > 0 ? (
            <details className="sc-follow" data-testid="sc-followups">
              <summary>Optional follow-ups ({q.followUps.length})</summary>
              <ul>{q.followUps.map((f, i) => <li key={i}>{f}</li>)}</ul>
            </details>
          ) : null}

          <div className="sc-record" data-testid="sc-on-record">
            <div className="sc-label">On record</div>
            {records.length === 0 ? (
              <div className="sc-muted" data-testid="sc-on-record-none">Nothing on record for this question.</div>
            ) : (
              <ul>{records.map((r, i) => (
                <li key={i} data-testid="sc-on-record-item"><strong>{r.label}:</strong> {r.value} <span className="sc-muted">— {r.source}</span></li>
              ))}</ul>
            )}
            {staleRead ? <div className="sc-warn" data-testid="sc-stale">The latest refresh failed; this is what was last read.</div> : null}
          </div>

          {q.id === "condition" && repairsHref ? (
            /* Bones P2-1: the existing repair estimator, unchanged, in a new tab -- this page and its drafts stay open. */
            <a className="sc-link" data-testid="sc-repairs-link" href={repairsHref} target="_blank" rel="noopener noreferrer">
              Estimate repairs in Underwriting (opens in a new tab)
            </a>
          ) : null}

          {q.id === "summary" ? (
            /* Captain C8 / plan A7 (Bones P2, f919d3f): Summary shows the call note itself, READ-ONLY -- the same
               `noteFor` projection the editable Call notes render. Every question, Opening through Summary and its
               follow-up date, then General notes. Blank stays blank; "Seller doesn't know" printed. Draft only. */
            <div className="sc-summary-note" data-testid="sc-summary-note">
              <div className="sc-label">Call notes — read back (NOT SAVED; edit in the questions or Call notes)</div>
              <ol>
                {note.map((row) => (
                  <li key={row.id} data-testid={`sc-summary-note-${row.id}`}>
                    <strong>{row.heading}</strong>
                    {row.kind === "general" ? (
                      <div className="sc-summary-answer" data-testid="sc-summary-answer">{row.value}</div>
                    ) : (
                      <>
                        {row.dontKnow ? <div className="sc-note-dk" data-testid={`sc-summary-dk-${row.id}`}>Seller doesn't know</div> : null}
                        {row.answers.map((x) => (
                          <div key={x.fieldId} className="sc-summary-answer" data-testid="sc-summary-answer" data-field={`${row.id}.${x.fieldId}`}>
                            <span className="sc-muted">{x.label}:</span> {x.value}
                          </div>
                        ))}
                      </>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          ) : null}

          <div className="sc-fields">
            {q.fields.map((f) => (
              <DraftField key={`${key}:${q.id}:${f.id}`} qid={q.id} field={f} value={answer?.fields[f.id] ?? ""}
                onChange={(v) => update((p) => withField(p, q.id, f.id, v))} />
            ))}
            <div className="sc-muted" data-testid="sc-draft-note">{save?.enabled
              ? "Draft: kept on this page while it is open, and saved only when you press Save at Summary & next step."
              : "Draft only: kept on this page while it is open. Nothing here is saved to GHL."}</div>
          </div>
          {answer?.mark ? (
            <div className="sc-marked" data-testid="sc-mark">
              Marked: {STATUS_LABEL[answer.mark]}{" "}
              <button type="button" className="sc-link" data-testid="sc-clear-mark" onClick={() => update((p) => withMark(p, q.id, null))}>Clear</button>
            </div>
          ) : null}

          {q.id === "summary" && save && savePlan ? (
            <SavePanel dealKey={key} save={save} plan={savePlan} results={save.coordinator.results(key)}
              notEnabledShown={notEnabledShown === key} onNotEnabled={() => setNotEnabledShown(key)} />
          ) : null}

          <div className="sc-controls" data-testid="sc-controls">
            <button type="button" data-testid="sc-prev" onClick={() => go(d.current - 1)} disabled={d.current === 0}>◀ Previous</button>
            <button type="button" data-testid="sc-skip" onClick={() => mark("skipped")}>Skip</button>
            <button type="button" data-testid="sc-dont-know" onClick={() => mark("seller_doesnt_know")}>Seller doesn't know</button>
            <button type="button" data-testid="sc-next" onClick={() => go(d.current + 1)} disabled={d.current === QUESTIONS.length - 1}>Next ▶</button>
          </div>
          <button type="button" className="sc-link" data-testid="sc-return-open" disabled={nextOpen === null}
            onClick={() => { if (nextOpen !== null) go(nextOpen); }}>
            {nextOpen === null ? "No unanswered or skipped questions left" : `Return to unanswered: ${QUESTIONS[nextOpen].title}`}
          </button>

          {/* Offer Readiness, compact (Captain 2026-11-03: no duplicate prominence). The existing engine's output only. */}
          <div className="sc-readiness" data-testid="sc-readiness">
            {readiness ? (
              <>
                <span className="sc-ready-status" data-testid="sc-readiness-status">{READINESS_TEXT[readiness.effectiveStatus]}</span>
                <ul>
                  {CATEGORY_PRIORITY.map((c) => (
                    <li key={c} data-testid={`sc-readiness-${c}`} data-level={readiness.categories[c]}>
                      <span>{CATEGORY_LABEL[c]}</span>{" "}
                      <span className={`sc-level sc-level-${readiness.categories[c].toLowerCase()}`}>{readiness.categories[c]}</span>
                    </li>
                  ))}
                </ul>
                <div className="sc-muted">Supported means the evidence is sufficient, not that an offer is approved. Brad makes any offer in Deal tools below.</div>
              </>
            ) : <div className="sc-muted" data-testid="sc-readiness-unavailable">Readiness is not available until this deal's figures load.</div>}
          </div>
        </div>

        {/* Call notes = the structured conversation note (Captain C8, 2026-11-03): every question in order, its
            answer underneath, edited in the SAME draft state as the card. Blank stays blank; "Seller doesn't
            know" is printed as the answer; a heading opens its question. Draft only -- nothing here is saved. */}
        <aside className="sc-side sc-notes" aria-label="Call notes" data-testid="sc-notes-panel">
          <div className="sc-heading">Call notes</div>
          <div className="sc-muted sc-notes-unsaved" data-testid="sc-notes-unsaved">NOT SAVED — kept on this page while it is open.</div>
          <ol className="sc-note-list">
            {note.map((row, i) => row.kind === "general" ? (
              <li key={row.id} data-testid="sc-note-general">
                <label className="sc-note-heading" htmlFor="sc-call-notes">{row.heading}</label>
                <textarea id="sc-call-notes" className="sc-input" data-testid="sc-call-notes" rows={3} value={row.value}
                  onChange={(e) => { const v = e.target.value; update((p) => ({ ...p, notes: v })); }} />
              </li>
            ) : (
              <li key={row.id} data-testid={`sc-note-${row.id}`}>
                <button type="button" className="sc-note-heading" data-testid={`sc-note-heading-${row.id}`}
                  aria-current={i === d.current ? "step" : undefined} onClick={() => go(i)}>
                  {row.heading}
                </button>
                {row.dontKnow ? <div className="sc-note-dk" data-testid={`sc-note-dk-${row.id}`}>Seller doesn't know</div> : null}
                {QUESTIONS[i].fields.map((f, j) => (
                  <DraftField key={`${key}:note:${row.id}:${f.id}`} prefix="scn" compact qid={row.id} field={f} value={row.answers[j].value}
                    onChange={(v) => update((p) => withField(p, row.id, f.id, v))} />
                ))}
              </li>
            ))}
          </ol>
        </aside>
      </div>
    </section>
  );
}

/**
 * One draft control. `prefix` keeps the card ("sc") and the Call notes panel ("scn") ids distinct while both
 * edit the same draft value. A GHL-backed field names its GHL record and says NOT SAVED (Captain 2026-11-03).
 */
function DraftField({ qid, field, value, onChange, prefix = "sc", compact = false }: { qid: QuestionId; field: AnswerField; value: string; onChange: (v: string) => void; prefix?: string; compact?: boolean }) {
  const id = `${prefix}-${qid}-${field.id}`;
  const common = { id, value, "data-testid": `${prefix === "sc" ? "sc-field" : "sc-note-field"}-${qid}-${field.id}`, className: field.ghl ? "sc-input sc-input-ghl" : "sc-input" };
  return (
    <div className={compact ? "sc-field sc-field-compact" : "sc-field"} data-ghl={field.ghl ? "true" : undefined}>
      <label htmlFor={id}>
        {field.label}
        {field.ghl ? (
          <span className="sc-ghl" data-testid={`${prefix}-ghl-${qid}-${field.id}`}>
            <span className="sc-ghl-name" title={`GHL · ${field.ghl}`}>{compact ? "GHL" : `GHL · ${field.ghl}`}</span> <span className="sc-ghl-unsaved">NOT SAVED</span>
          </span>
        ) : null}
      </label>
      {field.kind === "textarea" ? (
        <textarea {...common} rows={compact ? 1 : 2} onChange={(e) => onChange(e.target.value)} />
      ) : field.kind === "choice" ? (
        <select {...common} onChange={(e) => onChange(e.target.value)}>
          <option value="">Not answered</option>
          {(field.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <input {...common} type={field.kind === "date" ? "date" : "text"} inputMode={field.kind === "money" ? "decimal" : undefined}
          onChange={(e) => onChange(e.target.value)} />
      )}
      {field.hint ? <div className="sc-muted">{field.hint}</div> : null}
    </div>
  );
}

/**
 * Slice C -- Save at Summary. The whole plan, item by item, with what each would write or why it is not saved,
 * and after a Save each item's own result: confirmed / refused (the server's reason) / uncertain. An uncertain
 * item offers Check again (a read) and is never re-sent by Save: only finding it on the record, or the original
 * request's own answer, settles it (an empty read proves nothing; Bones C1).
 */
function SavePanel({ dealKey, save, plan, results, notEnabledShown, onNotEnabled }: {
  dealKey: string; save: ConversationSave; plan: SavePlan; results: DealResults; notEnabledShown: boolean; onNotEnabled: () => void;
}) {
  const busy = save.coordinator.busy();
  const hooks = { onConfirmed: (item: { id: SaveItemId; signature: string }, sent: SentRecord) => save.onConfirmed(dealKey, item, sent) };
  const onSave = () => {
    if (!save.enabled) { onNotEnabled(); return; }
    void save.coordinator.save(dealKey, save.contactId, plan, save.client, hooks);
  };
  const shown: PlanItem[] = plan.items;
  return (
    <div className="sc-save" data-testid="sc-save-panel" data-enabled={save.enabled ? "true" : "false"}>
      <div className="sc-label">Save this call</div>
      {shown.length === 0 ? <div className="sc-muted" data-testid="sc-save-empty">Nothing to save yet.</div> : (
        <ol className="sc-save-plan" data-testid="sc-save-plan">
          {shown.map((i) => {
            const r = results[i.id];
            return (
              <li key={i.id} data-testid={`sc-save-item-${i.id}`} data-action={i.action} data-result={r?.status ?? ""}>
                <strong>{i.label}</strong>
                <span className={`sc-save-state sc-save-state-${i.action}`} data-testid={`sc-save-state-${i.id}`}>{STATE_WORD[i.action][save.enabled ? 0 : 1]}</span>
                {i.text ? <div className="sc-save-text" data-testid={`sc-save-text-${i.id}`}>{i.text}</div> : null}
                {r && r.status !== "saving" ? (
                  <div className={`sc-save-result sc-save-result-${r.status}`} data-testid={`sc-save-result-${i.id}`} role={r.status === "refused" || r.status === "uncertain" ? "alert" : undefined}>
                    {RESULT_WORD[r.status]}{"message" in r && r.message ? `: ${r.message}` : ""}
                  </div>
                ) : null}
                {r && r.status === "uncertain" ? (
                  <button type="button" className="sc-save-check" data-testid={`sc-save-check-${i.id}`} disabled={busy}
                    onClick={() => { void save.coordinator.check(dealKey, i.id, save.client, hooks); }}>Check again</button>
                ) : null}
                {i.preview ? (
                  <details data-testid={`sc-save-preview-${i.id}`}>
                    <summary className="sc-muted">Show the note text</summary>
                    <pre data-testid="sc-save-note-preview">{i.preview}</pre>
                  </details>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
      <div className="sc-save-actions">
        <button type="button" className="sc-save-button" data-testid="sc-save" disabled={busy} onClick={onSave}>{busy ? "Saving…" : "Save"}</button>
        {save.enabled && !busy && plan.writes.length === 0 ? <span className="sc-muted" data-testid="sc-save-nothing">Nothing new to send.</span> : null}
      </div>
      {!save.enabled ? (
        notEnabledShown
          ? <div className="sc-save-notice" role="status" data-testid="sc-save-not-enabled">Saving is not enabled yet. Nothing was sent. The list above is what Save would write.</div>
          : <div className="sc-muted" data-testid="sc-save-disabled-note">Saving is not enabled yet: Save shows what it would write and sends nothing.</div>
      ) : null}
      <div className="sc-muted" data-testid="sc-save-separate">Current Offer, readiness approve/override, Accept / Follow-Up / Pass, contract steps and the call log keep their own buttons; Save never records them.</div>
    </div>
  );
}
