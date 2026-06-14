import { useState } from "react";
import { Link } from "wouter";
import { Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Navigation() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navItems = [
    { label: "Services", href: "/services" },
    { label: "Pricing", href: "https://go.investorautomationos.com/pricing", external: true },
    { label: "For Investors", href: "/for-investors" },
    { label: "How It Works", href: "/how-it-works" },
    { label: "Demo", href: "/demo" },
    { label: "About", href: "/about" },
    { label: "Contact", href: "/contact" },
  ];

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-background/75 backdrop-blur-xl border-b border-white/10 shadow-[0_10px_40px_rgba(0,0,0,0.18)]">
      <div className="container flex items-center justify-between h-16 md:h-20">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
          <div className="w-10 h-10 md:w-12 md:h-12 bg-gradient-to-br from-cyan-200 via-cyan-400 to-cyan-500 rounded-xl flex items-center justify-center font-display font-bold text-background text-lg md:text-xl glow-cyan shadow-[inset_0_1px_0_rgba(255,255,255,0.45)]">
            IA
          </div>
          <div className="hidden sm:flex flex-col">
            <span className="font-display font-bold text-sm md:text-base text-foreground">INVESTOR</span>
            <span className="text-xs md:text-sm text-accent font-display">AUTOMATION OS</span>
          </div>
        </Link>

        {/* Desktop Navigation */}
        <div className="hidden md:flex items-center gap-1 rounded-full bg-white/[0.035] border border-white/10 px-1.5 py-1.5">
          {navItems.map((item) => (
            item.external ? (
              <a 
                key={item.href} 
                href={item.href} 
                className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-accent hover:bg-white/[0.08] rounded-full transition-all duration-200 ease-out hover:shadow-[0_0_16px_rgba(0,217,255,0.1)]"
              >
                {item.label}
              </a>
            ) : (
              <Link key={item.href} href={item.href} className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-accent hover:bg-white/[0.08] rounded-full transition-all duration-200 ease-out hover:shadow-[0_0_16px_rgba(0,217,255,0.1)]">
                {item.label}
              </Link>
            )
          ))}
        </div>

        {/* CTA Button */}
        <div className="hidden md:block">
          <Link href="/contact">
            <Button className="bg-accent hover:bg-cyan-500 text-background font-semibold rounded-xl shadow-[0_0_24px_rgba(0,217,255,0.20)] transition-all duration-200 ease-out hover:shadow-[0_0_32px_rgba(0,217,255,0.35)] hover:scale-105 active:scale-95">
              Book a Call
            </Button>
          </Link>
        </div>

        {/* Mobile Menu Button */}
        <button
          className="md:hidden p-2 text-foreground hover:text-accent transition-colors"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        >
          {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {/* Mobile Navigation */}
      {mobileMenuOpen && (
        <div className="md:hidden bg-background/95 backdrop-blur-xl border-b border-white/10 animate-fade-in">
          <div className="container py-4 flex flex-col gap-2">
            {navItems.map((item) => (
              item.external ? (
                <a
                  key={item.href}
                  href={item.href}
                  className="px-4 py-3 text-sm font-medium text-foreground hover:text-accent hover:bg-white/[0.08] rounded-xl transition-all duration-200 ease-out hover:shadow-[0_0_16px_rgba(0,217,255,0.1)] block"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  {item.label}
                </a>
              ) : (
                <Link
                  key={item.href}
                  href={item.href}
                  className="px-4 py-3 text-sm font-medium text-foreground hover:text-accent hover:bg-white/[0.08] rounded-xl transition-all duration-200 ease-out hover:shadow-[0_0_16px_rgba(0,217,255,0.1)] block"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  {item.label}
                </Link>
              )
            ))}
            <Link href="/contact" className="w-full" onClick={() => setMobileMenuOpen(false)}>
              <Button className="w-full bg-accent hover:bg-cyan-500 text-background font-semibold mt-2 rounded-xl transition-all duration-200 ease-out hover:shadow-[0_0_24px_rgba(0,217,255,0.3)] active:scale-95">
                Book a Call
              </Button>
            </Link>
          </div>
        </div>
      )}
    </nav>
  );
}
