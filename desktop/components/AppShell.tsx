"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { PLATFORMS, PlatformSlug } from "@/lib/platforms";
import { PlatformIcon } from "@/components/PlatformIcon";

// Periodically fetch which platforms have at least one connected account,
// so the sidebar can show a small green dot next to live ones. 30s cadence
// is plenty — connect is a manual action, not a background event.
function useConnectedMap(): Partial<Record<PlatformSlug, boolean>> {
  const [map, setMap] = useState<Partial<Record<PlatformSlug, boolean>>>({});
  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      const results = await Promise.all(
        PLATFORMS.map(async (p) => {
          try {
            const r = await fetch(`/api/connect/${p.slug}`).then((r) => r.json());
            return [p.slug, Array.isArray(r.accounts) && r.accounts.length > 0] as const;
          } catch {
            return [p.slug, false] as const;
          }
        }),
      );
      if (cancelled) return;
      const next: Partial<Record<PlatformSlug, boolean>> = {};
      for (const [slug, connected] of results) next[slug] = connected;
      setMap(next);
    }
    refresh();
    const id = setInterval(refresh, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);
  return map;
}

interface SubNavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
}

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  // Sections that fan out per-platform set `platformChildren = true`.
  // We expand the PLATFORMS list inline at render time so a new platform
  // automatically appears under every section that opts in.
  platformChildren?: boolean;
  // Section-specific children rendered above the per-platform list.
  // Used today for "All platforms" under Scheduler — applies only there,
  // not to Connected/Monitor, because cross-managing accounts or scraping
  // every platform doesn't make sense from one screen.
  extraChildrenBefore?: SubNavItem[];
}

const NAV: NavItem[] = [
  {
    href: "/detector",
    label: "Monitor",
    platformChildren: true,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 3v9l6 4" />
      </svg>
    ),
  },
  {
    href: "/scheduler",
    label: "Scheduler",
    platformChildren: true,
    // Cross-post composer lives ABOVE the per-platform entries — it's the
    // most-used surface for a scheduling tool that supports many networks.
    extraChildrenBefore: [
      {
        href: "/scheduler/queue",
        label: "Queue",
        icon: (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M4 5h16M4 12h16M4 19h16" />
            <circle cx="3" cy="5" r="0.8" fill="currentColor" />
            <circle cx="3" cy="12" r="0.8" fill="currentColor" />
            <circle cx="3" cy="19" r="0.8" fill="currentColor" />
          </svg>
        ),
      },
      {
        href: "/scheduler/all",
        label: "All platforms",
        icon: (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M4 6h16M4 12h16M4 18h10" />
          </svg>
        ),
      },
    ],
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <path d="M16 2v4M8 2v4M3 10h18" />
      </svg>
    ),
  },
  {
    href: "/connected",
    label: "Connected",
    platformChildren: true,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10 14a5 5 0 0 1 0-7l3-3a5 5 0 0 1 7 7l-1.5 1.5" />
        <path d="M14 10a5 5 0 0 1 0 7l-3 3a5 5 0 0 1-7-7l1.5-1.5" />
      </svg>
    ),
  },
  {
    href: "/settings",
    label: "Settings",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
      </svg>
    ),
  },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const connectedMap = useConnectedMap();
  return (
    <div className="flex min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-30 flex w-56 flex-col border-r border-line bg-panel/95 backdrop-blur-xl">
        <div className="window-drag flex items-center gap-2.5 px-5 pb-4 pt-10 border-b border-line">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/icon.png"
            alt=""
            className="h-7 w-7 rounded-md shadow-[0_4px_16px_-6px_rgba(124,92,255,0.7)]"
          />
          <span className="text-sm font-semibold tracking-tight text-zinc-100">Kyrelo</span>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
          {NAV.map((item) => {
            const sectionActive =
              pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <div key={item.href}>
                <Link
                  href={item.href}
                  className={
                    "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition " +
                    (sectionActive
                      ? "bg-accent/10 text-zinc-100"
                      : "text-zinc-400 hover:bg-panel2 hover:text-zinc-100")
                  }
                >
                  <span className="h-4 w-4 shrink-0">{item.icon}</span>
                  <span>{item.label}</span>
                </Link>

                {item.platformChildren && (
                  <div className="mb-1 ml-7 mt-0.5 space-y-0.5 border-l border-line/60 pl-2">
                    {item.extraChildrenBefore?.map((child) => {
                      const childActive = pathname === child.href;
                      return (
                        <Link
                          key={child.href}
                          href={child.href}
                          className={
                            "flex items-center gap-2 rounded-md px-2 py-1.5 text-[12px] transition " +
                            (childActive
                              ? "bg-accent/15 text-zinc-100 shadow-[inset_0_0_0_1px_rgba(124,92,255,0.35)]"
                              : "text-zinc-500 hover:bg-panel2 hover:text-zinc-200")
                          }
                        >
                          <span className="h-3.5 w-3.5 shrink-0">{child.icon}</span>
                          <span className="flex-1 truncate">{child.label}</span>
                        </Link>
                      );
                    })}
                    {PLATFORMS.map((p) => {
                      const childHref = `${item.href}/${p.slug}`;
                      const childActive = pathname === childHref;
                      const comingSoon = p.status === "coming-soon";
                      const connected = connectedMap[p.slug] === true;
                      return (
                        <Link
                          key={p.slug}
                          href={childHref}
                          className={
                            "flex items-center gap-2 rounded-md px-2 py-1.5 text-[12px] transition " +
                            (childActive
                              ? "bg-accent/15 text-zinc-100 shadow-[inset_0_0_0_1px_rgba(124,92,255,0.35)]"
                              : "text-zinc-500 hover:bg-panel2 hover:text-zinc-200")
                          }
                        >
                          <PlatformIcon slug={p.slug} className="h-3.5 w-3.5 shrink-0" />
                          <span className="flex-1 truncate">{p.label}</span>
                          {comingSoon ? (
                            <span className="text-[9px] uppercase tracking-wider text-zinc-600">
                              soon
                            </span>
                          ) : connected ? (
                            <span
                              className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_0_3px_rgba(52,211,153,0.15)]"
                              aria-label={`${p.label} connected`}
                            />
                          ) : null}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        <div className="border-t border-line p-3 text-[10px] text-zinc-600">v0.1.0</div>
      </aside>

      <main className="ml-56 flex-1 overflow-x-hidden">{children}</main>
    </div>
  );
}
