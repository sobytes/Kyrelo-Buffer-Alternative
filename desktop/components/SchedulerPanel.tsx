"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ScheduledPost, SocialAccount, WatchSettings } from "@/lib/types";
import { getPlatform, PlatformMeta } from "@/lib/platforms";

interface ConnectStatus {
  accounts: SocialAccount[];
}

export function SchedulerPanel({ platform }: { platform: PlatformMeta }) {
  const platformSlug = platform.slug;
  const connectUrl = `/api/connect/${platformSlug}`;
  const connectedPageUrl = `/connected/${platformSlug}`;
  const [posts, setPosts] = useState<ScheduledPost[]>([]);
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [accountId, setAccountId] = useState<string>("");
  const [text, setText] = useState("");
  const [scheduledFor, setScheduledFor] = useState(defaultDateTime());
  const [submitting, setSubmitting] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [reschedulingPost, setReschedulingPost] = useState<ScheduledPost | null>(null);
  const [editingPost, setEditingPost] = useState<ScheduledPost | null>(null);
  const [aiProvider, setAiProvider] = useState<WatchSettings["aiProvider"]>("claude");
  const [imagePath, setImagePath] = useState<string | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [bulkIntervalMin, setBulkIntervalMin] = useState(60);
  const [bulkStartAt, setBulkStartAt] = useState(defaultDateTime());
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);

  async function pickImage(file: File) {
    setUploadingImage(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/scheduler/upload", {
        method: "POST",
        body: fd,
      }).then((r) => r.json());
      if (r.error) {
        alert(r.error);
        return;
      }
      setImagePath(r.filename);
      if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
      setImagePreviewUrl(URL.createObjectURL(file));
    } finally {
      setUploadingImage(false);
    }
  }

  function clearImage() {
    setImagePath(null);
    if (imagePreviewUrl) {
      URL.revokeObjectURL(imagePreviewUrl);
      setImagePreviewUrl(null);
    }
  }

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);

  async function loadPosts() {
    const r = await fetch("/api/scheduler/posts").then((r) => r.json());
    setPosts(r.posts ?? []);
  }

  const loadConnect = useCallback(async () => {
    const r = (await fetch(connectUrl).then((r) => r.json())) as ConnectStatus;
    setAccounts(r.accounts ?? []);
    setAccountId((curr) => {
      if (curr && r.accounts.some((a) => a.id === curr)) return curr;
      return r.accounts[0]?.id ?? "";
    });
  }, [connectUrl]);

  async function loadAiProvider() {
    const r = await fetch("/api/watch/settings").then((r) => r.json());
    if (r.settings?.aiProvider) setAiProvider(r.settings.aiProvider);
  }

  useEffect(() => {
    loadPosts();
    loadConnect();
    loadAiProvider();
    const id = setInterval(() => {
      loadPosts();
      loadConnect();
    }, 5_000);
    return () => clearInterval(id);
  }, [loadConnect]);

  async function schedule(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || !scheduledFor || !accountId) return;
    setSubmitting(true);
    try {
      const r = await fetch("/api/scheduler/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform: platformSlug,
          accountId,
          text,
          imagePath: imagePath || undefined,
          scheduledFor: new Date(scheduledFor).toISOString(),
        }),
      }).then((r) => r.json());
      if (r.error) {
        alert(r.error);
      } else {
        setText("");
        setScheduledFor(defaultDateTime());
        clearImage();
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

  async function removeFromHistory(id: string) {
    if (
      !confirm(
        `Delete this post from history?\n\nThis only removes it from the app — anything already posted on ${platform.label} stays on ${platform.label}.`,
      )
    )
      return;
    await fetch(`/api/scheduler/posts/${id}`, { method: "DELETE" });
    loadPosts();
  }

  function reschedule(post: ScheduledPost) {
    setReschedulingPost(post);
  }

  async function regigAndRescheduleAll(historyPosts: ScheduledPost[]) {
    if (!accountId || historyPosts.length === 0 || bulkRunning) return;
    const startMs = new Date(bulkStartAt).getTime();
    if (Number.isNaN(startMs)) {
      setBulkError("Invalid start time");
      return;
    }
    const intervalMs = Math.max(1, bulkIntervalMin) * 60_000;
    // ±20% of the interval, capped at 10 minutes, so the queue looks organic
    // instead of mechanically spaced. Cap keeps jitter < half-interval so post
    // order is always preserved.
    const jitterRangeMs = Math.min(intervalMs * 0.2, 10 * 60_000);
    // Reschedule in original chronological order so the queue mirrors the
    // historical flow — oldest first at startAt, newest last.
    const queue = [...historyPosts].reverse();
    if (
      !confirm(
        `Re-gig and reschedule ${queue.length} post${queue.length === 1 ? "" : "s"} at ${bulkIntervalMin}-minute intervals starting ${new Date(startMs).toLocaleString()}?`,
      )
    )
      return;
    setBulkRunning(true);
    setBulkError(null);
    setBulkProgress({ done: 0, total: queue.length });
    try {
      for (let i = 0; i < queue.length; i++) {
        const post = queue[i];
        let newText = post.text;
        try {
          const rw = await fetch("/api/scheduler/rewrite", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: post.text, platform: post.platform }),
          }).then((r) => r.json());
          if (rw.ok && rw.text) newText = rw.text;
        } catch {
          // fall back to original text if the rewrite call fails
        }
        const jitter = (Math.random() * 2 - 1) * jitterRangeMs;
        // Snap to the nearest minute so the datetime in the UI doesn't show
        // odd-second timestamps that themselves look scripted.
        const rawMs = startMs + i * intervalMs + jitter;
        const snappedMs = Math.max(startMs, Math.round(rawMs / 60_000) * 60_000);
        const when = new Date(snappedMs).toISOString();
        const r = await fetch("/api/scheduler/posts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            platform: platformSlug,
            accountId: post.accountId ?? accountId,
            text: newText,
            imagePath: post.imagePath || undefined,
            scheduledFor: when,
          }),
        }).then((r) => r.json());
        if (r.error) {
          setBulkError(r.error);
          break;
        }
        setBulkProgress({ done: i + 1, total: queue.length });
      }
      await loadPosts();
    } finally {
      setBulkRunning(false);
    }
  }

  // Only show posts that belong to the current platform AND the active
  // account. A post created on the X panel must never bleed into Threads.
  const forAccount = accountId
    ? posts.filter((p) => p.platform === platformSlug && p.accountId === accountId)
    : [];
  const sorted = [...forAccount].sort((a, b) =>
    a.scheduledFor.localeCompare(b.scheduledFor),
  );
  const upcoming = sorted.filter((p) => p.status === "pending" || p.status === "posting");
  const history = sorted.filter((p) => p.status === "posted" || p.status === "failed").reverse();

  const maxChars = platform.maxChars;
  const overLimit = text.length > maxChars;
  const needsMedia = !!platform.requiresMedia && !imagePath;

  if (accounts.length === 0) {
    return (
      <div className="card flex flex-col items-center justify-center gap-2 py-10 text-center">
        <div className="text-sm text-zinc-300">
          No {platform.label} accounts connected yet.
        </div>
        <div className="text-xs text-zinc-500">
          Connect one to start scheduling posts.
        </div>
        <Link href={connectedPageUrl} className="btn-primary mt-2 text-sm">
          Connect an account
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <AccountTabs
        accounts={accounts}
        accountId={accountId}
        setAccountId={setAccountId}
        connectedPageUrl={connectedPageUrl}
      />

      <section className="card space-y-3">
        <div className="label">Schedule a post</div>

        <form onSubmit={schedule} className="space-y-3">
          <div>
            <div className="label">Post text</div>
            <textarea
              className="textarea h-28 resize-none"
              placeholder="What do you want to post?"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <div className={"mt-1 text-[10px] " + (overLimit ? "text-rose-400" : "text-zinc-500")}>
              {text.length} / {maxChars}
            </div>
          </div>

          <div>
            <div className="label">Image (optional)</div>
            {imagePreviewUrl ? (
              <div className="flex items-start gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imagePreviewUrl}
                  alt=""
                  className="max-h-32 rounded-md border border-line object-cover"
                />
                <button
                  type="button"
                  onClick={clearImage}
                  className="btn-ghost text-xs"
                >
                  Remove
                </button>
              </div>
            ) : (
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-line bg-ink px-3 py-2 text-xs text-zinc-300 hover:border-line2">
                {uploadingImage ? "Uploading…" : "Attach image"}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  disabled={uploadingImage}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void pickImage(file);
                    e.target.value = "";
                  }}
                />
              </label>
            )}
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

          {needsMedia && (
            <p className="text-[11px] text-amber-300/90">
              {platform.label} requires an image — attach one to schedule this post.
            </p>
          )}

          <button
            type="submit"
            disabled={
              submitting ||
              !text.trim() ||
              overLimit ||
              !scheduledFor ||
              !accountId ||
              needsMedia
            }
            className="btn-primary text-sm"
          >
            {submitting ? "Scheduling…" : "Schedule post"}
          </button>
        </form>
      </section>

      <section>
        <div className="label">Upcoming ({upcoming.length})</div>
        {upcoming.length === 0 ? (
          <div className="card text-sm text-zinc-500">Nothing queued.</div>
        ) : (
          <Timeline
            posts={upcoming}
            now={now}
            onCancel={cancel}
            onEdit={(p) => setEditingPost(p)}
          />
        )}
      </section>

      {history.length > 0 && (
        <section className="space-y-2">
          <div className="label">History</div>

          <div className="card-tight space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-medium text-zinc-200">
                  Re-gig &amp; reschedule all
                </div>
                <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">
                  Reword every history post (same meaning &amp; feel) and queue
                  them out at a fixed interval. Originals stay in History.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <div className="label">Start at</div>
                <input
                  type="datetime-local"
                  className="input text-sm"
                  value={bulkStartAt}
                  onChange={(e) => setBulkStartAt(e.target.value)}
                  min={nowDateTime()}
                  disabled={bulkRunning}
                />
              </div>
              <div>
                <div className="label">Interval (min)</div>
                <input
                  type="number"
                  min={1}
                  max={1440}
                  className="input text-sm w-24"
                  value={bulkIntervalMin}
                  onChange={(e) =>
                    setBulkIntervalMin(Math.max(1, Number(e.target.value) || 60))
                  }
                  disabled={bulkRunning}
                />
              </div>
              <button
                onClick={() => regigAndRescheduleAll(history)}
                disabled={bulkRunning || history.length === 0}
                className="btn-primary text-xs"
              >
                {bulkRunning
                  ? bulkProgress
                    ? `Working… ${bulkProgress.done}/${bulkProgress.total}`
                    : "Working…"
                  : `Re-gig & reschedule ${history.length}`}
              </button>
            </div>
            {bulkError && (
              <div className="text-[11px] text-rose-400">{bulkError}</div>
            )}
          </div>

          {history.slice(0, 20).map((p) => (
            <PostRow
              key={p.id}
              post={p}
              now={now}
              onCancel={() => cancel(p.id)}
              onReschedule={() => reschedule(p)}
              onRemove={() => removeFromHistory(p.id)}
            />
          ))}
        </section>
      )}

      {reschedulingPost && (
        <RescheduleModal
          post={reschedulingPost}
          accounts={accounts}
          aiProvider={aiProvider}
          onClose={() => setReschedulingPost(null)}
          onScheduled={() => {
            setReschedulingPost(null);
            loadPosts();
          }}
        />
      )}

      {editingPost && (
        <EditPostModal
          post={editingPost}
          accounts={accounts}
          onClose={() => setEditingPost(null)}
          onSaved={() => {
            setEditingPost(null);
            loadPosts();
          }}
        />
      )}
    </div>
  );
}

