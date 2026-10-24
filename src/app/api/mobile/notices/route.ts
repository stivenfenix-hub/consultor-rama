import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ensureMobileNoticeTable } from "@/lib/push";
import { withMobileUser } from "@/lib/mobile";

export const dynamic = "force-dynamic";

type Aviso = {
  id: number;
  title: string;
  body: string;
  url: string | null;
  tag: string | null;
  createdAt: Date;
};

async function ultimoId() {
  const [r] = await prisma.$queryRawUnsafe<{ m: number | null }[]>(
    `SELECT max(id) AS m FROM "MobileNotice"`,
  );
  return r?.m ?? 0;
}

// GET ?after=<id> -> { notices, lastId }
// La app lo consulta en segundo plano y muestra cada aviso como notificación.
// Sin `after` (primera vez en el dispositivo) solo devuelve lastId, para no
// mostrar avisos viejos.
export async function GET(req: NextRequest) {
  return withMobileUser(
    req,
    async (user) => {
      await ensureMobileNoticeTable();
      const afterParam = req.nextUrl.searchParams.get("after");
      if (afterParam == null) return NextResponse.json({ notices: [], lastId: await ultimoId() });
      const after = Number(afterParam) || 0;
      const notices = await prisma.$queryRawUnsafe<Aviso[]>(
        `SELECT id, title, body, url, tag, "createdAt" FROM "MobileNotice"
         WHERE id > $1 AND ("userId" = $2 OR "userId" IS NULL)
           AND "createdAt" > now() - interval '3 days'
         ORDER BY id ASC LIMIT 20`,
        after,
        user.id,
      );
      const lastId = notices.length === 20 ? notices[19].id : Math.max(after, await ultimoId());
      return NextResponse.json({ notices, lastId });
    },
    { allowExpired: true },
  );
}
