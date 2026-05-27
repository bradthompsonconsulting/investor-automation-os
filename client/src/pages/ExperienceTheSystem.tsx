import { motion, AnimatePresence } from "framer-motion";
import { Link } from "wouter";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  MessageSquare,
  Calendar,
  TrendingUp,
  Zap,
  Phone,
  Mail,
  AlertCircle,
  Play,
  Pause,
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

// Realistic fake investor lead data
const fakeLead = {
  id: 1,
  name: "Sarah Mitchell",
  phone: "(512) 555-0142",
  email: "sarah.mitchell@email.com",
  property: "1247 Oak Ridge Dr, Austin, TX 78704",
  propertyType: "Single Family",
  condition: "Fair",
  motivation: "Inherited Property",
  timeline: "30 days",
  dealValue: "$285,000",
};

const fakeLead2 = {
  id: 2,
  name: "Marcus Johnson",
  phone: "(512) 555-0187",
  email: "marcus.j@email.com",
  property: "3456 Riverside Ave, Austin, TX 78702",
  propertyType: "Multi-Unit (4-plex)",
  condition: "Needs Repairs",
  motivation: "Tired Landlord",
  timeline: "60 days",
  dealValue: "$450,000",
};

const fakeLead3 = {
  id: 3,
  name: "Jennifer Lee",
  phone: "(512) 555-0203",
  email: "j.lee.properties@email.com",
  property: "5678 Elm Street, Austin, TX 78722",
  propertyType: "Vacant Land",
  condition: "Vacant",
  motivation: "Foreclosure Risk",
  timeline: "14 days",
  dealValue: "$165,000",
};

const pipelineStages = [
  { label: "New Lead", color: "bg-cyan-400", icon: <AlertCircle size={16} /> },
  { label: "Contacted", color: "bg-blue-400", icon: <Phone size={16} /> },
  { label: "Qualified", color: "bg-indigo-400", icon: <CheckCircle2 size={16} /> },
  { label: "Appointment", color: "bg-amber-400", icon: <Calendar size={16} /> },
  { label: "Offer Sent", color: "bg-emerald-400", icon: <TrendingUp size={16} /> },
];

function LeadCard({ lead, stage, isActive }: { lead: typeof fakeLead; stage: number; isActive: boolean }) {
  const currentStage = pipelineStages[stage];

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      transition={{ duration: 0.4 }}
      className={`rounded-xl glass-card p-5 border-l-4 transition-all duration-300 ${
        isActive ? "ring-2 ring-accent shadow-lg shadow-cyan-500/30" : ""
      } ${currentStage.color.replace("bg-", "border-")}`}
    >
      <div className="flex items-start justify-between mb-3">
        <div>
          <h4 className="font-display font-bold text-foreground text-sm">{lead.name}</h4>
          <p className="text-xs text-muted-foreground">{lead.property}</p>
        </div>
        <div className={`h-6 w-6 rounded-full ${currentStage.color} flex items-center justify-center text-background text-xs font-bold`}>
          {stage + 1}
        </div>
      </div>

      <div className="space-y-2 mb-4 text-xs">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Phone size={12} />
          <span>{lead.phone}</span>
        </div>
        <div className="flex items-center gap-2 text-muted-foreground">
          <Mail size={12} />
          <span>{lead.email}</span>
        </div>
        <div className="flex items-center gap-2 text-muted-foreground">
          <Zap size={12} />
          <span className="text-accent font-semibold">{lead.motivation}</span>
        </div>
      </div>

      <div className="flex items-center justify-between pt-3 border-t border-white/10">
        <span className="text-xs font-semibold text-accent">{currentStage.label}</span>
        <span className="text-xs text-muted-foreground">{lead.dealValue}</span>
      </div>
    </motion.div>
  );
}

