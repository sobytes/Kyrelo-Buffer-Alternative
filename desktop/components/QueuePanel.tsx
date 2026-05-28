"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ScheduledPost } from "@/lib/types";
import { PLATFORMS, PlatformSlug, getPlatform } from "@/lib/platforms";
import { PlatformIcon } from "@/components/PlatformIcon";

interface Counts {
  pending: number;
  posting: number;
}

export function QueuePanel() {
  const [posts, setPosts] = useState<ScheduledPost[] | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [filter, setFilter] = useState<PlatformSlug | "all">("all");

  async function loadPosts() {
    const r = await fetch("/api/scheduler/posts").then((r) => r.json());
    setPosts(r.posts ?? []);
  }

  useEffect(() => {
    loadPosts();
    const reload = setInterval(loadPosts, 5_000);
    const tick = setInterval(() => setNow(Date.now()), 1_000);
    return () => {
      clearInterval(reload);
      clearInterval(tick);
    };
  }, []);

  async function cancel(id: string) {
    if (!confirm("Cancel this scheduled post?")) return;
    await fetch(`/api/scheduler/posts/${id}`, { method: "DELETE" });
    loadPosts();
  }

  async function cancelAll(scope: "all" | PlatformSlug) {
    const count =
      scope === "all"
        ? (posts ?? []).filter((p) => p.status === "pending").length
        : (posts ?? []).filter(
            (p) => p.status === "pending" && p.platform === scope,
          ).length;
    if (count === 0) return;
    const label =
      scope === "all"
        ? `Cancel all ${count} pending post${count === 1 ? "" : "s"}? This can't be undone.`
        : `Cancel all ${count} pending ${getPlatform(scope)?.label ?? scope} post${count === 1 ? "" : "s"}? This can't be undone.`;
    if (!confirm(label)) return;
    await fetch("/api/scheduler/posts/cancel-all", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(scope === "all" ? {} : { platform: scope }),
    });
    loadPosts();
  }

  if (!posts) {
    return <div className="card text-sm text-zinc-500">Loading…</div>;
  }

  // Pending + posting only — the queue is "what's still going out". History
  // lives on each platform's dedicated Scheduler page.
  const upcoming = posts.filter(
    (p) => p.status === "pending" || p.status === "posting",
  );
  const filtered = filter === "all"
    ? upcoming
    : upcoming.filter((p) => p.platform === filter);
  filtered.sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor));

  // Per-platform counts for the filter pills.
  const counts: Record<string, Counts> = {};
  for (const p of upcoming) {
    counts[p.platform] ??= { pending: 0, posting: 0 };
    if (p.status === "pending") counts[p.platform].pending++;
    else counts[p.platform].posting++;
  }
  const total = upcoming.length;

  // Group rows by local date so the user can scan day-by-day.
  const groups: { label: string; items: ScheduledPost[] }[] = [];
  for (const p of filtered) {
    const label = dayLabel(p.scheduledFor, now);
    const bucket = groups.find((g) => g.label === label);
    if (bucket) bucket.items.push(p);
    else groups.push({ label, items: [p] });
  }

  const pendingInScope =
    filter === "all"
      ? upcoming.filter((p) => p.status === "pending").length
      : upcoming.filter(
          (p) => p.status === "pending" && p.platform === filter,
        ).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-1.5">
        <FilterPill
          active={filter === "all"}
          onClick={() => setFilter("all")}
          label="All"
          count={total}
        />
        {PLATFORMS.filter((p) => p.status === "live").map((p) => {
          const c = counts[p.slug];
          const total = (c?.pending ?? 0) + (c?.posting ?? 0);
          return (
            <FilterPill
              key={p.slug}
              active={filter === p.slug}
              onClick={() => setFilter(p.slug)}
              label={p.label}
              icon={<PlatformIcon slug={p.slug} className="h-3.5 w-3.5" />}
              count={total}
            />
          );
        })}
        {pendingInScope > 0 && (
          <button
            onClick={() => cancelAll(filter)}
            className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-rose-900/60 bg-rose-950/30 px-2.5 py-1 text-[11px] text-rose-300 hover:border-rose-700 hover:text-rose-200"
            title="Cancel every pending post in this view"
          >
            Cancel all pending ({pendingInScope})
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="card text-sm text-zinc-500">
          Nothing queued{filter === "all" ? "" : ` for ${getPlatform(filter)?.label ?? filter}`}.
        </div>
      ) : (
        <div className="space-y-7">
          {groups.map(({ label, items }) => (
            <div key={label} className="relative pl-7">
              <div className="absolute bottom-2 left-[7px] top-2 w-px bg-line2" />
              <div className="mb-3 -ml-7 inline-flex items-center gap-2 rounded-full border border-line bg-panel px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-zinc-400">
                <span className="h-1.5 w-1.5 rounded-full bg-zinc-500" />
                {label}
              </div>
              <div className="space-y-3">
                {items.map((p) => (
                  <QueueRow
                    key={p.id}
                    post={p}
                    now={now}
                    onCancel={() => cancel(p.id)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FilterPill({
  active,
  onClick,
  label,
  icon,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon?: React.ReactNode;
  count: number;
}) {
  return (
    <button
      onClick={onClick}
      className={
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition " +
        (active
          ? "border-accent bg-accent/15 text-zinc-100"
          : "border-line bg-panel2/40 text-zinc-400 hover:border-line2 hover:text-zinc-200")
      }
    >
      {icon && <span className="shrink-0">{icon}</span>}
      <span>{label}</span>
      <span
        className={
          "rounded-full px-1.5 text-[10px] " +
          (active
            ? "bg-accent/30 text-zinc-100"
            : "bg-panel2 text-zinc-500")
        }
      >
        {count}
      </span>
    </button>
  );
}

function QueueRow({
  post,
  now,
  onCancel,
}: {
  post: ScheduledPost;
  now: number;
  onCancel: () => void;
}) {
  const platform = getPlatform(post.platform);
  const time = new Date(post.scheduledFor).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
  const dueMs = new Date(post.scheduledFor).getTime() - now;
  const isPosting = post.status === "posting";
  const isAi = post.proposedBy === "ai-bot";
  return (
    <div className="relative">
      <div className="pointer-events-none absolute -left-[26px] top-3.5 flex h-3 w-3 items-center justify-center">
        <span
          className={
            "block h-2.5 w-2.5 rounded-full ring-4 ring-ink " +
            (isPosting
              ? "bg-amber-400 animate-pulse shadow-[0_0_0_4px_rgba(251,191,36,0.15)]"
              : "bg-accent shadow-[0_0_0_4px_rgba(124,92,255,0.18)]")
          }
        />
      </div>
      <div
        className={
          "card-tight " +
          (isAi
            ? "border-accent/40 bg-accent/[0.04] shadow-[inset_3px_0_0_0_rgba(124,92,255,0.6)]"
            : "")
        }
      >
        <div className="mb-1.5 flex items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2">
            <span className="font-semibold tabular-nums text-zinc-100">{time}</span>
            {platform && (
              <Link
                href={`/scheduler/${platform.slug}`}
                className="inline-flex items-center gap-1 rounded-md border border-line bg-panel2 px-1.5 py-0.5 text-[10px] text-zinc-300 hover:border-line2 hover:text-zinc-100"
              >
                <PlatformIcon slug={platform.slug} className="h-3 w-3" />
                {platform.label}
              </Link>
            )}
            {post.accountId && (
              <span className="text-[10px] text-zinc-500">@{post.accountId}</span>
            )}
            {post.proposedBy === "ai-bot" && <AiProposedBadge />}
            <span className={isPosting ? "text-amber-300" : "text-accent"}>
              {isPosting
                ? "Posting now…"
                : dueMs > 0
                  ? `in ${formatCountdown(dueMs)}`
                  : "any moment…"}
            </span>
          </div>
          {post.status === "pending" && (
            <button
              onClick={onCancel}
              className="text-[11px] text-zinc-500 hover:text-rose-400"
            >
              Cancel
            </button>
          )}
        </div>
        <div className="whitespace-pre-wrap break-words text-sm text-zinc-200">
          {post.text}
        </div>
        {post.imagePath && (
          <div className="mt-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/scheduler/uploads/${post.imagePath}`}
              alt=""
              className="max-h-32 rounded-md border border-line object-cover"
            />
          </div>
        )}
      </div>
    </div>
  );
}

function AiProposedBadge() {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-accent"
      title="Proposed by the AI Bot — review before it sends."
    >
      AI proposed
    </span>
  );
}

function dayLabel(iso: string, nowMs: number): string {
  const d = new Date(iso);
  const today = new Date(nowMs);
  today.setHours(0, 0, 0, 0);
  const target = new Date(d);
  target.setHours(0, 0, 0, 0);
  const diffDays = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  if (diffDays > 1 && diffDays < 7) {
    return d.toLocaleDateString(undefined, { weekday: "long" });
  }
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function formatCountdown(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  return `${seconds}s`;
}
