import { getSiteSettings } from "@/lib/settings";

/**
 * Logo del sitio (PNG). Usa el logo subido por el admin si existe; si no, el
 * logo por defecto de Estradox. Servidor: lee los ajustes del sitio.
 */
export async function BrandLogo({ size = "md" }: { size?: "md" | "lg" }) {
  const s = await getSiteSettings();
  const src = s.logoDataUrl ?? "/logo-estradox.png";
  return (
    <span className="logo-chip">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={s.brandName}
        className={`brand-logo ${size === "lg" ? "lg" : ""}`}
      />
    </span>
  );
}
