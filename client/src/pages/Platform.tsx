import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";
import { motion } from "framer-motion";
import { ArrowRight, Zap, MessageSquare, Calendar, TrendingUp, CheckCircle, AlertCircle, Clock } from "lucide-react";
import { useState, useEffect } from "react";
import { AcquisitionEngineVisual } from "@/components/AcquisitionEngineVisual";
import { LiveSystemActivity } from "@/components/LiveSystemActivity";
import { FloatingDashboardPanels } from "@/components/FloatingDashboardPanels";

export default function Platform() {
  const [activeStep, setActiveStep] = useState(0);

  // Acquisition Engine Steps
  const engineSteps = [
    { label: "Lead Source", icon: "📥" },
    { label: "Data Scrubbing", icon: "✓" },
    { label: "SMS & Email", icon: "💬" },
    { label: "Qualification", icon: "🎯" },
    { label: "Booking", icon: "📅" },
    { label: "Pipeline", icon: "📊" },
    { label: "Notifications", icon: "🔔" },
    { label: "Drip Campaigns", icon: "♻️" },
  ];

  // Live counters
  const [counters, setCounters] = useState({
    leadsProcessed: 0,
    appointmentsScheduled: 0,
    responseTime: 0,
    followUpsAutomated: 0,
  });

  useEffect(() => {
    const interval = setInterval(() => {
      setCounters((prev) => ({
        leadsProcessed: Math.min(prev.leadsProcessed + Math.floor(Math.random() * 5), 247),
        appointmentsScheduled: Math.min(prev.appointmentsScheduled + Math.floor(Math.random() * 2), 38),
        responseTime: Math.max(prev.responseTime - Math.floor(Math.random() * 2), 47),
        followUpsAutomated: Math.min(prev.followUpsAutomated + Math.floor(Math.random() * 10), 1842),
      }));
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  // Outcome cards
  const outcomes = [
    {
      outcome: "Instant Seller Response",
      description: "Respond to inbound leads in seconds instead of hours.",
      metric: "< 90s Average Response Time",
    },
    {
      outcome: "Zero Missed Leads",
      description: "Automated capture and qualification across all channels.",
      metric: "100% Lead Capture Rate",
    },
    {
      outcome: "Automated Pipeline",
      description: "Leads move through stages without manual intervention.",
      metric: "60% Less Admin Work",
    },
    {
      outcome: "Scheduled Appointments",
      description: "Calendar integration books meetings automatically.",
      metric: "5x More Appointments",
    },
    {
      outcome: "Persistent Follow-Up",
      description: "Long-term drip campaigns keep leads engaged.",
      metric: "3x Higher Conversion",
    },
    {
      outcome: "Team Alignment",
      description: "Real-time notifications keep everyone in sync.",
      metric: "Instant Lead Routing",
    },
  ];

  return (
    <div className="min-h-screen bg-background">
      <Navigation />

      {/* Hero Section */}
      <section className="relative pt-32 md:pt-40 pb-20 md:pb-32 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-accent/5 via-transparent to-transparent -z-10" />
        
        {/* Background atmospheric elements */}
        <div className="absolute top-20 right-10 w-72 h-72 bg-accent/5 rounded-full blur-3xl -z-10 animate-pulse" style={{ animationDuration: "8s" }} />
        <div className="absolute bottom-0 left-20 w-96 h-96 bg-blue-600/5 rounded-full blur-3xl -z-10 animate-pulse" style={{ animationDuration: "10s" }} />

        <div className="container">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            className="max-w-4xl mx-auto text-center"
          >
            <div className="inline-flex items-center gap-2 mb-6 px-4 py-2 rounded-full bg-accent/10 border border-accent/30">
              <Zap size={16} className="text-accent" />
              <span className="text-sm font-medium text-accent">Operational Infrastructure</span>
            </div>

            <h1 className="text-4xl md:text-5xl lg:text-6xl font-display font-bold mb-6 text-foreground leading-tight">
              The Acquisition Engine
            </h1>

            <p className="text-lg md:text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
              Your entire acquisition machine runs automatically. From lead capture to closed deals, every step is orchestrated by intelligent automation.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link href="/demo">
                <Button className="bg-accent hover:bg-cyan-500 text-background font-semibold rounded-xl shadow-[0_0_24px_rgba(0,217,255,0.20)] transition-all duration-200 ease-out hover:shadow-[0_0_32px_rgba(0,217,255,0.35)] hover:scale-105 active:scale-95">
                  See It In Action <ArrowRight size={18} className="ml-2" />
                </Button>
              </Link>
              <Link href="/contact">
                <Button variant="outline" className="rounded-xl border-white/20 hover:bg-white/5">
                  Schedule Demo
                </Button>
              </Link>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Acquisition Engine Centerpiece */}
      <section className="relative py-20 md:py-32 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-accent/3 to-transparent -z-10" />

        <div className="container">
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            viewport={{ once: true }}
            className="mb-16"
          >
            <h2 className="text-3xl md:text-4xl font-display font-bold text-center mb-4 text-foreground">
              How The Engine Works
            </h2>
            <p className="text-center text-muted-foreground max-w-2xl mx-auto">
              8 automated stages that transform raw leads into closed deals without manual intervention.
            </p>
          </motion.div>

          {/* Full Animated Acquisition Engine Visualization */}
          <div className="relative bg-gradient-to-b from-background via-blue-950/30 to-background rounded-2xl border border-white/10 p-8 md:p-12 overflow-hidden">
            {/* Background glow layers */}
            <div className="absolute inset-0 bg-gradient-to-r from-accent/5 via-transparent to-accent/5 -z-10" />
            <div className="absolute top-0 left-1/4 w-96 h-96 bg-accent/5 rounded-full blur-3xl -z-10" />
            <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-blue-600/5 rounded-full blur-3xl -z-10" />

            {/* Main workflow visualization */}
            <div className="mb-12">
              <h3 className="text-lg font-semibold text-foreground mb-6 text-center">Automated Acquisition Flow</h3>
              <div className="h-64 bg-gradient-to-b from-white/5 to-transparent rounded-xl border border-white/10 p-6 overflow-hidden">
                <AcquisitionEngineVisual />
              </div>
            </div>

            {/* Live System Activity & Metrics Grid */}
            <div className="grid md:grid-cols-2 gap-6">
              {/* Live Activity Feed */}
              <div className="bg-white/5 border border-white/10 rounded-xl p-6">
                <LiveSystemActivity />
              </div>

              {/* Real-time Metrics */}
              <div className="bg-white/5 border border-white/10 rounded-xl p-6">
                <div className="flex items-center gap-2 mb-4">
                  <Zap size={18} className="text-accent" />
                  <span className="text-sm font-medium text-foreground">System Metrics</span>
                </div>
                <div className="space-y-4">
                  {[
                    { label: "Processing Speed", value: "2.3s", color: "text-cyan-400" },
                    { label: "Lead Accuracy", value: "99.2%", color: "text-green-400" },
                    { label: "Automation Rate", value: "100%", color: "text-accent" },
                    { label: "System Uptime", value: "99.99%", color: "text-blue-400" },
                  ].map((metric, idx) => (
                    <div key={idx} className="flex justify-between items-center p-3 rounded-lg bg-white/5 border border-white/10">
                      <span className="text-sm text-muted-foreground">{metric.label}</span>
                      <span className={`text-sm font-bold ${metric.color}`}>{metric.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Floating Dashboard Panels Section */}
          <div className="mt-16">
            <h3 className="text-lg font-semibold text-center text-foreground mb-8">Dashboard Overview</h3>
            <FloatingDashboardPanels />
          </div>

          {/* Live System Metrics */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-12">
            {[
              { label: "Leads Processed", value: counters.leadsProcessed, unit: "this month" },
              { label: "Appointments Scheduled", value: counters.appointmentsScheduled, unit: "" },
              { label: "Response Time", value: counters.responseTime, unit: "seconds" },
              { label: "Follow-Ups Automated", value: counters.followUpsAutomated, unit: "" },
            ].map((metric, idx) => (
              <motion.div
                key={idx}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.1, duration: 0.5 }}
                viewport={{ once: true }}
                className="bg-white/5 border border-white/10 rounded-xl p-4 text-center hover:bg-white/10 transition-colors"
              >
                <div className="text-2xl md:text-3xl font-bold text-accent mb-1">{metric.value}</div>
                <div className="text-xs text-muted-foreground">{metric.label}</div>
                {metric.unit && <div className="text-xs text-muted-foreground">{metric.unit}</div>}
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Outcome Cards Section */}
      <section className="relative py-20 md:py-32">
        <div className="absolute inset-0 bg-gradient-to-b from-accent/3 via-transparent to-transparent -z-10" />

        <div className="container">
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            viewport={{ once: true }}
            className="mb-16"
          >
            <h2 className="text-3xl md:text-4xl font-display font-bold text-center mb-4 text-foreground">
              Real Outcomes
            </h2>
            <p className="text-center text-muted-foreground max-w-2xl mx-auto">
              What happens when your acquisition machine runs 24/7 without manual intervention.
            </p>
          </motion.div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {outcomes.map((item, idx) => (
              <motion.div
                key={idx}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.1, duration: 0.5 }}
                viewport={{ once: true }}
                className="group bg-gradient-to-br from-white/5 to-white/[0.02] border border-white/10 rounded-xl p-6 hover:border-accent/30 hover:bg-white/10 transition-all duration-300 hover:shadow-[0_0_24px_rgba(0,217,255,0.1)]"
              >
                <div className="flex items-start gap-3 mb-4">
                  <CheckCircle size={20} className="text-accent mt-1 flex-shrink-0" />
                  <h3 className="text-lg font-semibold text-foreground group-hover:text-accent transition-colors">
                    {item.outcome}
                  </h3>
                </div>
                <p className="text-sm text-muted-foreground mb-4">
                  {item.description}
                </p>
                <div className="text-sm font-medium text-accent bg-accent/10 px-3 py-2 rounded-lg inline-block">
                  {item.metric}
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="relative py-20 md:py-32 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-accent/5 to-transparent -z-10" />

        <div className="container">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            viewport={{ once: true }}
            className="max-w-2xl mx-auto text-center"
          >
            <h2 className="text-3xl md:text-4xl font-display font-bold mb-6 text-foreground">
              Ready to Automate Your Acquisition Machine?
            </h2>
            <p className="text-lg text-muted-foreground mb-8">
              See how the platform transforms your investor business from chaos to control.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link href="/demo">
                <Button className="bg-accent hover:bg-cyan-500 text-background font-semibold rounded-xl shadow-[0_0_24px_rgba(0,217,255,0.20)] transition-all duration-200 ease-out hover:shadow-[0_0_32px_rgba(0,217,255,0.35)] hover:scale-105 active:scale-95">
                  See The Demo <ArrowRight size={18} className="ml-2" />
                </Button>
              </Link>
              <Link href="/contact">
                <Button variant="outline" className="rounded-xl border-white/20 hover:bg-white/5">
                  Schedule a Call
                </Button>
              </Link>
            </div>
          </motion.div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
