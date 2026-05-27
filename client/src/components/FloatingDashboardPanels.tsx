import { motion } from "framer-motion";
import { BarChart3, TrendingUp, Users, Zap } from "lucide-react";

export function FloatingDashboardPanels() {
  const panels = [
    {
      title: "Sales Pipeline",
      icon: BarChart3,
      color: "from-cyan-500/20 to-blue-500/20",
      borderColor: "border-cyan-500/30",
      stats: [
        { label: "Prospects", value: "847" },
        { label: "Qualified", value: "234" },
        { label: "Appointments", value: "89" },
      ],
      zIndex: 30,
      position: { x: -40, y: -60 },
      opacity: 0.65,
    },
    {
      title: "Performance",
      icon: TrendingUp,
      color: "from-accent/20 to-cyan-400/20",
      borderColor: "border-accent/30",
      stats: [
        { label: "Response Rate", value: "94%" },
        { label: "Close Rate", value: "28%" },
        { label: "Avg Deal", value: "$145K" },
      ],
      zIndex: 40,
      position: { x: 0, y: 0 },
      opacity: 0.85,
    },
    {
      title: "Team Activity",
      icon: Users,
      color: "from-blue-500/20 to-cyan-500/20",
      borderColor: "border-blue-500/30",
      stats: [
        { label: "Active Users", value: "12" },
        { label: "Calls Today", value: "156" },
        { label: "Deals Closed", value: "8" },
      ],
      zIndex: 20,
      position: { x: 40, y: 60 },
      opacity: 0.5,
    },
  ];

  return (
    <div className="relative w-full h-96 perspective">
      {panels.map((panel, idx) => {
        const Icon = panel.icon;
        return (
          <motion.div
            key={idx}
            initial={{ opacity: 0, scale: 0.8 }}
            whileInView={{ opacity: panel.opacity, scale: 1 }}
            viewport={{ once: true }}
            animate={{
              y: [0, -20, 0],
            }}
            transition={{
              delay: idx * 0.15,
              duration: 6 + idx * 2,
              repeat: Infinity,
              ease: "easeInOut",
            }}
            className={`absolute w-72 rounded-xl backdrop-blur-sm border ${panel.borderColor} bg-gradient-to-br ${panel.color} p-6 shadow-[0_8px_32px_rgba(0,217,255,0.15)] hover:shadow-[0_8px_48px_rgba(0,217,255,0.25)] transition-all duration-300`}
            style={{
              zIndex: panel.zIndex,
              left: `calc(50% + ${panel.position.x}px)`,
              top: `calc(50% + ${panel.position.y}px)`,
              transform: "translate(-50%, -50%)",
            }}
          >
            {/* Panel Header */}
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-lg bg-accent/20">
                <Icon size={20} className="text-accent" />
              </div>
              <h3 className="font-semibold text-foreground">{panel.title}</h3>
            </div>

            {/* Panel Stats */}
            <div className="space-y-3">
              {panel.stats.map((stat, statIdx) => (
                <div key={statIdx} className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">{stat.label}</span>
                  <span className="text-lg font-bold text-accent">{stat.value}</span>
                </div>
              ))}
            </div>

            {/* Glow effect */}
            <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-accent/0 via-transparent to-accent/0 pointer-events-none" />
          </motion.div>
        );
      })}
    </div>
  );
}
