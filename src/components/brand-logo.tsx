import { LOGOS } from "@/lib/marca";

/** Logo del sitio (archivo publicado en public/marca). */
export function BrandLogo({ size = "md" }: { size?: "md" | "lg" }) {
  return (
    <span className="logo-chip">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={LOGOS.plataforma}
        alt="Estradox"
        className={`brand-logo ${size === "lg" ? "lg" : ""}`}
      />
    </span>
  );
}
