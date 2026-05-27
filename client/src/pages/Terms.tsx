import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";
import { motion } from "framer-motion";

export default function Terms() {
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
            Terms & Conditions
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
                <h2 className="text-2xl font-display font-bold text-foreground mb-4">Agreement to Terms</h2>
                <p>
                  These Terms & Conditions ("Terms") constitute a legal agreement between you and Brad Thompson Consulting LLC / Investor Automation OS ("Company," "we," "us," or "our"). By accessing and using our website, services, and applications (collectively, the "Services"), you agree to be bound by these Terms. If you do not agree to these Terms, please do not use our Services.
                </p>
              </div>

              <div>
                <h2 className="text-2xl font-display font-bold text-foreground mb-4">Use License</h2>
                <p>
                  Permission is granted to temporarily download one copy of the materials (information or software) on our Services for personal, non-commercial transitory viewing only. This is the grant of a license, not a transfer of title, and under this license you may not:
                </p>
                <ul className="list-disc list-inside space-y-2 mt-4">
                  <li>Modify or copy the materials</li>
                  <li>Use the materials for any commercial purpose or for any public display</li>
                  <li>Attempt to decompile or reverse engineer any software contained on our Services</li>
                  <li>Remove any copyright or other proprietary notations from the materials</li>
                  <li>Transfer the materials to another person or "mirror" the materials on any other server</li>
                </ul>
              </div>

              <div>
                <h2 className="text-2xl font-display font-bold text-foreground mb-4">Disclaimer</h2>
                <p>
                  The materials on our Services are provided on an "as is" basis. We make no warranties, expressed or implied, and hereby disclaim and negate all other warranties including, without limitation, implied warranties or conditions of merchantability, fitness for a particular purpose, or non-infringement of intellectual property or other violation of rights.
                </p>
              </div>

              <div>
                <h2 className="text-2xl font-display font-bold text-foreground mb-4">Limitations</h2>
                <p>
                  In no event shall Brad Thompson Consulting LLC or its suppliers be liable for any damages (including, without limitation, damages for loss of data or profit, or due to business interruption) arising out of the use or inability to use the materials on our Services, even if we or our authorized representative has been notified orally or in writing of the possibility of such damage.
                </p>
              </div>

              <div>
                <h2 className="text-2xl font-display font-bold text-foreground mb-4">Accuracy of Materials</h2>
                <p>
                  The materials appearing on our Services could include technical, typographical, or photographic errors. We do not warrant that any of the materials on our Services are accurate, complete, or current. We may make changes to the materials contained on our Services at any time without notice.
                </p>
              </div>

              <div>
                <h2 className="text-2xl font-display font-bold text-foreground mb-4">Links</h2>
                <p>
                  We have not reviewed all of the sites linked to our website and are not responsible for the contents of any such linked site. The inclusion of any link does not imply endorsement by us of the site. Use of any such linked website is at the user's own risk.
                </p>
              </div>

              <div>
                <h2 className="text-2xl font-display font-bold text-foreground mb-4">Modifications</h2>
                <p>
                  We may revise these Terms for our Services at any time without notice. By using this website, you are agreeing to be bound by the then current version of these Terms.
                </p>
              </div>

              <div>
                <h2 className="text-2xl font-display font-bold text-foreground mb-4">Governing Law</h2>
                <p>
                  These Terms and Conditions are governed by and construed in accordance with the laws of the State of Texas, and you irrevocably submit to the exclusive jurisdiction of the courts in that location.
                </p>
              </div>

              <div>
                <h2 className="text-2xl font-display font-bold text-foreground mb-4">SMS Compliance</h2>
                <p>
                  By submitting your information, you agree to receive SMS communications from Brad Thompson Consulting LLC / Investor Automation OS. Message frequency varies. Msg & data rates may apply. Reply STOP to unsubscribe and HELP for help. Standard message and data rates apply. We comply with all applicable SMS regulations and laws.
                </p>
              </div>

              <div>
                <h2 className="text-2xl font-display font-bold text-foreground mb-4">User Responsibilities</h2>
                <p>
                  You agree to:
                </p>
                <ul className="list-disc list-inside space-y-2 mt-4">
                  <li>Provide accurate and complete information</li>
                  <li>Maintain the confidentiality of your account information</li>
                  <li>Not use our Services for any illegal or unauthorized purpose</li>
                  <li>Not violate any laws in your jurisdiction</li>
                  <li>Not transmit any harmful or malicious code</li>
                  <li>Not attempt to gain unauthorized access to our systems</li>
                </ul>
              </div>

              <div>
                <h2 className="text-2xl font-display font-bold text-foreground mb-4">Intellectual Property Rights</h2>
                <p>
                  All content on our Services, including text, graphics, logos, images, and software, is the property of Brad Thompson Consulting LLC or its content suppliers and is protected by international copyright laws. You may not reproduce, distribute, or transmit any content without our prior written permission.
                </p>
              </div>

              <div>
                <h2 className="text-2xl font-display font-bold text-foreground mb-4">Limitation of Liability</h2>
                <p>
                  To the fullest extent permitted by law, in no event shall Brad Thompson Consulting LLC be liable for any indirect, incidental, special, consequential, or punitive damages, regardless of the cause of action or the theory of liability, even if we have been advised of the possibility of such damages.
                </p>
              </div>

              <div>
                <h2 className="text-2xl font-display font-bold text-foreground mb-4">Contact Us</h2>
                <p>
                  If you have questions about these Terms & Conditions, please contact us at:
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
