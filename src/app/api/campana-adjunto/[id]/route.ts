import { leerAdjuntoCampana } from "@/lib/campanas";

export const dynamic = "force-dynamic";

// GET -> el PDF adjunto de una campaña, desde el disco de Hostinger. Lo descarga el
// servicio de WhatsApp del VPS (una vez) para enviarlo como documento. El id es un
// UUID aleatorio: solo lo conoce quien recibió la campaña.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const datos = await leerAdjuntoCampana(id);
  if (!datos) return new Response("No encontrado", { status: 404 });
  return new Response(new Uint8Array(datos), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(datos.length),
      "Cache-Control": "private, max-age=86400",
      "X-Robots-Tag": "noindex",
    },
  });
}
