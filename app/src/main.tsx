/**
 * Application boot — Gate 4B-5.
 *
 * ORDER IS THE WHOLE DESIGN. Fetch configuration, validate it, populate the
 * singleton, and only THEN dynamically import App. Every module-scope
 * getRuntimeConfig() downstream — ghl.ts, ContactWorkspace, Dashboard,
 * UnderwritingWorkspace — runs during that import, which is after the fetch has
 * resolved. Nothing downstream had to change shape.
 *
 * FAIL-CLOSED IS STRUCTURAL, NOT DEFENSIVE. On any failure this file renders a
 * configuration-unavailable state and NEVER imports App. There is therefore no
 * code path in which a GHL-dependent surface renders unconfigured — the module
 * graph enforces it rather than a guard clause somebody has to remember. The
 * static `import App` that used to live here is gone on purpose; restoring it
 * would silently defeat this.
 *
 * Deploy Previews receive neither IAOS_ENV nor GHL_PRIVATE_API_KEY (both are
 * Production-context only), so a preview lands here by configuration rather
 * than by accident. Before this commit a preview threw during module evaluation
 * with no error boundary and showed a white screen; now it shows something a
 * human can diagnose.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { setRuntimeConfig } from "../shared/ghl-config";

const ENDPOINT = "/.netlify/functions/iaos-runtime-config";

const root = createRoot(document.getElementById("root")!);

function ConfigurationUnavailable({ detail }: { detail: string }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "2rem",
        fontFamily:
          "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
        background: "#0b1220",
        color: "#e5e7eb",
      }}
    >
      <div style={{ maxWidth: "34rem" }}>
        <h1 style={{ fontSize: "1.125rem", fontWeight: 600, margin: 0 }}>
          Configuration unavailable
        </h1>
        <p style={{ marginTop: "0.75rem", lineHeight: 1.5, color: "#9ca3af" }}>
          IAOS could not load its runtime configuration, so the application was
          not started. No data has been read or written.
        </p>
        <p
          style={{
            marginTop: "0.75rem",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: "0.8125rem",
            color: "#f87171",
            wordBreak: "break-word",
          }}
        >
          {detail}
        </p>
        <p style={{ marginTop: "0.75rem", fontSize: "0.8125rem", color: "#6b7280" }}>
          On a Deploy Preview this is expected: IAOS_ENV is set only in the
          Production context.
        </p>
      </div>
    </div>
  );
}

async function boot() {
  const res = await fetch(ENDPOINT, { method: "GET", cache: "no-store" });
  if (!res.ok) {
    throw new Error(`configuration endpoint returned HTTP ${res.status}`);
  }

  // Throws on an incomplete or malformed payload, which keeps us out of the
  // import below. Same completeness check getConfig uses server-side.
  setRuntimeConfig(await res.json());

  // ONLY after configuration is known good. Dynamic on purpose.
  const { default: App } = await import("./App");
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

boot().catch((err: unknown) => {
  const detail = err instanceof Error ? err.message : String(err);
  root.render(<ConfigurationUnavailable detail={detail} />);
});
