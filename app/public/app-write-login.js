(async () => {
  const status = document.getElementById("status");
  try {
    if (!window.opener) throw new Error("Open sign-in from IAOS.");
    const response = await fetch("/.netlify/functions/app-write-session", { cache: "no-store" });
    if (!response.ok) throw new Error("Application write sign-in is not configured.");
    const { clientId } = await response.json();
    await new Promise((resolve, reject) => {
      const script = document.createElement("script"); script.src = "https://accounts.google.com/gsi/client";
      script.onload = resolve; script.onerror = () => reject(new Error("Google sign-in could not load.")); document.head.appendChild(script);
    });
    google.accounts.id.initialize({ client_id: clientId, auto_select: false, callback: async ({ credential }) => {
      try {
        const result = await fetch("/.netlify/functions/app-write-session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ googleIdToken: credential }) });
        if (!result.ok) throw new Error("This identity is not authorized for application writes.");
        window.opener.postMessage({ type: "iaos-app-write-session", session: await result.json() }, location.origin);
        status.textContent = "Signed in. You can close this window.";
      } catch (error) { status.textContent = error.message; }
    }});
    google.accounts.id.renderButton(document.getElementById("signin"), { theme: "outline", size: "large" });
    status.textContent = "Use Brad’s authorized Google account.";
  } catch (error) { status.textContent = error.message; }
})();
