import { motion, useInView } from "framer-motion";
import { Link } from "wouter";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";
import {
  ArrowRight,
  Database,
  CheckCircle2,
  MessageSquare,
  Zap,
  Users,
  Calendar,
  TrendingUp,
  Bell,
  Mail,
  Smartphone,
  BarChart3,
  GitBranch,
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

const revealInView = {
  initial: { opacity: 0, y: 28 },
  whileInView: { opacity: 1, y: 0 },
  transition: { duration: 0.65, ease: "easeOut" },
  viewport: { once: true, margin: "-80px" },
} as const;

// 11-step acquisition machine flow
const acquisitionSteps = [
  {
    number: "01",
    title: "Get Data From Lead Sources",
    description: "Capture inbound leads from websites, PPC campaigns, SMS inquiries, referrals, and direct calls.",
    icon: <Database size={32} />,
    color: "from-cyan-400 to-cyan-500",
  },
  {
    number: "02",
    title: "Scrub & Validate Lead Data",
    description: "Automatically clean, validate, and enrich lead information to ensure accuracy and completeness.",
    icon: <CheckCircle2 size={32} />,
    color: "from-blue-400 to-blue-500",
  },
  {
    number: "03",
    title: "Automated Email & SMS Campaign Launch",
    description: "Trigger personalized outreach sequences based on lead source, property type, and seller motivation.",
    icon: <Mail size={32} />,
    color: "from-indigo-400 to-indigo-500",
  },
  {
    number: "04",
    title: "Lead Capture",
    description: "Leads enter the system and are immediately logged in your unified investor CRM.",
    icon: <BarChart3 size={32} />,
    color: "from-purple-400 to-purple-500",
  },
  {
    number: "05",
    title: "Instant SMS Response",
    description: "Sellers receive immediate SMS confirmation, creating the impression of a responsive team.",
    icon: <Smartphone size={32} />,
    color: "from-pink-400 to-pink-500",
  },
  {
    number: "06",
    title: "Seller Qualification",
    description: "AI analyzes seller motivation, property details, and timeline to prioritize high-intent opportunities.",
    icon: <Zap size={32} />,
    color: "from-orange-400 to-orange-500",
  },
  {
    number: "07",
    title: "Appointment Scheduling",
    description: "Qualified leads are automatically offered appointment times and added to your calendar.",
    icon: <Calendar size={32} />,
    color: "from-amber-400 to-amber-500",
  },
  {
    number: "08",
    title: "Automated Follow-Up",
    description: "Multi-touch email and SMS sequences nurture leads until they book or opt out.",
    icon: <MessageSquare size={32} />,
    color: "from-yellow-400 to-yellow-500",
  },
  {
    number: "09",
    title: "Pipeline Movement",
    description: "Leads automatically advance through stages based on engagement, qualification, and status.",
    icon: <GitBranch size={32} />,
    color: "from-green-400 to-green-500",
  },
  {
    number: "10",
    title: "Team Notifications",
    description: "Your team receives real-time alerts for qualified leads, booked appointments, and urgent actions.",
    icon: <Bell size={32} />,
    color: "from-teal-400 to-teal-500",
  },
  {
    number: "11",
    title: "Long-Term Drip Email & SMS Campaigns",
    description: "Nurture campaigns continue automatically, keeping your business top-of-mind for future acquisitions.",
    icon: <TrendingUp size={32} />,
    color: "from-cyan-400 to-cyan-500",
  },
];

function StepCard({ step, index }: { step: typeof acquisitionSteps[0]; index: number }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 24 }}
      animate={inView ? { opacity: 1, y: 0 } : { opacity: 0, y: 24 }}
      transition={{ duration: 0.65, delay: index * 0.05 }}
      className="relative group"
    >
      <div className="absolute -inset-0.5 bg-gradient-to-r opacity-0 group-hover:opacity-100 rounded-2xl blur transition duration-300" style={{ backgroundImage: `linear-gradient(135deg, var(--tw-gradient-stops))` }} />
      <div className="relative rounded-2xl glass-card p-6 md:p-8 hover-lift h-full">
        {/* Step number badge */}
        <div className="absolute -top-4 -right-4 h-12 w-12 rounded-full bg-gradient-to-br from-cyan-400 to-cyan-500 flex items-center justify-center font-display font-bold text-background text-sm shadow-lg shadow-cyan-500/50">
          {step.number}
        </div>

        {/* Icon */}
        <div className={`h-14 w-14 rounded-xl bg-gradient-to-br ${step.color} text-background flex items-center justify-center mb-5 group-hover:scale-110 transition-transform duration-300`}>
          {step.icon}
        </div>

        {/* Content */}
        <h3 className="text-xl md:text-lg font-display font-bold text-foreground mb-3">
          {step.title}
        </h3>
        <p className="text-muted-foreground text-base md:text-sm leading-relaxed">
          {step.description}
        </p>

        {/* Connection line to next step (on desktop) */}
        {index < acquisitionSteps.length - 1 && (
          <div className="hidden lg:block absolute -bottom-8 left-1/2 -translate-x-1/2 w-0.5 h-8 bg-gradient-to-b from-accent/50 to-transparent" />
        )}
      </div>
    </motion.div>
  );
}

