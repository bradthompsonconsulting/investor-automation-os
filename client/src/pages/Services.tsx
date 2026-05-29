import { motion } from "framer-motion";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";
import { ArrowRight, Database, Zap, MessageSquare, Calendar, BarChart3, Smartphone, Settings, TrendingUp } from "lucide-react";

const fadeInUp = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.6 },
};

export default function Services() {
  const services = [
    {
      icon: <Database size={40} />,
      title: "CRM Setup & Integration",
      description: "Complete GoHighLevel CRM setup, customization, and integration with your existing systems.",
      features: ["Lead database design", "Custom fields & pipelines", "Integration setup", "Data migration"],
    },
    {
      icon: <Zap size={40} />,
      title: "AI Automation Workflows",
      description: "Intelligent automation that captures leads, qualifies them, and moves them through your pipeline automatically.",
      features: ["Lead qualification", "Automated routing", "Smart tagging", "Conditional logic"],
    },
    {
      icon: <MessageSquare size={40} />,
      title: "SMS & Email Automation",
      description: "Instant SMS responses, automated follow-up sequences, and nurture campaigns that convert.",
      features: ["SMS automation", "Email sequences", "Drip campaigns", "A/B testing"],
    },
    {
      icon: <Calendar size={40} />,
      title: "Appointment Booking",
      description: "Automated calendar scheduling, missed-call text-back, and appointment reminders.",
      features: ["Calendar sync", "Missed call texts", "Reminders", "Timezone handling"],
    },
    {
      icon: <BarChart3 size={40} />,
      title: "Lead Capture Systems",
      description: "Multi-channel lead capture from web forms, Facebook, landing pages, and more.",
      features: ["Web forms", "Social integration", "Landing pages", "Lead scoring"],
    },
    {
      icon: <Smartphone size={40} />,
      title: "Seller Lead Systems",
      description: "Specialized automation for off-market seller lead capture and nurturing.",
      features: ["Seller targeting", "Property analysis", "Offer automation", "Follow-up sequences"],
    },
    {
      icon: <Settings size={40} />,
      title: "Investor Pipeline Management",
      description: "Complete pipeline visualization and management for wholesalers, flippers, and buy-and-hold investors.",
      features: ["Pipeline stages", "Deal tracking", "Metrics & analytics", "Team collaboration"],
    },
    {
      icon: <TrendingUp size={40} />,
      title: "Speed-to-Lead Optimization",
      description: "Ensure your team responds to leads faster than your competition.",
      features: ["Instant notifications", "Mobile alerts", "Lead routing", "Response tracking"],
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
              Our Services
            </motion.h1>
            <motion.p variants={fadeInUp} className="text-lg md:text-xl text-muted-foreground mb-8">
              Complete automation solutions for real estate investors. From lead capture to deal closing.
            </motion.p>
          </motion.div>
        </div>
      </section>

      {/* Services Grid */}
      <section className="py-20 md:py-32 bg-secondary">
        <div className="container">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {services.map((service, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: i * 0.05 }}
                viewport={{ once: true }}
                className="p-8 rounded-xl bg-background border border-border hover:border-accent/50 transition-all duration-300 ease-out hover:shadow-lg hover:shadow-accent/10 hover:bg-background/80 group"
              >
                <div className="text-accent mb-4 group-hover:scale-110 transition-transform duration-300">{service.icon}</div>
                <h3 className="text-2xl font-display font-bold text-foreground mb-3">{service.title}</h3>
                <p className="text-muted-foreground mb-6">{service.description}</p>
                <ul className="space-y-2">
                  {service.features.map((feature, j) => (
                    <li key={j} className="flex items-center gap-2 text-sm text-muted-foreground">
                      <div className="w-1.5 h-1.5 rounded-full bg-accent" />
                      {feature}
                    </li>
                  ))}
                </ul>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Implementation Process */}
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
              Our Implementation Process
            </h2>
            <p className="text-lg text-muted-foreground">
              We handle the technical complexity. You focus on your business.
            </p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-5 gap-4 md:gap-2">
            {[
              { step: "1", title: "Strategy", desc: "Understand your business" },
              { step: "2", title: "Build", desc: "Set up systems" },
              { step: "3", title: "Automate", desc: "Create workflows" },
              { step: "4", title: "Optimize", desc: "Fine-tune performance" },
              { step: "5", title: "Scale", desc: "Grow your business" },
            ].map((item, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: i * 0.1 }}
                viewport={{ once: true }}
                className="relative"
              >
                <div className="p-6 rounded-xl bg-secondary border border-border text-center transition-all duration-300 ease-out hover:border-accent/50 hover:bg-secondary/80 hover:shadow-lg hover:shadow-accent/10 group">
                  <div className="w-12 h-12 rounded-full bg-accent text-background flex items-center justify-center font-display font-bold text-lg mx-auto mb-3 group-hover:scale-110 transition-transform duration-300">
                    {item.step}
                  </div>
                  <h4 className="font-display font-bold text-foreground mb-1">{item.title}</h4>
                  <p className="text-sm text-muted-foreground">{item.desc}</p>
                </div>
                {i < 4 && (
                  <div className="hidden md:block absolute top-1/2 -right-2 w-4 h-0.5 bg-gradient-to-r from-accent to-transparent" />
                )}
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Technology Stack */}
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
              Built on Industry-Leading Platforms
            </h2>
            <p className="text-lg text-muted-foreground">
              We integrate with the tools your team already knows and loves.
            </p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              {
                name: "GoHighLevel",
                description: "Enterprise CRM and automation platform for real estate professionals.",
              },
              {
                name: "AI Tools",
                description: "Advanced AI for lead qualification, predictive analytics, and intelligent routing.",
              },
              {
                name: "Integrations",
                description: "Seamless integration with Zapier, webhooks, and custom APIs.",
              },
            ].map((tech, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: i * 0.1 }}
                viewport={{ once: true }}
                className="p-8 rounded-xl glass text-center"
              >
                <h3 className="text-xl font-display font-bold text-foreground mb-2">{tech.name}</h3>
                <p className="text-muted-foreground">{tech.description}</p>
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
              Let's discuss which services are right for your business.
            </p>
            <Link href="/contact">
              <a>
                <Button className="bg-accent hover:bg-cyan-500 text-background font-semibold px-8 py-6 text-lg h-auto flex items-center gap-2 mx-auto">
                  Schedule a Consultation
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
