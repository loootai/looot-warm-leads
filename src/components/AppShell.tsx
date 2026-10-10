"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import "./app-shell.css";

/* Shared looot app shell. The same file ships in every looot app; only the props differ.
   Icons are Lucide (ISC licence) inlined as path data, so the shell needs no icon package. */

const ICONS = {
  menu: '<path d="M4 5h16"/><path d="M4 12h16"/><path d="M4 19h16"/>',
  close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  collapse: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="m16 15-3-3 3-3"/>',
  expand: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="m14 9 3 3-3 3"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  moon: '<path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"/>',
  docs: '<path d="M12 5v16"/><path d="M20.001 19A2 2 0 0022 17V5a2 2 0 00-1.999-2L16 3.002A5 5 0 0012 5a5 5 0 00-4-2H4a2 2 0 00-2 2v12a2 2 0 001.999 2H8a5 5 0 014 2 5 5 0 014-2z"/>',
  dashboard: '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  play: '<path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"/>',
  file: '<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  megaphone: '<path d="M11 6a13 13 0 0 0 8.4-2.8A1 1 0 0 1 21 4v12a1 1 0 0 1-1.6.8A13 13 0 0 0 11 14H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z"/><path d="M6 14a12 12 0 0 0 2.4 7.2 2 2 0 0 0 3.2-2.4A8 8 0 0 1 10 14"/><path d="M8 6v8"/>',
  star: '<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/>',
  layers: '<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"/><path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12"/><path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17"/>',
  mail: '<path d="m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7"/><rect x="2" y="4" width="20" height="16" rx="2"/>',
  rss: '<path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1"/>',
  newspaper: '<path d="M15 18h-5"/><path d="M18 14h-8"/><path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-4 0v-9a2 2 0 0 1 2-2h2"/><rect width="8" height="4" x="10" y="6" rx="1"/>',
  building: '<path d="M10 12h4"/><path d="M10 8h4"/><path d="M14 21v-3a2 2 0 0 0-4 0v3"/><path d="M6 10H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-2"/><path d="M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><path d="M16 3.128a4 4 0 0 1 0 7.744"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><circle cx="9" cy="7" r="4"/>',
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  receipt: '<path d="M12 17V7"/><path d="M16 8h-6a2 2 0 0 0 0 4h4a2 2 0 0 1 0 4H8"/><path d="M4 3a1 1 0 0 1 1-1 1.3 1.3 0 0 1 .7.2l.933.6a1.3 1.3 0 0 0 1.4 0l.934-.6a1.3 1.3 0 0 1 1.4 0l.933.6a1.3 1.3 0 0 0 1.4 0l.933-.6a1.3 1.3 0 0 1 1.4 0l.934.6a1.3 1.3 0 0 0 1.4 0l.933-.6A1.3 1.3 0 0 1 19 2a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1 1.3 1.3 0 0 1-.7-.2l-.933-.6a1.3 1.3 0 0 0-1.4 0l-.934.6a1.3 1.3 0 0 1-1.4 0l-.933-.6a1.3 1.3 0 0 0-1.4 0l-.933.6a1.3 1.3 0 0 1-1.4 0l-.934-.6a1.3 1.3 0 0 0-1.4 0l-.933.6a1.3 1.3 0 0 1-.7.2 1 1 0 0 1-1-1z"/>',
  settings: '<path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"/><circle cx="12" cy="12" r="3"/>',
  bell: '<path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"/>',
  activity: '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>',
  list: '<path d="M3 5h.01"/><path d="M3 12h.01"/><path d="M3 19h.01"/><path d="M8 5h13"/><path d="M8 12h13"/><path d="M8 19h13"/>',
  send: '<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>',
  search: '<path d="m21 21-4.34-4.34"/><circle cx="11" cy="11" r="8"/>',
  swords: '<path d="m13 19 6-6"/><path d="M14.5 17.5 3.586 6.586A2 2 0 013 5.172V3h2.172a2 2 0 011.414.586L17.5 14.5"/><path d="m14.828 6.172 2.586-2.586A2 2 0 0118.828 3H21v2.172a2 2 0 01-.586 1.414l-2.586 2.586"/><path d="m16 16 4 4"/><path d="m19 21 2-2"/><path d="m5 14 4 4"/><path d="m5 21-2-2"/><path d="M7.5 16.5 4 20"/>',
  wallet: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
  gauge: '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
  scroll: '<path d="M15 12h-5"/><path d="M15 8h-5"/><path d="M19 17V5a2 2 0 0 0-2-2H4"/><path d="M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3"/>',
  message: '<path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z"/>',
  flame: '<path d="M12 3q1 4 4 6.5t3 5.5a1 1 0 0 1-14 0 5 5 0 0 1 1-3 1 1 0 0 0 5 0c0-2-1.5-3-1.5-5q0-2 2.5-4"/>',
  radar: '<path d="M19.07 4.93A10 10 0 0 0 6.99 3.34"/><path d="M4 6h.01"/><path d="M2.29 9.62A10 10 0 1 0 21.31 8.35"/><path d="M16.24 7.76A6 6 0 1 0 8.23 16.67"/><path d="M12 18h.01"/><path d="M17.99 11.66A6 6 0 0 1 15.77 16.67"/><circle cx="12" cy="12" r="2"/><path d="m13.41 10.59 5.66-5.66"/>',
  sparkles: '<path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/><path d="M20 2v4"/><path d="M22 4h-4"/><circle cx="4" cy="20" r="2"/>',
  inbox: '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
} as const;

