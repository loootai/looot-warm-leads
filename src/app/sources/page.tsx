import { SourcesEditor } from "@/components/ConfigEditors";
import { makeCtx } from "@/server/service";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sources" };

export default async function SourcesPage() {
  const ctx = await makeCtx();
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-20 font-medium">Signal sources</h1>
        <p className="text-13 text-mute">Where intent comes from. Each run reads these, quotes the cost first, and stops at your spend cap.{ctx.demo ? " In demo mode edits stay in memory." : ""}</p>
      </div>
      <SourcesEditor initial={ctx.getConfig()} />
    </div>
  );
}
