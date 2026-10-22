"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NotificationsPrompt } from "@/components/notifications-prompt";
import { Icon, type IconName } from "@/components/icon";

const NAV: { href: string; label: string; icon: IconName }[] = [
  { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
  { href: "/dashboard/procesos", label: "Procesos", icon: "scale" },
  { href: "/dashboard/configuracion", label: "Configuración", icon: "settings" },
];

const ADMIN_NAV: { href: string; label: string; icon: IconName }[] = [
  { href: "/dashboard/admin", label: "Panel admin", icon: "shield" },
  { href: "/dashboard/admin/usuarios", label: "Usuarios", icon: "users" },
  { href: "/dashboard/admin/notificaciones", label: "Notificaciones", icon: "megaphone" },
  { href: "/dashboard/admin/correos", label: "Correo de bienvenida", icon: "mail" },
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
  logoutAction,
  children,
}: {
  userLabel: string;
  logoUrl: string;
  byLogoUrl: string;
  byUrl: string;
  isAdmin: boolean;
  logoutAction: () => Promise<void>;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === "/dashboard"
      ? pathname === "/dashboard"
      : pathname === href || pathname.startsWith(href + "/");

  const renderNav = (
    items: { href: string; label: string; icon: IconName }[],
  ) =>
    items.map((item) => (
      <Link
        key={item.href}
        href={item.href}
        className={`nav-item ${isActive(item.href) ? "active" : ""}`}
        onClick={() => setOpen(false)}
      >
        <Icon name={item.icon} size={19} className="nav-icon" />
        {item.label}
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
          {renderNav(NAV)}
          {isAdmin && (
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
        </header>
        <main className="app-main">{children}</main>
      </div>

      {/* Barra de navegación inferior (solo móvil) */}
      <nav className="bottom-nav">
        {BOTTOM_NAV.map((nav) => {
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
    </div>
  );
}