export type ShellIcon = keyof typeof ICONS;
export type ShellNavItem = { href: string; label: string; icon: ShellIcon; /** Extra path prefixes that count as this item (detail pages). */ also?: string[] };
export type ShellNavSection = { heading?: string; items: ShellNavItem[] };
export type ShellSpend = { label: string; spent: string; cap?: string; /** 0 to 1, drawn as a bar. */ ratio?: number };
export type AppShellProps = {
  appName: string;
  nav: ShellNavSection[];
  githubHref: string;
  docsHref?: string;
  /** Text of the demo badge. Leave out when the app runs on real data. */
  demoLabel?: string;
  spend?: ShellSpend;
  primaryAction?: { href: string; label: string };
  children: React.ReactNode;
};

const GITHUB_PATH =
  "M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12";

function Icon({ name }: { name: ShellIcon | "github" }) {
  if (name === "github") {
    return (
      <svg className="ls-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d={GITHUB_PATH} />
      </svg>
    );
  }
  return <svg className="ls-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: ICONS[name] }} />;
}

/* Collapsed state: localStorage when it works, a variable when it does not. */
const COLLAPSE_KEY = "looot-shell-collapsed";
let memoryCollapsed = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
};
function readCollapsed() {
  try {
    const v = localStorage.getItem(COLLAPSE_KEY);
    if (v !== null) return v === "1";
  } catch {}
  return memoryCollapsed;
}
function writeCollapsed(v: boolean) {
  memoryCollapsed = v;
  try {
    localStorage.setItem(COLLAPSE_KEY, v ? "1" : "0");
  } catch {}
  notify();
}

/* Theme: the same "dark" class and "theme" key the apps' pre-paint script uses. */
const subscribeTheme = (cb: () => void) => {
  const obs = new MutationObserver(cb);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => obs.disconnect();
};
const readDark = () => document.documentElement.classList.contains("dark");
function flipTheme() {
  const dark = !readDark();
  document.documentElement.classList.toggle("dark", dark);
  try {
    localStorage.setItem("theme", dark ? "dark" : "light");
  } catch {}
}

const isActive = (path: string, item: ShellNavItem) => {
  const hit = (h: string) => (h === "/" ? path === "/" : path === h || path.startsWith(`${h}/`));
  return hit(item.href) || (item.also ?? []).some(hit);
};

