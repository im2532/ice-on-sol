import type { CSSProperties } from "react";

const FLAKES = [
  [3, 0, 15, 5], [7, 8, 22, 7], [12, 3, 18, 4],
  [17, 14, 25, 6], [22, 6, 17, 8], [27, 19, 23, 4],
  [32, 2, 20, 6], [37, 11, 27, 5], [42, 17, 19, 7],
  [47, 5, 24, 4], [52, 21, 16, 6], [57, 9, 26, 8],
  [62, 15, 21, 5], [67, 1, 18, 7], [72, 23, 25, 4],
  [77, 7, 20, 6], [82, 13, 28, 5], [87, 4, 17, 8],
  [92, 18, 23, 4], [96, 10, 19, 6],
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
