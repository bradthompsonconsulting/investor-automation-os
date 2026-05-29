import { useEffect, useRef, useState } from "react";
import { motion, useInView } from "framer-motion";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";
import {
  ArrowRight,
  BadgeCheck,
  BarChart3,
  Bot,
  Calendar,
  CheckCircle2,
  ChevronRight,
  Clock3,
  DatabaseZap,
  LineChart,
  MessageSquare,
  ShieldCheck,
  Smartphone,
  Sparkles,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";

const fadeInUp = {
  initial: { opacity: 0, y: 24 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.65, ease: "easeOut" },
} as const;

const staggerContainer = {
  animate: {
    transition: {
      staggerChildren: 0.09,
      delayChildren: 0.15,
    },
  },
};

const revealInView = {
  initial: { opacity: 0, y: 28 },
  whileInView: { opacity: 1, y: 0 },
  transition: { duration: 0.65, ease: "easeOut" },
  viewport: { once: true, margin: "-80px" },
} as const;

function AnimatedCounter({ value, suffix = "", prefix = "" }: { value: number; suffix?: string; prefix?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  const [displayValue, setDisplayValue] = useState(0);

  useEffect(() => {
    if (!inView) return;

    let frame = 0;
    const totalFrames = 80;
    const animateValue = () => {
      frame += 1;
      const progress = 1 - Math.pow(1 - frame / totalFrames, 3);
      setDisplayValue(Math.round(value * progress));

      if (frame < totalFrames) {
        requestAnimationFrame(animateValue);
      }
    };

    requestAnimationFrame(animateValue);
  }, [inView, value]);

  return (
    <div ref={ref} className="text-4xl md:text-5xl font-display font-bold text-gradient mb-2">
      {prefix}{displayValue}{suffix}
    </div>
  );
}

function SectionHeading({ eyebrow, title, description }: { eyebrow?: string; title: string; description: string }) {
  return (
    <motion.div {...revealInView} className="max-w-3xl mx-auto text-center mb-14 md:mb-16">
      {eyebrow && (
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full glass text-accent text-sm font-semibold mb-5">
          <Sparkles size={14} />
          {eyebrow}
        </div>
      )}
      <h2 className="text-4xl md:text-5xl font-display font-bold text-foreground mb-4">
        {title}
      </h2>
      <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
        {description}
      </p>
    </motion.div>
  );
}

const pipelineStages = [
  { label: "New Lead", count: 42, color: "bg-cyan-400" },
  { label: "AI Qualified", count: 28, color: "bg-blue-400" },
  { label: "Follow-Up", count: 19, color: "bg-indigo-300" },
  { label: "Appointment", count: 11, color: "bg-amber-300" },
  { label: "Offer Sent", count: 7, color: "bg-emerald-300" },
];

const workflowSteps = [
  { icon: <MessageSquare size={20} />, label: "Seller Inquiry", detail: "Website, PPC, SMS, call" },
  { icon: <Bot size={20} />, label: "AI Intake", detail: "Qualify and enrich lead" },
  { icon: <DatabaseZap size={20} />, label: "CRM Sync", detail: "Route to the right pipeline" },
  { icon: <Calendar size={20} />, label: "Booked Call", detail: "Schedule with reminders" },
];

const testimonials = [
  {
    quote: "Investor Automation OS will become the operating layer for our acquisition team — lead response, nurturing, and pipeline visibility in one place.",
    name: "Acquisitions Director",
    company: "Regional Real Estate Investment Firm",
  },
  {
    quote: "The value is not just automation. It is consistency. Every seller receives a professional response while our team focuses on the highest-intent opportunities.",
    name: "Founder",
    company: "Off-Market Property Buying Company",
  },
  {
    quote: "This is the kind of infrastructure we wanted before scaling ad spend: cleaner data, better follow-up, and fewer manual handoffs.",
    name: "Operations Lead",
    company: "Single-Family Acquisition Team",
  },
];

export default function Home() {
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
        <div className="absolute inset-x-0 top-24 h-px bg-gradient-to-r from-transparent via-accent/50 to-transparent" />

        <div className="container">
          <motion.div
            initial="initial"
            animate="animate"
            variants={staggerContainer}
            className="max-w-5xl mx-auto text-center"
          >
            <motion.div variants={fadeInUp} className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-accent/10 border border-accent/30 mb-6 shadow-[0_0_28px_rgba(0,217,255,0.18)] backdrop-blur-xl">
              <Zap size={16} className="text-accent" />
              <span className="text-sm font-medium text-accent">For Serious Real Estate Investors</span>
            </motion.div>

            {/* Headline Variations for Testing - Hidden by default, uncomment to compare */}
            <div className="space-y-8 mb-12 hidden">
              {/* Variation 1: Results-Focused */}
              <motion.div variants={fadeInUp} className="group">
                <div className="text-xs text-accent/60 mb-2">Option 1: Results-Focused</div>
                <motion.h1 className="text-5xl md:text-7xl lg:text-8xl font-display font-bold text-foreground mb-4 leading-[0.95] group-hover:text-accent/50 transition-colors">
                  Close more deals with <span className="text-gradient">less chaos</span>
                </motion.h1>
                <motion.p className="text-lg md:text-xl text-muted-foreground max-w-3xl mx-auto">
                  Automate lead follow-up, organize your pipeline, and spend less time on admin so you can focus on closing.
                </motion.p>
              </motion.div>

              {/* Variation 2: Premium Direct Response */}
              <motion.div variants={fadeInUp} className="group">
                <div className="text-xs text-accent/60 mb-2">Option 2: Premium Direct Response</div>
                <motion.h1 className="text-5xl md:text-7xl lg:text-8xl font-display font-bold text-foreground mb-4 leading-[0.95] group-hover:text-accent/50 transition-colors">
                  Turn seller leads into <span className="text-gradient">closed deals</span>
                </motion.h1>
                <motion.p className="text-lg md:text-xl text-muted-foreground max-w-3xl mx-auto">
                  Capture inbound leads, nurture them automatically, and book appointments without the manual follow-up grind.
                </motion.p>
              </motion.div>

              {/* Variation 3: Outcome-Driven */}
              <motion.div variants={fadeInUp} className="group">
                <div className="text-xs text-accent/60 mb-2">Option 3: Outcome-Driven</div>
                <motion.h1 className="text-5xl md:text-7xl lg:text-8xl font-display font-bold text-foreground mb-4 leading-[0.95] group-hover:text-accent/50 transition-colors">
                  More seller leads, <span className="text-gradient">faster follow-up</span>
                </motion.h1>
                <motion.p className="text-lg md:text-xl text-muted-foreground max-w-3xl mx-auto">
                  Respond to leads within minutes, not hours. Automate your pipeline so nothing falls through the cracks.
                </motion.p>
              </motion.div>

              {/* Variation 4: High-End Positioning */}
              <motion.div variants={fadeInUp} className="group">
                <div className="text-xs text-accent/60 mb-2">Option 4: High-End Positioning</div>
                <motion.h1 className="text-5xl md:text-7xl lg:text-8xl font-display font-bold text-foreground mb-4 leading-[0.95] group-hover:text-accent/50 transition-colors">
                  The operating system for <span className="text-gradient">investor growth</span>
                </motion.h1>
                <motion.p className="text-lg md:text-xl text-muted-foreground max-w-3xl mx-auto">
                  Systematize your acquisition pipeline. Capture more leads, nurture them automatically, and scale without adding headcount.
                </motion.p>
              </motion.div>

              {/* Variation 5: Investor Pain Point */}
              <motion.div variants={fadeInUp} className="group">
                <div className="text-xs text-accent/60 mb-2">Option 5: Investor Pain Point</div>
                <motion.h1 className="text-5xl md:text-7xl lg:text-8xl font-display font-bold text-foreground mb-4 leading-[0.95] group-hover:text-accent/50 transition-colors">
                  Stop losing deals to <span className="text-gradient">slow follow-up</span>
                </motion.h1>
                <motion.p className="text-lg md:text-xl text-muted-foreground max-w-3xl mx-auto">
                  Automate seller outreach, qualify leads instantly, and book appointments 24/7 while you focus on bigger opportunities.
                </motion.p>
              </motion.div>

              {/* Variation 6: Simplicity + Results */}
              <motion.div variants={fadeInUp} className="group">
                <div className="text-xs text-accent/60 mb-2">Option 6: Simplicity + Results</div>
                <motion.h1 className="text-5xl md:text-7xl lg:text-8xl font-display font-bold text-foreground mb-4 leading-[0.95] group-hover:text-accent/50 transition-colors">
                  Consistent pipeline. <span className="text-gradient">Zero manual work.</span>
                </motion.h1>
                <motion.p className="text-lg md:text-xl text-muted-foreground max-w-3xl mx-auto">
                  Capture leads, automate follow-up, and organize your pipeline in one system. More deals. Less chaos.
                </motion.p>
              </motion.div>
            </div>
            <motion.h1 variants={fadeInUp} className="text-5xl md:text-7xl lg:text-8xl font-display font-bold text-foreground mb-6 leading-[0.95]">
              Turn seller leads into <span className="text-gradient">closed deals</span>
            </motion.h1>

            <motion.p variants={fadeInUp} className="text-lg md:text-xl text-muted-foreground mb-8 max-w-3xl mx-auto">
              Capture inbound leads, automate follow-up, and book appointments without the manual grind. More deals. Less chaos.
            </motion.p>

            <motion.div variants={fadeInUp} className="flex flex-col sm:flex-row gap-4 justify-center mb-10">
              <Link href="/contact" className="w-full">
                <Button className="bg-accent hover:bg-cyan-500 text-background font-semibold px-8 py-6 text-lg h-auto rounded-xl shadow-[0_0_34px_rgba(0,217,255,0.30)] transition-all duration-200 ease-out hover:shadow-[0_0_48px_rgba(0,217,255,0.45)] hover:scale-105 active:scale-95 w-full">
                  Book Your Free Strategy Call
                  <ArrowRight size={18} />
                </Button>
              </Link>
              <Link href="/experience-the-system" className="w-full">
                <Button variant="outline" className="border-accent/50 text-accent hover:bg-accent/10 hover:text-accent font-semibold px-8 py-6 text-lg h-auto rounded-xl bg-background/40 backdrop-blur-xl transition-all duration-200 ease-out hover:border-accent/80 hover:shadow-[0_0_24px_rgba(0,217,255,0.2)] active:scale-95 w-full">
                  Experience The System
                  <ChevronRight size={18} />
                </Button>
              </Link>
            </motion.div>

            <motion.div variants={fadeInUp} className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 max-w-3xl mx-auto mb-12 text-left">
              {[
                "More seller leads",
                "Faster follow-up",
                "Automated pipeline",
                "Booked appointments",
              ].map((item) => (
                <div key={item} className="glass rounded-xl px-4 py-3 flex items-center gap-2 text-sm text-muted-foreground">
                  <CheckCircle2 size={16} className="text-accent shrink-0" />
                  <span>{item}</span>
                </div>
              ))}
            </motion.div>

            <motion.div variants={fadeInUp} className="relative max-w-6xl mx-auto">
              <div className="absolute -inset-4 md:-inset-8 bg-gradient-to-r from-accent/0 via-accent/20 to-indigo-500/0 blur-3xl opacity-80" />
              <div className="relative rounded-[1.75rem] overflow-hidden border border-accent/20 bg-white/[0.03] shadow-2xl shadow-cyan-950/50 dashboard-shell">
                <div className="absolute inset-x-0 top-0 h-12 bg-gradient-to-b from-white/10 to-transparent z-10" />
                <img
                  src="https://d2xsxph8kpxj0f.cloudfront.net/310519663569019027/d3Ygw65BjdqTKvfaHVio5Q/dashboard-mockup-hero-FvFJtpf2ZP56QP2vuBnkB8.webp"
                  alt="Investor Automation OS dashboard preview"
                  className="w-full h-auto"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-transparent" />

                <motion.div
                  initial={{ opacity: 0, x: -18, y: 12 }}
                  animate={{ opacity: 1, x: 0, y: 0 }}
                  transition={{ duration: 0.7, delay: 0.85 }}
                  className="hidden md:block absolute left-6 bottom-8 w-72 glass rounded-2xl p-5 text-left shadow-2xl"
                >
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-sm text-muted-foreground">Live lead routing</span>
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.8)]" />
                  </div>
                  <div className="space-y-3">
                    {pipelineStages.slice(0, 3).map((stage) => (
                      <div key={stage.label} className="flex items-center justify-between gap-3 text-sm">
                        <span className="text-foreground">{stage.label}</span>
                        <div className="flex items-center gap-2">
                          <div className="w-20 h-1.5 rounded-full bg-white/10 overflow-hidden">
                            <div className={`h-full ${stage.color}`} style={{ width: `${Math.min(stage.count * 2, 92)}%` }} />
                          </div>
                          <span className="text-accent font-semibold w-6 text-right">{stage.count}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, x: 18, y: -12 }}
                  animate={{ opacity: 1, x: 0, y: 0 }}
                  transition={{ duration: 0.7, delay: 1 }}
                  className="hidden lg:block absolute right-6 top-20 w-64 glass rounded-2xl p-5 text-left shadow-2xl"
                >
                  <div className="flex items-center gap-3 mb-3">
                    <div className="h-10 w-10 rounded-xl bg-accent/15 text-accent flex items-center justify-center">
                      <Bot size={20} />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-foreground leading-tight">AI Follow-up Active</p>
                      <p className="text-xs text-muted-foreground">Next touch in 12 min</p>
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground">Seller sequence personalized using motivation, timeline, property type, and campaign source.</p>
                </motion.div>
              </div>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* Trust Strip */}
      <section className="relative py-8 bg-background border-y border-white/10">
        <div className="container">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
            {[
              { icon: <ShieldCheck size={18} />, text: "Built for investor teams" },
              { icon: <Clock3 size={18} />, text: "Always-on follow-up" },
              { icon: <BadgeCheck size={18} />, text: "Clean CRM handoffs" },
              { icon: <LineChart size={18} />, text: "Acquisition visibility" },
            ].map((item) => (
              <div key={item.text} className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <span className="text-accent">{item.icon}</span>
                <span>{item.text}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pain Points Section */}
      <section className="py-20 md:py-32 bg-secondary/70 relative section-grid">
        <div className="container relative">
          <SectionHeading
            eyebrow="Revenue leaks automation can fix"
            title="The Investor's Challenge"
            description="Most acquisition teams do not lose deals because they lack leads. They lose because response time, follow-up quality, and pipeline discipline break down as volume increases."
          />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8">
            {[
              {
                icon: <MessageSquare size={32} />,
                title: "Lost Leads",
                description: "Seller inquiries slip through the cracks when speed-to-lead depends on manual checking, fragmented inboxes, and inconsistent ownership.",
              },
              {
                icon: <Smartphone size={32} />,
                title: "Manual Workflows",
                description: "Your team spends hours sending reminders, logging notes, copying data, and chasing status updates instead of negotiating deals.",
              },
              {
                icon: <TrendingUp size={32} />,
                title: "Scaling Friction",
                description: "More campaigns create more operational complexity unless your follow-up, routing, and reporting systems can scale with you.",
              },
            ].map((item, i) => (
              <motion.div
                key={item.title}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: i * 0.1 }}
                viewport={{ once: true, margin: "-80px" }}
                className="p-8 rounded-2xl glass-card hover-lift group"
              >
                <div className="h-12 w-12 rounded-xl bg-accent/10 text-accent mb-5 flex items-center justify-center group-hover:scale-110 transition-transform duration-300">{item.icon}</div>
                <h3 className="text-xl font-display font-bold text-foreground mb-3">{item.title}</h3>
                <p className="text-muted-foreground text-base md:text-base">{item.description}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Solutions Section */}
      <section className="py-20 md:py-32 bg-background relative overflow-hidden">
        <div className="absolute right-0 top-1/4 h-96 w-96 rounded-full bg-accent/10 blur-3xl" />
        <div className="container relative">
          <SectionHeading
            eyebrow="A connected acquisition layer"
            title="Automation Solutions"
            description="Investor Automation OS connects the moving parts of your acquisition machine so every lead receives the right action at the right time."
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8">
            {[
              {
                icon: <BarChart3 size={32} />,
                title: "Lead Capture & CRM",
                description: "Capture inbound leads from ads, forms, calls, and messages, then route them into a unified investor-focused pipeline.",
              },
              {
                icon: <MessageSquare size={32} />,
                title: "SMS & Email Automation",
                description: "Trigger instant replies, nurture campaigns, appointment reminders, and reactivation sequences without sounding robotic.",
              },
              {
                icon: <Calendar size={32} />,
                title: "Appointment Booking",
                description: "Convert qualified seller interest into booked calls with calendar automation, reminders, and missed-call text-back flows.",
              },
              {
                icon: <Bot size={32} />,
                title: "AI-Powered Workflows",
                description: "Use AI to summarize conversations, classify seller motivation, generate next steps, and support smarter acquisition decisions.",
              },
            ].map((item, i) => (
              <motion.div
                key={item.title}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: i * 0.1 }}
                viewport={{ once: true, margin: "-80px" }}
                className="p-8 rounded-2xl glass-card hover-lift group relative overflow-hidden"
              >
                <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="text-accent mb-5 group-hover:scale-110 transition-transform duration-300">{item.icon}</div>
                <h3 className="text-xl font-display font-bold text-foreground mb-3">{item.title}</h3>
                <p className="text-muted-foreground text-base md:text-base">{item.description}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Workflow Visualization Section */}
      <section className="py-20 md:py-32 bg-secondary/70 relative section-grid">
        <div className="container relative">
          <SectionHeading
            eyebrow="From first touch to booked appointment"
            title="How It Works"
            description="Automated intake, qualification, routing, and follow-up move leads through the pipeline while your team stays focused on high-value conversations."
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            whileInView={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.75, ease: "easeOut" }}
            viewport={{ once: true, margin: "-80px" }}
            className="rounded-[1.75rem] glass-card p-5 md:p-8 overflow-hidden"
          >
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.15fr] gap-8 items-center">
              <div className="space-y-4">
                {workflowSteps.map((step, i) => (
                  <motion.div
                    key={step.label}
                    initial={{ opacity: 0, x: -20 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.55, delay: i * 0.1 }}
                    viewport={{ once: true }}
                    className="relative glass rounded-2xl p-5 flex items-center gap-4"
                  >
                    <div className="h-11 w-11 rounded-xl bg-accent/15 text-accent flex items-center justify-center shrink-0">
                      {step.icon}
                    </div>
                    <div>
                      <h3 className="text-lg font-display font-semibold text-foreground">{step.label}</h3>
                      <p className="text-sm md:text-base text-muted-foreground">{step.detail}</p>
                    </div>
                    {i < workflowSteps.length - 1 && <div className="hidden lg:block absolute -bottom-4 left-10 h-4 w-px bg-accent/30" />}
                  </motion.div>
                ))}
              </div>

              <div className="relative rounded-2xl overflow-hidden border border-accent/20 glow-cyan-lg bg-background/60">
                <img
                  src="https://d2xsxph8kpxj0f.cloudfront.net/310519663569019027/d3Ygw65BjdqTKvfaHVio5Q/automation-flow-diagram-m58qBnGEchZnWcgcD8UYcT.webp"
                  alt="Automation workflow visualization"
                  className="w-full h-auto opacity-90"
                />
                <div className="absolute inset-0 bg-gradient-to-tr from-background/70 via-transparent to-accent/10" />
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* CRM Pipeline Section */}
      <section className="py-20 md:py-32 bg-background relative overflow-hidden">
        <div className="container relative">
          <SectionHeading
            eyebrow="Pipeline clarity for every campaign"
            title="Real Estate Investor Pipeline"
            description="Visualize seller opportunities, acquisition activity, and automated next steps in one intelligent operating view."
          />

          <div className="grid grid-cols-1 lg:grid-cols-[0.95fr_1.25fr] gap-8 items-center">
            <motion.div {...revealInView} className="space-y-5">
              {pipelineStages.map((stage, i) => (
                <div key={stage.label} className="glass rounded-2xl p-5">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <span className={`h-3 w-3 rounded-full ${stage.color} shadow-[0_0_14px_rgba(0,217,255,0.5)]`} />
                      <span className="font-display font-semibold text-foreground">{stage.label}</span>
                    </div>
                    <span className="text-accent font-semibold">{stage.count} leads</span>
                  </div>
                  <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      whileInView={{ width: `${Math.min(stage.count * 2, 96)}%` }}
                      transition={{ duration: 0.9, delay: i * 0.08 }}
                      viewport={{ once: true }}
                      className={`h-full ${stage.color}`}
                    />
                  </div>
                </div>
              ))}
            </motion.div>

            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              whileInView={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.75, ease: "easeOut" }}
              viewport={{ once: true, margin: "-80px" }}
              className="rounded-[1.75rem] overflow-hidden border border-accent/20 glow-cyan-lg relative bg-white/[0.03]"
            >
              <img
                src="https://d2xsxph8kpxj0f.cloudfront.net/310519663569019027/d3Ygw65BjdqTKvfaHVio5Q/crm-pipeline-visual-ZWHxjVrsaaPExXjkdX9wuv.webp"
                alt="CRM pipeline dashboard"
                className="w-full h-auto"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-background/80 via-transparent to-transparent" />
            </motion.div>
          </div>
        </div>
      </section>

      {/* Results Section */}
      <section className="py-20 md:py-32 bg-secondary/70 relative section-grid">
        <div className="container relative">
          <SectionHeading
            eyebrow="Operational lift, not vanity metrics"
            title="What You'll Achieve"
            description="A premium automation layer designed to improve response speed, consistency, visibility, and team capacity."
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              { value: 5, suffix: "x", label: "Faster lead response", note: "Respond while seller intent is highest." },
              { value: 60, suffix: "%", label: "Less admin work", note: "Reduce repetitive handoffs and manual logging." },
              { value: 40, suffix: "%", label: "More qualified calls", note: "Prioritize motivated sellers faster." },
              { value: 24, suffix: "/7", label: "Follow-up coverage", note: "Automation keeps sequences moving after hours." },
            ].map((item, i) => (
              <motion.div
                key={item.label}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: i * 0.1 }}
                viewport={{ once: true, margin: "-80px" }}
                className="p-7 rounded-2xl glass-card text-center hover-lift"
              >
                <AnimatedCounter value={item.value} suffix={item.suffix} />
                <h3 className="text-lg font-display font-semibold text-foreground mb-2">{item.label}</h3>
                <p className="text-sm md:text-base text-muted-foreground">{item.note}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials / Trust Section */}
      <section className="py-20 md:py-32 bg-background relative overflow-hidden">
        <div className="absolute left-1/2 top-0 h-80 w-[44rem] -translate-x-1/2 rounded-full bg-accent/10 blur-3xl" />
        <div className="container relative">
          <SectionHeading
            eyebrow="Built for serious acquisition teams"
            title="Trust Signals & Client Voice"
            description="Placeholder testimonial language is ready for replacement with verified customer quotes as Investor Automation OS moves into public launch."
          />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8">
            {testimonials.map((testimonial, i) => (
              <motion.figure
                key={testimonial.name}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: i * 0.1 }}
                viewport={{ once: true, margin: "-80px" }}
                className="glass-card rounded-2xl p-7 hover-lift"
              >
                <div className="flex items-center gap-1 text-accent mb-5" aria-label="Five star placeholder rating">
                  {Array.from({ length: 5 }).map((_, starIndex) => (
                    <span key={starIndex} className="h-1.5 w-6 rounded-full bg-accent/70" />
                  ))}
                </div>
                <blockquote className="text-muted-foreground mb-6 text-base md:text-base">
                  “{testimonial.quote}”
                </blockquote>
                <figcaption>
                  <div className="font-display font-semibold text-foreground">{testimonial.name}</div>
                  <div className="text-sm text-muted-foreground">{testimonial.company}</div>
                </figcaption>
              </motion.figure>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA Section */}
      <section className="py-20 md:py-32 bg-background relative overflow-hidden">
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
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-accent/10 border border-accent/30 mb-6 text-accent text-sm font-semibold">
                <Users size={16} />
                Designed for growing real estate investor teams
              </div>
              <h2 className="text-4xl md:text-6xl font-display font-bold text-foreground mb-6">
                Ready to build your acquisition operating system?
              </h2>
              <p className="text-lg text-muted-foreground mb-8 max-w-2xl mx-auto">
                Book a strategy call to map your current lead flow, identify automation gaps, and design the next version of your investor operations stack.
              </p>
              <div className="flex flex-col sm:flex-row justify-center gap-4">
                <Link href="/contact">
                  <Button className="bg-accent hover:bg-cyan-500 text-background font-semibold px-8 py-6 text-lg h-auto rounded-xl shadow-[0_0_34px_rgba(0,217,255,0.30)] w-full">
                    Schedule Your Strategy Call
                    <ArrowRight size={18} />
                  </Button>
                </Link>
                <Link href="/how-it-works">
                  <Button variant="outline" className="border-white/15 text-foreground hover:text-accent hover:bg-white/5 font-semibold px-8 py-6 text-lg h-auto rounded-xl w-full">
                    Explore How It Works
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
