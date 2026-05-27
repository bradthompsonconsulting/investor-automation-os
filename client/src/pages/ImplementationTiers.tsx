import { motion } from "framer-motion";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";
import {
  ArrowRight,
  Check,
  Zap,
  Users,
  BarChart3,
  Sparkles,
  Clock,
  Headphones,
  Rocket,
} from "lucide-react";

const fadeInUp = {
  initial: { opacity: 0, y: 24 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.65, ease: "easeOut" },
} as const;

const staggerContainer = {
  animate: {
    transition: {
      staggerChildren: 0.08,
      delayChildren: 0.15,
    },
  },
};

const tiers = [
  {
    name: "Investor Automation OS Core",
    subtitle: "Self-Service Automation",
    description: "For investors who want to implement and manage their own automation system.",
    idealFor: "Solo investors, small teams, DIY operators",
    monthlyPrice: "Starting at $499",
    features: [
      "Lead capture from unlimited sources",
      "Automated SMS & email sequences",
      "CRM with pipeline management",
      "AI-powered lead qualification",
      "Appointment booking automation",
      "Basic reporting & analytics",
      "Email & community support",
      "Self-service setup & configuration",
    ],
    notIncluded: [
      "Dedicated implementation support",
      "Custom workflow design",
      "Advanced integrations",
      "Priority support",
    ],
    cta: "Start Free Trial",
    highlight: false,
  },
  {
    name: "Investor Automation OS Setup",
    subtitle: "Guided Implementation",
    description: "For teams that want expert guidance to build their automation system correctly.",
    idealFor: "Growing acquisition teams, operators wanting expert setup",
    monthlyPrice: "Starting at $1,299",
    features: [
      "Everything in Core, plus:",
      "Dedicated implementation specialist",
      "Custom workflow design & setup",
      "Lead source integration setup",
      "SMS & email template customization",
      "Team training & onboarding",
      "Performance optimization",
      "Priority email support",
      "Quarterly strategy reviews",
    ],
    notIncluded: [
      "Ongoing managed services",
      "24/7 phone support",
      "Advanced custom development",
    ],
    cta: "Schedule Setup Call",
    highlight: true,
  },
  {
    name: "Investor Automation OS Managed",
    subtitle: "Full-Service Operations",
    description: "For serious acquisition teams that want us to run their automation machine.",
    idealFor: "High-volume acquisition teams, operators focused on deals",
    monthlyPrice: "Starting at $2,999",
    features: [
      "Everything in Setup, plus:",
      "Fully managed automation operation",
      "Dedicated account manager",
      "Continuous workflow optimization",
      "Advanced integrations & custom development",
      "Lead quality monitoring & improvement",
      "Weekly performance reviews",
      "24/7 priority phone & email support",
      "Unlimited strategy consulting",
      "Proactive system improvements",
    ],
    notIncluded: [],
    cta: "Talk To Our Team",
    highlight: false,
  },
];