function PostRow({
  post,
  now,
  onCancel,
  onReschedule,
  onRemove,
}: {
  post: ScheduledPost;
  now: number;
  onCancel: () => void;
  onReschedule: () => void;
  onRemove?: () => void;
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
        <div className="flex items-center gap-3">
          {(post.status === "posted" || post.status === "failed") && (
            <button
              onClick={onReschedule}
              className="text-[11px] text-zinc-500 hover:text-accent"
            >
              Reschedule
            </button>
          )}
          {(post.status === "posted" || post.status === "failed") && onRemove && (
            <button
              onClick={onRemove}
              className="text-[11px] text-zinc-500 hover:text-rose-400"
            >
              Delete
            </button>
          )}
          {post.status === "pending" && (
            <button onClick={onCancel} className="text-[11px] text-zinc-500 hover:text-rose-400">
              Cancel
            </button>
          )}
        </div>
      </div>
      <div className="whitespace-pre-wrap break-words text-sm text-zinc-200">{post.text}</div>
      {post.postedUrl && /\/status\/\d+/.test(post.postedUrl) && (
        <a
          href={post.postedUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-block text-[11px] text-zinc-500 hover:text-zinc-300"
        >
          open on X ↗
        </a>
      )}
      {post.error && <PostError error={post.error} />}
    </div>
  );
}

// Failed-post errors (especially Playwright launch dumps) can run to thousands
// of characters. Show a short preview with a Read more / Show less toggle.
function PostError({ error }: { error: string }) {
  const [expanded, setExpanded] = useState(false);
  const LIMIT = 220;
  const isLong = error.length > LIMIT;
  const shown = expanded || !isLong ? error : error.slice(0, LIMIT).trimEnd() + "…";
  return (
    <div className="mt-2 rounded-md border border-rose-900/50 bg-rose-950/30 p-2 text-[11px] text-rose-300">
      <div
        className={
          "whitespace-pre-wrap break-words" +
          (expanded ? " max-h-48 overflow-y-auto" : "")
        }
      >
        {shown}
      </div>
      {isLong && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 font-medium text-rose-200 underline-offset-2 hover:underline"
        >
          {expanded ? "Show less" : "Read more"}
        </button>
      )}
    </div>
  );
}