export default function DemoCase() {
  const [isPlaying, setIsPlaying] = useState(true);
  const [lead1Stage, setLead1Stage] = useState(0);
  const [lead2Stage, setLead2Stage] = useState(0);
  const [lead3Stage, setLead3Stage] = useState(0);
  const [notifications, setNotifications] = useState<Array<{ id: string; text: string }>>([]);

  // Auto-play animation loop
  useEffect(() => {
    if (!isPlaying) return;

    const interval = setInterval(() => {
      setLead1Stage((prev) => (prev < 4 ? prev + 1 : 0));
      setLead2Stage((prev) => (prev < 4 ? prev + 1 : 0));
      setLead3Stage((prev) => (prev < 4 ? prev + 1 : 0));

      // Add random notifications
      const notifMessages = [
        "SMS sent to Sarah Mitchell",
        "Lead qualified: Marcus Johnson",
        "Appointment scheduled: Jennifer Lee",
        "Offer sent to Sarah Mitchell",
      ];
      const randomNotif = notifMessages[Math.floor(Math.random() * notifMessages.length)];
      const notifId = Math.random().toString();
      setNotifications((prev) => [...prev, { id: notifId, text: randomNotif }]);

      setTimeout(() => {
        setNotifications((prev) => prev.filter((n) => n.id !== notifId));
      }, 3000);
    }, 3500);

    return () => clearInterval(interval);
  }, [isPlaying]);

  const advanceLead = (leadNum: number) => {
    if (leadNum === 1) setLead1Stage((prev) => (prev < 4 ? prev + 1 : 0));
    if (leadNum === 2) setLead2Stage((prev) => (prev < 4 ? prev + 1 : 0));
    if (leadNum === 3) setLead3Stage((prev) => (prev < 4 ? prev + 1 : 0));
  };

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
              <Zap size={16} className="text-accent" />
              <span className="text-sm font-medium text-accent">Interactive Demo</span>
            </motion.div>

            <motion.h1 variants={fadeInUp} className="text-4xl md:text-5xl lg:text-6xl font-display font-bold text-foreground mb-6 leading-[0.95]">
              See The System <span className="text-gradient">In Action</span>
            </motion.h1>

            <motion.p variants={fadeInUp} className="text-lg md:text-xl text-muted-foreground mb-8 max-w-3xl mx-auto">
              Watch multiple leads flow through the acquisition machine simultaneously. Click to advance any lead through the pipeline or let the system run automatically.
            </motion.p>

            <motion.div variants={fadeInUp} className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link href="/how-it-works" className="w-full sm:w-auto">
                <Button className="bg-accent hover:bg-cyan-500 text-background font-semibold px-8 py-6 text-lg h-auto rounded-xl shadow-[0_0_34px_rgba(0,217,255,0.30)] transition-all duration-200 ease-out hover:shadow-[0_0_48px_rgba(0,217,255,0.45)] hover:scale-105 active:scale-95 w-full">
                  Learn The Full System
                  <ArrowRight size={18} />
                </Button>
              </Link>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* Live Demo Section */}
      <section className="py-20 md:py-32 bg-secondary/70 relative section-grid">
        <div className="container relative">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.65 }}
            viewport={{ once: true, margin: "-80px" }}
            className="mb-12"
          >
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-4xl md:text-5xl font-display font-bold text-foreground">
                Multiple Leads, Simultaneous Flow
              </h2>
              <button
                onClick={() => setIsPlaying(!isPlaying)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-accent/10 border border-accent/30 text-accent hover:bg-accent/20 transition-colors"
              >
                {isPlaying ? <Pause size={18} /> : <Play size={18} />}
                <span className="text-sm font-semibold">{isPlaying ? "Pause" : "Play"}</span>
              </button>
            </div>
            <p className="text-lg text-muted-foreground max-w-2xl">
              Three real investor leads moving through your acquisition pipeline. Click any lead card to advance it to the next stage.
            </p>
          </motion.div>

          {/* Pipeline Visualization */}
          <div className="mb-12">
            <div className="flex flex-wrap gap-2 mb-8 justify-center">
              {pipelineStages.map((stage, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, scale: 0.8 }}
                  whileInView={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.4, delay: i * 0.05 }}
                  viewport={{ once: true }}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg glass-card"
                >
                  <div className={`h-3 w-3 rounded-full ${stage.color}`} />
                  <span className="text-sm font-semibold text-foreground">{stage.label}</span>
                </motion.div>
              ))}
            </div>
          </div>

          {/* Lead Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.65 }}
              viewport={{ once: true }}
              onClick={() => advanceLead(1)}
              className="cursor-pointer hover:scale-105 transition-transform duration-300"
            >
              <LeadCard lead={fakeLead} stage={lead1Stage} isActive={true} />
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.65, delay: 0.1 }}
              viewport={{ once: true }}
              onClick={() => advanceLead(2)}
              className="cursor-pointer hover:scale-105 transition-transform duration-300"
            >
              <LeadCard lead={fakeLead2} stage={lead2Stage} isActive={true} />
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.65, delay: 0.2 }}
              viewport={{ once: true }}
              onClick={() => advanceLead(3)}
              className="cursor-pointer hover:scale-105 transition-transform duration-300"
            >
              <LeadCard lead={fakeLead3} stage={lead3Stage} isActive={true} />
            </motion.div>
          </div>

          {/* Notifications Feed */}
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            whileInView={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.75, ease: "easeOut" }}
            viewport={{ once: true, margin: "-80px" }}
            className="rounded-2xl glass-card p-6 md:p-8 border border-accent/20"
          >
            <h3 className="text-lg font-display font-bold text-foreground mb-4 flex items-center gap-2">
              <div className="text-accent">
                <Bell size={20} />
              </div>
              System Activity Feed
            </h3>
            <div className="space-y-3 h-32 overflow-y-auto">
              <AnimatePresence>
                {notifications.length === 0 ? (
                  <div className="text-muted-foreground text-sm">
                    Waiting for automation events...
                  </div>
                ) : (
                  notifications.map((notif) => (
                    <motion.div
                      key={notif.id}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 20 }}
                      transition={{ duration: 0.3 }}
                      className="flex items-center gap-3 px-4 py-2 rounded-lg bg-accent/10 border border-accent/30 text-sm text-accent"
                    >
                      <CheckCircle2 size={16} />
                      {notif.text}
                    </motion.div>
                  ))
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        </div>
      </section>

      {/* What's Happening Section */}
      <section className="py-20 md:py-32 bg-background relative overflow-hidden">
        <div className="absolute right-0 top-1/4 h-96 w-96 rounded-full bg-accent/10 blur-3xl" />
        <div className="container relative">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.65 }}
            viewport={{ once: true, margin: "-80px" }}
            className="max-w-3xl mx-auto text-center mb-14"
          >
            <h2 className="text-4xl md:text-5xl font-display font-bold text-foreground mb-4">
              Behind The Scenes
            </h2>
            <p className="text-lg text-muted-foreground">
              Here's what the system is doing automatically as leads move through each stage.
            </p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8">
            {[
              {
                stage: "New Lead",
                icon: <AlertCircle size={28} />,
                actions: [
                  "Lead captured from form submission",
                  "Data validated and enriched",
                  "Lead scored automatically",
                  "SMS welcome message sent",
                ],
              },
              {
                stage: "Contacted",
                icon: <Phone size={28} />,
                actions: [
                  "Phone call logged in CRM",
                  "Call notes auto-transcribed",
                  "Seller motivation recorded",
                  "Follow-up email triggered",
                ],
              },
              {
                stage: "Qualified",
                icon: <CheckCircle2 size={28} />,
                actions: [
                  "Lead meets acquisition criteria",
                  "Moved to hot leads list",
                  "Appointment offer sent",
                  "Calendar sync initiated",
                ],
              },
              {
                stage: "Appointment",
                icon: <Calendar size={28} />,
                actions: [
                  "Meeting scheduled in calendar",
                  "Reminder SMS sent (24h before)",
                  "Pre-call brief generated",
                  "Offer template prepared",
                ],
              },
            ].map((item, i) => (
              <motion.div
                key={item.stage}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: i * 0.08 }}
                viewport={{ once: true, margin: "-80px" }}
                className="p-8 rounded-2xl glass-card hover-lift group"
              >
                <div className="h-12 w-12 rounded-xl bg-accent/10 text-accent mb-5 flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                  {item.icon}
                </div>
                <h3 className="text-xl font-display font-bold text-foreground mb-4">{item.stage}</h3>
                <ul className="space-y-2">
                  {item.actions.map((action, j) => (
                    <li key={j} className="flex items-start gap-3 text-sm text-muted-foreground">
                      <CheckCircle2 size={14} className="text-accent shrink-0 mt-0.5" />
                      {action}
                    </li>
                  ))}
                </ul>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Results Section */}
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
              The Result: Your Business Runs Automatically
            </h2>
            <p className="text-lg text-muted-foreground">
              While you focus on deals, the system handles lead flow, qualification, and follow-up.
            </p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8">
            {[
              {
                metric: "5x",
                label: "Faster Lead Response",
                description: "Sellers get instant SMS, not delayed emails",
              },
              {
                metric: "100%",
                label: "Lead Capture",
                description: "No leads slip through the cracks",
              },
              {
                metric: "60%",
                label: "Less Admin Work",
                description: "Automation handles data entry and follow-up",
              },
              {
                metric: "24/7",
                label: "Continuous Operation",
                description: "System works while you sleep",
              },
              {
                metric: "3x",
                label: "More Qualified Calls",
                description: "AI pre-qualifies before your team calls",
              },
              {
                metric: "40%",
                label: "More Deals Closed",
                description: "Better follow-up = higher conversion",
              },
            ].map((item, i) => (
              <motion.div
                key={item.label}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: i * 0.08 }}
                viewport={{ once: true, margin: "-80px" }}
                className="p-8 rounded-2xl glass-card text-center hover-lift"
              >
                <div className="text-5xl md:text-6xl font-display font-bold text-gradient mb-3">
                  {item.metric}
                </div>
                <h3 className="text-lg font-display font-bold text-foreground mb-2">{item.label}</h3>
                <p className="text-muted-foreground text-sm">{item.description}</p>
              </motion.div>
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
              <h2 className="text-4xl md:text-6xl font-display font-bold text-foreground mb-6">
                Ready to automate your acquisition machine?
              </h2>
              <p className="text-lg text-muted-foreground mb-8 max-w-2xl mx-auto">
                See how Investor Automation OS transforms lead flow, eliminates manual work, and scales your business.
              </p>
              <div className="flex flex-col sm:flex-row justify-center gap-4">
                <Link href="/contact">
                  <Button className="bg-accent hover:bg-cyan-500 text-background font-semibold px-8 py-6 text-lg h-auto rounded-xl shadow-[0_0_34px_rgba(0,217,255,0.30)] w-full">
                    Book Your Demo
                    <ArrowRight size={18} />
                  </Button>
                </Link>
                <Link href="/implementation-tiers">
                  <Button variant="outline" className="border-white/15 text-foreground hover:text-accent hover:bg-white/5 font-semibold px-8 py-6 text-lg h-auto rounded-xl w-full">
                    See Pricing Tiers
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

function Bell({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}
