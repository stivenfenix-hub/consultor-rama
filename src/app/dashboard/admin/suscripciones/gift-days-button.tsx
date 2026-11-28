"use client";

import { extenderPruebaAction, regalarDiasAction, terminarAccesoAction } from "@/app/actions";
import { BotonConfirmar } from "@/components/boton-confirmar";

/** +15 días de prueba gratis (sigue en prueba, no cuenta como pago). */
export function ExtendTrialButton({ userId, nombre }: { userId: string; nombre?: string | null }) {
  return (
    <BotonConfirmar
      texto="+15 días prueba"
      confirmar="Sí, extender"
      title="Suma 15 días a la prueba gratis (desde hoy si ya venció)"
      pregunta={`Se suman 15 días a la prueba gratis${nombre ? ` de ${nombre}` : ""} (desde hoy si ya venció).`}
      accion={async () => {
        await extenderPruebaAction(userId);
      }}
    />
  );
}

export function GiftDaysButton({ userId }: { userId: string }) {
  return (
    <BotonConfirmar
      texto="+30 días"
      confirmar="Sí, regalar"
      pregunta="Se regalan 30 días de acceso a este usuario."
      accion={async () => {
        await regalarDiasAction(userId, 30);
      }}
    />
  );
}

export function EndAccessButton({ userId }: { userId: string }) {
  return (
    <BotonConfirmar
      peligro
      texto="Terminar acceso"
      confirmar="Sí, terminar"
      pregunta="El acceso de este usuario termina ahora: solo podrá ver la página de pago."
      accion={async () => {
        await terminarAccesoAction(userId);
      }}
    />
  );
}
