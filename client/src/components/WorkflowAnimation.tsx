import { motion } from "framer-motion";

interface WorkflowAnimationProps {
  steps: number;
  className?: string;
  showParticles?: boolean;
}

/**
 * Animated workflow visualization with SVG lines and particles
 * Creates a cinematic "data in motion" effect for acquisition machine flows
 */
export function WorkflowAnimation({
  steps = 5,
  className = "",
  showParticles = true,
}: WorkflowAnimationProps) {
  // Calculate positions for workflow nodes
  const nodePositions = Array.from({ length: steps }, (_, i) => ({
    x: (i / (steps - 1)) * 100,
    y: 50,
  }));

  // Particle animation variants
  const particleVariants = {
    initial: { opacity: 0, pathLength: 0 },
    animate: {
      opacity: [0, 1, 1, 0],
      pathLength: [0, 1],
      transition: {
        duration: 3,
        repeat: Infinity,
        repeatDelay: 1,
        ease: "linear",
      },
    },
  };

  // Pulsing node effect
  const nodeVariants = {
    animate: {
      scale: [1, 1.2, 1],
      boxShadow: [
        "0 0 0 0 rgba(0, 217, 255, 0.4)",
        "0 0 0 8px rgba(0, 217, 255, 0)",
      ],
      transition: {
        duration: 2,
        repeat: Infinity,
        repeatDelay: 0.5,
      },
    },
  };

  return (
    <div className={`w-full h-32 relative ${className}`}>
      <svg
        viewBox="0 0 100 100"
        className="w-full h-full"
        preserveAspectRatio="none"
      >
        {/* Animated connection lines */}
        {nodePositions.map((pos, i) => {
          if (i === nodePositions.length - 1) return null;

          const nextPos = nodePositions[i + 1];
          const pathId = `workflow-path-${i}`;

          return (
            <g key={`line-${i}`}>
              {/* Base line */}
              <line
                x1={`${pos.x}%`}
                y1={`${pos.y}%`}
                x2={`${nextPos.x}%`}
                y2={`${nextPos.y}%`}
                stroke="rgba(0, 217, 255, 0.15)"
                strokeWidth="0.8"
                vectorEffect="non-scaling-stroke"
              />

              {/* Glowing animated line */}
              <motion.line
                x1={`${pos.x}%`}
                y1={`${pos.y}%`}
                x2={`${nextPos.x}%`}
                y2={`${nextPos.y}%`}
                stroke="rgba(0, 217, 255, 0.6)"
                strokeWidth="1.2"
                vectorEffect="non-scaling-stroke"
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{
                  pathLength: [0, 1, 1],
                  opacity: [0, 0.8, 0.2],
                }}
                transition={{
                  duration: 2.5,
                  repeat: Infinity,
                  repeatDelay: 1.5,
                  ease: "easeInOut",
                }}
                style={{
                  filter: "drop-shadow(0 0 4px rgba(0, 217, 255, 0.5))",
                }}
              />

              {/* Particle dots moving along the line */}
              {showParticles && (
                <motion.circle
                  cx={`${pos.x}%`}
                  cy={`${pos.y}%`}
                  r="0.6"
                  fill="rgba(0, 217, 255, 0.8)"
                  initial={{ offsetDistance: "0%" }}
                  animate={{ offsetDistance: "100%" }}
                  transition={{
                    duration: 3,
                    repeat: Infinity,
                    repeatDelay: 1,
                    ease: "linear",
                  }}
                  style={{
                    offsetPath: `path('M ${pos.x}% ${pos.y}% L ${nextPos.x}% ${nextPos.y}%')`,
                    filter: "drop-shadow(0 0 3px rgba(0, 217, 255, 0.8))",
                  }}
                />
              )}
            </g>
          );
        })}

        {/* Animated nodes */}
        {nodePositions.map((pos, i) => (
          <motion.g key={`node-${i}`}>
            {/* Outer pulsing ring */}
            <motion.circle
              cx={`${pos.x}%`}
              cy={`${pos.y}%`}
              r="2"
              fill="none"
              stroke="rgba(0, 217, 255, 0.4)"
              strokeWidth="0.4"
              vectorEffect="non-scaling-stroke"
              animate={{
                r: [2, 3.5],
                opacity: [1, 0],
              }}
              transition={{
                duration: 2,
                repeat: Infinity,
                repeatDelay: 0.5,
              }}
            />

            {/* Core node */}
            <motion.circle
              cx={`${pos.x}%`}
              cy={`${pos.y}%`}
              r="1.2"
              fill="rgba(0, 217, 255, 0.9)"
              vectorEffect="non-scaling-stroke"
              animate={{
                r: [1.2, 1.5, 1.2],
                boxShadow: [
                  "0 0 0 0 rgba(0, 217, 255, 0.4)",
                  "0 0 0 2px rgba(0, 217, 255, 0.2)",
                ],
              }}
              transition={{
                duration: 2,
                repeat: Infinity,
                repeatDelay: 0.5,
              }}
              style={{
                filter: "drop-shadow(0 0 6px rgba(0, 217, 255, 0.8))",
              }}
            />
          </motion.g>
        ))}
      </svg>
    </div>
  );
}

export default WorkflowAnimation;
