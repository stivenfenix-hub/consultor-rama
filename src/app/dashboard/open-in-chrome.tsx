"use client";

import { useEffect, useState } from "react";

/**
 * Tras verificar el correo desde una app de correo (Gmail, Outlook…), la página
 * queda en el navegador interno de esa app. Ese navegador es Chrome por dentro,
 * así que ningún enlace lo saca: solo su menú "Abrir en Chrome". Se muestra la
 * indicación únicamente cuando la página viene de una app de Android
 * (referrer android-app://…); la sesión ya iniciada se comparte con Chrome.
 */
export function OpenInChrome() {
  const [enApp, setEnApp] = useState(false);
  useEffect(() => setEnApp(document.referrer.startsWith("android-app://")), []);
  if (!enApp) return null;

  return (
    <div className="small" style={{ marginTop: 8, opacity: 0.9 }}>
      Para seguir en Chrome: toca <b>⋮</b> (arriba a la derecha) y elige <b>Abrir en Chrome</b>. Tu
      sesión ya está iniciada.
    </div>
  );
}
