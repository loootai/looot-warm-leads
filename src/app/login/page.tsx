import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { adminPolicy } from "@/lib/auth/policy";
import { hasRealData } from "@/lib/auth/realData";

export const metadata: Metadata = { title: "Sign in", robots: { index: false } };
export const dynamic = "force-dynamic";

const REASONS = {
  no_password: "No admin password is set, so the admin pages are closed.",
  short_password: "The admin password is shorter than 12 characters, so the admin pages are closed.",
  demo_with_real_data: "Demo mode is on, but a LOOOT_TOKEN or a data file exists. The demo has no sign-in, so it will not open next to real data.",
} as const;

/** Public. Shows the sign-in form, or the setup steps when no admin password is configured. */
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  const policy = adminPolicy(process.env, hasRealData());
  if (policy.mode === "open-demo") redirect("/");
  const q = await searchParams;

  if (policy.mode === "setup") {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-20 font-semibold">Admin sign-in is not set up</h1>
        <p>{REASONS[policy.reason ?? "no_password"]}</p>
        <p>Set one of these on the server, then restart the app.</p>
        <pre className="overflow-x-auto rounded-panel border border-line bg-panel p-3 text-12">{`WARM_ADMIN_PASSWORD=<at least 12 characters>
# or, to keep the password out of the environment as plain text:
WARM_ADMIN_PASSWORD_HASH=<output of: npm run hash-password>`}</pre>
        <p className="text-mute">To look around with sample data and no sign-in, run npm run demo on a machine with no LOOOT_TOKEN and no data file.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-20 font-semibold">Sign in to looot-warm-leads</h1>
      {q.error && (
        <p role="alert" className="rounded-panel border border-line bg-amber-soft p-3 text-amber">
          {q.error === "locked" ? "Too many wrong attempts. Wait 15 minutes and try again." : "Wrong password."}
        </p>
      )}
      <form method="post" action="/api/auth/login" className="flex flex-col gap-3">
        <input type="hidden" name="next" value={typeof q.next === "string" ? q.next : "/"} />
        <label htmlFor="password" className="font-medium">
          Admin password
        </label>
        <input id="password" name="password" type="password" autoComplete="current-password" autoFocus required maxLength={1024} className="h-10 rounded-panel border border-line bg-panel px-3" />
        <button type="submit" className="h-10 rounded-panel bg-ink px-4 font-medium text-page">
          Sign in
        </button>
      </form>
    </div>
  );
}
