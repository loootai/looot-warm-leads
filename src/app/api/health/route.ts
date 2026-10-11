export const dynamic = "force-dynamic";

/** Public. Says the process is up. Reads no data. */
export function GET() {
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
