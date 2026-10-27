import type { Metadata } from "next";
import { LEGAL } from "@/lib/legal";
import { LegalShell } from "../legal-shell";

// Dinámica: el logo lo configura el admin.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Política de Tratamiento de Datos · Estradox" };

export default function PrivacidadPage() {
  const L = LEGAL;
  return (
    <LegalShell titulo="Política de Tratamiento de Datos Personales">
      <p>
        Esta Política se expide en cumplimiento de la Ley 1581 de 2012, el Decreto 1377 de 2013
        (compilado en el Decreto 1074 de 2015) y demás normas sobre protección de datos personales
        en Colombia.
      </p>

      <h2>1. Responsable del tratamiento</h2>
      <ul>
        <li>Razón social: {L.razonSocial}</li>
        <li>NIT: {L.nit}</li>
        <li>Domicilio y dirección: {L.direccion}, {L.ciudad}</li>
        <li>Correo para consultas y reclamos: {L.correo}</li>
        <li>Teléfono: {L.telefono}</li>
        <li>Sitio web: {L.sitio}</li>
      </ul>

      <h2>2. Datos que tratamos</h2>
      <ul>
        <li><b>De registro:</b> nombre, apellido, correo electrónico y número de WhatsApp.</li>
        <li><b>De acceso:</b> contraseña, que se guarda cifrada y no podemos leer.</li>
        <li>
          <b>De los procesos:</b> números de radicado que el usuario registra, y la información
          pública que la Rama Judicial publica sobre ellos (despacho, partes, actuaciones y
          documentos).
        </li>
        <li>
          <b>De suscripción y pagos:</b> plan, fechas e historial de pagos. Los datos de tarjetas y
          cuentas bancarias los maneja directamente Bold; nosotros no los recibimos.
        </li>
        <li>
          <b>Técnicos:</b> dirección IP, navegador o dispositivo, registros de uso y los datos
          necesarios para enviar notificaciones al dispositivo.
        </li>
      </ul>

      <h2>3. Para qué usamos los datos</h2>
      <ul>
        <li>Crear y administrar la cuenta, y verificar la identidad del usuario.</li>
        <li>
          Consultar los procesos registrados y avisar de actuaciones nuevas por correo,
          notificaciones o WhatsApp.
        </li>
        <li>Gestionar la prueba gratis, los planes, los cobros y las facturas.</li>
        <li>Dar soporte y responder solicitudes.</li>
        <li>Mantener la seguridad, prevenir fraudes y mejorar el servicio.</li>
        <li>Cumplir obligaciones legales y requerimientos de autoridades.</li>
        <li>
          Enviar ofertas, novedades y boletines de {L.marca} por correo, notificaciones o
          WhatsApp. El titular autoriza esta finalidad al aceptar esta Política y puede revocarla
          en cualquier momento desde Configuración, sin que afecte el servicio.
        </li>
      </ul>

      <h2>4. Datos de terceros en los procesos</h2>
      <p>
        Los procesos contienen nombres y datos de las partes que publica la Rama Judicial. Se
        muestran únicamente al usuario que registró el proceso, para hacer su seguimiento, y no se
        usan para ninguna otra finalidad.
      </p>

      <h2>5. Con quién compartimos los datos</h2>
      <p>
        No vendemos datos personales. Para prestar el servicio los compartimos con proveedores que
        actúan como encargados del tratamiento, bajo obligaciones de confidencialidad y seguridad:
        alojamiento del sitio (Hostinger), base de datos (Supabase), pagos (Bold), medición de anuncios (Meta Platforms), envío de correos
        y servicios de notificaciones push (como Google Firebase). Algunos están ubicados fuera de
        Colombia, por ejemplo en Estados Unidos. Al aceptar esta Política, el titular autoriza esa
        transmisión, que se hace con niveles adecuados de protección.
      </p>

      <h2>6. Derechos del titular</h2>
      <p>Como titular de los datos, el usuario puede:</p>
      <ul>
        <li>conocer, actualizar y rectificar sus datos;</li>
        <li>pedir prueba de la autorización que otorgó;</li>
        <li>ser informado sobre el uso que se ha dado a sus datos;</li>
        <li>
          revocar la autorización y pedir que sus datos se supriman, cuando no exista un deber
          legal o contractual de conservarlos;
        </li>
        <li>acceder gratis a sus datos;</li>
        <li>presentar quejas ante la Superintendencia de Industria y Comercio (SIC).</li>
      </ul>

      <h2>7. Cómo ejercer los derechos</h2>
      <ul>
        <li>
          Desde la plataforma, el usuario puede actualizar su WhatsApp, activar o retirar las
          desactivar las ofertas y eliminar su cuenta (en Configuración).
        </li>
        <li>Por correo a {L.correo}, indicando nombre, correo de la cuenta y la solicitud.</li>
        <li>
          <b>Consultas:</b> se responden en máximo 10 días hábiles, prorrogables por 5 días
          hábiles más, avisando el motivo.
        </li>
        <li>
          <b>Reclamos</b> (corrección, actualización, supresión o incumplimiento): se responden en
          máximo 15 días hábiles, prorrogables por 8 días hábiles más, avisando el motivo.
        </li>
      </ul>

      <h2>8. Seguridad y conservación</h2>
      <p>
        Usamos conexiones cifradas (HTTPS), contraseñas cifradas y acceso restringido a la
        información. Los datos se conservan mientras la cuenta esté activa y durante el tiempo que
        exijan las obligaciones legales, contables o tributarias. Al eliminar la cuenta se borran
        sus datos y procesos, salvo los registros que la ley obliga a conservar.
      </p>

      <h2>9. Cookies y medición de publicidad</h2>
      <p>
        Usamos cookies necesarias para mantener la sesión iniciada. Además usamos el Píxel de Meta
        (Facebook e Instagram), que guarda cookies en el navegador para medir cuántas personas
        llegan a {L.marca} desde nuestros anuncios y cuántas crean su cuenta. Meta recibe datos
        técnicos como la página visitada, el navegador y la dirección IP; no le enviamos el
        nombre, el correo, el WhatsApp ni la información de los procesos. El usuario puede borrar
        o bloquear estas cookies desde la configuración de su navegador, y ajustar sus
        preferencias de anuncios en su cuenta de Meta.
      </p>

      <h2>10. Vigencia y cambios</h2>
      <p>
        Esta Política rige desde su publicación. Los cambios importantes se avisarán por correo o
        dentro de la plataforma. Las bases de datos estarán vigentes mientras se preste el
        servicio.
      </p>
    </LegalShell>
  );
}
