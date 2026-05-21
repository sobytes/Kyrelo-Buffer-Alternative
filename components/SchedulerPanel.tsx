"use client";
import { useEffect, useState } from "react";
import { ScheduledPost, XAccount } from "@/lib/types";

interface ConnectStatus {
  accounts: XAccount[];
}

export function SchedulerPanel() {
  const [posts, setPosts] = useState<ScheduledPost[]>([]);
  const [accounts, setAccounts] = useState<XAccount[]>([]);
  const [accountId, setAccountId] = useState<string>("");
  const [text, setText] = useState("");
  const [scheduledFor, setScheduledFor] = useState(defaultDateTime());
  const [submitting, setSubmitting] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);

  async function loadPosts() {
    const r = await fetch("/api/scheduler/posts").then((r) => r.json());
    setPosts(r.posts ?? []);
  }

  async function loadConnect() {
    const r = (await fetch("/api/twitter-connect").then((r) => r.json())) as ConnectStatus;
    setAccounts(r.accounts ?? []);
    setAccountId((curr) => {
      if (curr && r.accounts.some((a) => a.id === curr)) return curr;
      return r.accounts[0]?.id ?? "";
    });
  }

  useEffect(() => {
    loadPosts();
    loadConnect();
    const id = setInterval(() => {
      loadPosts();
      loadConnect();
    }, 5_000);
    return () => clearInterval(id);
  }, []);

  async function schedule(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || !scheduledFor || !accountId) return;
    setSubmitting(true);
    try {
      const r = await fetch("/api/scheduler/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform: "twitter",
          accountId,
          text,
          scheduledFor: new Date(scheduledFor).toISOString(),
        }),
      }).then((r) => r.json());
      if (r.error) {
        alert(r.error);
      } else {
        setText("");
        setScheduledFor(defaultDateTime());
        await loadPosts();
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function cancel(id: string) {
    if (!confirm("Cancel this scheduled post?")) return;
    await fetch(`/api/scheduler/posts/${id}`, { method: "DELETE" });
    loadPosts();
  }

  const sorted = [...posts].sort((a, b) =>
    a.scheduledFor.localeCompare(b.scheduledFor),
  );
  const upcoming = sorted.filter((p) => p.status === "pending" || p.status === "posting");
  const history = sorted.filter((p) => p.status === "posted" || p.status === "failed").reverse();

  const overLimit = text.length > 280;

  return (
    <div className="space-y-5">
      <section className="card space-y-3">
        <div className="label">Schedule a post</div>

        {accounts.length === 0 && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-300">
            No X account connected. Posts won&apos;t send until you add one under{" "}
            <strong>Connected accounts</strong>.
          </div>
        )}

        <form onSubmit={schedule} className="space-y-3">
          <div>
            <div className="label">Account</div>
            <select
              className="rounded-md border border-line bg-ink px-2 py-2 text-sm w-full"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              disabled={accounts.length === 0}
            >
              {accounts.length === 0 ? (
                <option value="">No accounts connected</option>
              ) : (
                accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    @{a.handle}
                  </option>
                ))
              )}
            </select>
          </div>

          <div>
            <div className="label">Post text</div>
            <textarea
              className="textarea h-28 resize-none"
              placeholder="What do you want to post?"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <div className={"mt-1 text-[10px] " + (overLimit ? "text-rose-400" : "text-zinc-500")}>
              {text.length} / 280
            </div>
          </div>

          <div>
            <div className="label">When</div>
            <input
              type="datetime-local"
              className="input text-sm"
              value={scheduledFor}
              onChange={(e) => setScheduledFor(e.target.value)}
              min={nowDateTime()}
            />
          </div>

          <button
            type="submit"
            disabled={submitting || !text.trim() || overLimit || !scheduledFor || !accountId}
            className="btn-primary text-sm"
          >
            {submitting ? "Scheduling…" : "Schedule post"}
          </button>
        </form>
      </section>

      <section className="space-y-2">
        <div className="label">Upcoming ({upcoming.length})</div>
        {upcoming.length === 0 ? (
          <div className="card text-sm text-zinc-500">Nothing queued.</div>
        ) : (
          upcoming.map((p) => (
            <PostRow key={p.id} post={p} now={now} onCancel={() => cancel(p.id)} />
          ))
        )}
      </section>

      {history.length > 0 && (
        <section className="space-y-2">
          <div className="label">History</div>
          {history.slice(0, 20).map((p) => (
            <PostRow key={p.id} post={p} now={now} onCancel={() => cancel(p.id)} />
          ))}
        </section>
      )}
    </div>
  );
}

function PostRow({
  post,
  now,
  onCancel,
}: {
  post: ScheduledPost;
  now: number;
  onCancel: () => void;
}) {
  const dueMs = new Date(post.scheduledFor).getTime() - now;
  return (
    <div className="card-tight">
      <div className="mb-2 flex items-center justify-between gap-2 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={post.status} />
          <span className="text-zinc-400">
            {new Date(post.scheduledFor).toLocaleString()}
          </span>
          {post.status === "pending" && (
            <span className="text-accent">
              {dueMs > 0 ? `Sending in ${formatCountdown(dueMs)}` : "Sending any moment…"}
            </span>
          )}
          {post.status === "posting" && (
            <span className="text-amber-300">Posting now…</span>
          )}
        </div>
        {post.status === "pending" && (
          <button onClick={onCancel} className="text-[11px] text-zinc-500 hover:text-rose-400">
            Cancel
          </button>
        )}
      </div>
      <div className="whitespace-pre-wrap break-words text-sm text-zinc-200">{post.text}</div>
      {post.postedUrl && (
        <a
          href={post.postedUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-block text-[11px] text-zinc-500 hover:text-zinc-300"
        >
          open on X ↗
        </a>
      )}
      {post.error && (
        <div className="mt-2 rounded-md border border-rose-900/50 bg-rose-950/30 p-2 text-[11px] text-rose-300">
          {post.error}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: ScheduledPost["status"] }) {
  const styles: Record<ScheduledPost["status"], string> = {
    pending: "bg-zinc-800/60 text-zinc-300",
    posting: "bg-amber-500/10 text-amber-300",
    posted: "bg-live/10 text-emerald-300",
    failed: "bg-rose-500/10 text-rose-300",
  };
  return (
    <span
      className={
        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide " +
        styles[status]
      }
    >
      {status}
    </span>
  );
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

function toDateTimeLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function defaultDateTime(): string {
  // Pre-fill the next clean minute — user can bump it from there.
  const d = new Date(Date.now() + 60 * 1000);
  d.setSeconds(0, 0);
  return toDateTimeLocal(d);
}

function nowDateTime(): string {
  // Lower bound: don't allow scheduling in the past.
  const d = new Date();
  d.setSeconds(0, 0);
  return toDateTimeLocal(d);
}
