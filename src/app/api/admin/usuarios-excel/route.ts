import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getWhatsappPorUsuario } from "@/lib/accounts";
import { listUsers } from "@/lib/admin";
import { resumenCargasPorUsuario } from "@/lib/sync";

export const dynamic = "force-dynamic";

/** Hora de Bogotá para Excel, que guarda las fechas sin zona horaria. */
const bogota = (d: Date | null) => (d ? new Date(new Date(d).getTime() - 5 * 3_600_000) : null);

// GET -> Excel con todos los usuarios (las mismas columnas de la tabla). Solo root.
export async function GET() {
  const admin = await getCurrentUser();
  if (!admin || admin.role !== "admin") {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const { users } = await listUsers({ porPagina: 100_000 });
  const ids = users.map((u) => u.id);
  const [whatsapp, cargas] = await Promise.all([
    getWhatsappPorUsuario(ids),
    resumenCargasPorUsuario(ids).catch(() => new Map<string, { cargas: number }>()),
  ]);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Usuarios", { views: [{ state: "frozen", ySplit: 1 }] });
  const FECHA = "dd/mm/yyyy hh:mm";
  ws.columns = [
    { header: "Nombre", key: "nombre", width: 32 },
    { header: "Correo", key: "correo", width: 36 },
    { header: "WhatsApp", key: "whatsapp", width: 18, style: { numFmt: "@" } },
    { header: "Rol", key: "rol", width: 10 },
    { header: "Verificado", key: "verificado", width: 11 },
    { header: "Procesos", key: "procesos", width: 10 },
    { header: "Intentos de carga", key: "intentos", width: 17 },
    { header: "Último acceso", key: "acceso", width: 18, style: { numFmt: FECHA } },
    { header: "Registro", key: "registro", width: 18, style: { numFmt: FECHA } },
  ];
  ws.getRow(1).font = { bold: true };
  ws.autoFilter = { from: "A1", to: "I1" };
  for (const u of users) {
    ws.addRow({
      nombre: u.name ?? "",
      correo: u.email,
      whatsapp: whatsapp.get(u.id) ?? "",
      rol: u.role === "admin" ? "admin" : "usuario",
      verificado: u.emailVerified ? "Sí" : "No",
      procesos: u._count.cases,
      intentos: cargas.get(u.id)?.cargas ?? 0,
      acceso: bogota(u.lastLoginAt),
      registro: bogota(u.createdAt),
    });
  }

  const excel = await wb.xlsx.writeBuffer();
  const hoy = new Date(Date.now() - 5 * 3_600_000).toISOString().slice(0, 10);
  return new NextResponse(new Uint8Array(excel as ArrayBuffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="usuarios-estradox-${hoy}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
