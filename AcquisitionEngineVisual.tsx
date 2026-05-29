import React from 'react';
import { motion } from 'framer-motion';
import { 
  Search, 
  Target, 
  Zap, 
  MessageSquare, 
  Phone, 
  Mail, 
  Calendar, 
  CheckCircle2,
  Database,
  Bot,
  ArrowRight
} from 'lucide-react';

const AcquisitionEngineVisual = () => {
  const steps = [
    {
      id: 'capture',
      title: 'Lead Capture',
      icon: <Search className="w-5 h-5" />,
      color: 'text-blue-400',
      bgColor: 'bg-blue-400/10',
      borderColor: 'border-blue-400/20',
      description: 'Omnichannel lead intake',
      subtasks: ['Direct Mail', 'PPC/SEO', 'Social Media', 'Cold Call']
    },
    {
      id: 'process',
      title: 'AI Processing',
      icon: <Bot className="w-5 h-5" />,
      color: 'text-purple-400',
      bgColor: 'bg-purple-400/10',
      borderColor: 'border-purple-400/20',
      description: 'Instant lead qualification',
      subtasks: ['Lead Scoring', 'Data Enrichment', 'AI Chatbot', 'Verification']
    },
    {
      id: 'engage',
      title: 'Smart Engagement',
      icon: <Zap className="w-5 h-5" />,
      color: 'text-cyan-400',
      bgColor: 'bg-cyan-400/10',
      borderColor: 'border-cyan-400/20',
      description: 'Automated multi-touch',
      subtasks: ['SMS Sequences', 'Email Drip', 'RVM Drops', 'Direct Dial']
    },
    {
      id: 'convert',
      title: 'Conversion',
      icon: <Target className="w-5 h-5" />,
      color: 'text-emerald-400',
      bgColor: 'bg-emerald-400/10',
      borderColor: 'border-emerald-400/20',
      description: 'Ready-to-close deals',
      subtasks: ['Live Transfer', 'Appointment Set', 'Offer Sent', 'Closed Won']
    }
  ];

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.2
      }
    }
  };

  const itemVariants = {
    hidden: { y: 20, opacity: 0 },
    visible: {
      y: 0,
      opacity: 1,
      transition: {
        duration: 0.5,
        ease: "easeOut"
      }
    }
  };

  return (
    <div className="w-full max-w-6xl mx-auto py-12 px-4">
      <div className="text-center mb-16">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-4">
            The Investor Acquisition Engine
          </h2>
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
            A high-performance automated system that turns raw leads into predictable revenue.
          </p>
        </motion.div>
      </div>

      <motion.div 
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 relative"
        variants={containerVariants}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: "-100px" }}
      >
        {/* Connection lines for desktop */}
        <div className="hidden lg:block absolute top-1/2 left-0 w-full h-px bg-gradient-to-r from-transparent via-accent/20 to-transparent -translate-y-1/2 -z-10" />

        {steps.map((step, index) => (
          <motion.div
            key={step.id}
            variants={itemVariants}
            className={`relative p-6 rounded-2xl border ${step.borderColor} bg-background/50 backdrop-blur-sm hover:border-accent/40 transition-all duration-300 group`}
          >
            {/* Step Number Badge */}
            <div className="absolute -top-3 -right-3 w-8 h-8 rounded-full bg-secondary border border-border flex items-center justify-center text-xs font-bold text-muted-foreground">
              0{index + 1}
            </div>

            <div className={`w-12 h-12 rounded-xl ${step.bgColor} ${step.color} flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300`}>
              {step.icon}
            </div>

            <h3 className="text-xl font-display font-bold text-foreground mb-2">
              {step.title}
            </h3>
            <p className="text-sm text-muted-foreground mb-6">
              {step.description}
            </p>

            <ul className="space-y-3">
              {step.subtasks.map((task, i) => (
                <li key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                  <div className={`w-1.5 h-1.5 rounded-full ${step.bgColor.replace('/10', '')}`} />
                  {task}
                </li>
              ))}
            </ul>

            {index < steps.length - 1 && (
              <div className="hidden lg:flex absolute -right-3 top-1/2 -translate-y-1/2 z-10 text-accent/30 group-hover:text-accent/60 transition-colors">
                <ArrowRight className="w-6 h-6" />
              </div>
            )}
          </motion.div>
        ))}
      </motion.div>

      {/* Infrastructure Footer */}
      <motion.div 
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        transition={{ delay: 1, duration: 1 }}
        className="mt-16 pt-8 border-t border-border/50 flex flex-wrap justify-center gap-8 md:gap-16 opacity-60"
      >
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Database className="w-4 h-4" />
          <span>Centralized CRM</span>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <MessageSquare className="w-4 h-4" />
          <span>Omnichannel Comms</span>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <CheckCircle2 className="w-4 h-4" />
          <span>Compliance Built-in</span>
        </div>
      </motion.div>
    </div>
  );
};

export default AcquisitionEngineVisual;
