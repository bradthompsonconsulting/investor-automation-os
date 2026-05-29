import { motion } from "framer-motion";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";
import { ArrowRight } from "lucide-react";

const fadeInUp = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.6 },
};

export default function DemoCase() {
  return (
    <div className="min-h-screen bg-background">
      <Navigation />

      {/* Hero Section */}
      <section className="relative pt-32 md:pt-40 pb-20 md:pb-32">
        <div className="absolute inset-0 bg-gradient-to-b from-accent/5 via-transparent to-transparent -z-10" />

        <div className="container">
          <motion.div
            initial="initial"
            animate="animate"
            variants={{
              animate: {
                transition: {
                  staggerChildren: 0.1,
                  delayChildren: 0.2,
                },
              },
            }}
            className="max-w-3xl mx-auto text-center"
          >
            <motion.h1 variants={fadeInUp} className="text-5xl md:text-6xl font-display font-bold text-foreground mb-6">
              See the System in Action
            </motion.h1>
            <motion.p variants={fadeInUp} className="text-lg md:text-xl text-muted-foreground mb-8">
              Watch how leads flow through the system from capture to closed deal.
            </motion.p>
          </motion.div>
        </div>
      </section>

      {/* Dashboard Preview */}
      <section className="py-20 md:py-32 bg-secondary">
        <div className="container">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            whileInView={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.8 }}
            viewport={{ once: true }}
            className="rounded-2xl overflow-hidden border border-accent/20 glow-cyan-lg"
          >
            <img
              src="https://d2xsxph8kpxj0f.cloudfront.net/310519663569019027/d3Ygw65BjdqTKvfaHVio5Q/dashboard-mockup-hero-FvFJtpf2ZP56QP2vuBnkB8.webp"
              alt="Dashboard Preview"
              className="w-full h-auto"
            />
          </motion.div>
        </div>
      </section>

      {/* Workflow Steps */}
      <section className="py-20 md:py-32 bg-background">
        <div className="container">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            viewport={{ once: true }}
            className="max-w-2xl mx-auto text-center mb-16"
          >
            <h2 className="text-4xl md:text-5xl font-display font-bold text-foreground mb-4">
              The Lead Journey
            </h2>
            <p className="text-lg text-muted-foreground">
              Here's exactly what happens when a lead enters the system.
            </p>
          </motion.div>

          <div className="max-w-4xl mx-auto space-y-8">
            {[
              {
                step: "1",
                title: "Lead Submission",
                description: "A seller fills out your web form with their property information.",
                details: [
                  "Form captures: Name, phone, email, property address, property condition",
                  "Lead is instantly created in the CRM",
                  "Lead is tagged and scored automatically",
                ],
              },
              {
                step: "2",
                title: "Instant SMS Response",
                description: "The seller immediately receives an automated SMS acknowledgment.",
                details: [
                  "SMS sent within seconds of form submission",
                  "Message confirms receipt and sets expectations",
                  "Includes link to schedule appointment",
                ],
              },
              {
                step: "3",
                title: "Lead Qualification",
                description: "AI analyzes the lead and determines fit and priority.",
                details: [
                  "Property analysis: location, condition, potential profit",
                  "Lead scoring: hot, warm, cold",
                  "Automatic routing to appropriate team member",
                ],
              },
              {
                step: "4",
                title: "Appointment Scheduling",
                description: "If the lead is qualified, they receive a calendar link.",
                details: [
                  "Automated message with appointment link",
                  "Seller books directly into your calendar",
                  "Confirmation SMS sent to seller",
                ],
              },
              {
                step: "5",
                title: "Appointment Reminders",
                description: "Automated reminders keep appointments on track.",
                details: [
                  "24-hour reminder SMS sent to seller",
                  "1-hour reminder sent to your team",
                  "Missed appointment triggers follow-up sequence",
                ],
              },
              {
                step: "6",
                title: "Follow-Up Sequence",
                description: "If no appointment is scheduled, automated follow-up begins.",
                details: [
                  "Day 1: SMS with property analysis",
                  "Day 3: Email with comparable sales",
                  "Day 7: Phone call from your team",
                  "Day 14: Final offer email",
                ],
              },
              {
                step: "7",
                title: "Pipeline Movement",
                description: "As deals progress, they move through your pipeline automatically.",
                details: [
                  "Appointment completed → Moves to 'Qualified' stage",
                  "Offer made → Moves to 'In Progress' stage",
                  "Offer accepted → Moves to 'Negotiating' stage",
                  "Deal closed → Moves to 'Closed' stage",
                ],
              },
              {
                step: "8",
                title: "Team Notifications",
                description: "Your team stays informed every step of the way.",
                details: [
                  "Push notifications for new leads",
                  "SMS alerts for hot leads",
                  "Email summaries of daily activity",
                  "Dashboard shows real-time pipeline status",
                ],
              },
            ].map((item, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: i * 0.05 }}
                viewport={{ once: true }}
                className="flex gap-6"
              >
                <div className="flex-shrink-0">
                  <div className="flex items-center justify-center h-14 w-14 rounded-lg bg-accent text-background font-display font-bold text-lg glow-cyan">
                    {item.step}
                  </div>
                </div>
                <div className="flex-1 p-8 rounded-xl bg-secondary border border-border hover:border-accent/50 transition-colors">
                  <h3 className="text-2xl font-display font-bold text-foreground mb-2">{item.title}</h3>
                  <p className="text-muted-foreground mb-4">{item.description}</p>
                  <ul className="space-y-2">
                    {item.details.map((detail, j) => (
                      <li key={j} className="flex items-start gap-2 text-sm text-muted-foreground">
                        <div className="w-1.5 h-1.5 rounded-full bg-accent mt-1.5 flex-shrink-0" />
                        <span>{detail}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* CRM Pipeline Visualization */}
      <section className="py-20 md:py-32 bg-secondary">
        <div className="container">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            viewport={{ once: true }}
            className="max-w-2xl mx-auto text-center mb-16"
          >
            <h2 className="text-4xl md:text-5xl font-display font-bold text-foreground mb-4">
              Your Complete Pipeline
            </h2>
            <p className="text-lg text-muted-foreground">
              See all your deals in one place, organized by stage.
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            whileInView={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.8 }}
            viewport={{ once: true }}
            className="rounded-2xl overflow-hidden border border-accent/20 glow-cyan-lg"
          >
            <img
              src="https://d2xsxph8kpxj0f.cloudfront.net/310519663569019027/d3Ygw65BjdqTKvfaHVio5Q/crm-pipeline-visual-ZWHxjVrsaaPExXjkdX9wuv.webp"
              alt="CRM Pipeline"
              className="w-full h-auto"
            />
          </motion.div>
        </div>
      </section>

      {/* Key Features */}
      <section className="py-20 md:py-32 bg-background">
        <div className="container">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            viewport={{ once: true }}
            className="max-w-2xl mx-auto text-center mb-16"
          >
            <h2 className="text-4xl md:text-5xl font-display font-bold text-foreground mb-4">
              Built-In Features
            </h2>
            <p className="text-lg text-muted-foreground">
              Everything you need to manage your real estate business.
            </p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {[
              {
                title: "Real-Time Notifications",
                description: "Get instant alerts for new leads, appointments, and deal updates.",
              },
              {
                title: "Lead Scoring",
                description: "AI automatically scores leads so your team focuses on hot prospects.",
              },
              {
                title: "Automated Follow-Up",
                description: "SMS, email, and call sequences run automatically based on lead behavior.",
              },
              {
                title: "Team Collaboration",
                description: "Assign leads, share notes, and collaborate on deals in real-time.",
              },
              {
                title: "Performance Analytics",
                description: "Track conversion rates, response times, and deal metrics.",
              },
              {
                title: "Mobile Access",
                description: "Manage your business from anywhere with mobile-optimized interface.",
              },
              {
                title: "Integration Hub",
                description: "Connect to Zapier, webhooks, and custom APIs for seamless workflow.",
              },
              {
                title: "Compliance Ready",
                description: "Built-in SMS compliance, GDPR support, and audit trails.",
              },
            ].map((feature, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: i * 0.05 }}
                viewport={{ once: true }}
                className="p-6 rounded-xl glass"
              >
                <h3 className="text-lg font-display font-bold text-foreground mb-2">{feature.title}</h3>
                <p className="text-muted-foreground text-sm">{feature.description}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Results */}
      <section className="py-20 md:py-32 bg-secondary">
        <div className="container">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            viewport={{ once: true }}
            className="max-w-2xl mx-auto text-center mb-16"
          >
            <h2 className="text-4xl md:text-5xl font-display font-bold text-foreground mb-4">
              Real Results
            </h2>
            <p className="text-lg text-muted-foreground">
              What investors achieve with this system.
            </p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              {
                metric: "85%",
                label: "Faster Response Time",
                description: "Leads get responses in seconds, not hours",
              },
              {
                metric: "3.2x",
                label: "More Leads Captured",
                description: "Automated systems capture more opportunities",
              },
              {
                metric: "42%",
                label: "Higher Close Rate",
                description: "Consistent follow-up closes more deals",
              },
            ].map((result, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: i * 0.1 }}
                viewport={{ once: true }}
                className="p-8 rounded-xl bg-background border border-border text-center"
              >
                <div className="text-5xl font-display font-bold text-accent mb-2">{result.metric}</div>
                <h4 className="font-display font-bold text-foreground mb-2">{result.label}</h4>
                <p className="text-muted-foreground text-sm">{result.description}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 md:py-32 bg-background">
        <div className="container">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            viewport={{ once: true }}
            className="max-w-2xl mx-auto text-center"
          >
            <h2 className="text-4xl md:text-5xl font-display font-bold text-foreground mb-6">
              Ready to See This in Your Business?
            </h2>
            <p className="text-lg text-muted-foreground mb-8">
              Let's schedule a personalized demo for your specific business.
            </p>
            <Link href="/contact">
              <a>
                <Button className="bg-accent hover:bg-cyan-500 text-background font-semibold px-8 py-6 text-lg h-auto flex items-center gap-2 mx-auto">
                  Schedule Your Demo
                  <ArrowRight size={18} />
                </Button>
              </a>
            </Link>
          </motion.div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
