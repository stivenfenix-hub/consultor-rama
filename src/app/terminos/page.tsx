import type { Metadata } from "next";
import Link from "next/link";
import { LEGAL } from "@/lib/legal";
import { LegalShell } from "../legal-shell";

// Dinámica: el logo lo configura el admin.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Términos y Condiciones · Estradox" };

export default function TerminosPage() {
  const L = LEGAL;
  return (
    <LegalShell titulo="Términos y Condiciones">
      <p>
        Estos Términos regulan el uso de {L.marca} ({L.sitio}), servicio operado por{" "}
        {L.razonSocial}, NIT {L.nit}, con domicilio en {L.ciudad} (en adelante, “{L.marca}”). Al
        crear una cuenta, el usuario declara que los leyó y los acepta.
      </p>

      <h2>1. Qué es {L.marca}</h2>
      <p>
        {L.marca} es una herramienta de apoyo para abogados que permite registrar procesos
        judiciales por su número de radicado y recibir avisos cuando aparecen actuaciones nuevas.
        La información proviene de la Consulta Nacional Unificada de Procesos de la Rama Judicial
        de Colombia, que es pública.
      </p>

      <h2>2. Alcance y límites del servicio</h2>
      <ul>
        <li>
          {L.marca} no es una entidad oficial ni tiene relación con la Rama Judicial. No modifica
          ni certifica la información de los despachos judiciales.
        </li>
        <li>
          La información se muestra tal como la publica la Rama Judicial. {L.marca} no garantiza
          que esté completa, actualizada o libre de errores, ni que la consulta oficial esté
          disponible en todo momento.
        </li>
        <li>
          Las actualizaciones se hacen de forma periódica (principalmente en la noche) y los avisos
          pueden tardar. {L.marca} es una ayuda y <b>no reemplaza la vigilancia judicial</b> ni la
          revisión de los canales oficiales. El control de términos procesales, notificaciones y
          estados es responsabilidad exclusiva del usuario.
        </li>
      </ul>

      <h2>3. Cuenta del usuario</h2>
      <ul>
        <li>El usuario debe ser mayor de edad y entregar datos reales (nombre, correo y WhatsApp).</li>
        <li>
          La cuenta es personal. El usuario cuida su contraseña y responde por el uso que se haga
          con ella.
        </li>
        <li>
          El usuario solo debe registrar procesos sobre los que tenga un interés legítimo, y usar
          la información conforme a la ley y a la ética profesional.
        </li>
      </ul>

      <h2>4. Prueba gratis, planes y pagos</h2>
      <ul>
        <li>
          Las cuentas nuevas tienen un periodo de prueba gratis. Al terminar, para seguir usando
          el servicio se debe pagar uno de los planes publicados en la plataforma.
        </li>
        <li>
          Los pagos se procesan a través de Bold. {L.marca} no conoce ni guarda los datos de
          tarjetas ni cuentas bancarias.
        </li>
        <li>
          Los planes <b>no se renuevan automáticamente</b>: cada periodo se paga de forma
          independiente. El tiempo pagado se suma al acceso vigente.
        </li>
        <li>
          Cuando el acceso vence, la cuenta queda en pausa hasta que se pague un nuevo periodo.
          Los procesos registrados se conservan.
        </li>
        <li>
          Los derechos de retracto y reversión del pago se rigen por el Estatuto del Consumidor
          (Ley 1480 de 2011).
        </li>
      </ul>

      <h2>5. Uso aceptable</h2>
      <p>No está permitido:</p>
      <ul>
        <li>usar la plataforma para fines ilegales, o para perseguir o acosar a las partes de un proceso;</li>
        <li>
          intentar acceder a cuentas ajenas, extraer datos de forma masiva o automatizada, o
          afectar el funcionamiento del servicio;
        </li>
        <li>revender el servicio o compartir la cuenta con terceros sin autorización.</li>
      </ul>
      <p>
        Para proteger el servicio y la consulta oficial, {L.marca} puede limitar la cantidad de
        actualizaciones manuales.
      </p>

      <h2>6. Comunicaciones</h2>
      <p>
        {L.marca} enviará al correo, WhatsApp o al dispositivo del usuario los mensajes necesarios
        para prestar el servicio: verificación de la cuenta, avisos de actuaciones, estado de la
        suscripción y pagos. Las ofertas, novedades y boletines solo se envían a quien lo autorizó,
        y ese permiso se puede retirar en cualquier momento desde Configuración.
      </p>

      <h2>7. Responsabilidad</h2>
      <p>
        En la medida permitida por la ley, {L.marca} no responde por daños derivados de errores,
        demoras u omisiones en la información publicada por la Rama Judicial, de fallas o
        indisponibilidad de la consulta oficial o de servicios de terceros, ni por decisiones que
        el usuario tome sin verificar la información en las fuentes oficiales.
      </p>

      <h2>8. Datos personales</h2>
      <p>
        El tratamiento de los datos personales se rige por la{" "}
        <Link href="/privacidad">Política de Tratamiento de Datos</Link>.
      </p>

      <h2>9. Cancelación de la cuenta</h2>
      <p>
        El usuario puede eliminar su cuenta en cualquier momento desde Configuración. {L.marca}{" "}
        puede suspender o cancelar cuentas que incumplan estos Términos.
      </p>

      <h2>10. Cambios a estos Términos</h2>
      <p>
        {L.marca} puede actualizar estos Términos. Los cambios importantes se avisarán por correo
        o dentro de la plataforma antes de entrar en vigor.
      </p>

      <h2>11. Ley aplicable y contacto</h2>
      <p>
        Estos Términos se rigen por las leyes de la República de Colombia. Contacto: {L.correo} ·{" "}
        {L.telefono} · {L.direccion}, {L.ciudad}.
      </p>
    </LegalShell>
  );
}
