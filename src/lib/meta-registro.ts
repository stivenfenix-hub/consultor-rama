import "server-only";
import { cookies } from "next/headers";
import { COOKIE_REGISTRO } from "./meta-pixel-config";

/**
 * Marca que se acaba de crear una cuenta: el Píxel de Meta (componente
 * MetaPixel) envía CompleteRegistration en el navegador y borra la cookie.
 * Solo se llama al CREAR la cuenta, nunca en un login.
 */
export async function marcarRegistroNuevo(userId: string) {
  (await cookies()).set(COOKIE_REGISTRO, userId, {
    path: "/",
    maxAge: 60 * 60, // si no se envía en 1 hora, se descarta
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    httpOnly: false, // la lee el script del píxel
  });
}
