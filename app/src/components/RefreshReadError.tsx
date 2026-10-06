/**
 * Board 15 cleanup (Bones, PR #131 P2) -- a RE-read of data the page already
 * shows failed (for example the refresh after read sign-in returns). The page
 * keeps what it has -- the workspace, its editors, their drafts and any save
 * in progress stay mounted -- and this line reports the failed read on its
 * own. Only a page that never loaded shows the full-page error.
 */
export default function RefreshReadError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div data-testid="refresh-read-error" role="status"
      style={{ marginBottom: "12px", padding: "8px 12px", borderRadius: "8px", fontSize: "12px", color: "#FBBF24", background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.35)" }}>
      Couldn't refresh this page's data ({message}). What's shown may be out of date; your unsaved work on this page is kept.
    </div>
  );
}
