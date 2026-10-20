import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getSiteSettings } from "@/lib/settings";
import { logoutAction } from "@/app/actions";
import { AppShell } from "./sidebar";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const settings = await getSiteSettings();

  return (
    <AppShell
      userLabel={user.name ?? user.email}
      logoUrl={settings.logoDataUrl ?? "/logo-estradox.png"}
      byLogoUrl={settings.byLogoDataUrl ?? "/unor-logo.png"}
      byUrl={settings.byUrl}
      isAdmin={user.role === "admin"}
      logoutAction={logoutAction}
    >
      {children}
    </AppShell>
  );
}
