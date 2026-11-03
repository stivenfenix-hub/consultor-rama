import "server-only";
import { getCurrentUser } from "./auth";
import { esSocio } from "./subscription";

/** Usuario del Portal socios (root o socio), o null. */
export async function usuarioSocio() {
  const user = await getCurrentUser();
  if (!user) return null;
  if (user.role === "admin" || (await esSocio(user.id))) return user;
  return null;
}
