/**
 * Botón "Abrir Gmail / Outlook / …" según el dominio del correo. Para correos
 * corporativos (dominio propio) no se muestra nada: no sabemos dónde está su
 * bandeja.
 */

type Proveedor = { nombre: string; url: string; logo: React.ReactNode };

const GMAIL = (
  <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#4285F4" d="M6 40h7V22.5L3 15v22a3 3 0 0 0 3 3z" />
    <path fill="#34A853" d="M35 40h7a3 3 0 0 0 3-3V15l-10 7.5z" />
    <path fill="#FBBC04" d="M35 9.5v12.5l10-7.5v-4c0-3.7-4.2-5.8-7.2-3.6z" />
    <path fill="#EA4335" d="M13 22.5V9.5l11 8.25 11-8.25v12.5l-11 8.25z" />
    <path fill="#C5221F" d="M3 10.5v4l10 7.5V9.5l-2.8-2.1C7.2 5.2 3 7.3 3 10.5z" />
  </svg>
);

const OUTLOOK = (
  <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
    <rect x="18" y="8" width="26" height="32" rx="3" fill="#28A8EA" />
    <rect x="4" y="12" width="24" height="24" rx="3" fill="#0A64C8" />
    <ellipse cx="16" cy="24" rx="6" ry="7.5" fill="none" stroke="#fff" strokeWidth="3.4" />
  </svg>
);

const YAHOO = (
  <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
    <rect width="48" height="48" rx="10" fill="#6001D2" />
    <path fill="#fff" d="M11 16h6l4.5 11L26 16h6l-8.5 19h-6l2.2-5z" />
    <circle cx="35" cy="31" r="2.6" fill="#fff" />
    <path fill="#fff" d="M33 13h5l-1.6 14h-2z" />
  </svg>
);

const ICLOUD = (
  <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
    <rect width="48" height="48" rx="10" fill="#3693F3" />
    <path
      fill="#fff"
      d="M15 33a7 7 0 0 1-.8-13.95A10 10 0 0 1 33.3 17.4 7.8 7.8 0 0 1 33 33z"
    />
  </svg>
);

const PROTON = (
  <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
    <rect width="48" height="48" rx="10" fill="#6D4AFF" />
    <path fill="#fff" d="M12 14h24a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H12a2 2 0 0 1-2-2V16a2 2 0 0 1 2-2zm1 4v.5L24 26l11-7.5V18L24 25.5z" />
  </svg>
);

const SOBRE = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="m3 7 9 6 9-6" />
  </svg>
);

function proveedorDe(email: string): Proveedor | null {
  const dominio = email.trim().toLowerCase().split("@")[1] ?? "";
  if (!dominio) return null;
  // Gmail: busca en todas las carpetas (incluido spam) el correo de Estradox.
  if (["gmail.com", "googlemail.com"].includes(dominio)) {
    return {
      nombre: "Gmail",
      url: "https://mail.google.com/mail/u/0/#search/in%3Aanywhere+Estradox",
      logo: GMAIL,
    };
  }
  if (/^(hotmail|outlook|live|msn)\.[a-z.]+$/.test(dominio)) {
    return { nombre: "Outlook", url: "https://outlook.live.com/mail/0/", logo: OUTLOOK };
  }
  if (/^(yahoo|ymail|rocketmail)\.[a-z.]+$/.test(dominio)) {
    return { nombre: "Yahoo Mail", url: "https://mail.yahoo.com/", logo: YAHOO };
  }
  if (["icloud.com", "me.com", "mac.com"].includes(dominio)) {
    return { nombre: "iCloud Mail", url: "https://www.icloud.com/mail", logo: ICLOUD };
  }
  if (["proton.me", "protonmail.com", "pm.me"].includes(dominio)) {
    return { nombre: "Proton Mail", url: "https://mail.proton.me/", logo: PROTON };
  }
  if (["aol.com"].includes(dominio)) {
    return { nombre: "AOL Mail", url: "https://mail.aol.com/", logo: SOBRE };
  }
  if (/^zoho(mail)?\.[a-z.]+$/.test(dominio)) {
    return { nombre: "Zoho Mail", url: "https://mail.zoho.com/", logo: SOBRE };
  }
  return null; // correo corporativo / dominio propio
}

export function OpenInboxButton({ email }: { email: string }) {
  const p = proveedorDe(email);
  if (!p) return null;
  return (
    <a
      href={p.url}
      target="_blank"
      rel="noopener noreferrer"
      className="btn inbox-btn"
      style={{ width: "100%", justifyContent: "center", marginTop: 12 }}
    >
      <span className="inbox-logo">{p.logo}</span>
      Abrir {p.nombre}
    </a>
  );
}
