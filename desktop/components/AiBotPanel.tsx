"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { PLATFORMS, PlatformSlug, getPlatform } from "@/lib/platforms";
import { PlatformIcon } from "@/components/PlatformIcon";
import {
  AiBotConfig,
  AiBotDraft,
  AiBotEvent,
  AiBotRun,
  SocialAccount,
} from "@/lib/types";

// v1 is X-only because the Watch monitor's live scraping is only running for
// twitter today. The agent can technically run on any platform, but without
// watched-post context it has nothing to ground its proposals in.
const SUPPORTED_PLATFORMS: PlatformSlug[] = ["twitter"];

interface AccountsByPlatform {
  platform: PlatformSlug;
  accounts: SocialAccount[];
}

export function AiBotPanel() {
  const [byPlatform, setByPlatform] = useState<AccountsByPlatform[]>([]);
  const [config, setConfig] = useState<AiBotConfig>({ accounts: {} });
  const [loading, setLoading] = useState(true);
  const [activeRunSpec, setActiveRunSpec] = useState<{
    platform: PlatformSlug;
    accountId: string;
    websiteUrls?: string[];
  } | null>(null);
  const [reopenedRunId, setReopenedRunId] = useState<string | null>(null);
  const [runs, setRuns] = useState<AiBotRun[]>([]);

  const loadAccounts = useCallback(async () => {
    const results = await Promise.all(
      SUPPORTED_PLATFORMS.map(async (slug) => {
        try {
          const r = (await fetch(`/api/connect/${slug}`).then((r) => r.json())) as {
            accounts?: SocialAccount[];
          };
          return { platform: slug, accounts: r.accounts ?? [] };
        } catch {
          return { platform: slug, accounts: [] };
        }
      }),
    );
    setByPlatform(results);
    setLoading(false);
  }, []);

  const loadRuns = useCallback(async () => {
    try {
      const r = (await fetch("/api/ai-bot/runs").then((r) => r.json())) as {
        runs?: AiBotRun[];
      };
      setRuns(r.runs ?? []);
    } catch {
      // non-fatal
    }
  }, []);

  const loadConfig = useCallback(async () => {
    try {
      const r = (await fetch("/api/ai-bot/config").then((r) => r.json())) as {
        config?: AiBotConfig;
      };
      if (r.config) setConfig(r.config);
    } catch {
      // non-fatal
    }
  }, []);

  useEffect(() => {
    loadAccounts();
    loadRuns();
    loadConfig();
  }, [loadAccounts, loadRuns, loadConfig]);

  function configKey(platform: PlatformSlug, accountId: string) {
    return `${platform}:${accountId}`;
  }

  async function saveAccountUrls(
    platform: PlatformSlug,
    accountId: string,
    websiteUrls: string[],
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      const r = await fetch("/api/ai-bot/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform, accountId, websiteUrls }),
      });
      const json = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok)
        return { ok: false, error: json.error ?? `Save failed (${r.status})` };
      // Reflect the change locally so the card re-renders without a roundtrip.
      setConfig((curr) => {
        const next: AiBotConfig = {
          accounts: {
            ...curr.accounts,
            [configKey(platform, accountId)]: {
              ...curr.accounts[configKey(platform, accountId)],
              websiteUrls: websiteUrls.length > 0 ? websiteUrls : undefined,
            },
          },
        };
        return next;
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  const totalAccounts = byPlatform.reduce((n, p) => n + p.accounts.length, 0);

  if (loading) {
    return <div className="card text-sm text-zinc-500">Loading accounts…</div>;
  }

  return (
    <div className="space-y-6">
      {totalAccounts === 0 ? (
        <div className="card text-sm text-zinc-400">
          No supported accounts connected yet. Connect an X account on the{" "}
          <Link href="/connected/twitter" className="text-accent hover:underline">
            Connected
          </Link>{" "}
          page to get started.
        </div>
      ) : (
        <section className="space-y-3">
          <div className="label">Pick an account</div>
          <div className="grid gap-3 sm:grid-cols-2">
            {byPlatform.flatMap((group) =>
              group.accounts.map((a) => {
                const cfg =
                  config.accounts[configKey(group.platform, a.id)] ?? {};
                return (
                  <AccountCard
                    key={`${group.platform}:${a.id}`}
                    account={a}
                    savedUrls={cfg.websiteUrls ?? []}
                    disabled={activeRunSpec !== null || reopenedRunId !== null}
                    onSaveUrls={(urls) =>
                      saveAccountUrls(group.platform, a.id, urls)
                    }
                    onRun={(urls) => {
                      setReopenedRunId(null);
                      setActiveRunSpec({
                        platform: group.platform,
                        accountId: a.id,
                        websiteUrls: urls,
                      });
                    }}
                  />
                );
              }),
            )}
          </div>
        </section>
      )}

      {activeRunSpec && (
        <RunStream
          platform={activeRunSpec.platform}
          accountId={activeRunSpec.accountId}
          websiteUrls={activeRunSpec.websiteUrls}
          onClose={() => {
            setActiveRunSpec(null);
            loadRuns();
          }}
        />
      )}

      {reopenedRunId && (
        <ReopenedRun
          runId={reopenedRunId}
          onClose={() => {
            setReopenedRunId(null);
            loadRuns();
          }}
        />
      )}

      {runs.length > 0 && (
        <section className="space-y-2">
          <div className="label">Past runs</div>
          <div className="space-y-2">
            {runs.slice(0, 10).map((r) => (
              <PastRunRow
                key={r.id}
                run={r}
                onOpen={() => {
                  setActiveRunSpec(null);
                  setReopenedRunId(r.id);
                }}
              />
            ))}
          </div>
        </section>
      )}

      <section className="card-tight space-y-2 text-[11px] leading-relaxed text-zinc-500">
        <div className="font-medium text-zinc-300">How it works</div>
        <div>
          Each run reads the account&apos;s monitored posts, queue, and history,
          then drafts 3–8 candidate posts. Drafts stay here — nothing enters
          your scheduler queue until you tap{" "}
          <span className="text-zinc-300">Schedule</span> on the draft.
        </div>
      </section>
    </div>
  );
}

const MAX_KNOWLEDGE_URLS = 5;

function AccountCard({
  account,
  savedUrls,
  disabled,
  onSaveUrls,
  onRun,
}: {
  account: SocialAccount;
  savedUrls: string[];
  disabled: boolean;
  onSaveUrls: (urls: string[]) => Promise<{ ok: boolean; error?: string }>;
  onRun: (urls?: string[]) => void;
}) {
  const platform = getPlatform(account.platform);
  const [editing, setEditing] = useState(false);
  // Editor state is a list of raw strings — we add an empty slot when the user
  // wants to type a new URL, and drop empties on save.
  const [drafts, setDrafts] = useState<string[]>(
    savedUrls.length > 0 ? [...savedUrls] : [""],
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // When the saved list changes from outside (config reload, another card
  // saved), mirror it into the editor as long as the user isn't actively
  // editing this card.
  useEffect(() => {
    if (!editing) {
      setDrafts(savedUrls.length > 0 ? [...savedUrls] : [""]);
    }
  }, [savedUrls, editing]);

  function setAt(idx: number, value: string) {
    setDrafts((curr) => curr.map((u, i) => (i === idx ? value : u)));
  }

  function removeAt(idx: number) {
    setDrafts((curr) => {
      const next = curr.filter((_, i) => i !== idx);
      return next.length === 0 ? [""] : next;
    });
  }

  function addRow() {
    setDrafts((curr) => (curr.length >= MAX_KNOWLEDGE_URLS ? curr : [...curr, ""]));
  }

  async function save() {
    setSaving(true);
    setSaveError(null);
    const cleaned = drafts.map((u) => u.trim()).filter(Boolean);
    const r = await onSaveUrls(cleaned);
    setSaving(false);
    if (!r.ok) {
      setSaveError(r.error ?? "Save failed");
      return;
    }
    setEditing(false);
  }

  function cancelEdit() {
    setDrafts(savedUrls.length > 0 ? [...savedUrls] : [""]);
    setSaveError(null);
    setEditing(false);
  }

  return (
    <div className="card-tight space-y-2">
      <div className="flex items-center gap-3">
        <PlatformIcon
          slug={account.platform}
          className="h-5 w-5 shrink-0 text-zinc-400"
        />
        <div className="flex-1 min-w-0">
          <div className="truncate text-sm font-medium text-zinc-100">
            @{account.handle}
          </div>
          <div className="text-[11px] text-zinc-500">
            {platform?.label ?? account.platform}
          </div>
        </div>
        <button
          onClick={() => onRun(savedUrls)}
          disabled={disabled}
          className="btn-primary text-xs disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Plan a growth run
        </button>
      </div>

      {!editing ? (
        <div className="space-y-1 text-[11px]">
          {savedUrls.length > 0 ? (
            <>
              <div className="flex items-center justify-between gap-2">
                <span className="text-zinc-500">
                  Knowledge sources ({savedUrls.length})
                </span>
                <button
                  onClick={() => setEditing(true)}
                  className="text-zinc-500 hover:text-zinc-200"
                >
                  Edit
                </button>
              </div>
              <ul className="space-y-0.5">
                {savedUrls.map((u) => (
                  <li
                    key={u}
                    className="truncate text-zinc-300"
                    title={u}
                  >
                    · {prettyUrl(u)}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <button
              onClick={() => setEditing(true)}
              className="text-zinc-500 hover:text-accent"
            >
              + Add knowledge URLs (the agent scrapes them for context)
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-1.5">
          <div className="text-[11px] text-zinc-500">
            Knowledge URLs — up to {MAX_KNOWLEDGE_URLS}. Try homepage,
            /features, /pricing, /about.
          </div>
          {drafts.map((url, idx) => (
            <div key={idx} className="flex items-center gap-1.5">
              <input
                type="url"
                value={url}
                onChange={(e) => setAt(idx, e.target.value)}
                placeholder="https://yoursite.com"
                className="input text-sm flex-1"
                autoFocus={idx === drafts.length - 1 && url === ""}
                onKeyDown={(e) => {
                  if (e.key === "Enter") save();
                  if (e.key === "Escape") cancelEdit();
                }}
              />
              <button
                onClick={() => removeAt(idx)}
                disabled={saving}
                className="text-zinc-500 hover:text-rose-400 disabled:opacity-40 px-1"
                aria-label="Remove URL"
                title="Remove"
              >
                ×
              </button>
            </div>
          ))}
          <div className="flex items-center gap-2 text-[11px]">
            <button
              onClick={save}
              disabled={saving}
              className="btn-primary text-[11px] disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              onClick={cancelEdit}
              disabled={saving}
              className="text-zinc-500 hover:text-zinc-200"
            >
              Cancel
            </button>
            {drafts.length < MAX_KNOWLEDGE_URLS && (
              <button
                onClick={addRow}
                disabled={saving}
                className="ml-auto text-zinc-500 hover:text-accent disabled:opacity-40"
              >
                + Add URL
              </button>
            )}
            {saveError && (
              <span className="text-rose-400 ml-auto">{saveError}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function prettyUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.host + (u.pathname === "/" ? "" : u.pathname);
  } catch {
    return url;
  }
}

// --- Streaming run viewer ----------------------------------------------------

function RunStream({
  platform,
  accountId,
  websiteUrls,
  onClose,
}: {
  platform: PlatformSlug;
  accountId: string;
  websiteUrls?: string[];
  onClose: () => void;
}) {
  const [events, setEvents] = useState<AiBotEvent[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    abortRef.current = ac;
    (async () => {
      try {
        const res = await fetch("/api/ai-bot/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ platform, accountId, websiteUrls }),
          signal: ac.signal,
        });
        if (!res.ok || !res.body) {
          const body = await res.text().catch(() => "");
          setError(body || `Request failed (${res.status})`);
          setDone(true);
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { done: streamDone, value } = await reader.read();
          if (streamDone) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n\n");
          buffer = parts.pop() ?? "";
          for (const part of parts) {
            const line = part.trim();
            if (!line.startsWith("data:")) continue;
            const payload = line.slice("data:".length).trim();
            try {
              const ev = JSON.parse(payload) as AiBotEvent;
              setEvents((prev) => [...prev, ev]);
              if (ev.kind === "final" || ev.kind === "error") {
                setDone(true);
              }
            } catch {
              // ignore malformed frame
            }
          }
        }
        setDone(true);
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setError((err as Error).message);
        setDone(true);
      }
    })();
    return () => {
      ac.abort();
    };
  }, [platform, accountId, websiteUrls]);

  // Once the stream completes, fetch the persisted run so we have the canonical
  // draft list (including any post-run edits and the rationale field, which
  // doesn't fit cleanly in the SSE event stream).
  useEffect(() => {
    if (!done) return;
    (async () => {
      // The run id isn't sent in the SSE stream yet — fetch the latest run for
      // this account/platform from the runs list. Most-recent-first, so [0]
      // is the one we just started (assuming nothing else is running).
      try {
        const r = (await fetch("/api/ai-bot/runs").then((r) => r.json())) as {
          runs?: AiBotRun[];
        };
        const latest = r.runs?.find(
          (run) => run.platform === platform && run.accountId === accountId,
        );
        if (latest) setRunId(latest.id);
      } catch {
        // non-fatal — the stream view still works without the run id
      }
    })();
  }, [done, platform, accountId]);

  const finalEvent = events.find((e) => e.kind === "final");
  const errorEvent = events.find((e) => e.kind === "error");

  return (
    <div className="card space-y-4 border-accent/40">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-medium uppercase tracking-[0.15em] text-accent">
            {done ? (errorEvent ? "Run failed" : "Run complete") : "Running…"}
          </div>
          <div className="mt-1 text-sm text-zinc-100">
            @{accountId} on {getPlatform(platform)?.label ?? platform}
          </div>
          {websiteUrls && websiteUrls.length > 0 && (
            <div className="mt-0.5 text-[11px] text-zinc-500">
              Knowledge ({websiteUrls.length}):{" "}
              <span className="text-zinc-400">
                {websiteUrls.map(prettyUrl).join(", ")}
              </span>
            </div>
          )}
        </div>
        <button onClick={onClose} className="btn-ghost text-xs">
          {done ? "Close" : "Run in background"}
        </button>
      </div>

      <EventLog events={events} />

      {done && runId && !errorEvent && (
        <DraftsReviewer
          runId={runId}
          platform={platform}
          accountId={accountId}
        />
      )}

      {finalEvent?.text && (
        <div className="rounded-md border border-accent/40 bg-accent/5 p-3 text-sm text-zinc-200">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-accent">
            Strategy summary
          </div>
          {finalEvent.text}
        </div>
      )}

      {(errorEvent?.text || error) && (
        <div className="rounded-md border border-rose-900/60 bg-rose-950/30 p-3 text-sm text-rose-300">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-rose-400">
            Failed
          </div>
          {errorEvent?.text ?? error}
        </div>
      )}
    </div>
  );
}

// Reopen a past run from the history list — same drafts UI, no streaming.
function ReopenedRun({
  runId,
  onClose,
}: {
  runId: string;
  onClose: () => void;
}) {
  const [run, setRun] = useState<AiBotRun | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = (await fetch(`/api/ai-bot/runs/${runId}`).then((r) => r.json())) as {
          run?: AiBotRun;
          error?: string;
        };
        if (r.error || !r.run) {
          setError(r.error ?? "Run not found");
          return;
        }
        setRun(r.run);
      } catch (err) {
        setError((err as Error).message);
      }
    })();
  }, [runId]);

  if (error) {
    return (
      <div className="card text-sm text-rose-300">
        {error}{" "}
        <button onClick={onClose} className="ml-2 text-zinc-500 hover:text-zinc-200">
          Close
        </button>
      </div>
    );
  }
  if (!run) {
    return <div className="card text-sm text-zinc-500">Loading run…</div>;
  }

  const finalEvent = run.events.find((e) => e.kind === "final");

  return (
    <div className="card space-y-4 border-accent/40">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-medium uppercase tracking-[0.15em] text-accent">
            Reopened run
          </div>
          <div className="mt-1 text-sm text-zinc-100">
            @{run.accountId} on {getPlatform(run.platform)?.label ?? run.platform}
          </div>
          <div className="text-[11px] text-zinc-500">
            {new Date(run.startedAt).toLocaleString()}
          </div>
        </div>
        <button onClick={onClose} className="btn-ghost text-xs">
          Close
        </button>
      </div>

      <DraftsReviewer
        runId={run.id}
        platform={run.platform}
        accountId={run.accountId}
        initialRun={run}
      />

      {finalEvent?.text && (
        <div className="rounded-md border border-accent/40 bg-accent/5 p-3 text-sm text-zinc-200">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-accent">
            Strategy summary
          </div>
          {finalEvent.text}
        </div>
      )}
    </div>
  );
}

// --- Drafts reviewer ---------------------------------------------------------

function DraftsReviewer({
  runId,
  platform,
  accountId,
  initialRun,
}: {
  runId: string;
  platform: PlatformSlug;
  accountId: string;
  initialRun?: AiBotRun;
}) {
  const [run, setRun] = useState<AiBotRun | null>(initialRun ?? null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = (await fetch(`/api/ai-bot/runs/${runId}`).then((r) => r.json())) as {
        run?: AiBotRun;
      };
      if (r.run) setRun(r.run);
    } catch {
      // non-fatal
    }
  }, [runId]);

  useEffect(() => {
    if (!initialRun) refresh();
  }, [initialRun, refresh]);

  // Auto-select every pending draft by default — the user came here to act on
  // them, so the common case is "schedule the lot." They can untick what they
  // don't want before hitting Schedule selected.
  useEffect(() => {
    if (!run) return;
    setSelected((curr) => {
      if (curr.size > 0) return curr;
      const next = new Set<string>();
      for (const d of run.drafts) if (d.status === "pending") next.add(d.id);
      return next;
    });
  }, [run]);

  if (!run) return null;

  const pending = run.drafts.filter((d) => d.status === "pending");
  const scheduled = run.drafts.filter((d) => d.status === "scheduled");
  const discarded = run.drafts.filter((d) => d.status === "discarded");

  function toggle(id: string) {
    setSelected((curr) => {
      const next = new Set(curr);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function act(action: "schedule" | "discard", draftIds: string[]) {
    if (draftIds.length === 0 || busy) return;
    setBusy(true);
    try {
      await fetch(`/api/ai-bot/runs/${runId}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftIds }),
      });
      await refresh();
      setSelected(new Set());
    } finally {
      setBusy(false);
    }
  }

  if (run.drafts.length === 0) {
    return (
      <div className="card-tight text-sm text-zinc-500">
        The agent didn&apos;t produce any drafts this run.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="label !mb-0">
            Drafts ({pending.length} to review
            {scheduled.length > 0 ? `, ${scheduled.length} scheduled` : ""}
            {discarded.length > 0 ? `, ${discarded.length} discarded` : ""})
          </div>
          <p className="mt-1 text-[11px] text-zinc-500">
            Drafts stay here. Nothing posts until you schedule it.
          </p>
        </div>
        {pending.length > 0 && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => act("schedule", Array.from(selected))}
              disabled={busy || selected.size === 0}
              className="btn-primary text-xs disabled:opacity-40"
            >
              Schedule selected ({selected.size})
            </button>
            <button
              onClick={() => act("discard", Array.from(selected))}
              disabled={busy || selected.size === 0}
              className="btn-ghost text-xs text-rose-400 hover:text-rose-300 disabled:opacity-40"
            >
              Discard selected
            </button>
          </div>
        )}
      </div>

      <div className="space-y-2">
        {run.drafts.map((d) => (
          <DraftCard
            key={d.id}
            draft={d}
            selected={selected.has(d.id)}
            onToggle={() => toggle(d.id)}
            onScheduleOne={() => act("schedule", [d.id])}
            onDiscardOne={() => act("discard", [d.id])}
            busy={busy}
          />
        ))}
      </div>

      {scheduled.length > 0 && (
        <div className="text-[11px] text-zinc-500">
          Scheduled drafts now appear on the{" "}
          <Link
            href={`/scheduler/${platform}`}
            className="text-accent hover:underline"
          >
            @{accountId} scheduler
          </Link>{" "}
          and{" "}
          <Link href="/scheduler/queue" className="text-accent hover:underline">
            Queue
          </Link>{" "}
          with an &ldquo;AI proposed&rdquo; badge.
        </div>
      )}
    </div>
  );
}

function DraftCard({
  draft,
  selected,
  onToggle,
  onScheduleOne,
  onDiscardOne,
  busy,
}: {
  draft: AiBotDraft;
  selected: boolean;
  onToggle: () => void;
  onScheduleOne: () => void;
  onDiscardOne: () => void;
  busy: boolean;
}) {
  const when = new Date(draft.scheduledFor);
  const isPending = draft.status === "pending";

  return (
    <div
      className={
        "rounded-lg border p-3 transition " +
        (isPending
          ? selected
            ? "border-accent/60 bg-accent/5"
            : "border-line bg-panel2/30 hover:border-line2"
          : draft.status === "scheduled"
            ? "border-emerald-900/40 bg-emerald-950/20"
            : "border-line bg-ink/40 opacity-60")
      }
    >
      <div className="flex items-start gap-3">
        {isPending ? (
          <button
            onClick={onToggle}
            className={
              "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition " +
              (selected
                ? "border-accent bg-accent text-ink"
                : "border-line bg-ink hover:border-line2")
            }
            aria-pressed={selected}
            aria-label={selected ? "Unselect draft" : "Select draft"}
          >
            {selected && (
              <svg
                viewBox="0 0 20 20"
                fill="none"
                className="h-3 w-3"
                aria-hidden
              >
                <path
                  d="M5 10l3 3 7-7"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </button>
        ) : (
          <div className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
            {draft.status === "scheduled" ? (
              <span
                className="h-2 w-2 rounded-full bg-emerald-400"
                title="Scheduled"
              />
            ) : (
              <span className="h-2 w-2 rounded-full bg-zinc-700" title="Discarded" />
            )}
          </div>
        )}

        <div className="flex-1 min-w-0">
          <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
            <span className="font-medium text-zinc-300">
              {when.toLocaleString(undefined, {
                weekday: "short",
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
            <DraftStatusBadge status={draft.status} />
          </div>
          <div className="whitespace-pre-wrap break-words text-sm text-zinc-100">
            {draft.text}
          </div>
          {draft.rationale && (
            <div className="mt-2 rounded-md border border-line/60 bg-ink/40 px-2 py-1.5 text-[11px] italic leading-relaxed text-zinc-400">
              Why: {draft.rationale}
            </div>
          )}
        </div>

        {isPending && (
          <div className="flex flex-col items-end gap-1.5 text-[11px]">
            <button
              onClick={onScheduleOne}
              disabled={busy}
              className="rounded-md border border-accent/60 bg-accent/15 px-2 py-1 text-accent hover:bg-accent/25 disabled:opacity-40"
            >
              Schedule
            </button>
            <button
              onClick={onDiscardOne}
              disabled={busy}
              className="text-zinc-500 hover:text-rose-400 disabled:opacity-40"
            >
              Discard
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function DraftStatusBadge({ status }: { status: AiBotDraft["status"] }) {
  if (status === "pending") {
    return (
      <span className="rounded-full border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-accent">
        Draft
      </span>
    );
  }
  if (status === "scheduled") {
    return (
      <span className="rounded-full border border-emerald-700/60 bg-emerald-950/40 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-emerald-400">
        Scheduled
      </span>
    );
  }
  return (
    <span className="rounded-full border border-line bg-panel2 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-zinc-500">
      Discarded
    </span>
  );
}

// --- Event log ---------------------------------------------------------------

function EventLog({ events }: { events: AiBotEvent[] }) {
  // Chronological tool-call trail. Skip draft/final/error — those have their
  // own UI sections. Cap at the last 30 lines so the panel stays readable.
  const trail = events
    .filter(
      (e) =>
        e.kind !== "draft" &&
        e.kind !== "final" &&
        e.kind !== "error",
    )
    .slice(-30);
  if (trail.length === 0) return null;
  return (
    <div className="space-y-1 rounded-md border border-line bg-ink/60 p-3 font-mono text-[11px] leading-relaxed text-zinc-400">
      {trail.map((e) => (
        <EventLine key={e.seq} event={e} />
      ))}
    </div>
  );
}

function EventLine({ event }: { event: AiBotEvent }) {
  if (event.kind === "thinking") {
    return <div className="text-zinc-500">{event.text}</div>;
  }
  if (event.kind === "tool_call") {
    return (
      <div>
        <span className="text-accent">→ {event.toolName}</span>
        {event.toolInput ? (
          <span className="text-zinc-600">
            {" "}
            {previewInput(event.toolInput)}
          </span>
        ) : null}
      </div>
    );
  }
  if (event.kind === "tool_result") {
    return (
      <div className="text-zinc-600">
        ← {event.toolName}{" "}
        <span className="text-zinc-700">{event.toolResultPreview}</span>
      </div>
    );
  }
  return null;
}

function previewInput(input: unknown): string {
  try {
    const s = JSON.stringify(input);
    return s.length > 120 ? s.slice(0, 117) + "…" : s;
  } catch {
    return "";
  }
}

// --- Past runs ---------------------------------------------------------------

function PastRunRow({ run, onOpen }: { run: AiBotRun; onOpen: () => void }) {
  const total = run.drafts.length;
  const scheduled = run.drafts.filter((d) => d.status === "scheduled").length;
  const pendingCount = run.drafts.filter((d) => d.status === "pending").length;
  const when = new Date(run.startedAt).toLocaleString();
  return (
    <button
      onClick={onOpen}
      className="w-full card-tight flex items-center justify-between gap-2 text-xs text-left hover:border-line2 hover:bg-panel2/60"
    >
      <div className="flex items-center gap-2">
        <PlatformIcon slug={run.platform} className="h-3.5 w-3.5 text-zinc-400" />
        <span className="text-zinc-300">@{run.accountId}</span>
        <span className="text-zinc-600">·</span>
        <span className="text-zinc-500">{when}</span>
      </div>
      <div className="flex items-center gap-2">
        <span
          className={
            "text-[10px] uppercase tracking-wider " +
            (run.status === "completed"
              ? "text-emerald-400"
              : run.status === "failed"
                ? "text-rose-400"
                : run.status === "running"
                  ? "text-amber-300"
                  : "text-zinc-500")
          }
        >
          {run.status}
        </span>
        <span className="text-zinc-500">
          {scheduled}/{total} scheduled
          {pendingCount > 0 ? `, ${pendingCount} to review` : ""}
        </span>
      </div>
    </button>
  );
}
