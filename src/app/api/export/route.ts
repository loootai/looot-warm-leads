import { exportFile } from "@/server/actions";
import { makeCtx } from "@/server/service";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const f = exportFile(await makeCtx(), url.searchParams.get("format") ?? "csv", url.searchParams.get("new") === "1");
  return new Response(f.body, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${f.name}"` } });
}
