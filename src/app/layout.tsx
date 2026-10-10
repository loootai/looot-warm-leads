import type { Metadata, Viewport } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { AppShell, type ShellNavSection } from "@/components/AppShell";
import { usd } from "@/engine/money";
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
  const run = (await makeCtx()).read().lastRun;
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-dvh bg-page text-ink">
        <AppShell
          appName="looot-warm-leads"
          githubHref="https://github.com/loootai/looot-warm-leads"
          nav={NAV}
          demoLabel={isDemo() ? "Demo data. Invented people. Nothing is called or sent." : undefined}
          spend={run ? { label: run.demo ? "Last run, simulated" : "Spent last run", spent: usd(run.spentMicros), cap: usd(run.capMicros), ratio: run.capMicros > 0 ? run.spentMicros / run.capMicros : 0 } : undefined}
        >
          <div className="mx-auto w-full max-w-[1200px] px-4 pb-16 pt-6 sm:px-6">{children}</div>
        </AppShell>
      </body>
    </html>
  );
}
