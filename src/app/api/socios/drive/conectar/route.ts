import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getCurrentUser } from "@/lib/auth";
import { COOKIE_DRIVE, driveDisponible, iniciarDrive } from "@/lib/drive";

export const dynamic = "force-dynamic";

/** Root: autorizar el Google Drive donde quedan los comprobantes. */
export async function GET() {
  const user = await getCurrentUser();
  if (user?.role !== "admin" || !driveDisponible()) {
    return NextResponse.redirect(new URL("/dashboard/socios", process.env.APP_URL ?? "http://localhost:3000"));
  }
  const { url, state } = iniciarDrive();
  (await cookies()).set(COOKIE_DRIVE, state, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/" });
  return NextResponse.redirect(url);
}
