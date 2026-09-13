import type { CSSProperties } from "react";

const FLAKES = [
  [4, 0, 18, 4],
  [11, 7, 24, 6],
  [18, 14, 20, 3],
  [25, 3, 27, 5],
  [33, 19, 22, 4],
  [41, 10, 30, 7],
  [49, 24, 21, 3],
  [57, 5, 26, 5],
  [65, 17, 31, 4],
  [72, 9, 23, 6],
  [79, 26, 28, 3],
  [86, 12, 20, 5],
  [93, 21, 29, 4],
] as const;

type ParticleStyle = CSSProperties & {
  "--flake-x": string;
  "--flake-delay": string;
  "--flake-duration": string;
  "--flake-size": string;
};

/** Decorative only: a quiet layer that never receives pointer or screen-reader input. */
export default function IceAtmosphere() {
  return (
    <div className="ice-atmosphere" aria-hidden="true">
      {FLAKES.map(([x, delay, duration, size], index) => (
        <span
          className={`ice-flake ${index % 4 === 0 ? "ice-flake-diamond" : ""}`}
          key={`${x}-${delay}`}
          style={
            {
              "--flake-x": `${x}%`,
              "--flake-delay": `-${delay}s`,
              "--flake-duration": `${duration}s`,
              "--flake-size": `${size}px`,
            } as ParticleStyle
          }
        />
      ))}
      <span className="ice-shard ice-shard-left" />
      <span className="ice-shard ice-shard-right" />
    </div>
  );
}
