"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import Script from "next/script";
import { COOKIE_REGISTRO, META_PIXEL_ID } from "@/lib/meta-pixel-config";

/**
 * Píxel de Meta (Facebook/Instagram Ads).
 * - PageView al cargar (lo hace el script base) y en cada cambio de ruta.
 * - CompleteRegistration UNA vez por cuenta nueva: el servidor deja la cookie
 *   COOKIE_REGISTRO al crear la cuenta (formulario o Google); aquí se dispara el
 *   evento y se borra la cookie, así un login o una recarga no lo repiten.
 */

type Fbq = (...args: unknown[]) => void;
const fbq: Fbq = (...args) => (window as unknown as { fbq?: Fbq }).fbq?.(...args);

/**
 * Envía CompleteRegistration si el servidor marcó una cuenta recién creada.
 * Se llama en cada cambio de ruta (registro con Google) y al terminar el
 * formulario de registro (que no cambia de ruta).
 */
export function enviarRegistroPendiente() {
  const id = leerCookie(COOKIE_REGISTRO);
  if (!id) return;
  document.cookie = `${COOKIE_REGISTRO}=; Max-Age=0; path=/`;
  let intentos = 0;
  const enviar = () => {
    // El script base del píxel puede no haber cargado todavía: se espera.
    if (!(window as unknown as { fbq?: Fbq }).fbq) {
      if (++intentos < 40) setTimeout(enviar, 250);
      return;
    }
    fbq(
      "track",
      "CompleteRegistration",
      { content_name: "Prueba Gratis 1 Mes", currency: "COP", value: 0 },
      { eventID: `registro-${id}` }, // evita duplicados si Meta lo recibe dos veces
    );
  };
  enviar();
}

function leerCookie(nombre: string) {
  const par = document.cookie.split("; ").find((c) => c.startsWith(`${nombre}=`));
  return par ? decodeURIComponent(par.slice(nombre.length + 1)) : null;
}

export function MetaPixel() {
  const pathname = usePathname();
  const primera = useRef(true);

  // PageView en navegaciones dentro de la app (la primera la envía el script base).
  useEffect(() => {
    if (primera.current) {
      primera.current = false;
      return;
    }
    fbq("track", "PageView");
  }, [pathname]);

  // Registro nuevo con Google: la cookie llega tras la redirección.
  useEffect(() => enviarRegistroPendiente(), [pathname]);

  // Llegó desde un anuncio (?fbclid=…) y el script de Meta no creó _fbc (Safari,
  // bloqueadores): se crea aquí con el formato de Meta, para que el servidor la
  // mande en CompleteRegistration (Conversions API) y el registro se atribuya.
  useEffect(() => {
    // El fbclid va EXACTO (sin codificar ni cambiar mayúsculas): Meta lo compara con
    // el clic real y marca "fbclid modificado" si difiere. Se toma crudo de la URL;
    // si trae caracteres raros no se arma la cookie (mejor sin fbc que con uno malo).
    const crudo = /[?&]fbclid=([^&#]*)/.exec(window.location.search)?.[1];
    if (!crudo || !/^[A-Za-z0-9_-]+$/.test(crudo) || leerCookie("_fbc")) return;
    document.cookie = `_fbc=fb.1.${Date.now()}.${crudo}; Max-Age=${90 * 86400}; path=/; SameSite=Lax`;
  }, []);

  return (
    <>
      <Script id="meta-pixel" strategy="afterInteractive">
        {`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
document,'script','https://connect.facebook.net/en_US/fbevents.js');
fbq('init','${META_PIXEL_ID}');fbq('track','PageView');`}
      </Script>
      <noscript>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          height="1"
          width="1"
          style={{ display: "none" }}
          alt=""
          src={`https://www.facebook.com/tr?id=${META_PIXEL_ID}&ev=PageView&noscript=1`}
        />
      </noscript>
    </>
  );
}

/**
 * Purchase en el navegador al volver de Bold con el pago aprobado. Mismo eventID
 * que el servidor ("compra-<link>"): Meta cuenta uno. Se recuerda en el navegador
 * para no repetirlo si recarga la página.
 */
export function PixelCompra({ id, valor, nombre }: { id: string; valor: number; nombre: string }) {
  useEffect(() => {
    const clave = `estradox_compra_${id}`;
    try {
      if (localStorage.getItem(clave)) return;
      localStorage.setItem(clave, "1");
    } catch {
      // sin almacenamiento: Meta igual deduplica por eventID
    }
    let intentos = 0;
    const enviar = () => {
      if (!(window as unknown as { fbq?: Fbq }).fbq) {
        if (++intentos < 40) setTimeout(enviar, 250);
        return;
      }
      fbq("track", "Purchase", { content_name: nombre, content_type: "product", currency: "COP", value: valor }, { eventID: `compra-${id}` });
    };
    enviar();
  }, [id, valor, nombre]);
  return null;
}
