import { IcpEditor } from "@/components/ConfigEditors";
import { makeCtx } from "@/server/service";
import { requireAdminPage } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";
export const metadata = { title: "ICP" };

export default async function IcpPage() {
  await requireAdminPage();
  const ctx = await makeCtx();
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-20 font-medium">ICP and scoring</h1>
        <p className="text-13 text-mute">Fit is checked against the profile and company data. Intent comes from the signals. The score is fit plus intent, 0 to 100.</p>
      </div>
      <IcpEditor initial={ctx.getConfig()} />
    </div>
  );
}
