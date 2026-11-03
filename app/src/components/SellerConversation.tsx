import { useState } from "react";
import {
  OPENINGS, OPENING_THEN, QUESTIONS, SOURCE_LABEL, STATUS_LABEL, EMPTY_CONVERSATION,
  fillLine, withField, withMark, moveTo, questionStatus, nextOpenQuestion, recapFor,
  type AnswerStatus, type ConversationDraft, type OnRecord, type QuestionId, type AnswerField,
} from "../lib/seller-conversation";
import { CATEGORY_LABEL, type ReadinessResult } from "../lib/underwriting/offer-readiness";
import { CATEGORY_PRIORITY } from "../lib/underwriting/next-best-question";
import "./SellerConversation.css";

/**
 * B15-03 / INV-103 -- Revision 6 guided seller conversation, slices 1-2.
 *
 * DRAFT-ONLY. Nothing in this component reads or writes GHL, starts a save, or
 * touches the page's autosave sections: the answer controls here have no blur,
 * Enter or change handler other than updating this component's own state. The
 * page passes in what is already on record (read-only projection) and the
 * existing engines' results; this component never computes readiness.
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

export function SellerConversation({ dealKey, firstName, street, onRecord, readiness, recommended, staleRead, repairsHref }: {
  dealKey: string | null;
  firstName: string | null;
  street: string | null;
  onRecord: OnRecord;
  readiness: ReadinessResult | null;
  recommended: QuestionId | null;
  staleRead: boolean;
  /** The existing Underwriting page for this contact (repair estimator); opened in a NEW TAB so this page and its drafts stay. */
  repairsHref: string | null;
}) {
  const [drafts, setDrafts] = useState<Record<string, ConversationDraft>>({});
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

  const go = (i: number) => update((p) => moveTo(p, i));
  const mark = (m: "skipped" | "seller_doesnt_know") => update((p) => moveTo(withMark(p, q.id, m), p.current + 1));

  return (
    <section className="sc-wrap" data-testid="seller-conversation" data-deal={key} aria-label="Seller conversation">
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
            /* Bones P2-2: read-only recap of what is saved and what is only drafted. Nothing inferred or combined. */
            <div className="sc-recap" data-testid="sc-recap">
              <div className="sc-label">Recap — read back, don't add to it</div>
              <ul>
                {recapFor(d, onRecord).map((row) => (
                  <li key={row.id} data-testid={`sc-recap-${row.id}`} data-status={row.status}>
                    <strong>{row.title}:</strong>{" "}
                    {row.saved.length === 0 && row.draft.length === 0 && !row.mark ? <span className="sc-muted">Unanswered</span> : null}
                    {row.saved.map((s, i) => (
                      <div key={`s${i}`} className="sc-recap-saved" data-testid="sc-recap-saved">
                        <span className="sc-chip sc-chip-record">Saved</span> {s.label}: {s.value} <span className="sc-muted">— {s.source}</span>
                      </div>
                    ))}
                    {row.draft.map((x, i) => (
                      <div key={`d${i}`} className="sc-recap-draft" data-testid="sc-recap-draft">
                        <span className="sc-chip sc-chip-draft">Draft — not saved</span> {x.label}: {x.value}
                      </div>
                    ))}
                    {row.mark ? (
                      <div className="sc-recap-mark" data-testid="sc-recap-mark"><span className="sc-chip sc-chip-skip">{STATUS_LABEL[row.mark]}</span></div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="sc-fields">
            {q.fields.map((f) => (
              <DraftField key={`${key}:${q.id}:${f.id}`} qid={q.id} field={f} value={answer?.fields[f.id] ?? ""}
                onChange={(v) => update((p) => withField(p, q.id, f.id, v))} />
            ))}
            <div className="sc-muted" data-testid="sc-draft-note">Draft only: kept on this page while it is open. Nothing here is saved to GHL.</div>
          </div>
          {answer?.mark ? (
            <div className="sc-marked" data-testid="sc-mark">
              Marked: {STATUS_LABEL[answer.mark]}{" "}
              <button type="button" className="sc-link" data-testid="sc-clear-mark" onClick={() => update((p) => withMark(p, q.id, null))}>Clear</button>
            </div>
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
            {QUESTIONS.map((item, i) => {
              const a = d.answers[item.id];
              return (
                <li key={item.id} data-testid={`sc-note-${item.id}`}>
                  <button type="button" className="sc-note-heading" data-testid={`sc-note-heading-${item.id}`}
                    aria-current={i === d.current ? "step" : undefined} onClick={() => go(i)}>
                    {i === 0 ? item.title : `${i}. ${item.title}`}
                  </button>
                  {a?.mark === "seller_doesnt_know" ? <div className="sc-note-dk" data-testid={`sc-note-dk-${item.id}`}>Seller doesn't know</div> : null}
                  {item.fields.map((f) => (
                    <DraftField key={`${key}:note:${item.id}:${f.id}`} prefix="scn" compact qid={item.id} field={f} value={a?.fields[f.id] ?? ""}
                      onChange={(v) => update((p) => withField(p, item.id, f.id, v))} />
                  ))}
                </li>
              );
            })}
            <li data-testid="sc-note-general">
              <label className="sc-note-heading" htmlFor="sc-call-notes">General notes</label>
              <textarea id="sc-call-notes" className="sc-input" data-testid="sc-call-notes" rows={3} value={d.notes}
                onChange={(e) => { const v = e.target.value; update((p) => ({ ...p, notes: v })); }} />
            </li>
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
