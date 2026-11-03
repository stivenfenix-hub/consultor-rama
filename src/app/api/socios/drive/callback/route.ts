import { after, NextRequest } from "next/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { COOKIE_DRIVE, conectarDrive } from "@/lib/drive";
import { subirPendientesADrive } from "@/lib/socios";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (user?.role !== "admin") redirect("/dashboard");
  const jar = await cookies();
  const state = jar.get(COOKIE_DRIVE)?.value;
  jar.delete(COOKIE_DRIVE);
  const code = req.nextUrl.searchParams.get("code");
  if (!code || !state || req.nextUrl.searchParams.get("state") !== state) redirect("/dashboard/socios?drive=cancelado");
  let ok = true;
  try {
    await conectarDrive(code);
  } catch (e) {
    console.error("[drive] conectar", e);
    ok = false;
  }
  // Sube los comprobantes que estaban esperando a que se conectara Drive.
  if (ok) after(() => subirPendientesADrive().catch(() => {}));
  redirect(`/dashboard/socios?drive=${ok ? "ok" : "error"}`);
}