// --- Timeline ---------------------------------------------------------------

function Timeline({
  posts,
  now,
  onCancel,
  onEdit,
}: {
  posts: ScheduledPost[];
  now: number;
  onCancel: (id: string) => void;
  onEdit: (post: ScheduledPost) => void;
}) {
  const groups: { label: string; items: ScheduledPost[] }[] = [];
  for (const p of posts) {
    const label = dayLabel(p.scheduledFor, now);
    const bucket = groups.find((g) => g.label === label);
    if (bucket) bucket.items.push(p);
    else groups.push({ label, items: [p] });
  }

  return (
    <div className="mt-3 space-y-7">
      {groups.map(({ label, items }) => (
        <div key={label} className="relative pl-7">
          <div className="absolute bottom-2 left-[7px] top-2 w-px bg-line2" />
          <div className="mb-3 -ml-7 inline-flex items-center gap-2 rounded-full border border-line bg-panel px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-zinc-400">
            <span className="h-1.5 w-1.5 rounded-full bg-zinc-500" />
            {label}
          </div>
          <div className="space-y-3">
            {items.map((p) => (
              <TimelineRow
                key={p.id}
                post={p}
                now={now}
                onCancel={() => onCancel(p.id)}
                onEdit={() => onEdit(p)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function TimelineRow({
  post,
  now,
  onCancel,
  onEdit,
}: {
  post: ScheduledPost;
  now: number;
  onCancel: () => void;
  onEdit: () => void;
}) {
  const time = new Date(post.scheduledFor).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
  const dueMs = new Date(post.scheduledFor).getTime() - now;
  const isPosting = post.status === "posting";
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
      <div className="card-tight">
        <div className="mb-1.5 flex items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2">
            <span className="font-semibold tabular-nums text-zinc-100">{time}</span>
            <span className={isPosting ? "text-amber-300" : "text-accent"}>
              {isPosting
                ? "Posting now…"
                : dueMs > 0
                  ? `in ${formatCountdown(dueMs)}`
                  : "any moment…"}
            </span>
          </div>
          {post.status === "pending" && (
            <div className="flex items-center gap-3">
              <button
                onClick={onEdit}
                className="text-[11px] text-zinc-500 hover:text-accent"
              >
                Edit
              </button>
              <button
                onClick={onCancel}
                className="text-[11px] text-zinc-500 hover:text-rose-400"
              >
                Cancel
              </button>
            </div>
          )}
          {post.status === "posting" && (
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

function EditPostModal({
  post,
  accounts,
  onClose,
  onSaved,
}: {
  post: ScheduledPost;
  accounts: SocialAccount[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [text, setText] = useState(post.text);
  const [accountId, setAccountId] = useState<string>(post.accountId ?? accounts[0]?.id ?? "");
  const [scheduledFor, setScheduledFor] = useState(() =>
    toDateTimeLocal(new Date(post.scheduledFor)),
  );
  const [imagePath, setImagePath] = useState<string | null>(post.imagePath ?? null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const maxChars = getPlatform(post.platform)?.maxChars ?? 4000;
  const overLimit = text.length > maxChars;

  async function pickImage(file: File) {
    setUploadingImage(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/scheduler/upload", { method: "POST", body: fd }).then((r) =>
        r.json(),
      );
      if (r.error) {
        alert(r.error);
        return;
      }
      setImagePath(r.filename);
      if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
      setImagePreviewUrl(URL.createObjectURL(file));
    } finally {
      setUploadingImage(false);
    }
  }

  function clearImage() {
    setImagePath(null);
    if (imagePreviewUrl) {
      URL.revokeObjectURL(imagePreviewUrl);
      setImagePreviewUrl(null);
    }
  }

  async function save() {
    if (!text.trim() || !accountId || !scheduledFor) return;
    setSaving(true);
    setError(null);
    try {
      const r = await fetch(`/api/scheduler/posts/${post.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          accountId,
          imagePath: imagePath ?? null,
          scheduledFor: new Date(scheduledFor).toISOString(),
        }),
      }).then((r) => r.json());
      if (r.error) {
        setError(r.error);
      } else {
        onSaved();
      }
    } finally {
      setSaving(false);
    }
  }

  // Preview source: local blob URL if user picked a new image, otherwise the
  // stored image served from the uploads route.
  const previewSrc =
    imagePreviewUrl ?? (imagePath ? `/api/scheduler/uploads/${imagePath}` : null);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-line bg-panel p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <div className="label !mb-0">Edit scheduled post</div>
            <p className="mt-1 text-xs text-zinc-500">
              Change the text, time, account, or image. Saves in place.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-full px-2 py-0.5 text-zinc-500 hover:bg-panel2 hover:text-zinc-200"
          >
            ✕
          </button>
        </div>

        <textarea
          className="textarea h-32 resize-none"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="mt-1 flex items-center justify-between text-[10px]">
          <span className={overLimit ? "text-rose-400" : "text-zinc-500"}>
            {text.length} / {maxChars}
          </span>
          {error && <span className="text-rose-400">{error}</span>}
        </div>

        <div className="mt-3">
          <div className="label">Image</div>
          {previewSrc ? (
            <div className="flex items-start gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={previewSrc}
                alt=""
                className="max-h-32 rounded-md border border-line object-cover"
              />
              <button type="button" onClick={clearImage} className="btn-ghost text-xs">
                Remove
              </button>
            </div>
          ) : (
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-line bg-ink px-3 py-2 text-xs text-zinc-300 hover:border-line2">
              {uploadingImage ? "Uploading…" : "Attach image"}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                disabled={uploadingImage}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void pickImage(file);
                  e.target.value = "";
                }}
              />
            </label>
          )}
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <div className="label">Account</div>
            <select
              className="rounded-md border border-line bg-ink px-2 py-2 text-sm w-full"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  @{a.handle}
                </option>
              ))}
            </select>
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
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <div className="ml-auto" />
          <button onClick={onClose} className="btn-ghost text-xs">
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving || !text.trim() || overLimit || !accountId || !scheduledFor}
            className="btn-primary text-xs"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AccountTabs({
  accounts,
  accountId,
  setAccountId,
  connectedPageUrl,
}: {
  accounts: SocialAccount[];
  accountId: string;
  setAccountId: (id: string) => void;
  connectedPageUrl: string;
}) {
  return (
    <div className="flex items-center gap-0 border-b border-line">
      {accounts.map((a) => {
        const active = a.id === accountId;
        return (
          <button
            key={a.id}
            onClick={() => setAccountId(a.id)}
            className={
              "relative -mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm transition " +
              (active
                ? "border-accent text-zinc-100"
                : "border-transparent text-zinc-500 hover:text-zinc-200")
            }
          >
            <span
              className={
                "h-5 w-5 flex items-center justify-center rounded-md text-[10px] font-bold " +
                (active
                  ? "bg-gradient-to-br from-accent to-live text-white"
                  : "bg-panel2 text-zinc-400")
              }
            >
              {a.handle[0]?.toUpperCase() ?? "?"}
            </span>
            @{a.handle}
          </button>
        );
      })}
      <Link
        href={connectedPageUrl}
        className="ml-auto px-3 py-2.5 text-xs text-zinc-500 hover:text-zinc-200"
      >
        + add account
      </Link>
    </div>
  );
}

function RescheduleModal({
  post,
  accounts,
  aiProvider,
  onClose,
  onScheduled,
}: {
  post: ScheduledPost;
  accounts: SocialAccount[];
  aiProvider: WatchSettings["aiProvider"];
  onClose: () => void;
  onScheduled: () => void;
}) {
  const [text, setText] = useState(post.text);
  const [accountId, setAccountId] = useState<string>(
    post.accountId && accounts.some((a) => a.id === post.accountId)
      ? post.accountId
      : accounts[0]?.id ?? "",
  );
  const [scheduledFor, setScheduledFor] = useState(defaultDateTime());
  const [rewriting, setRewriting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const maxChars = getPlatform(post.platform)?.maxChars ?? 4000;
  const overLimit = text.length > maxChars;
  const providerName = aiProvider === "openai" ? "OpenAI" : "Claude";

  async function rewrite() {
    setRewriting(true);
    setError(null);
    try {
      const r = await fetch("/api/scheduler/rewrite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, platform: post.platform }),
      }).then((r) => r.json());
      if (r.ok && r.text) {
        setText(r.text);
      } else {
        setError(r.error ?? "Rewrite failed");
      }
    } finally {
      setRewriting(false);
    }
  }

  async function submit() {
    if (!text.trim() || !accountId || !scheduledFor) return;
    setSubmitting(true);
    setError(null);
    try {
      const r = await fetch("/api/scheduler/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform: post.platform,
          accountId,
          text,
          scheduledFor: new Date(scheduledFor).toISOString(),
        }),
      }).then((r) => r.json());
      if (r.error) {
        setError(r.error);
      } else {
        onScheduled();
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-line bg-panel p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <div className="label !mb-0">Reschedule post</div>
            <p className="mt-1 text-xs text-zinc-500">
              Edit, or have {providerName} reword it slightly. Then pick a new time.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-full px-2 py-0.5 text-zinc-500 hover:bg-panel2 hover:text-zinc-200"
          >
            ✕
          </button>
        </div>

        <textarea
          className="textarea h-32 resize-none"
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={rewriting}
        />
        <div className="mt-1 flex items-center justify-between text-[10px]">
          <span className={overLimit ? "text-rose-400" : "text-zinc-500"}>
            {text.length} / {maxChars}
          </span>
          {error && <span className="text-rose-400">{error}</span>}
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
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
            <div className="label">When</div>
            <input
              type="datetime-local"
              className="input text-sm"
              value={scheduledFor}
              onChange={(e) => setScheduledFor(e.target.value)}
              min={nowDateTime()}
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            onClick={rewrite}
            disabled={rewriting || !text.trim()}
            className="btn-ghost text-xs"
          >
            {rewriting ? `Asking ${providerName}…` : `Re-gig with ${providerName}`}
          </button>
          <div className="ml-auto" />
          <button onClick={onClose} className="btn-ghost text-xs">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={submitting || !text.trim() || overLimit || !accountId || !scheduledFor}
            className="btn-primary text-xs"
          >
            {submitting ? "Scheduling…" : "Schedule"}
          </button>
        </div>

        <p className="mt-2 text-[10px] leading-relaxed text-zinc-500">
          Re-gig keeps the meaning but varies the wording. The original post stays in History
          unchanged — this creates a new pending post.
        </p>
      </div>
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
