import { Link } from "wouter";
import { Facebook, Linkedin, Youtube, Twitter } from "lucide-react";

export default function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="bg-secondary border-t border-border">
      <div className="container py-12 md:py-16">
        {/* Footer Grid */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
          {/* Brand */}
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-gradient-to-br from-cyan-400 to-cyan-500 rounded-lg flex items-center justify-center font-display font-bold text-background text-sm glow-cyan">
                IA
              </div>
              <span className="font-display font-bold text-sm text-foreground">INVESTOR AUTOMATION OS</span>
            </div>
            <p className="text-sm text-muted-foreground">
              AI-powered automation for real estate investors.
            </p>
          </div>

          {/* Quick Links */}
          <div className="flex flex-col gap-4">
            <h4 className="font-display font-bold text-foreground">Product</h4>
            <Link href="/services" className="text-sm text-muted-foreground hover:text-accent transition-colors">
              Services
            </Link>
            <Link href="/how-it-works" className="text-sm text-muted-foreground hover:text-accent transition-colors">
              How It Works
            </Link>
            <Link href="/experience-the-system" className="text-sm text-muted-foreground hover:text-accent transition-colors">
              Experience The System
            </Link>
          </div>

          {/* Company */}
          <div className="flex flex-col gap-4">
            <h4 className="font-display font-bold text-foreground">Company</h4>
            <Link href="/about" className="text-sm text-muted-foreground hover:text-accent transition-colors">
              About
            </Link>
            <Link href="/contact" className="text-sm text-muted-foreground hover:text-accent transition-colors">
              Contact
            </Link>
            <Link href="/privacy" className="text-sm text-muted-foreground hover:text-accent transition-colors">
              Privacy
            </Link>
          </div>

          {/* Contact */}
          <div className="flex flex-col gap-4">
            <h4 className="font-display font-bold text-foreground">Contact</h4>
            <a href="mailto:brad@investorautomationsos.com" className="text-sm text-muted-foreground hover:text-accent transition-colors">
              brad@investorautomationsos.com
            </a>
            <a href="tel:+19729548586" className="text-sm text-muted-foreground hover:text-accent transition-colors">
              (972) 954-8586
            </a>
            <p className="text-sm text-muted-foreground">
              McKinney, Texas
            </p>
          </div>
        </div>

        {/* Social Links */}
        <div className="flex gap-4 mb-8 pb-8 border-b border-border">
          <a href="#" className="p-2 rounded-lg bg-background hover:bg-accent/10 text-accent transition-colors" aria-label="LinkedIn">
            <Linkedin size={18} />
          </a>
          <a href="#" className="p-2 rounded-lg bg-background hover:bg-accent/10 text-accent transition-colors" aria-label="YouTube">
            <Youtube size={18} />
          </a>
          <a href="#" className="p-2 rounded-lg bg-background hover:bg-accent/10 text-accent transition-colors" aria-label="Facebook">
            <Facebook size={18} />
          </a>
          <a href="#" className="p-2 rounded-lg bg-background hover:bg-accent/10 text-accent transition-colors" aria-label="X/Twitter">
            <Twitter size={18} />
          </a>
        </div>

        {/* Bottom Section */}
        <div className="flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-muted-foreground">
          <p>&copy; {currentYear} Brad Thompson Consulting LLC. All rights reserved.</p>
          <div className="flex gap-4">
            <Link href="/privacy" className="hover:text-accent transition-colors">
              Privacy Policy
            </Link>
            <Link href="/terms" className="hover:text-accent transition-colors">
              Terms & Conditions
            </Link>
          </div>
        </div>

        {/* SMS Compliance Notice */}
        <div className="mt-8 pt-8 border-t border-border text-xs text-muted-foreground">
          <p>
            By submitting your information, you agree to receive SMS communications from Brad Thompson Consulting LLC / Investor Automation OS. Message frequency varies. Msg & data rates may apply. Reply STOP to unsubscribe and HELP for help.
          </p>
        </div>
      </div>
    </footer>
  );
}
