import { motion } from "framer-motion";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";
import { Mail, Phone, MapPin, Linkedin, Youtube, Facebook, Twitter } from "lucide-react";
import { toast } from "sonner";

const fadeInUp = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.6 },
};

export default function Contact() {
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone: "",
    company: "",
    message: "",
  });

  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    // Simulate form submission
    setTimeout(() => {
      toast.success("Message sent! We'll get back to you soon.");
      setFormData({
        name: "",
        email: "",
        phone: "",
        company: "",
        message: "",
      });
      setIsSubmitting(false);
    }, 1000);
  };

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
              Get in Touch
            </motion.h1>
            <motion.p variants={fadeInUp} className="text-lg md:text-xl text-muted-foreground mb-8">
              Let's discuss how we can help your real estate business grow.
            </motion.p>
          </motion.div>
        </div>
      </section>

      {/* Contact Section */}
      <section className="py-20 md:py-32 bg-secondary">
        <div className="container">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-16">
            {/* Contact Info */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
              viewport={{ once: true }}
              className="space-y-8"
            >
              {/* Email */}
              <div className="flex gap-4">
                <div className="flex-shrink-0">
                  <div className="flex items-center justify-center h-12 w-12 rounded-lg bg-accent text-background transition-transform duration-300 hover:scale-110">
                    <Mail size={24} />
                  </div>
                </div>
                <div>
                  <h3 className="font-display font-bold text-foreground mb-1">Email</h3>
                  <a href="mailto:brad@investorautomationsos.com" className="text-muted-foreground hover:text-accent transition-colors">
                    brad@investorautomationsos.com
                  </a>
                </div>
              </div>

              {/* Phone */}
              <div className="flex gap-4">
                <div className="flex-shrink-0">
                  <div className="flex items-center justify-center h-12 w-12 rounded-lg bg-accent text-background transition-transform duration-300 hover:scale-110">
                    <Phone size={24} />
                  </div>
                </div>
                <div>
                  <h3 className="font-display font-bold text-foreground mb-1">Phone</h3>
                  <a href="tel:+19729548586" className="text-muted-foreground hover:text-accent transition-colors">
                    (972) 954-8586
                  </a>
                </div>
              </div>

              {/* Location */}
              <div className="flex gap-4">
                <div className="flex-shrink-0">
                  <div className="flex items-center justify-center h-12 w-12 rounded-lg bg-accent text-background transition-transform duration-300 hover:scale-110">
                    <MapPin size={24} />
                  </div>
                </div>
                <div>
                  <h3 className="font-display font-bold text-foreground mb-1">Location</h3>
                  <p className="text-muted-foreground">
                    McKinney, Texas<br />
                    United States
                  </p>
                </div>
              </div>

              {/* Social Links */}
              <div>
                <h3 className="font-display font-bold text-foreground mb-4">Follow Us</h3>
                <div className="flex gap-3">
                  <a href="#" className="p-3 rounded-lg bg-background hover:bg-accent/10 text-accent transition-all duration-200 ease-out hover:scale-110 hover:shadow-lg hover:shadow-accent/20" aria-label="LinkedIn">
                    <Linkedin size={20} />
                  </a>
                  <a href="#" className="p-3 rounded-lg bg-background hover:bg-accent/10 text-accent transition-all duration-200 ease-out hover:scale-110 hover:shadow-lg hover:shadow-accent/20" aria-label="YouTube">
                    <Youtube size={20} />
                  </a>
                  <a href="#" className="p-3 rounded-lg bg-background hover:bg-accent/10 text-accent transition-all duration-200 ease-out hover:scale-110 hover:shadow-lg hover:shadow-accent/20" aria-label="Facebook">
                    <Facebook size={20} />
                  </a>
                  <a href="#" className="p-3 rounded-lg bg-background hover:bg-accent/10 text-accent transition-all duration-200 ease-out hover:scale-110 hover:shadow-lg hover:shadow-accent/20" aria-label="X/Twitter">
                    <Twitter size={20} />
                  </a>
                </div>
              </div>
            </motion.div>

            {/* Contact Form */}
            <motion.form
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.1 }}
              viewport={{ once: true }}
              onSubmit={handleSubmit}
              className="md:col-span-2 p-8 rounded-xl bg-background border border-border"
            >
              <div className="space-y-6">
                {/* Name */}
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Full Name *
                  </label>
                  <Input
                    type="text"
                    name="name"
                    value={formData.name}
                    onChange={handleChange}
                    required
                    placeholder="Your name"
                    className="bg-secondary border-border text-foreground placeholder:text-muted-foreground"
                  />
                </div>

                {/* Email */}
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Email Address *
                  </label>
                  <Input
                    type="email"
                    name="email"
                    value={formData.email}
                    onChange={handleChange}
                    required
                    placeholder="your@email.com"
                    className="bg-secondary border-border text-foreground placeholder:text-muted-foreground"
                  />
                </div>

                {/* Phone */}
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Phone Number
                  </label>
                  <Input
                    type="tel"
                    name="phone"
                    value={formData.phone}
                    onChange={handleChange}
                    placeholder="(555) 123-4567"
                    className="bg-secondary border-border text-foreground placeholder:text-muted-foreground"
                  />
                </div>

                {/* Company */}
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Company / Business Name
                  </label>
                  <Input
                    type="text"
                    name="company"
                    value={formData.company}
                    onChange={handleChange}
                    placeholder="Your company"
                    className="bg-secondary border-border text-foreground placeholder:text-muted-foreground"
                  />
                </div>

                {/* Message */}
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Message *
                  </label>
                  <Textarea
                    name="message"
                    value={formData.message}
                    onChange={handleChange}
                    required
                    placeholder="Tell us about your business and what you're looking to achieve..."
                    rows={6}
                    className="bg-secondary border-border text-foreground placeholder:text-muted-foreground resize-none"
                  />
                </div>

                {/* Submit Button */}
                <Button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full bg-accent hover:bg-cyan-500 text-background font-semibold h-auto py-3"
                >
                  {isSubmitting ? "Sending..." : "Send Message"}
                </Button>

                {/* Compliance Notice */}
                <p className="text-xs text-muted-foreground">
                  By submitting this form, you agree to receive SMS communications from Brad Thompson Consulting LLC / Investor Automation OS. Message frequency varies. Msg & data rates may apply. Reply STOP to unsubscribe and HELP for help.
                </p>
              </div>
            </motion.form>
          </div>
        </div>
      </section>

      {/* Booking Section */}
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
              Prefer to Schedule Directly?
            </h2>
            <p className="text-lg text-muted-foreground mb-8">
              Book a strategy call at your convenience. We'll discuss your business, challenges, and how we can help.
            </p>
            <Button
              onClick={() => toast.info("Booking link will be connected soon. Please use the contact form above.")}
              className="bg-accent hover:bg-cyan-500 text-background font-semibold px-8 py-6 text-lg h-auto"
            >
              Book a Strategy Call
            </Button>
          </motion.div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
