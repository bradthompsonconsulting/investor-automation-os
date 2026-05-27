import { motion, AnimatePresence } from "framer-motion";
import { useState, useEffect } from "react";
import { MessageCircle, Bell, CheckCircle, Clock, AlertCircle } from "lucide-react";

interface ActivityItem {
  id: string;
  type: "sms" | "notification" | "pipeline" | "status";
  message: string;
  timestamp: string;
  status?: "success" | "pending" | "alert";
}

export function LiveSystemActivity() {
  const [activities, setActivities] = useState<ActivityItem[]>([
    {
      id: "1",
      type: "sms",
      message: "SMS sent to Sarah Mitchell",
      timestamp: "2 min ago",
      status: "success",
    },
    {
      id: "2",
      type: "notification",
      message: "Lead qualified: Marcus Johnson",
      timestamp: "1 min ago",
      status: "success",
    },
    {
      id: "3",
      type: "pipeline",
      message: "Appointment scheduled with Jennifer Lee",
      timestamp: "30 sec ago",
      status: "success",
    },
  ]);

  useEffect(() => {
    const interval = setInterval(() => {
      const newActivity: ActivityItem = {
        id: Date.now().toString(),
        type: ["sms", "notification", "pipeline"][Math.floor(Math.random() * 3)] as any,
        message: [
          "SMS sent to new lead",
          "Lead qualified automatically",
          "Appointment scheduled",
          "Follow-up email triggered",
          "Pipeline updated",
        ][Math.floor(Math.random() * 5)],
        timestamp: "now",
        status: "success",
      };

      setActivities((prev) => [newActivity, ...prev.slice(0, 3)]);
    }, 4000);

    return () => clearInterval(interval);
  }, []);

  const getIcon = (type: string) => {
    switch (type) {
      case "sms":
        return <MessageCircle size={16} className="text-accent" />;
      case "notification":
        return <Bell size={16} className="text-cyan-400" />;
      case "pipeline":
        return <CheckCircle size={16} className="text-green-400" />;
      default:
        return <Clock size={16} className="text-amber-400" />;
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
        <span className="text-sm font-medium text-foreground">Live System Activity</span>
      </div>

      <AnimatePresence>
        {activities.map((activity) => (
          <motion.div
            key={activity.id}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ duration: 0.3 }}
            className="flex items-start gap-3 p-3 rounded-lg bg-white/5 border border-white/10 hover:border-accent/30 hover:bg-white/10 transition-all"
          >
            <div className="mt-1">{getIcon(activity.type)}</div>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-foreground truncate">{activity.message}</p>
              <p className="text-xs text-muted-foreground mt-1">{activity.timestamp}</p>
            </div>
            <div className="flex-shrink-0">
              {activity.status === "success" && (
                <CheckCircle size={16} className="text-green-400" />
              )}
              {activity.status === "pending" && (
                <Clock size={16} className="text-amber-400 animate-spin" />
              )}
              {activity.status === "alert" && (
                <AlertCircle size={16} className="text-red-400" />
              )}
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
