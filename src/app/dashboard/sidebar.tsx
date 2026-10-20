"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: "▦" },
  { href: "/dashboard/procesos", label: "Procesos", icon: "⚖️" },
  { href: "/dashboard/configuracion", label: "Configuración", icon: "⚙️" },
];

const ADMIN_NAV = [
  { href: "/dashboard/admin", label: "Panel admin", icon: "👑" },
  { href: "/dashboard/admin/usuarios", label: "Usuarios", icon: "👥" },
  { href: "/dashboard/admin/notificaciones", label: "Notificaciones", icon: "📣" },
  { href: "/dashboard/admin/apariencia", label: "Apariencia", icon: "🎨" },
];

// Barra inferior solo en móvil.
const BOTTOM_NAV = [
  { href: "/dashboard", label: "Inicio", icon: "🏠" },
  { href: "/dashboard/procesos", label: "Procesos", icon: "⚖️" },
  { href: "/dashboard/configuracion", label: "Configuración", icon: "⚙️" },
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
    items: { href: string; label: string; icon: string }[],
  ) =>
    items.map((item) => (
      <Link
        key={item.href}
        href={item.href}
        className={`nav-item ${isActive(item.href) ? "active" : ""}`}
        onClick={() => setOpen(false)}
      >
        <span className="nav-icon">{item.icon}</span>
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
            ✕
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
            ☰
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
        {BOTTOM_NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`bottom-item ${isActive(item.href) ? "active" : ""}`}
          >
            <span className="bottom-icon">{item.icon}</span>
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
