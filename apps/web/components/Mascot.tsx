/**
 * The ICEmarkets mascot: an original ice-cream-cone character, two scoops purple→green, waffle cone,
 * simple face. Used small in the nav logo, larger in empty states and the 404 page.
 */
interface MascotProps {
  size?: number;
  className?: string;
  mood?: "happy" | "sad" | "neutral";
}

export default function Mascot({ size = 48, className = "", mood = "happy" }: MascotProps) {
  const eyeY = mood === "sad" ? 100 : 96;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="ICEmarkets mascot"
    >
      <defs>
        <linearGradient id="iceScoopTop" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#9945FF" />
          <stop offset="1" stopColor="#7A3FE0" />
        </linearGradient>
        <linearGradient id="iceScoopBottom" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#14F195" />
          <stop offset="1" stopColor="#0FD986" />
        </linearGradient>
      </defs>

      {/* cone */}
      <path d="M20 34 L44 34 L34 60 Q32 63 30 60 Z" fill="#D9A05B" />
      <path
        d="M20 34 L44 34 L34 60 Q32 63 30 60 Z"
        fill="none"
        stroke="#B87F3E"
        strokeWidth="1"
        opacity="0.5"
      />
      <path d="M22 38 L42 38 M23 44 L41 44 M25 50 L39 50" stroke="#B87F3E" strokeWidth="1.2" opacity="0.6" />

      {/* bottom scoop (green) */}
      <circle cx="32" cy="32" r="15" fill="url(#iceScoopBottom)" />
      {/* top scoop (purple) */}
      <circle cx="32" cy="20" r="13" fill="url(#iceScoopTop)" />
      {/* swirl tip */}
      <path d="M32 6 Q36 8 33 13 Q31 15 32 9 Z" fill="url(#iceScoopTop)" />

      {/* face on bottom scoop */}
      <circle cx="26" cy={eyeY} r="2.1" fill="#0A0A0F" />
      <circle cx="38" cy={eyeY} r="2.1" fill="#0A0A0F" />
      {mood === "sad" ? (
        <path d="M27 40 Q32 36 37 40" stroke="#0A0A0F" strokeWidth="2" fill="none" strokeLinecap="round" />
      ) : (
        <path d="M27 40 Q32 44 37 40" stroke="#0A0A0F" strokeWidth="2" fill="none" strokeLinecap="round" />
      )}
      <circle cx="21" cy="38" r="2.4" fill="#FF9AD1" opacity="0.6" />
      <circle cx="43" cy="38" r="2.4" fill="#FF9AD1" opacity="0.6" />

      {/* sprinkles */}
      <rect x="24" y="14" width="3" height="1.4" rx="0.7" fill="#F5F5F7" transform="rotate(20 24 14)" />
      <rect x="34" y="12" width="3" height="1.4" rx="0.7" fill="#0A0A0F" transform="rotate(-15 34 12)" />
      <rect x="30" y="24" width="3" height="1.4" rx="0.7" fill="#F5F5F7" transform="rotate(45 30 24)" />
    </svg>
  );
}
