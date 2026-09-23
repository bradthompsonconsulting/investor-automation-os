// SECURITY -- application read sign-in popup. The session is the HttpOnly
// cookie set by app-read-session's own response; this page never sees it,
// never stores anything, and tells its opener only that sign-in finished.
// The opener re-checks the session with the server rather than trusting it.
(async () => {
  const status = document.getElementById("status");
  try {
    if (!window.opener) throw new Error("Open sign-in from IAOS.");
    const response = await fetch("/.netlify/functions/app-read-session", { cache: "no-store", credentials: "same-origin" });
    if (!response.ok) throw new Error("Read sign-in is not configured for this site.");
    const { clientId } = await response.json();
    await new Promise((resolve, reject) => {
      const script = document.createElement("script"); script.src = "https://accounts.google.com/gsi/client";
      script.onload = resolve; script.onerror = () => reject(new Error("Google sign-in could not load.")); document.head.appendChild(script);
    });
    google.accounts.id.initialize({ client_id: clientId, auto_select: false, callback: async ({ credential }) => {
      try {
        const result = await fetch("/.netlify/functions/app-read-session", {
          method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ googleIdToken: credential }),
        });
        if (!result.ok) throw new Error("This identity is not authorized to read IAOS data.");
        window.opener.postMessage({ type: "iaos-app-read-signed-in" }, location.origin);
        status.textContent = "Signed in. You can close this window.";
      } catch (error) { status.textContent = error.message; }
    }});
    google.accounts.id.renderButton(document.getElementById("signin"), { theme: "outline", size: "large" });
    status.textContent = "Use Brad’s authorized Google account.";
  } catch (error) { status.textContent = error.message; }
})();
