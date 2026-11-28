"use client";

import { eliminarUsuarioAction } from "@/app/actions";
import { BotonConfirmar } from "@/components/boton-confirmar";

export function EliminarUsuario({ id, email }: { id: string; email: string }) {
  return (
    <BotonConfirmar
      peligro
      texto="Eliminar"
      confirmar="Sí, eliminar"
      pregunta={`Se borran la cuenta de ${email}, sus procesos, pagos, firmas electrónicas y su autorización de datos. No se puede deshacer. Si solo ya no quiere el servicio, usa "Desactivar".`}
      accion={() => eliminarUsuarioAction(id)}
    />
  );
}
