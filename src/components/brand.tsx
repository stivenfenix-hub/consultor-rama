/** Marca Estradox: ícono angular con degradado + wordmark. */
export function Brand({ size = "md" }: { size?: "md" | "lg" }) {
  return (
    <span className={`wordmark ${size === "lg" ? "lg" : ""}`} aria-label="Estradox">
      <svg className="mark" viewBox="0 0 48 48" fill="none" aria-hidden="true">
        <defs>
          <linearGradient
            id="estradox-grad"
            x1="2"
            y1="4"
            x2="46"
            y2="44"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="#a259ff" />
            <stop offset="0.5" stopColor="#6a2bf5" />
            <stop offset="1" stopColor="#3a1bd8" />
          </linearGradient>
        </defs>
        <path d="M7 4 L21 4 L41 44 L27 44 Z" fill="url(#estradox-grad)" />
        <path
          d="M41 4 L27 4 L7 44 L21 44 Z"
          fill="url(#estradox-grad)"
          opacity="0.5"
        />
      </svg>
      <span className="word">Estradox</span>
    </span>
  );
}
