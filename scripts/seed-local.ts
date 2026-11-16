// Crea (o actualiza) el usuario de prueba del entorno LOCAL.
// Las credenciales están en .env (LOCAL_TEST_EMAIL / LOCAL_TEST_PASSWORD); nunca corre contra producción.
import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const url = process.env.DATABASE_URL ?? "";
if (!/localhost|127\.0\.0\.1/.test(url)) {
  console.error("Este script solo corre contra una base local (DATABASE_URL en localhost).");
  process.exit(1);
}
const email = process.env.LOCAL_TEST_EMAIL;
const clave = process.env.LOCAL_TEST_PASSWORD;
if (!email || !clave) {
  console.error("Faltan LOCAL_TEST_EMAIL y LOCAL_TEST_PASSWORD en .env");
  process.exit(1);
}
const prisma = new PrismaClient();
(async () => {
  const passwordHash = await bcrypt.hash(clave, 10);
  const datos = { name: "Carlos Andrés Pérez Mejía", firstName: "Carlos Andrés", lastName: "Pérez Mejía", passwordHash, emailVerified: new Date(), role: "user" };
  const u = await prisma.user.upsert({ where: { email }, update: datos, create: { email, ...datos } });
  console.log("Usuario de prueba listo:", u.email, "(la contraseña está en .env)");
  await prisma.$disconnect();
})();
