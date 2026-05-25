"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { SocialAccount } from "@/lib/types";
import { PLATFORMS, PlatformMeta, PlatformSlug } from "@/lib/platforms";
import { PlatformIcon } from "@/components/PlatformIcon";

interface PlatformBucket {
  meta: PlatformMeta;
  accounts: SocialAccount[];
  defaultAccountId: string | null;
}

// Fetch per-platform connect status in parallel. Used by the cross-post
// composer to decide which platforms the user can target.
async function loadAllBuckets(): Promise<PlatformBucket[]> {
  const results = await Promise.all(
    PLATFORMS.filter((p) => p.status === "live").map(async (meta) => {
      const r = await fetch(`/api/connect/${meta.slug}`).then((r) => r.json());
      const accounts: SocialAccount[] = r.accounts ?? [];
      return {
        meta,
        accounts,
        defaultAccountId: accounts[0]?.id ?? null,
      };
    }),
  );
  return results;
}

export function CrossPostPanel() {
  const [buckets, setBuckets] = useState<PlatformBucket[] | null>(null);
  const [enabled, setEnabled] = useState<Record<PlatformSlug, boolean>>(
    {} as Record<PlatformSlug, boolean>,
  );
  const [text, setText] = useState("");
  const [scheduledFor, setScheduledFor] = useState(defaultDateTime());
  const [submitting, setSubmitting] = useState(false);
  const [imagePath, setImagePath] = useState<string | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitResult, setSubmitResult] = useState<
    | null
    | {
        scheduled: PlatformSlug[];
        failed: { slug: PlatformSlug; error: string }[];
      }
  >(null);

  const refresh = useCallback(async () => {
    const b = await loadAllBuckets();
    setBuckets(b);
    // First load: enable every platform that has at least one account.
    setEnabled((prev) => {
      if (Object.keys(prev).length > 0) return prev;
      const next = {} as Record<PlatformSlug, boolean>;
      for (const bucket of b) {
        next[bucket.meta.slug] = bucket.accounts.length > 0;
      }
      return next;
    });
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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

  if (!buckets) {
    return <div className="card text-sm text-zinc-500">Loading…</div>;
  }

  const enabledBuckets = buckets.filter((b) => enabled[b.meta.slug]);
  // Tightest character limit across the enabled platforms — that's what the
  // composer counter shows so the user knows the worst-case budget.
  const tightestLimit = enabledBuckets.length
    ? Math.min(...enabledBuckets.map((b) => b.meta.maxChars))
    : Math.max(...buckets.map((b) => b.meta.maxChars));
  const overTight = text.length > tightestLimit;

  // Per-platform validation. A platform is "blocked" (can't be targeted) if it
  // has no account, requires media without one attached, or the text is over
  // its specific limit. Surface these inline next to each toggle.
  const platformIssues = new Map<PlatformSlug, string>();
  for (const b of buckets) {
    if (b.accounts.length === 0) {
      platformIssues.set(b.meta.slug, "no account connected");
      continue;
    }
    if (b.meta.requiresMedia && !imagePath) {
      platformIssues.set(b.meta.slug, "needs image");
      continue;
    }
    if (text.length > b.meta.maxChars) {
      platformIssues.set(
        b.meta.slug,
        `text exceeds ${b.meta.maxChars}-char limit`,
      );
    }
  }

  const targetable = enabledBuckets.filter(
    (b) => !platformIssues.has(b.meta.slug),
  );
  const canSubmit =
    !submitting &&
    text.trim().length > 0 &&
    !!scheduledFor &&
    targetable.length > 0;

  async function schedule(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    setSubmitResult(null);
    const scheduled: PlatformSlug[] = [];
    const failed: { slug: PlatformSlug; error: string }[] = [];
    try {
      for (const bucket of targetable) {
        if (!bucket.defaultAccountId) continue;
        const r = await fetch("/api/scheduler/posts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            platform: bucket.meta.slug,
            accountId: bucket.defaultAccountId,
            text,
            imagePath: imagePath || undefined,
            scheduledFor: new Date(scheduledFor).toISOString(),
          }),
        }).then((r) => r.json());
        if (r.error) {
          failed.push({ slug: bucket.meta.slug, error: r.error });
        } else {
          scheduled.push(bucket.meta.slug);
        }
      }
      setSubmitResult({ scheduled, failed });
      if (failed.length === 0) {
        setText("");
        setScheduledFor(defaultDateTime());
        clearImage();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-5">
      <section className="card space-y-3">
        <div className="label">Compose once · post everywhere</div>

        <form onSubmit={schedule} className="space-y-3">
          <div>
            <div className="label">Post text</div>
            <textarea
              className="textarea h-32 resize-none"
              placeholder="What do you want to post?"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <div
              className={
                "mt-1 text-[10px] " +
                (overTight ? "text-rose-400" : "text-zinc-500")
              }
            >
              {text.length} / {tightestLimit}
              {enabledBuckets.length > 0 && (
                <span className="ml-1 text-zinc-600">
                  (tightest of enabled platforms)
                </span>
              )}
            </div>
          </div>

          <div>
            <div className="label">Image (optional · required for Instagram)</div>
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

          <div>
            <div className="label">Send to</div>
            <div className="space-y-1.5">
              {buckets.map((b) => {
                const isEnabled = !!enabled[b.meta.slug];
                const issue = platformIssues.get(b.meta.slug);
                const hasAccount = b.accounts.length > 0;
                const wouldSend = isEnabled && !issue;
                return (
                  <label
                    key={b.meta.slug}
                    className={
                      "flex items-center gap-3 rounded-md border px-3 py-2 text-xs transition " +
                      (wouldSend
                        ? "border-accent/40 bg-accent/5 text-zinc-100"
                        : isEnabled
                          ? "border-amber-500/40 bg-amber-500/5 text-amber-200"
                          : "border-line bg-panel2/40 text-zinc-500") +
                      (hasAccount ? " cursor-pointer hover:border-line2" : " cursor-not-allowed opacity-60")
                    }
                  >
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 accent-accent"
                      checked={isEnabled}
                      disabled={!hasAccount}
                      onChange={(e) =>
                        setEnabled((p) => ({
                          ...p,
                          [b.meta.slug]: e.target.checked,
                        }))
                      }
                    />
                    <PlatformIcon slug={b.meta.slug} className="h-4 w-4 shrink-0" />
                    <span className="font-medium">{b.meta.label}</span>
                    {hasAccount ? (
                      <span className="text-zinc-500">
                        @{b.accounts[0].handle}
                      </span>
                    ) : (
                      <Link
                        href={`/connected/${b.meta.slug}`}
                        className="text-zinc-500 underline-offset-2 hover:text-zinc-200 hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        connect →
                      </Link>
                    )}
                    <span className="ml-auto text-[10px] text-zinc-500">
                      {issue ?? `${b.meta.maxChars} chars`}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          {error && (
            <div className="text-[11px] text-rose-400">{error}</div>
          )}

          {submitResult && (
            <div className="space-y-1 text-[11px]">
              {submitResult.scheduled.length > 0 && (
                <div className="text-emerald-300">
                  Scheduled on {submitResult.scheduled.length} platform
                  {submitResult.scheduled.length === 1 ? "" : "s"}:{" "}
                  {submitResult.scheduled
                    .map((s) => labelFor(s, buckets))
                    .join(", ")}
                </div>
              )}
              {submitResult.failed.length > 0 && (
                <div className="text-rose-300">
                  Failed:{" "}
                  {submitResult.failed
                    .map((f) => `${labelFor(f.slug, buckets)} (${f.error})`)
                    .join("; ")}
                </div>
              )}
            </div>
          )}

          <button
            type="submit"
            disabled={!canSubmit}
            className="btn-primary text-sm"
          >
            {submitting
              ? "Scheduling…"
              : targetable.length === 0
                ? "Nothing to send"
                : `Schedule on ${targetable.length} platform${targetable.length === 1 ? "" : "s"}`}
          </button>
        </form>
      </section>

      <div className="card text-xs leading-relaxed text-zinc-500">
        <strong className="text-zinc-300">How cross-posting works.</strong>{" "}
        One post per enabled platform is queued at the same time, each using
        that platform&apos;s default connected account. To pick a different
        account or tweak per-platform timing, schedule from the platform&apos;s
        own Scheduler page instead.
      </div>
    </div>
  );
}

function labelFor(slug: PlatformSlug, buckets: PlatformBucket[]): string {
  return buckets.find((b) => b.meta.slug === slug)?.meta.label ?? slug;
}

function toDateTimeLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function defaultDateTime(): string {
  const d = new Date(Date.now() + 60 * 1000);
  d.setSeconds(0, 0);
  return toDateTimeLocal(d);
}

function nowDateTime(): string {
  const d = new Date();
  d.setSeconds(0, 0);
  return toDateTimeLocal(d);
}
