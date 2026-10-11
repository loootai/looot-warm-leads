import { requireAdminRoute } from "@/lib/auth/guard";
import { exportFile } from "@/server/actions";
import { makeCtx } from "@/server/service";

export const dynamic = "force-dynamic";

/** Admin. The lead list as CSV: names, LinkedIn URLs and emails. Never cached. */
export async function GET(req: Request) {
  const gate = await requireAdminRoute(req);
  if (gate) return gate;
  const url = new URL(req.url);
  const f = exportFile(await makeCtx(), url.searchParams.get("format") ?? "csv", url.searchParams.get("new") === "1");
  return new Response(f.body, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${f.name}"`, "Cache-Control": "no-store" } });
}
