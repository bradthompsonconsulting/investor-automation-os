import { motion } from "framer-motion";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";
import { ArrowRight, Award, Users, Zap, Target } from "lucide-react";

const fadeInUp = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.6 },
};

export default function About() {
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
              About Investor Automation OS
            </motion.h1>
            <motion.p variants={fadeInUp} className="text-lg md:text-xl text-muted-foreground mb-8">
              Built by real estate operators, for real estate operators.
            </motion.p>
          </motion.div>
        </div>
      </section>

      {/* Story Section */}
      <section className="py-20 md:py-32 bg-secondary">
        <div className="container">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            viewport={{ once: true }}
            className="max-w-3xl mx-auto"
          >
            <h2 className="text-4xl md:text-5xl font-display font-bold text-foreground mb-8">
              Our Story
            </h2>
            <div className="space-y-6 text-lg text-muted-foreground">
              <p>
                Investor Automation OS was born from frustration. Brad Thompson, a veteran real estate investor and operator, watched his team lose deals to competitors who responded faster. He saw talented investors leaving money on the table because they lacked the systems to scale.
              </p>
              <p>
                Instead of hiring more staff, Brad built a system. He combined his years of real estate experience with cutting-edge automation technology to create a platform that does what most real estate teams do manually—automatically.
              </p>
              <p>
                The result? His team closed 3x more deals with the same number of people. Response times dropped from hours to seconds. And the best part? The system was so effective that other investors started asking for it.
              </p>
              <p>
                That's when Investor Automation OS was born. A platform built by someone who understands the real estate business from the ground up. Not by software engineers trying to guess what investors need. By an operator who's been in the trenches.
              </p>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Values Section */}
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
              Our Values
            </h2>
            <p className="text-lg text-muted-foreground">
              What drives everything we do.
            </p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
            {[
              {
                icon: <Target size={40} />,
                title: "Practical",
                description: "We solve real problems for real investors. No fluff, no theory—just results.",
              },
              {
                icon: <Zap size={40} />,
                title: "Efficient",
                description: "We believe in automation, not busy work. Your time is your most valuable asset.",
              },
              {
                icon: <Award size={40} />,
                title: "Trustworthy",
                description: "We're operators first. We understand your business because we've lived it.",
              },
              {
                icon: <Users size={40} />,
                title: "Supportive",
                description: "Your success is our success. We're invested in your growth.",
              },
            ].map((value, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: i * 0.1 }}
                viewport={{ once: true }}
                className="p-8 rounded-xl glass text-center transition-all duration-300 ease-out hover:bg-white/[0.08] hover:shadow-lg hover:shadow-accent/10 group"
              >
                <div className="text-accent mb-4 flex justify-center group-hover:scale-110 transition-transform duration-300">{value.icon}</div>
                <h3 className="text-xl font-display font-bold text-foreground mb-2">{value.title}</h3>
                <p className="text-muted-foreground">{value.description}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Founder Section */}
      <section className="py-20 md:py-32 bg-secondary">
        <div className="container">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            viewport={{ once: true }}
            className="max-w-3xl mx-auto"
          >
            <h2 className="text-4xl md:text-5xl font-display font-bold text-foreground mb-8">
              Meet the Founder
            </h2>
            <div className="flex flex-col md:flex-row gap-8 items-start">
              <div className="flex-shrink-0">
                <div className="w-48 h-48 rounded-xl bg-gradient-to-br from-accent to-cyan-500 flex items-center justify-center text-foreground font-display font-bold text-6xl glow-cyan">
                  BT
                </div>
              </div>
              <div className="flex-1">
                <h3 className="text-3xl font-display font-bold text-foreground mb-4">Brad Thompson</h3>
                <p className="text-lg text-muted-foreground mb-6">
                  Founder & CEO, Brad Thompson Consulting LLC
                </p>
                <div className="space-y-4 text-muted-foreground">
                  <p>
                    Brad is a veteran real estate investor with 15+ years of experience in wholesale, fix-and-flip, and buy-and-hold investing. He's built multiple successful real estate teams and understands the operational challenges that come with scaling.
                  </p>
                  <p>
                    His practical, operator-first mindset drives everything at Investor Automation OS. He's not interested in features that sound good in a pitch deck—only solutions that actually work in the real world.
                  </p>
                  <p>
                    When he's not building automation systems, Brad is actively investing in real estate and mentoring other investors. He lives in McKinney, Texas with his family.
                  </p>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Why Choose Us */}
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
              Why Choose Investor Automation OS?
            </h2>
            <p className="text-lg text-muted-foreground">
              What sets us apart from generic automation platforms.
            </p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {[
              {
                title: "Built by Investors",
                description: "We understand your business because we've been in your shoes. Our founder is an active real estate investor.",
              },
              {
                title: "Real Estate Focused",
                description: "Not a generic automation platform. Every feature is designed specifically for real estate investors.",
              },
              {
                title: "Proven Results",
                description: "Our systems have been tested in the field. We know what works because we use it ourselves.",
              },
              {
                title: "Practical Support",
                description: "You get support from people who understand real estate, not just software support tickets.",
              },
              {
                title: "Continuous Improvement",
                description: "We're constantly improving based on real-world feedback from investors like you.",
              },
              {
                title: "Scalable Systems",
                description: "Start small, grow big. Our systems scale with your business without breaking.",
              },
            ].map((item, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: i * 0.05 }}
                viewport={{ once: true }}
                className="p-8 rounded-xl glass"
              >
                <h3 className="text-xl font-display font-bold text-foreground mb-2">{item.title}</h3>
                <p className="text-muted-foreground">{item.description}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Mission Section */}
      <section className="py-20 md:py-32 bg-secondary">
        <div className="container">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            viewport={{ once: true }}
            className="max-w-3xl mx-auto text-center"
          >
            <h2 className="text-4xl md:text-5xl font-display font-bold text-foreground mb-6">
              Our Mission
            </h2>
            <p className="text-xl text-muted-foreground mb-8">
              To empower real estate investors with intelligent automation systems that eliminate manual work, accelerate deal flow, and enable sustainable business growth.
            </p>
            <p className="text-lg text-muted-foreground">
              We believe every real estate investor deserves access to enterprise-level automation. Not just the big players with huge teams. You.
            </p>
          </motion.div>
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
              Let's Work Together
            </h2>
            <p className="text-lg text-muted-foreground mb-8">
              Ready to transform your real estate business with automation?
            </p>
            <Link href="/contact">
              <Button className="bg-accent hover:bg-cyan-500 text-background font-semibold px-8 py-6 text-lg h-auto flex items-center gap-2 mx-auto">
                Get in Touch
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
