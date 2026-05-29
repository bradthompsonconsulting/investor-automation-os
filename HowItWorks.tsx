import { motion } from "framer-motion";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";
import AcquisitionEngineVisual from "@/components/AcquisitionEngineVisual";
import { ArrowRight, CheckCircle } from "lucide-react";

const fadeInUp = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.6 },
};

export default function HowItWorks() {
  const steps = [
    {
      number: "1",
      title: "Strategy",
      description: "We understand your business, your goals, and your challenges. We audit your current systems and identify opportunities for automation.",
      details: [
        "Business analysis",
        "Current process review",
        "Opportunity identification",
        "Goal setting",
      ],
    },
    {
      number: "2",
      title: "Build",
      description: "We set up your CRM, integrations, and automation infrastructure. Everything is configured to match your business process.",
      details: [
        "CRM setup",
        "Integration configuration",
        "Database design",
        "System testing",
      ],
    },
    {
      number: "3",
      title: "Automate",
      description: "We create the workflows that capture leads, qualify them, and move them through your pipeline automatically.",
      details: [
        "Workflow creation",
        "Automation rules",
        "Lead scoring",
        "Conditional logic",
      ],
    },
    {
      number: "4",
      title: "Optimize",
      description: "We monitor performance, analyze data, and continuously improve your systems to maximize results.",
      details: [
        "Performance tracking",
        "Data analysis",
        "Optimization",
        "Reporting",
      ],
    },
    {
      number: "5",
      title: "Scale",
      description: "Your systems are now proven and optimized. We help you scale to handle more leads and deals without proportionally increasing costs.",
      details: [
        "Capacity planning",
        "Process refinement",
        "Team training",
        "Ongoing support",
      ],
    },
  ];

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
              How It Works
            </motion.h1>
            <motion.p variants={fadeInUp} className="text-lg md:text-xl text-muted-foreground mb-8">
              A proven 5-step process to transform your real estate business with automation.
            </motion.p>
          </motion.div>
        </div>
      </section>

      {/* Process Steps */}
      <section className="py-20 md:py-32 bg-secondary">
        <div className="container">
          <div className="max-w-4xl mx-auto">
            {steps.map((step, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: i * 0.1 }}
                viewport={{ once: true }}
                className="mb-8 last:mb-0"
              >
                <div className="flex gap-6">
                  {/* Step Number */}
                  <div className="flex-shrink-0">
                    <div className="flex items-center justify-center h-16 w-16 rounded-xl bg-gradient-to-br from-accent to-cyan-500 text-background font-display font-bold text-2xl glow-cyan">
                      {step.number}
                    </div>
                  </div>

                  {/* Step Content */}
                  <div className="flex-1 p-8 rounded-xl bg-background border border-border hover:border-accent/50 transition-colors">
                    <h3 className="text-3xl font-display font-bold text-foreground mb-3">{step.title}</h3>
                    <p className="text-lg text-muted-foreground mb-6">{step.description}</p>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      {step.details.map((detail, j) => (
                        <div key={j} className="flex items-center gap-2">
                          <CheckCircle size={16} className="text-accent flex-shrink-0" />
                          <span className="text-sm text-muted-foreground">{detail}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Arrow */}
                {i < steps.length - 1 && (
                  <div className="flex justify-center my-4">
                    <div className="w-1 h-8 bg-gradient-to-b from-accent to-transparent" />
                  </div>
                )}
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Acquisition Engine Visual */}
      <section className="py-20 md:py-32 bg-background">
        <div className="container">
          <AcquisitionEngineVisual />
        </div>
      </section>

      {/* Workflow Diagram */}
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
              The Complete Automation Flow
            </h2>
            <p className="text-lg text-muted-foreground">
              From lead capture to closed deal, every step is automated.
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
              src="https://d2xsxph8kpxj0f.cloudfront.net/310519663569019027/d3Ygw65BjdqTKvfaHVio5Q/automation-flow-diagram-m58qBnGEchZnWcgcD8UYcT.webp"
              alt="Automation Workflow"
              className="w-full h-auto"
            />
          </motion.div>
        </div>
      </section>

      {/* Timeline */}
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
              Implementation Timeline
            </h2>
            <p className="text-lg text-muted-foreground">
              From strategy to scaling, here's what to expect.
            </p>
          </motion.div>

          <div className="max-w-3xl mx-auto">
            {[
              { phase: "Week 1-2", title: "Strategy & Planning", description: "Business analysis, process mapping, and system design" },
              { phase: "Week 3-4", title: "System Setup", description: "CRM configuration, integration setup, and testing" },
              { phase: "Week 5-6", title: "Automation Build", description: "Workflow creation, automation rules, and optimization" },
              { phase: "Week 7-8", title: "Launch & Training", description: "System launch, team training, and ongoing support" },
            ].map((item, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -20 }}
                whileInView={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.6, delay: i * 0.1 }}
                viewport={{ once: true }}
                className="flex gap-6 mb-8 last:mb-0"
              >
                <div className="flex-shrink-0">
                  <div className="flex items-center justify-center h-12 w-24 rounded-lg bg-accent text-background font-display font-bold text-sm">
                    {item.phase}
                  </div>
                </div>
                <div className="flex-1 p-6 rounded-lg bg-background border border-border">
                  <h4 className="font-display font-bold text-foreground mb-2">{item.title}</h4>
                  <p className="text-muted-foreground text-sm">{item.description}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Key Outcomes */}
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
              What You'll Achieve
            </h2>
            <p className="text-lg text-muted-foreground">
              Measurable results from day one.
            </p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {[
              {
                icon: "⚡",
                title: "Faster Response Time",
                description: "Leads get responses in seconds, not hours. Your team stays ahead of the competition.",
              },
              {
                icon: "📊",
                title: "Better Lead Quality",
                description: "AI qualification means your team only works on qualified, high-value leads.",
              },
              {
                icon: "🎯",
                title: "Higher Close Rates",
                description: "Consistent, automated follow-up means more deals close at higher rates.",
              },
              {
                icon: "⏱️",
                title: "Time Savings",
                description: "Your team saves 10-15 hours per week on administrative tasks.",
              },
              {
                icon: "💰",
                title: "Revenue Growth",
                description: "More deals closed + lower acquisition costs = significantly higher profits.",
              },
              {
                icon: "🚀",
                title: "Scalability",
                description: "Handle 3-5x more deals with the same team size.",
              },
            ].map((outcome, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: i * 0.05 }}
                viewport={{ once: true }}
                className="p-8 rounded-xl glass"
              >
                <div className="text-4xl mb-4">{outcome.icon}</div>
                <h3 className="text-xl font-display font-bold text-foreground mb-2">{outcome.title}</h3>
                <p className="text-muted-foreground">{outcome.description}</p>
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
              Ready to Get Started?
            </h2>
            <p className="text-lg text-muted-foreground mb-8">
              Let's discuss how we can implement this process for your business.
            </p>
            <Link href="/contact">
              <a>
                <Button className="bg-accent hover:bg-cyan-500 text-background font-semibold px-8 py-6 text-lg h-auto flex items-center gap-2 mx-auto">
                  Schedule Your Strategy Call
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
