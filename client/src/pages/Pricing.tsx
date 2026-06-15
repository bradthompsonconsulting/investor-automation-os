import { useEffect } from "react";
import Navigation from "@/components/Navigation";

export default function Pricing() {
  useEffect(() => {
    window.scrollTo(0, 0);
    // GHL checkout forms auto-focus their first input on load, which fires a
    // secondary browser scroll AFTER our initial scrollTo. Override it once
    // the iframe has had time to settle.
    const id = setTimeout(() => window.scrollTo(0, 0), 400);
    return () => clearTimeout(id);
  }, []);

  return (
    <div className="bg-background">
      <Navigation />
      <main className="pt-16 md:pt-20">
        <iframe
          src="https://go.investorautomationos.com/pricing?noheader=true"
          title="Pricing"
          className="w-full border-0 block h-[calc(100vh-4rem)] md:h-[calc(100vh-5rem)]"
        />
      </main>
    </div>
  );
}
