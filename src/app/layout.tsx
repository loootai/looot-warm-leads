import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { AppShell, type ShellNavSection } from "@/components/AppShell";
import { usd } from "@/engine/money";
import { currentCsrf, requireAdminPage } from "@/lib/auth/guard";
import { isPublicPath } from "@/lib/auth/routes";
import { isDemo } from "@/server/runtime";
import { makeCtx } from "@/server/service";
import "./globals.css";

export const dynamic = "force-dynamic";

const NAV: ShellNavSection[] = [
  {
    items: [
      { href: "/", label: "Inbox", icon: "inbox", also: ["/leads"] },
      { href: "/sources", label: "Sources", icon: "radar" },
      { href: "/icp", label: "ICP", icon: "target" },
      { href: "/outbox", label: "Outbox", icon: "send" },
      { href: "/cost", label: "Cost", icon: "receipt" },
    ],
  },
];

export const metadata: Metadata = {
  title: { default: "looot-warm-leads", template: "%s · looot-warm-leads" },
  description: "Warm B2B leads from LinkedIn intent signals, scored with an explainable breakdown. Built on looot.",
  icons: { icon: "/brand/looot-mark.svg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F7F8F5" },
    { media: "(prefers-color-scheme: dark)", color: "#0A1512" },
  ],
};

// Sets the theme class before the first paint. ?theme=dark or ?theme=light overrides the saved choice for one view.
const themeScript = `(function(){try{var q=new URLSearchParams(location.search).get("theme");var t=q||localStorage.getItem("theme")||"system";var d=t==="dark"||(t==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d)}catch(e){}})()`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const path = (await headers()).get("x-warm-path") ?? "";
  // Public routes (the sign-in page) render with no stored data and no admin navigation.
  if (path !== "" && isPublicPath(path)) {
    return (
      <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
        <head>
          <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        </head>
        <body className="min-h-dvh bg-page text-ink">
          <main className="mx-auto min-h-dvh max-w-xl px-4 py-10">{children}</main>
        </body>
      </html>
    );
  }
  const gate = await requireAdminPage();
  const csrf = await currentCsrf();
  const run = (await makeCtx()).read().lastRun;
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <meta name="warm-csrf" content={csrf} />
      </head>
      <body className="min-h-dvh bg-page text-ink">
        <AppShell
          appName="looot-warm-leads"
          githubHref="https://github.com/loootai/looot-warm-leads"
          nav={NAV}
          demoLabel={gate.policy.mode === "open-demo" ? "Demo, no sign-in. Invented people. Nothing is called or sent." : isDemo() ? "Demo data. Invented people. Nothing is called or sent." : undefined}
          signOut={gate.policy.mode === "login"}
          spend={run ? { label: run.demo ? "Last run, simulated" : "Spent last run", spent: usd(run.spentMicros), cap: usd(run.capMicros), ratio: run.capMicros > 0 ? run.spentMicros / run.capMicros : 0 } : undefined}
        >
          <div className="mx-auto w-full max-w-[1200px] px-4 pb-16 pt-6 sm:px-6">{children}</div>
        </AppShell>
      </body>
    </html>
  );
}
