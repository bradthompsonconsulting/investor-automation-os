import { motion } from "framer-motion";
import { useState, useEffect } from "react";

interface LeadCard {
  id: string;
  name: string;
  progress: number;
  stage: number;
}

export function AcquisitionEngineVisual() {
  const [leads, setLeads] = useState<LeadCard[]>([
    { id: "1", name: "Sarah Mitchell", progress: 0, stage: 0 },
    { id: "2", name: "Marcus Johnson", progress: 0, stage: 0 },
    { id: "3", name: "Jennifer Lee", progress: 0, stage: 0 },
  ]);

  const stages = [
    { label: "Lead Source", icon: "📥", color: "from-blue-500" },
    { label: "Data Scrubbing", icon: "✓", color: "from-cyan-500" },
    { label: "SMS & Email", icon: "💬", color: "from-cyan-400" },
    { label: "Qualification", icon: "🎯", color: "from-accent" },
    { label: "Booking", icon: "📅", color: "from-cyan-500" },
    { label: "Pipeline", icon: "📊", color: "from-blue-500" },
    { label: "Notifications", icon: "🔔", color: "from-cyan-400" },
    { label: "Drip Campaigns", icon: "♻️", color: "from-accent" },
  ];

  // Auto-advance leads through stages
  useEffect(() => {
    const interval = setInterval(() => {
      setLeads((prev) =>
        prev.map((lead) => ({
          ...lead,
          stage: (lead.stage + 1) % stages.length,
          progress: (lead.progress + 1) % 100,
        }))
      );
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="relative w-full h-full">
      {/* SVG Workflow Lines */}
      <svg
        className="absolute inset-0 w-full h-full pointer-events-none"
        viewBox="0 0 1200 400"
        preserveAspectRatio="none"
      >
        {/* Animated workflow line */}
        <defs>
          <linearGradient id="flowGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="rgba(0, 217, 255, 0)" />
            <stop offset="50%" stopColor="rgba(0, 217, 255, 0.8)" />
            <stop offset="100%" stopColor="rgba(0, 217, 255, 0)" />
          </linearGradient>
          <filter id="glow">
            <feGaussianBlur stdDeviation="2" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Main workflow path */}
        <path
          d="M 50 200 L 1150 200"
          stroke="url(#flowGradient)"
          strokeWidth="3"
          fill="none"
          filter="url(#glow)"
        />

        {/* Pulsing connection points */}
        {stages.map((_, idx) => {
          const x = 50 + (idx * 1100) / (stages.length - 1);
          return (
            <g key={`pulse-${idx}`}>
              <circle
                cx={x}
                cy="200"
                r="8"
                fill="rgba(0, 217, 255, 0.3)"
                className="animate-pulse"
                style={{ animationDuration: "2s" }}
              />
              <circle
                cx={x}
                cy="200"
                r="4"
                fill="rgb(0, 217, 255)"
              />
            </g>
          );
        })}

        {/* Animated particles flowing along path */}
        {[0, 1, 2].map((particle) => (
          <motion.circle
            key={`particle-${particle}`}
            cx="50"
            cy="200"
            r="3"
            fill="rgb(0, 217, 255)"
            initial={{ cx: 50 }}
            animate={{ cx: 1150 }}
            transition={{
              duration: 4,
              delay: particle * 1.3,
              repeat: Infinity,
              ease: "linear",
            }}
            filter="url(#glow)"
          />
        ))}
      </svg>

      {/* Stage Cards */}
      <div className="relative flex justify-between items-center h-full px-4">
        {stages.map((stage, idx) => (
          <motion.div
            key={idx}
            initial={{ opacity: 0, scale: 0.8 }}
            whileInView={{ opacity: 1, scale: 1 }}
            transition={{ delay: idx * 0.1, duration: 0.5 }}
            viewport={{ once: true }}
            className="flex flex-col items-center"
          >
            <div className={`w-16 h-16 rounded-full bg-gradient-to-br ${stage.color} to-cyan-600 flex items-center justify-center text-3xl font-bold mb-3 shadow-[0_0_20px_rgba(0,217,255,0.4)] hover:shadow-[0_0_30px_rgba(0,217,255,0.6)] transition-all duration-300`}>
              {stage.icon}
            </div>
            <span className="text-xs font-medium text-center text-foreground whitespace-nowrap w-20">
              {stage.label}
            </span>
          </motion.div>
        ))}
      </div>

      {/* Lead Cards Moving Through Pipeline */}
      <div className="absolute top-1/2 left-0 w-full h-24 pointer-events-none">
        {leads.map((lead, idx) => {
          const x = 50 + (lead.stage * 1100) / (stages.length - 1);
          return (
            <motion.div
              key={lead.id}
              initial={{ x: 50, y: -60 + idx * 40 }}
              animate={{ x }}
              transition={{ duration: 2.5, ease: "easeInOut" }}
              className="absolute w-32 h-12 bg-gradient-to-r from-accent/20 to-cyan-500/20 border border-accent/50 rounded-lg p-2 shadow-[0_0_16px_rgba(0,217,255,0.3)]"
            >
              <div className="text-xs font-medium text-accent truncate">
                {lead.name}
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {stages[lead.stage].label}
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
