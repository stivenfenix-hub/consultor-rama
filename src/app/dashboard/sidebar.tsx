"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NotificationsPrompt } from "@/components/notifications-prompt";
import { SospechosoAviso } from "@/components/sospechoso-aviso";
import { NotificationBell } from "@/components/notification-bell";
import { WhatsappPrompt } from "@/components/whatsapp-prompt";
import { Icon, type IconName } from "@/components/icon";

type NavItem = { href: string; label: string; icon: IconName; pronto?: boolean };

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
  { href: "/dashboard/procesos", label: "Procesos", icon: "scale" },
  {
    href: "/dashboard/notificaciones-certificadas",
    label: "Notificaciones certificadas",
    icon: "certificado",
    pronto: true,
  },
  { href: "/dashboard/suscripcion", label: "Suscripción", icon: "card" },
  { href: "/dashboard/configuracion", label: "Configuración", icon: "settings" },
];

const ADMIN_NAV: { href: string; label: string; icon: IconName }[] = [
  { href: "/dashboard/admin", label: "Panel admin", icon: "shield" },
  { href: "/dashboard/admin/usuarios", label: "Usuarios", icon: "users" },
  { href: "/dashboard/admin/reportes", label: "Reportes", icon: "download" },
  { href: "/dashboard/admin/notificaciones", label: "Notificaciones", icon: "megaphone" },
  { href: "/dashboard/admin/whatsapp", label: "WhatsApp", icon: "phone" },
  { href: "/dashboard/admin/suscripciones", label: "Suscripciones", icon: "card" },
  { href: "/dashboard/admin/correos", label: "Correos automáticos", icon: "mail" },
  { href: "/dashboard/admin/apariencia", label: "Apariencia", icon: "palette" },
];

// Barra inferior solo en móvil.
const BOTTOM_NAV: { href: string; label: string; icon: IconName }[] = [
  { href: "/dashboard", label: "Inicio", icon: "home" },
  { href: "/dashboard/procesos", label: "Procesos", icon: "scale" },
  { href: "/dashboard/configuracion", label: "Configuración", icon: "settings" },
];

export function AppShell({
  userLabel,
  logoUrl,
  byLogoUrl,
  byUrl,
  isAdmin,
  soloPago = false,
  pedirWhatsapp = null,
  sospechoso = null,
  logoutAction,
  children,
}: {
  userLabel: string;
  logoUrl: string;
  byLogoUrl: string;
  byUrl: string;
  isAdmin: boolean;
  /** Acceso vencido: el menú solo muestra Suscripción (para pagar). */
  soloPago?: boolean;
  /** Número del abogado si aún no decide recibir actuaciones por WhatsApp (burbuja). */
  pedirWhatsapp?: string | null;
  /** Registro con datos que parecen falsos: aviso de que la cuenta puede ser eliminada. */
  sospechoso?: { nombreMal: boolean; correoMal: boolean } | null;
  logoutAction: () => Promise<void>;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === "/dashboard"
      ? pathname === "/dashboard"
      : pathname === href || pathname.startsWith(href + "/");

  const renderNav = (items: NavItem[]) =>
    items.map((item) => (
      <Link
        key={item.href}
        href={item.href}
        className={`nav-item ${isActive(item.href) ? "active" : ""}`}
        onClick={() => setOpen(false)}
      >
        <Icon name={item.icon} size={19} className="nav-icon" />
        <span className="nav-label">
          {item.label}
          {item.pronto && <span className="nav-pronto">Próximamente</span>}
        </span>
      </Link>
    ));

  return (
    <div className="app-shell">
      <aside className={`sidebar ${open ? "open" : ""}`}>
        <div className="sidebar-brand">
          <span className="logo-chip">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logoUrl} alt="logo" className="brand-logo" />
          </span>
          <button
            className="close"
            aria-label="Cerrar menú"
            onClick={() => setOpen(false)}
          >
            <Icon name="close" size={20} />
          </button>
        </div>

        <nav className="nav">
          {renderNav(soloPago ? NAV.filter((n) => n.href === "/dashboard/suscripcion") : NAV)}
          {isAdmin && !soloPago && (
            <>
              <div className="nav-section">Administración</div>
              {renderNav(ADMIN_NAV)}
            </>
          )}
        </nav>

        <div className="sidebar-foot">
          <div className="user small muted">{userLabel}</div>
          <form action={logoutAction}>
            <button className="btn secondary small" type="submit">
              Salir
            </button>
          </form>
          <a
            className="sidebar-by"
            href={byUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            <span>By</span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={byLogoUrl} alt="By" />
          </a>
        </div>
      </aside>

      {open && <div className="backdrop" onClick={() => setOpen(false)} />}

      <div className="app-main-col">
        <header className="mobile-bar">
          <button
            className="hamburger"
            aria-label="Abrir menú"
            onClick={() => setOpen(true)}
          >
            <Icon name="menu" size={22} />
          </button>
          <span className="logo-chip">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logoUrl} alt="logo" className="brand-logo" />
          </span>
          <div className="spacer" />
          {!soloPago && <NotificationBell />}
        </header>
        {/* Escritorio: la campana arriba a la derecha. */}
        {!soloPago && (
          <div className="desk-bar">
            <NotificationBell />
          </div>
        )}
        <main className="app-main">{children}</main>
      </div>

      {/* Barra de navegación inferior (solo móvil) */}
      <nav className="bottom-nav">
        {(soloPago
          ? [{ href: "/dashboard/suscripcion", label: "Suscripción", icon: "card" as IconName }]
          : BOTTOM_NAV
        ).map((nav) => {
          // Para el admin, "Inicio" lleva al panel admin.
          const esInicioAdmin = isAdmin && nav.href === "/dashboard";
          const href = esInicioAdmin ? "/dashboard/admin" : nav.href;
          const activo = esInicioAdmin
            ? pathname === "/dashboard/admin"
            : isActive(nav.href);
          return (
            <Link
              key={nav.href}
              href={href}
              className={`bottom-item ${activo ? "active" : ""}`}
            >
              <Icon name={nav.icon} size={22} className="bottom-icon" />
              <span className="bottom-label">{nav.label}</span>
            </Link>
          );
        })}
      </nav>

      <NotificationsPrompt />
      {sospechoso ? (
        <SospechosoAviso nombreMal={sospechoso.nombreMal} correoMal={sospechoso.correoMal} />
      ) : (
        pedirWhatsapp && !soloPago && <WhatsappPrompt whatsapp={pedirWhatsapp} />
      )}
    </div>
  );
}
