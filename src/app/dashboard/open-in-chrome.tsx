"use client";

import { useEffect, useState } from "react";

/**
 * Tras verificar el correo desde la app de Gmail, la página queda en el
 * navegador interno de Gmail. En Android, este botón la abre en Chrome (la
 * sesión ya iniciada se comparte, así que entra directo).
 */
export function OpenInChrome() {
  const [android, setAndroid] = useState(false);
  useEffect(() => setAndroid(/android/i.test(navigator.userAgent)), []);
  if (!android) return null;

  const destino = `${window.location.host}/dashboard`;
  return (
    <div style={{ marginTop: 10 }}>
      <a
        className="btn secondary"
        href={`intent://${destino}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(`https://${destino}`)};end`}
      >
        Abrir en Chrome
      </a>
      <div className="small" style={{ marginTop: 6, opacity: 0.85 }}>
        ¿Abriste el enlace desde la app de Gmail? Sigue en Chrome con tu sesión ya iniciada.
      </div>
    </div>
  );
}
