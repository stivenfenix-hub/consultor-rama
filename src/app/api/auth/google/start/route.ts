import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_ESTADO, googleConfigurado, iniciarGoogle } from "@/lib/google-auth";

export const dynamic = "force-dynamic";

/** Botón "Continuar con Google": manda al usuario a elegir su cuenta. */
export async function GET() {
  if (!googleConfigurado()) redirect("/login");
  const { url, cookie } = iniciarGoogle();
  (await cookies()).set(COOKIE_ESTADO, cookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  redirect(url);
}
