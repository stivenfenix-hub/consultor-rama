"use client";

import { desactivarUsuarioAction, reactivarUsuarioAction } from "@/app/actions";
import { BotonConfirmar } from "@/components/boton-confirmar";

/** Desactivar (conserva todo) o reactivar una cuenta. Alternativa segura a eliminar. */
export function DesactivarUsuario({ id, email, desactivada }: { id: string; email: string; desactivada: boolean }) {
  return desactivada ? (
    <BotonConfirmar
      texto="Reactivar"
      confirmar="Sí, reactivar"
      title="Vuelve a vigilar sus procesos, a escribirle y a dejarlo entrar"
      pregunta={`Se reactiva la cuenta de ${email}: vuelve a vigilar sus procesos, a recibir avisos y a poder entrar.`}
      accion={() => reactivarUsuarioAction(id)}
    />
  ) : (
    <BotonConfirmar
      texto="Desactivar"
      confirmar="Sí, desactivar"
      title="Deja de vigilar y de escribirle y no puede entrar. Se conserva todo."
      pregunta={`Se desactiva la cuenta de ${email}: deja de vigilar sus procesos, no se le escribe y no puede entrar. Se conserva todo y la puedes reactivar.`}
      accion={() => desactivarUsuarioAction(id)}
    />
  );
}
