"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";
import { cn } from "@/lib/cn";

function useIsDark(): boolean {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener("themechange", cb);
      return () => window.removeEventListener("themechange", cb);
    },
    () => document.documentElement.classList.contains("dark"),
    () => false,
  );
}

const NAV = [
  { href: "/", label: "Inbox" },
  { href: "/sources", label: "Sources" },
  { href: "/icp", label: "ICP" },
  { href: "/outbox", label: "Outbox" },
  { href: "/cost", label: "Cost" },
];

/** Top bar: brand, the five pages, a demo badge when the data is sample data, and the theme switch. */
export function Header({ demo }: { demo: boolean }) {
  const dark = useIsDark();
  const path = usePathname();
  const toggle = () => {
    const next = dark ? "light" : "dark";
    document.documentElement.classList.toggle("dark", next === "dark");
    try {
      localStorage.setItem("theme", next);
    } catch {}
    window.dispatchEvent(new CustomEvent("themechange"));
  };
  return (
    <header className="sticky top-0 z-10 border-b border-line bg-page/90 backdrop-blur">
      <div className="mx-auto flex h-12 w-full max-w-[1200px] items-center gap-3 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-medium tracking-tight">
          <Image src={dark ? "/brand/looot-mark-white.svg" : "/brand/looot-mark.svg"} alt="" width={20} height={20} priority />
          <span className="hidden sm:inline">looot-warm-leads</span>
        </Link>
        <nav className="flex items-center gap-0.5" aria-label="Pages">
          {NAV.map((n) => {
            const on = n.href === "/" ? path === "/" || path.startsWith("/leads") : path.startsWith(n.href);
            return (
              <Link key={n.href} href={n.href} className={cn("rounded-control px-2 py-1 text-13", on ? "bg-brand-soft font-medium text-link" : "text-mute hover:bg-hover hover:text-ink")}>
                {n.label}
              </Link>
            );
          })}
        </nav>
        {demo && <span className="hidden rounded-control border border-line-strong bg-amber-soft px-1.5 py-0.5 text-11 font-medium text-amber md:inline">Demo data. Invented people. Nothing is called or sent.</span>}
        <div className="ml-auto flex items-center gap-1">
          <a href="https://github.com/loootai/looot-warm-leads" className="hidden rounded-control px-2 py-1 text-mute hover:bg-hover hover:text-ink sm:block">GitHub</a>
          <button type="button" onClick={toggle} aria-label="Toggle dark mode" className="grid size-8 place-items-center rounded-control text-mute hover:bg-hover hover:text-ink">
            {dark ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
      </div>
    </header>
  );
}
