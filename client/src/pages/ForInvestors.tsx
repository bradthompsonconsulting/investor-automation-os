import { motion } from "framer-motion";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";
import { ArrowRight, Target, Users, TrendingUp, Zap } from "lucide-react";

const fadeInUp = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.6 },
};

export default function ForInvestors() {
  const investorTypes = [
    {
      icon: <Target size={40} />,
      title: "Wholesalers",
      pain: "Losing deals to slow follow-up",
      solution: "Instant lead capture and automated seller follow-up sequences",
      benefits: ["Faster deal identification", "Automated lead nurturing", "Higher close rates"],
    },
    {
      icon: <Users size={40} />,
      title: "Flippers",
      pain: "Managing multiple projects and leads",
      solution: "Complete project and lead pipeline management with real-time updates",
      benefits: ["Project tracking", "Contractor coordination", "Timeline management"],
    },
    {
      icon: <TrendingUp size={40} />,
      title: "Buy & Hold Investors",
      pain: "Scaling acquisition without scaling team",
      solution: "Automated lead generation and qualification systems",
      benefits: ["Consistent lead flow", "Reduced acquisition costs", "Scalable systems"],
    },
    {
      icon: <Zap size={40} />,
      title: "Acquisition Teams",
      pain: "Coordinating across multiple team members",
      solution: "Centralized lead management and team collaboration tools",
      benefits: ["Team alignment", "Lead distribution", "Performance tracking"],
    },
  ];

  const painPoints = [
    {
      title: "Lost Leads",
      description: "Leads slip through the cracks due to slow response times and inconsistent follow-up.",
      solution: "Instant SMS responses and automated follow-up sequences ensure no lead is left behind.",
    },
    {
      title: "Slow Follow-Up",
      description: "Manual follow-up processes mean deals go to competitors who respond faster.",
      solution: "Automated workflows respond to leads in seconds, not hours.",
    },
    {
      title: "Inconsistent Outreach",
      description: "Without a system, lead follow-up is inconsistent and unpredictable.",
      solution: "Standardized, automated workflows ensure every lead gets the same quality treatment.",
    },
    {
      title: "Lead Organization",
      description: "Spreadsheets and scattered notes make it impossible to see your full pipeline.",
      solution: "Centralized CRM gives you complete visibility into every lead and deal.",
    },
    {
      title: "Scaling Challenges",
      description: "Growing your business means hiring more staff, not automating better.",
      solution: "Automation-driven scaling lets you grow without proportionally increasing costs.",
    },
    {
      title: "Data Silos",
      description: "Lead information is scattered across multiple platforms and team members.",
      solution: "Unified system of record ensures all data flows through one intelligent platform.",
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
              Built for Real Estate Investors
            </motion.h1>
            <motion.p variants={fadeInUp} className="text-lg md:text-xl text-muted-foreground mb-8">
              Whether you're a wholesaler, flipper, or buy-and-hold investor, we have a solution for your business.
            </motion.p>
          </motion.div>
        </div>
      </section>

      {/* Investor Types */}
      <section className="py-20 md:py-32 bg-secondary">
        <div className="container">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {investorTypes.map((type, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: i * 0.1 }}
                viewport={{ once: true }}
                className="p-8 rounded-xl bg-background border border-border hover:border-accent/50 transition-all duration-300 ease-out hover:shadow-lg hover:shadow-accent/10 hover:bg-background/80 group"
              >
                <div className="text-accent mb-4 group-hover:scale-110 transition-transform duration-300">{type.icon}</div>
                <h3 className="text-2xl font-display font-bold text-foreground mb-2">{type.title}</h3>
                <p className="text-sm text-destructive mb-4">Challenge: {type.pain}</p>
                <p className="text-muted-foreground mb-6">{type.solution}</p>
                <ul className="space-y-2">
                  {type.benefits.map((benefit, j) => (
                    <li key={j} className="flex items-center gap-2 text-sm text-muted-foreground">
                      <div className="w-1.5 h-1.5 rounded-full bg-accent" />
                      {benefit}
                    </li>
                  ))}
                </ul>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Pain Points Deep Dive */}
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
              We Understand Your Challenges
            </h2>
            <p className="text-lg text-muted-foreground">
              Real problems require real solutions.
            </p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {painPoints.map((point, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: i * 0.05 }}
                viewport={{ once: true }}
                className="p-8 rounded-xl glass"
              >
                <h3 className="text-xl font-display font-bold text-foreground mb-3">{point.title}</h3>
                <p className="text-muted-foreground mb-4">{point.description}</p>
                <div className="pt-4 border-t border-border">
                  <p className="text-sm text-accent font-semibold">Our Solution:</p>
                  <p className="text-sm text-muted-foreground mt-2">{point.solution}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Scaling Section */}
      <section className="py-20 md:py-32 bg-secondary">
        <div className="container">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            viewport={{ once: true }}
            className="max-w-3xl mx-auto"
          >
            <h2 className="text-4xl md:text-5xl font-display font-bold text-foreground mb-6">
              Scale Without Hiring
            </h2>
            <p className="text-lg text-muted-foreground mb-8">
              Most real estate investors think they need to hire more staff to grow. We think differently. With proper automation, you can handle 3-5x more deals with the same team size.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {[
                {
                  metric: "3-5x",
                  label: "More Deals",
                  description: "Same team, more output",
                },
                {
                  metric: "60%",
                  label: "Time Saved",
                  description: "On administrative tasks",
                },
                {
                  metric: "40%",
                  label: "Higher Close Rate",
                  description: "Faster response = more deals",
                },
              ].map((item, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, delay: i * 0.1 }}
                  viewport={{ once: true }}
                  className="p-6 rounded-xl bg-background border border-border text-center"
                >
                  <div className="text-4xl font-display font-bold text-accent mb-2">{item.metric}</div>
                  <h4 className="font-display font-bold text-foreground mb-1">{item.label}</h4>
                  <p className="text-sm text-muted-foreground">{item.description}</p>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </div>
      </section>

      {/* Automation-Driven Scaling */}
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
              Automation-Driven Scaling
            </h2>
            <p className="text-lg text-muted-foreground">
              The path to sustainable growth.
            </p>
          </motion.div>

          <div className="max-w-3xl mx-auto">
            {[
              {
                step: "Automate Lead Capture",
                description: "Leads flow in automatically from multiple sources—web, social, paid ads, referrals.",
              },
              {
                step: "Automate Lead Qualification",
                description: "AI qualifies leads and routes them to the right team member automatically.",
              },
              {
                step: "Automate Follow-Up",
                description: "SMS, email, and call sequences run automatically based on lead behavior.",
              },
              {
                step: "Automate Deal Management",
                description: "Deals move through your pipeline automatically as conditions are met.",
              },
              {
                step: "Scale Confidently",
                description: "Your team focuses on closing deals. The system handles everything else.",
              },
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
                  <div className="flex items-center justify-center h-12 w-12 rounded-lg bg-accent text-background font-display font-bold">
                    {i + 1}
                  </div>
                </div>
                <div className="flex-1">
                  <h4 className="text-xl font-display font-bold text-foreground mb-2">{item.step}</h4>
                  <p className="text-muted-foreground">{item.description}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 md:py-32 bg-secondary">
        <div className="container">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            viewport={{ once: true }}
            className="max-w-2xl mx-auto text-center"
          >
            <h2 className="text-4xl md:text-5xl font-display font-bold text-foreground mb-6">
              Ready to Scale Your Business?
            </h2>
            <p className="text-lg text-muted-foreground mb-8">
              Let's discuss how automation can transform your real estate business.
            </p>
            <Link href="/pricing">
              <Button className="bg-accent hover:bg-cyan-500 text-background font-semibold px-8 py-6 text-lg h-auto flex items-center gap-2 mx-auto">
                Get Started Now
                <ArrowRight size={18} />
              </Button>
            </Link>
          </motion.div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
