import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";
import { motion } from "framer-motion";

export default function Privacy() {
  return (
    <div className="min-h-screen bg-background">
      <Navigation />

      {/* Hero Section */}
      <section className="relative pt-32 md:pt-40 pb-20 md:pb-32">
        <div className="absolute inset-0 bg-gradient-to-b from-accent/5 via-transparent to-transparent -z-10" />

        <div className="container">
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="text-5xl md:text-6xl font-display font-bold text-foreground text-center"
          >
            Privacy Policy
          </motion.h1>
        </div>
      </section>

      {/* Content Section */}
      <section className="py-20 md:py-32 bg-secondary">
        <div className="container">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            viewport={{ once: true }}
            className="max-w-3xl mx-auto prose prose-invert"
          >
            <div className="space-y-8 text-muted-foreground">
              <div>
                <h2 className="text-2xl font-display font-bold text-foreground mb-4">Introduction</h2>
                <p>
                  This Privacy Policy ("Policy") describes how Brad Thompson Consulting LLC and Investor Automation OS ("we," "us," "our," or "Company") collects, uses, and shares information about you when you use our website, services, and applications (collectively, the "Services").
                </p>
              </div>

              <div>
                <h2 className="text-2xl font-display font-bold text-foreground mb-4">Information We Collect</h2>
                <p>
                  We collect information you provide directly to us, such as when you fill out a form, contact us, or use our Services. This may include:
                </p>
                <ul className="list-disc list-inside space-y-2 mt-4">
                  <li>Name, email address, and phone number</li>
                  <li>Company name and business information</li>
                  <li>Property information and real estate data</li>
                  <li>SMS and communication preferences</li>
                  <li>Any other information you choose to provide</li>
                </ul>
              </div>

              <div>
                <h2 className="text-2xl font-display font-bold text-foreground mb-4">How We Use Your Information</h2>
                <p>
                  We use the information we collect to:
                </p>
                <ul className="list-disc list-inside space-y-2 mt-4">
                  <li>Provide and improve our Services</li>
                  <li>Communicate with you about our Services</li>
                  <li>Send SMS messages related to your requests and our Services</li>
                  <li>Respond to your inquiries and requests</li>
                  <li>Comply with legal obligations</li>
                  <li>Protect against fraud and security threats</li>
                </ul>
              </div>

              <div>
                <h2 className="text-2xl font-display font-bold text-foreground mb-4">SMS Communications</h2>
                <p>
                  By submitting your information, you agree to receive SMS communications from Brad Thompson Consulting LLC / Investor Automation OS. Message frequency varies. Msg & data rates may apply. Reply STOP to unsubscribe and HELP for help. Standard message and data rates apply.
                </p>
              </div>

              <div>
                <h2 className="text-2xl font-display font-bold text-foreground mb-4">Information Sharing</h2>
                <p>
                  We do not sell your personal information. We may share your information with:
                </p>
                <ul className="list-disc list-inside space-y-2 mt-4">
                  <li>Service providers who assist us in operating our Services</li>
                  <li>Law enforcement when required by law</li>
                  <li>Other parties with your consent</li>
                </ul>
              </div>

              <div>
                <h2 className="text-2xl font-display font-bold text-foreground mb-4">Data Security</h2>
                <p>
                  We implement appropriate technical and organizational measures to protect your personal information against unauthorized access, alteration, disclosure, or destruction. However, no method of transmission over the Internet is completely secure.
                </p>
              </div>

              <div>
                <h2 className="text-2xl font-display font-bold text-foreground mb-4">Your Rights</h2>
                <p>
                  You have the right to:
                </p>
                <ul className="list-disc list-inside space-y-2 mt-4">
                  <li>Access your personal information</li>
                  <li>Correct inaccurate information</li>
                  <li>Request deletion of your information</li>
                  <li>Opt-out of marketing communications</li>
                  <li>Opt-out of SMS communications by replying STOP</li>
                </ul>
              </div>

              <div>
                <h2 className="text-2xl font-display font-bold text-foreground mb-4">Cookies and Tracking</h2>
                <p>
                  We use cookies and similar tracking technologies to enhance your experience on our Services. You can control cookie settings through your browser preferences.
                </p>
              </div>

              <div>
                <h2 className="text-2xl font-display font-bold text-foreground mb-4">Third-Party Links</h2>
                <p>
                  Our Services may contain links to third-party websites. We are not responsible for the privacy practices of these websites. We encourage you to review their privacy policies.
                </p>
              </div>

              <div>
                <h2 className="text-2xl font-display font-bold text-foreground mb-4">Children's Privacy</h2>
                <p>
                  Our Services are not intended for children under 13. We do not knowingly collect personal information from children under 13. If we become aware that we have collected personal information from a child under 13, we will delete such information.
                </p>
              </div>

              <div>
                <h2 className="text-2xl font-display font-bold text-foreground mb-4">Changes to This Policy</h2>
                <p>
                  We may update this Privacy Policy from time to time. We will notify you of any material changes by posting the updated policy on our website and updating the "Last Updated" date.
                </p>
              </div>

              <div>
                <h2 className="text-2xl font-display font-bold text-foreground mb-4">Contact Us</h2>
                <p>
                  If you have questions about this Privacy Policy or our privacy practices, please contact us at:
                </p>
                <div className="mt-4 space-y-2">
                  <p>Brad Thompson Consulting LLC</p>
                  <p>Email: brad@investorautomationsos.com</p>
                  <p>Phone: (972) 954-8586</p>
                  <p>Location: McKinney, Texas</p>
                </div>
              </div>

              <div className="pt-8 border-t border-border">
                <p className="text-sm">
                  Last Updated: May 22, 2026
                </p>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