function TierCard({ tier, index }: { tier: typeof tiers[0]; index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.65, delay: index * 0.1 }}
      viewport={{ once: true, margin: "-80px" }}
      className={`relative rounded-2xl overflow-hidden transition-all duration-300 ${
        tier.highlight ? "ring-2 ring-accent shadow-2xl shadow-cyan-500/30 md:scale-105" : ""
      }`}
    >
      {/* Highlight badge for Setup tier */}
      {tier.highlight && (
        <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-accent/10 border border-accent/30 shadow-[0_0_28px_rgba(0,217,255,0.18)] backdrop-blur-xl">
            <Sparkles size={14} className="text-accent" />
            <span className="text-xs font-semibold text-accent">Most Popular</span>
          </div>
        </div>
      )}

      <div className={`relative p-8 md:p-10 rounded-2xl glass-card h-full flex flex-col ${tier.highlight ? "bg-gradient-to-br from-accent/5 to-transparent" : ""}`}>
        {/* Header */}
        <div className="mb-8">
          <h3 className="text-2xl md:text-3xl font-display font-bold text-foreground mb-2">
            {tier.name}
          </h3>
          <p className="text-accent font-semibold text-sm mb-3">{tier.subtitle}</p>
          <p className="text-muted-foreground text-base mb-4">{tier.description}</p>
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10">
            <Users size={14} className="text-accent" />
            <span className="text-xs text-muted-foreground">{tier.idealFor}</span>
          </div>
        </div>

        {/* Price */}
        <div className="mb-8 pb-8 border-b border-white/10">
          <p className="text-muted-foreground text-sm mb-2">Pricing</p>
          <p className="text-3xl md:text-4xl font-display font-bold text-foreground">
            {tier.monthlyPrice}
            <span className="text-lg text-muted-foreground font-normal">/month</span>
          </p>
        </div>

        {/* Features */}
        <div className="flex-grow mb-8">
          <h4 className="text-sm font-semibold text-foreground mb-4 uppercase tracking-wide">
            Included Features
          </h4>
          <ul className="space-y-3">
            {tier.features.map((feature, i) => (
              <li key={i} className="flex items-start gap-3">
                <Check size={18} className="text-accent shrink-0 mt-0.5" />
                <span className="text-muted-foreground text-sm">{feature}</span>
              </li>
            ))}
          </ul>

          {tier.notIncluded.length > 0 && (
            <div className="mt-6 pt-6 border-t border-white/10">
              <h4 className="text-xs font-semibold text-muted-foreground mb-3 uppercase tracking-wide">
                Not Included
              </h4>
              <ul className="space-y-2">
                {tier.notIncluded.map((feature, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span className="text-white/20 text-xs mt-1">—</span>
                    <span className="text-muted-foreground/60 text-xs">{feature}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* CTA Button */}
        <Link href="/contact" className="w-full">
          <Button
            className={`w-full font-semibold px-6 py-3 text-base h-auto rounded-xl transition-all duration-200 ease-out ${
              tier.highlight
                ? "bg-accent hover:bg-cyan-500 text-background shadow-[0_0_34px_rgba(0,217,255,0.30)] hover:shadow-[0_0_48px_rgba(0,217,255,0.45)] hover:scale-105"
                : "border border-accent/50 text-accent hover:bg-accent/10 bg-background/40 backdrop-blur-xl hover:border-accent/80 hover:shadow-[0_0_24px_rgba(0,217,255,0.2)]"
            }`}
          >
            {tier.cta}
            <ArrowRight size={16} />
          </Button>
        </Link>
      </div>
    </motion.div>
  );
}

export default function ImplementationTiers() {
  return (
    <div className="min-h-screen bg-background overflow-hidden">
      <Navigation />

      {/* Hero Section */}
      <section className="relative pt-32 md:pt-40 pb-20 md:pb-32 overflow-hidden hero-mesh">
        <div
          className="absolute inset-0 opacity-30 -z-20 scale-105"
          style={{
            backgroundImage: "url('https://d2xsxph8kpxj0f.cloudfront.net/310519663569019027/d3Ygw65BjdqTKvfaHVio5Q/hero-background-dark-cU4DxVivTyTdDDeBzue2Es.webp')",
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(0,217,255,0.24),transparent_34%),linear-gradient(180deg,rgba(10,14,39,0.25),#0A0E27_82%)] -z-10" />
        <div className="floating-orb floating-orb-one" />
        <div className="floating-orb floating-orb-two" />

        <div className="container">
          <motion.div
            initial="initial"
            animate="animate"
            variants={staggerContainer}
            className="max-w-4xl mx-auto text-center"
          >
            <motion.div variants={fadeInUp} className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-accent/10 border border-accent/30 mb-6 shadow-[0_0_28px_rgba(0,217,255,0.18)] backdrop-blur-xl">
              <Rocket size={16} className="text-accent" />
              <span className="text-sm font-medium text-accent">Three Ways To Implement</span>
            </motion.div>

            <motion.h1 variants={fadeInUp} className="text-4xl md:text-5xl lg:text-6xl font-display font-bold text-foreground mb-6 leading-[0.95]">
              Choose Your <span className="text-gradient">Implementation Path</span>
            </motion.h1>

            <motion.p variants={fadeInUp} className="text-lg md:text-xl text-muted-foreground mb-8 max-w-3xl mx-auto">
              From self-service automation to fully managed operations, select the tier that matches your team's needs and expertise.
            </motion.p>
          </motion.div>
        </div>
      </section>

      {/* Tiers Comparison Section */}
      <section className="py-20 md:py-32 bg-secondary/70 relative section-grid">
        <div className="container relative">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8 lg:gap-10">
            {tiers.map((tier, index) => (
              <TierCard key={tier.name} tier={tier} index={index} />
            ))}
          </div>
        </div>
      </section>

      {/* Comparison Table Section */}
      <section className="py-20 md:py-32 bg-background relative overflow-hidden">
        <div className="absolute right-0 top-1/4 h-96 w-96 rounded-full bg-accent/10 blur-3xl" />
        <div className="container relative">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.65 }}
            viewport={{ once: true, margin: "-80px" }}
            className="max-w-4xl mx-auto mb-14 text-center"
          >
            <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-4">
              Feature Comparison
            </h2>
            <p className="text-lg text-muted-foreground">
              See exactly what's included at each tier and choose what's right for your team.
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            whileInView={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.75, ease: "easeOut" }}
            viewport={{ once: true, margin: "-80px" }}
            className="rounded-2xl overflow-hidden border border-accent/20 glass-card"
          >
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/10 bg-white/[0.03]">
                    <th className="text-left px-6 py-4 font-display font-bold text-foreground">Feature</th>
                    <th className="text-center px-6 py-4 font-display font-bold text-foreground">Core</th>
                    <th className="text-center px-6 py-4 font-display font-bold text-accent">Setup</th>
                    <th className="text-center px-6 py-4 font-display font-bold text-foreground">Managed</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { feature: "Lead Capture & CRM", core: true, setup: true, managed: true },
                    { feature: "SMS & Email Automation", core: true, setup: true, managed: true },
                    { feature: "AI Lead Qualification", core: true, setup: true, managed: true },
                    { feature: "Appointment Booking", core: true, setup: true, managed: true },
                    { feature: "Basic Reporting", core: true, setup: true, managed: true },
                    { feature: "Dedicated Implementation", core: false, setup: true, managed: true },
                    { feature: "Custom Workflow Design", core: false, setup: true, managed: true },
                    { feature: "Team Training", core: false, setup: true, managed: true },
                    { feature: "Managed Operations", core: false, setup: false, managed: true },
                    { feature: "Dedicated Account Manager", core: false, setup: false, managed: true },
                    { feature: "24/7 Priority Support", core: false, setup: false, managed: true },
                    { feature: "Unlimited Consulting", core: false, setup: false, managed: true },
                  ].map((item, i) => (
                    <tr key={i} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                      <td className="text-left px-6 py-4 text-muted-foreground">{item.feature}</td>
                      <td className="text-center px-6 py-4">
                        {item.core ? (
                          <Check size={20} className="text-accent inline" />
                        ) : (
                          <span className="text-white/20">—</span>
                        )}
                      </td>
                      <td className="text-center px-6 py-4 bg-accent/5">
                        {item.setup ? (
                          <Check size={20} className="text-accent inline" />
                        ) : (
                          <span className="text-white/20">—</span>
                        )}
                      </td>
                      <td className="text-center px-6 py-4">
                        {item.managed ? (
                          <Check size={20} className="text-accent inline" />
                        ) : (
                          <span className="text-white/20">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Support Levels Section */}
      <section className="py-20 md:py-32 bg-secondary/70 relative section-grid">
        <div className="container relative">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.65 }}
            viewport={{ once: true, margin: "-80px" }}
            className="max-w-3xl mx-auto text-center mb-14"
          >
            <h2 className="text-4xl md:text-5xl font-display font-bold text-foreground mb-4">
              Support & Implementation
            </h2>
            <p className="text-lg text-muted-foreground">
              Each tier includes the right level of support for your team's needs.
            </p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8">
            {[
              {
                title: "Core Support",
                icon: <Headphones size={28} />,
                details: [
                  "Email support",
                  "Community forum access",
                  "Self-service documentation",
                  "Video tutorials",
                  "Response time: 24-48 hours",
                ],
              },
              {
                title: "Setup Support",
                icon: <Clock size={28} />,
                details: [
                  "Dedicated implementation specialist",
                  "Priority email support",
                  "Weekly check-ins during setup",
                  "Custom workflow design",
                  "Response time: 4-8 hours",
                ],
              },
              {
                title: "Managed Support",
                icon: <Zap size={28} />,
                details: [
                  "Dedicated account manager",
                  "24/7 phone & email support",
                  "Weekly performance reviews",
                  "Proactive optimization",
                  "Response time: 1 hour",
                ],
              },
            ].map((item, i) => (
              <motion.div
                key={item.title}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: i * 0.08 }}
                viewport={{ once: true, margin: "-80px" }}
                className="p-8 rounded-2xl glass-card hover-lift group"
              >
                <div className="h-12 w-12 rounded-xl bg-accent/10 text-accent mb-5 flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                  {item.icon}
                </div>
                <h3 className="text-xl font-display font-bold text-foreground mb-4">{item.title}</h3>
                <ul className="space-y-3">
                  {item.details.map((detail, j) => (
                    <li key={j} className="flex items-start gap-3">
                      <Check size={16} className="text-accent shrink-0 mt-0.5" />
                      <span className="text-muted-foreground text-sm">{detail}</span>
                    </li>
                  ))}
                </ul>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ-style Section */}
      <section className="py-20 md:py-32 bg-background relative overflow-hidden">
        <div className="container relative">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.65 }}
            viewport={{ once: true, margin: "-80px" }}
            className="max-w-3xl mx-auto"
          >
            <h2 className="text-4xl md:text-5xl font-display font-bold text-foreground mb-12 text-center">
              Choosing Your Tier
            </h2>

            <div className="space-y-6">
              {[
                {
                  q: "Which tier is right for me?",
                  a: "Core is ideal for solo investors or small teams with technical expertise. Setup is perfect for growing acquisition teams that want expert guidance. Managed is best for high-volume operations where you want us to handle the automation machine entirely.",
                },
                {
                  q: "Can I upgrade or downgrade tiers?",
                  a: "Yes. You can upgrade or downgrade at any time. Changes take effect at your next billing cycle.",
                },
                {
                  q: "What if I start with Core and want to upgrade?",
                  a: "Absolutely. Many teams start with Core and upgrade to Setup or Managed as their volume grows. Your data and configurations transfer seamlessly.",
                },
                {
                  q: "Is there a contract or long-term commitment?",
                  a: "No. All tiers are month-to-month with no long-term contracts. You can cancel anytime.",
                },
              ].map((item, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 24 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, delay: i * 0.08 }}
                  viewport={{ once: true, margin: "-80px" }}
                  className="p-6 rounded-xl glass-card border border-white/10"
                >
                  <h3 className="text-lg font-display font-bold text-foreground mb-3">{item.q}</h3>
                  <p className="text-muted-foreground text-base">{item.a}</p>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </div>
      </section>

      {/* Final CTA Section */}
      <section className="py-20 md:py-32 bg-secondary/70 relative overflow-hidden">
        <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-accent/50 to-transparent" />
        <div className="container">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.65, ease: "easeOut" }}
            viewport={{ once: true, margin: "-80px" }}
            className="relative max-w-5xl mx-auto text-center rounded-[2rem] glass-card p-8 md:p-14 overflow-hidden"
          >
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(0,217,255,0.20),transparent_45%)]" />
            <div className="relative">
              <h2 className="text-4xl md:text-6xl font-display font-bold text-foreground mb-6">
                Ready to get started?
              </h2>
              <p className="text-lg text-muted-foreground mb-8 max-w-2xl mx-auto">
                Schedule a strategy call to discuss which tier is right for your acquisition team and get a personalized implementation plan.
              </p>
              <div className="flex flex-col sm:flex-row justify-center gap-4">
                <Link href="/contact">
                  <Button className="bg-accent hover:bg-cyan-500 text-background font-semibold px-8 py-6 text-lg h-auto rounded-xl shadow-[0_0_34px_rgba(0,217,255,0.30)] w-full">
                    Schedule Your Call
                    <ArrowRight size={18} />
                  </Button>
                </Link>
                <Link href="/how-it-works">
                  <Button variant="outline" className="border-white/15 text-foreground hover:text-accent hover:bg-white/5 font-semibold px-8 py-6 text-lg h-auto rounded-xl w-full">
                    Learn How It Works
                  </Button>
                </Link>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
