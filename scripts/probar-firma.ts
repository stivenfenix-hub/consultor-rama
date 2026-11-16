import { writeFileSync } from "node:fs";
import QRCode from "qrcode";
import forge from "node-forge";
const R = new URL("../src/services/signature-engine", import.meta.url).href;
const OUT = process.argv[2];
(async () => {
const { PLANTILLAS, renderizarPlantilla, camposFaltantes } = await import(`${R}/plantillas.ts`);
const { estamparFirmas, anexarCertificado, sha256Hex } = await import(`${R}/sello.ts`);
const fd = await import(`${R}/firma-digital.ts`);

for (const p of PLANTILLAS) {
  const v: Record<string,string> = {};
  for (const c of p.campos) v[c.clave] = c.opciones?.[0] ?? c.ejemplo ?? "x";
  console.log(p.id, "faltan:", camposFaltantes(p, v).length);
  const r = await renderizarPlantilla(p, v);
  writeFileSync(`${OUT}/${p.id}.pdf`, r.pdf);
  console.log(" paginas", r.paginas, "firmas", JSON.stringify(r.firmas.map((f:any)=>[f.page, +f.x.toFixed(2), +f.y.toFixed(2)])));
  if (p.id !== "poder-especial") continue;
  const img = new Uint8Array(await QRCode.toBuffer("firma de prueba", { width: 240 }));
  const ahora = new Date();
  const firmas = r.firmas.map((f:any, i:number) => ({ nombre: f.nombre, tipoDoc: "CC", numDoc: f.doc, email: i ? "carlos@bufete.com" : "maria@correo.com", telefono: i ? null : "573001234567", imagen: img, tipoFirma: i ? "tipografica" : "dibujada", posicion: f, firmadoAt: ahora, otpVerificadoAt: ahora, ip: "190.25.10." + (i+7) }));
  const doc = await estamparFirmas(r.pdf, firmas);
  const h = sha256Hex(await doc.save());
  const eventos = Array.from({length: 14}, (_, i) => ({ fecha: new Date(ahora.getTime() + i*61000), evento: ["Documento creado","Enlace enviado por correo","Abrió el enlace","Código de verificación enviado","Código verificado (identidad confirmada)","Leyó el documento","Firmó el documento"][i%7], quien: i%2 ? firmas[0].nombre : "Dr. Carlos Andrés Pérez Mejía", ip: i%3 ? "190.25.10.7" : null }));
  await anexarCertificado(doc, { id: "3f2b8c1e-9a44-4d07-b1c2-5e6f7a8b9c0d", titulo: r.titulo, radicado: "05001310302120240028100", abogado: "Carlos Andrés Pérez Mejía", creado: ahora, originalSha256: sha256Hex(r.pdf), urlVerificar: "http://localhost:3000/verificar/3f2b8c1e-9a44-4d07-b1c2-5e6f7a8b9c0d", firmas, eventos, selloTexto: ["Trazabilidad Estradox: huellas SHA-256 y bitácora de eventos (este certificado).", "Firma digital y estampa cronológica de entidad acreditada (ONAC): pendientes de activar."] }, h);
  const sellado = await doc.save({ useObjectStreams: false });
  writeFileSync(`${OUT}/sellado-desarrollo.pdf`, sellado);
  // modo desarrollo
  const d = await fd.applyDigitalSignatureAndTSA(sellado);
  console.log(" desarrollo:", d.modo, d.avisos.length, "mismo pdf:", d.pdf === sellado);
  // p12 autofirmado de prueba
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey; cert.serialNumber = "01";
  cert.validity.notBefore = new Date(); cert.validity.notAfter = new Date(Date.now() + 864e5 * 30);
  const attrs = [{ name: "commonName", value: "Estradox PRUEBA LOCAL" }, { name: "countryName", value: "CO" }];
  cert.setSubject(attrs); cert.setIssuer(attrs); cert.sign(keys.privateKey, forge.md.sha256.create());
  const p12 = forge.asn1.toDer(forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], "clave-prueba", { algorithm: "3des" })).getBytes();
  writeFileSync(`${OUT}/prueba.p12`, Buffer.from(p12, "binary"));
  process.env.CERT_P12_PATH = `${OUT}/prueba.p12`; process.env.CERT_P12_PASSWORD = "clave-prueba";
  const s = await fd.applyDigitalSignatureAndTSA(sellado);
  writeFileSync(`${OUT}/sellado-p12.pdf`, s.pdf);
  const txt = Buffer.from(s.pdf).toString("latin1");
  console.log(" p12:", s.modo, "CN:", s.certificado, "ByteRange:", /\/ByteRange \[\d+ +\d+ +\d+ +\d+ *\]/.test(txt), "SubFilter:", (txt.match(/\/SubFilter \/([\w.]+)/)||[])[1], "bytes", s.pdf.length);
  // TSA: estructura de la solicitud
  const req = fd.construirTimeStampReq(Buffer.alloc(32, 7), Buffer.from("8102030405060708", "hex"));
  console.log(" TSQ:", req.toString("hex"));
  console.log(" estado resp:", fd.estadoTimeStampResp(Buffer.from("3009300302010030020500", "hex")));
}
})().catch((e) => { console.error("FALLO", e); process.exit(1); });
