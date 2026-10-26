import { redirect } from "next/navigation";
import { getCurrentUser, homePath } from "@/lib/auth";
import { getWhatsapp } from "@/lib/accounts";
import { BrandLogo } from "@/components/brand-logo";
import { CompleteForm } from "./complete-form";

/** Tras crear la cuenta con Google: solo falta el WhatsApp (obligatorio). */
export default async function CompletarRegistroPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (await getWhatsapp(user.id)) redirect(homePath(user.role));

  return (
    <div className="container">
      <div className="center">
        <div className="card">
          <div style={{ marginBottom: 12 }}>
            <BrandLogo />
          </div>
          <h1>¡Ya casi!</h1>
          <p className="muted small">
            Hola{user.firstName ? ` ${user.firstName}` : ""}, tu cuenta quedó creada con Google. Solo
            falta tu número de WhatsApp para poder contactarte.
          </p>
          <CompleteForm />
        </div>
      </div>
    </div>
  );
}
