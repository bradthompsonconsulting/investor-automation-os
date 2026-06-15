import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";

export default function Pricing() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Navigation />
      <main className="flex-1 pt-16 md:pt-20">
        <iframe
          src="https://go.investorautomationos.com/pricing"
          title="Pricing"
          className="w-full border-0 block"
          style={{ height: "2400px" }}
          loading="lazy"
        />
      </main>
      <Footer />
    </div>
  );
}
