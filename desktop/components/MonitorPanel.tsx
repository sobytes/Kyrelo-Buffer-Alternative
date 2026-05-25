"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { WatchedPost, WatchSettings, WatchState } from "@/lib/types";
import { PlatformMeta } from "@/lib/platforms";
import { PlatformIcon } from "@/components/PlatformIcon";

// Lightweight monitor panel for non-X platforms. Mirrors the same data flow
// as DetectorPanel (watched-handle list + recent posts feed) but without the
// X-specific @grok reply UI.

const POLL_MS = 8_000;

export function MonitorPanel({ platform }: { platform: PlatformMeta }) {
  const slug = platform.slug;
  const [settings, setSettings] = useState<WatchSettings | null>(null);
  const [state, setState] = useState<WatchState | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [handleInput, setHandleInput] = useState("");
  const [connected, setConnected] = useState(false);

  const load = useCallback(async () => {
    const [s, st, c] = await Promise.all([
      fetch("/api/watch/settings").then((r) => r.json()),
      fetch(`/api/watch/${slug}/state`).then((r) => r.json()),
      fetch(`/api/connect/${slug}`).then((r) => r.json()),
    ]);
    setSettings(s.settings);
    setState(st.state);
    setConnected(Array.isArray(c.accounts) && c.accounts.length > 0);
  }, [slug]);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  async function save(next: WatchSettings) {
    setSettings(next);
    await fetch("/api/watch/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next),
    });
    // Handle changes can wipe state — reload.
    fetch(`/api/watch/${slug}/state`)
      .then((r) => r.json())
      .then((j) => setState(j.state));
  }

  function handlesFor(s: WatchSettings): string[] {
    return s.handles[slug] ?? [];
  }
  function withHandles(s: WatchSettings, list: string[]): WatchSettings {
    return { ...s, handles: { ...s.handles, [slug]: list } };
  }

  function addHandle() {
    if (!settings) return;
    const h = handleInput.trim().replace(/^@/, "").toLowerCase();
    const current = handlesFor(settings);
    if (!h || current.includes(h)) {
      setHandleInput("");
      return;
    }
    save(withHandles(settings, [...current, h]));
    setHandleInput("");
  }

  function removeHandle(h: string) {
    if (!settings) return;
    save(withHandles(settings, handlesFor(settings).filter((x) => x !== h)));
  }

  async function refreshNow() {
    setRefreshing(true);
    try {
      const res = await fetch(`/api/watch/${slug}/run`, { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) alert(`Run failed: ${json.error ?? res.status}`);
      else if (json.skipped) console.log(`Skipped: ${json.skipped}`);
    } finally {
      setRefreshing(false);
      load();
    }
  }

  if (!settings || !state) {
    return <div className="card text-sm text-zinc-500">Loading…</div>;
  }

  const handles = handlesFor(settings);
  const posts = [...state.posts].sort((a, b) =>
    (b.postedAt ?? b.seenAt).localeCompare(a.postedAt ?? a.seenAt),
  );
  const watching = settings.enabled && connected && handles.length > 0;

  return (
    <div className="space-y-5">
      {/* Status hero */}
      <section className="card flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-panel2 text-zinc-200">
            <PlatformIcon slug={slug} className="h-5 w-5" />
          </div>
          <div>
            <div className="text-sm font-semibold text-zinc-100">
              {platform.label} monitor
            </div>
            <div className="mt-0.5 text-xs text-zinc-500">
              {!connected
                ? "Connect an account to start watching."
                : handles.length === 0
                  ? `Add ${platform.label} handles to start watching.`
                  : watching
                    ? `Watching ${handles.length} handle${handles.length === 1 ? "" : "s"}`
                    : "Paused"}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!connected && (
            <Link
              href={`/connected/${slug}`}
              className="btn-primary text-xs"
            >
              Connect {platform.label}
            </Link>
          )}
          <button
            onClick={() => save({ ...settings, enabled: !settings.enabled })}
            disabled={!connected || handles.length === 0}
            className={
              "rounded-md border px-3 py-1.5 text-xs " +
              (settings.enabled
                ? "border-accent/40 bg-accent/10 text-zinc-100"
                : "border-line bg-panel2/40 text-zinc-400 hover:border-line2 hover:text-zinc-200")
            }
          >
            {settings.enabled ? "Watching" : "Paused"}
          </button>
          <button
            onClick={refreshNow}
            disabled={refreshing || !connected || handles.length === 0}
            className="btn-ghost text-xs"
          >
            {refreshing ? "Checking…" : "Check now"}
          </button>
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[340px_1fr]">
        {/* Handles sidebar */}
        <aside className="space-y-3">
          <div className="card space-y-2">
            <div className="label">Watched handles</div>
            <div className="flex gap-2">
              <input
                className="input text-sm"
                placeholder={`@handle (no @ needed)`}
                value={handleInput}
                onChange={(e) => setHandleInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addHandle())}
              />
              <button
                onClick={addHandle}
                disabled={!handleInput.trim()}
                className="btn-primary text-xs"
              >
                Add
              </button>
            </div>
            {handles.length === 0 ? (
              <p className="text-[11px] text-zinc-500">
                No handles yet. Add one above to start surfacing new posts.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {handles.map((h) => (
                  <span
                    key={h}
                    className="inline-flex items-center gap-1 rounded-full border border-line bg-panel2 px-2 py-0.5 text-[11px] text-zinc-300"
                  >
                    @{h}
                    <button
                      onClick={() => removeHandle(h)}
                      className="text-zinc-500 hover:text-rose-400"
                      aria-label={`Remove @${h}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </aside>

        {/* Feed */}
        <section className="space-y-3">
          {posts.length === 0 ? (
            <div className="card text-sm text-zinc-500">
              {!connected || handles.length === 0
                ? "Waiting for setup."
                : state.lastCheckedAt
                  ? "No posts seen yet — they'll appear here as they roll in."
                  : "First check hasn't run yet."}
            </div>
          ) : (
            posts.slice(0, 50).map((p) => <PostRow key={p.id} post={p} />)
          )}
        </section>
      </div>
    </div>
  );
}

function PostRow({ post }: { post: WatchedPost }) {
  return (
    <div className="card-tight">
      <div className="mb-1.5 flex items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-zinc-100">@{post.handle}</span>
          {post.isReply && (
            <span className="text-[10px] uppercase tracking-wider text-zinc-500">
              reply
            </span>
          )}
          <span className="text-zinc-500">
            {new Date(post.postedAt ?? post.seenAt).toLocaleString()}
          </span>
        </div>
        {post.url && (
          <a
            href={post.url}
            target="_blank"
            rel="noreferrer"
            className="text-[11px] text-zinc-500 hover:text-accent"
          >
            open ↗
          </a>
        )}
      </div>
      <div className="whitespace-pre-wrap break-words text-sm text-zinc-200">
        {post.text}
      </div>
    </div>
  );
}
