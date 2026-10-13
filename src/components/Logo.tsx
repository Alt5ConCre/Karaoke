/**
 * Logo — an eight-ray sun with three stars, a restrained nod to the Philippine
 * flag, rendered as inline SVG so there is no asset to load.
 */
export function Logo({ size = 36 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label="Filipino Videoke"
      className="logo-svg"
    >
      <defs>
        <radialGradient id="fv-sun" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fff3b0" />
          <stop offset="55%" stopColor="#fcd116" />
          <stop offset="100%" stopColor="#f5a623" />
        </radialGradient>
      </defs>
      <g className="logo-rays">
        {Array.from({ length: 8 }).map((_, index) => (
          <rect
            key={index}
            x="30.4"
            y="1.5"
            width="3.2"
            height="15"
            rx="1.4"
            fill="#fcd116"
            opacity="0.85"
            transform={`rotate(${index * 45} 32 32)`}
          />
        ))}
      </g>
      <circle cx="32" cy="32" r="13" fill="url(#fv-sun)" />
      <g fill="#ffffff">
        <polygon points="32,14 33.6,18 37.8,18 34.4,20.6 35.6,24.6 32,22.2 28.4,24.6 29.6,20.6 26.2,18 30.4,18" />
        <circle cx="14" cy="50" r="2.2" />
        <circle cx="50" cy="50" r="2.2" />
      </g>
    </svg>
  )
}
