import { LOGOS } from "@/lib/marca";

/** Logo del sitio (archivo publicado en public/marca): letra clara de noche, oscura de día. */
export function BrandLogo({ size = "md" }: { size?: "md" | "lg" }) {
  const clase = `brand-logo ${size === "lg" ? "lg" : ""}`;
  return (
    <span className="logo-chip">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={LOGOS.plataforma} alt="Estradox" className={`${clase} logo-noche`} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={LOGOS.correo} alt="Estradox" className={`${clase} logo-dia`} />
    </span>
  );
}
