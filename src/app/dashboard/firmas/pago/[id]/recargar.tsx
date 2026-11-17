"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Vuelve a consultar el pago cada 5 s durante unos 3 minutos. */
export function Recargar() {
  const router = useRouter();
  useEffect(() => {
    let n = 0;
    const t = setInterval(() => {
      if (++n > 36) return clearInterval(t);
      router.refresh();
    }, 5000);
    return () => clearInterval(t);
  }, [router]);
  return null;
}
