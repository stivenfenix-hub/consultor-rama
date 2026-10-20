"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Brand } from "@/components/brand";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: "▦" },
  { href: "/dashboard/procesos", label: "Procesos", icon: "⚖️" },
  { href: "/dashboard/configuracion", label: "Configuración", icon: "⚙️" },
];

export function AppShell({
  userLabel,
  logoutAction,
  children,
}: {
  userLabel: string;
  logoutAction: () => Promise<void>;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === "/dashboard"
      ? pathname === "/dashboard"
      : pathname.startsWith(href);

  return (
    <div className="app-shell">
      <aside className={`sidebar ${open ? "open" : ""}`}>
        <div className="sidebar-brand">
          <Brand />
          <button
            className="close"
            aria-label="Cerrar menú"
            onClick={() => setOpen(false)}
          >
            ✕
          </button>
        </div>

        <nav className="nav">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`nav-item ${isActive(item.href) ? "active" : ""}`}
              onClick={() => setOpen(false)}
            >
              <span className="nav-icon">{item.icon}</span>
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="sidebar-foot">
          <div className="user small muted">{userLabel}</div>
          <form action={logoutAction}>
            <button className="btn secondary small" type="submit">
              Salir
            </button>
          </form>
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
          <Brand />
        </header>
        <main className="app-main">{children}</main>
      </div>
    </div>
  );
}