export function AppShell({ appName, nav, githubHref, docsHref = "https://docs.looot.ai", demoLabel, spend, primaryAction, children }: AppShellProps) {
  const path = usePathname() ?? "/";
  const collapsed = useSyncExternalStore(subscribe, readCollapsed, () => false);
  const dark = useSyncExternalStore(subscribeTheme, readDark, () => false);
  const [open, setOpen] = useState(false);
  const sideRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  const items = nav.flatMap((s) => s.items);
  const current = items.filter((i) => isActive(path, i)).sort((a, b) => b.href.length - a.href.length)[0];
  const title = current?.label ?? appName;
  const showAction = primaryAction && !(current && current.href === primaryAction.href);

  useEffect(() => {
    if (!open) {
      if (wasOpen.current) menuRef.current?.focus();
      wasOpen.current = false;
      return;
    }
    wasOpen.current = true;
    closeRef.current?.focus();
    const side = sideRef.current;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        return;
      }
      if (e.key !== "Tab" || !side) return;
      const f = Array.from(side.querySelectorAll<HTMLElement>("a[href], button:not([disabled])")).filter((el) => el.getClientRects().length > 0);
      if (f.length === 0) return;
      const first = f[0];
      const last = f[f.length - 1];
      const at = document.activeElement;
      if (!side.contains(at)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && at === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && at === last) {
        e.preventDefault();
        first.focus();
      }
    };
    const mq = window.matchMedia("(min-width: 1024px)");
    const onWide = () => mq.matches && setOpen(false);
    document.addEventListener("keydown", onKey);
    mq.addEventListener("change", onWide);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      mq.removeEventListener("change", onWide);
      document.body.style.overflow = prev;
    };
  }, [open]);

  const close = () => setOpen(false);
  const demoShort = demoLabel ? "Demo" : "";

  return (
    <div className="ls-root" data-collapsed={collapsed ? "true" : "false"} data-open={open ? "true" : "false"}>
      <a href="#main" className="ls-skip">
        Skip to content
      </a>
      <div className="ls-backdrop" onClick={close} aria-hidden="true" />
      <aside ref={sideRef} id="ls-sidebar" className="ls-side" aria-label={`${appName} sidebar`} role={open ? "dialog" : undefined} aria-modal={open ? true : undefined}>
        <div className="ls-brand">
          <Link href="/" className="ls-brand-link" aria-label={`${appName}, home`} onClick={close}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/looot-mark-white.svg" alt="" width={24} height={24} className="ls-mark" />
            <span className="ls-label ls-name">{appName}</span>
          </Link>
          <button ref={closeRef} type="button" className="ls-iconbtn ls-close" onClick={close} aria-label="Close menu">
            <Icon name="close" />
          </button>
        </div>

        <nav className="ls-nav" aria-label="Main">
          {nav.map((section, i) => (
            <div key={section.heading ?? i} className="ls-section">
              {section.heading && <p className="ls-group ls-label">{section.heading}</p>}
              <ul>
                {section.items.map((item) => {
                  const active = isActive(path, item);
                  return (
                    <li key={item.href}>
                      <Link href={item.href} className="ls-item" aria-current={active ? "page" : undefined} title={item.label} onClick={close}>
                        <Icon name={item.icon} />
                        <span className="ls-label">{item.label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="ls-foot">
          {spend && (
            <div className="ls-spend" title={`${spend.label}: ${spend.spent}${spend.cap ? ` of ${spend.cap}` : ""}`}>
              <p className="ls-label ls-spend-text">
                <span>{spend.label}</span>
                <strong>
                  {spend.spent}
                  {spend.cap ? ` of ${spend.cap}` : ""}
                </strong>
              </p>
              {spend.ratio !== undefined && (
                <div className="ls-meter" role="meter" aria-label={spend.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.min(1, Math.max(0, spend.ratio)) * 100)}>
                  <span style={{ width: `${Math.round(Math.min(1, Math.max(0, spend.ratio)) * 100)}%` }} />
                </div>
              )}
            </div>
          )}
          {demoLabel && (
            <p className="ls-demo" title={demoLabel}>
              <span className="ls-label">{demoLabel}</span>
              <span className="ls-short">{demoShort}</span>
            </p>
          )}
          <button type="button" className="ls-item ls-foot-item" onClick={flipTheme} aria-label={dark ? "Switch to light theme" : "Switch to dark theme"} title={dark ? "Light theme" : "Dark theme"}>
            <Icon name={dark ? "sun" : "moon"} />
            <span className="ls-label">{dark ? "Light theme" : "Dark theme"}</span>
          </button>
          <a className="ls-item ls-foot-item" href={docsHref} target="_blank" rel="noreferrer" title="Docs">
            <Icon name="docs" />
            <span className="ls-label">Docs</span>
          </a>
          <a className="ls-item ls-foot-item" href={githubHref} target="_blank" rel="noreferrer" title="GitHub">
            <Icon name="github" />
            <span className="ls-label">GitHub</span>
          </a>
          <button type="button" className="ls-item ls-foot-item ls-collapse" onClick={() => writeCollapsed(!collapsed)} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-expanded={!collapsed} aria-controls="ls-sidebar" title={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
            <Icon name={collapsed ? "expand" : "collapse"} />
            <span className="ls-label">Collapse</span>
          </button>
        </div>
      </aside>

      <div className="ls-content" inert={open}>
        <header className="ls-top">
          <button ref={menuRef} type="button" className="ls-iconbtn ls-menu" onClick={() => setOpen(true)} aria-label="Open menu" aria-expanded={open} aria-controls="ls-sidebar">
            <Icon name="menu" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/looot-mark.svg" alt="" width={20} height={20} className="ls-top-mark ls-mark-light" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/looot-mark-white.svg" alt="" width={20} height={20} className="ls-top-mark ls-mark-dark" />
          <p className="ls-title">{title}</p>
          {showAction && (
            <Link href={primaryAction.href} className="ls-action">
              <Icon name="plus" />
              <span>{primaryAction.label}</span>
            </Link>
          )}
        </header>
        <main id="main" className="ls-main">
          {children}
        </main>
      </div>
    </div>
  );
}