export default function HowItWorks() {
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
              <span className="text-sm font-medium text-accent">The Acquisition Machine</span>
            </motion.div>

            <motion.h1 variants={fadeInUp} className="text-4xl md:text-5xl lg:text-6xl font-display font-bold text-foreground mb-6 leading-[0.95]">
              How The System <span className="text-gradient">Operates Automatically</span>
            </motion.h1>

            <motion.p variants={fadeInUp} className="text-lg md:text-xl text-muted-foreground mb-8 max-w-3xl mx-auto">
              An 11-step automated workflow that captures seller leads, qualifies them, books appointments, and nurtures long-term relationships—all without manual intervention.
            </motion.p>

            <motion.div variants={fadeInUp} className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link href="/demo" className="w-full sm:w-auto">
                <Button className="bg-accent hover:bg-cyan-500 text-background font-semibold px-8 py-6 text-lg h-auto rounded-xl shadow-[0_0_34px_rgba(0,217,255,0.30)] transition-all duration-200 ease-out hover:shadow-[0_0_48px_rgba(0,217,255,0.45)] hover:scale-105 active:scale-95 w-full">
                  See It In Action
                  <ArrowRight size={18} />
                </Button>
              </Link>
              <Link href="/contact" className="w-full sm:w-auto">
                <Button variant="outline" className="border-accent/50 text-accent hover:bg-accent/10 font-semibold px-8 py-6 text-lg h-auto rounded-xl bg-background/40 backdrop-blur-xl transition-all duration-200 ease-out hover:border-accent/80 w-full">
                  Book A Strategy Call
                </Button>
              </Link>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* 11-Step Acquisition Machine Flow */}
      <section className="py-20 md:py-32 bg-secondary/70 relative section-grid">
        <div className="container relative">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.65 }}
            viewport={{ once: true, margin: "-80px" }}
            className="max-w-2xl mx-auto text-center mb-16"
          >
            <h2 className="text-4xl md:text-5xl font-display font-bold text-foreground mb-4">
              The Complete Acquisition Workflow
            </h2>
            <p className="text-lg text-muted-foreground">
              From first touch to long-term nurturing, every step is automated and optimized for investor success.
            </p>
          </motion.div>

          {/* Grid of 11 steps */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8">
            {acquisitionSteps.map((step, index) => (
              <StepCard key={step.number} step={step} index={index} />
            ))}
          </div>
        </div>
      </section>

      {/* Mission Control Visualization Section */}
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
              Mission Control Dashboard
            </h2>
            <p className="text-lg text-muted-foreground">
              Real-time visibility into every stage of your acquisition machine. Monitor lead flow, automation activity, and team performance in one unified interface.
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            whileInView={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.75, ease: "easeOut" }}
            viewport={{ once: true, margin: "-80px" }}
            className="rounded-[1.75rem] overflow-hidden border border-accent/20 glow-cyan-lg bg-white/[0.03] shadow-2xl"
          >
            <div className="aspect-video bg-gradient-to-br from-background/80 via-background/60 to-accent/5 flex items-center justify-center relative">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(0,217,255,0.1),transparent_70%)]" />
              <div className="text-center relative z-10">
                <div className="inline-flex items-center justify-center h-16 w-16 rounded-full bg-accent/10 text-accent mb-4">
                  <BarChart3 size={32} />
                </div>
                <p className="text-muted-foreground text-lg">Dashboard mockup area</p>
                <p className="text-muted-foreground text-sm mt-2">Real-time lead flow, automation metrics, and team activity</p>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Key Outcomes Section */}
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
              What This Automation Delivers
            </h2>
            <p className="text-lg text-muted-foreground">
              The system removes operational chaos and creates consistent, predictable acquisition results.
            </p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8">
            {[
              {
                icon: <Zap size={28} />,
                title: "5x Faster Response",
                description: "Sellers receive instant SMS and email responses, dramatically increasing conversion rates.",
              },
              {
                icon: <CheckCircle2 size={28} />,
                title: "Zero Missed Leads",
                description: "Every inbound inquiry is captured, qualified, and tracked automatically.",
              },
              {
                icon: <Users size={28} />,
                title: "Scale Without Hiring",
                description: "Handle 10x more leads with the same team size through automation.",
              },
              {
                icon: <Calendar size={28} />,
                title: "24/7 Follow-Up",
                description: "Automated sequences work around the clock, keeping your pipeline moving.",
              },
              {
                icon: <TrendingUp size={28} />,
                title: "Predictable Pipeline",
                description: "Consistent lead flow and qualification means more predictable deal volume.",
              },
              {
                icon: <Bell size={28} />,
                title: "Real-Time Visibility",
                description: "Know exactly where every lead is in your acquisition machine at all times.",
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
                <h3 className="text-xl font-display font-bold text-foreground mb-3">{item.title}</h3>
                <p className="text-muted-foreground text-base">{item.description}</p>
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
                See how Investor Automation OS can transform your lead flow, eliminate manual work, and scale your business without proportionally increasing costs.
              </p>
              <div className="flex flex-col sm:flex-row justify-center gap-4">
                <Link href="/demo">
                  <Button className="bg-accent hover:bg-cyan-500 text-background font-semibold px-8 py-6 text-lg h-auto rounded-xl shadow-[0_0_34px_rgba(0,217,255,0.30)] w-full">
                    See The Demo
                    <ArrowRight size={18} />
                  </Button>
                </Link>
                <Link href="/contact">
                  <Button variant="outline" className="border-white/15 text-foreground hover:text-accent hover:bg-white/5 font-semibold px-8 py-6 text-lg h-auto rounded-xl w-full">
                    Schedule Strategy Call
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
