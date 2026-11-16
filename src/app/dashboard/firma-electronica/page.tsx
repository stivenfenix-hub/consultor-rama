import { redirect } from "next/navigation";

// La página de "Próximamente" dio paso al módulo real.
export default function FirmaElectronicaAntes() {
  redirect("/dashboard/firmas");
}
