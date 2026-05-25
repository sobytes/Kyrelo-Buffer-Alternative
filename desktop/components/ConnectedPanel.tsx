"use client";
import { useCallback, useEffect, useState } from "react";
import { SocialAccount } from "@/lib/types";
import { PlatformMeta } from "@/lib/platforms";
import { PlatformIcon } from "@/components/PlatformIcon";

type Phase = "idle" | "starting" | "connecting" | "saving";

function openExternal(url: string) {
  if (window.electronAPI?.openExternal) {
    void window.electronAPI.openExternal(url);
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

interface ConnectState {
  accounts: SocialAccount[];
  connecting: boolean;
}

export function ConnectedPanel({ platform }: { platform: PlatformMeta }) {
  const apiUrl = `/api/connect/${platform.slug}`;
  const [state, setState] = useState<ConnectState | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");

  const refresh = useCallback(async () => {
    const r = (await fetch(apiUrl).then((r) => r.json())) as ConnectState;
    setState(r);
    setPhase((p) => (r.connecting && p === "idle" ? "connecting" : p));
  }, [apiUrl]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5_000);
    return () => clearInterval(id);
  }, [refresh]);

  async function start() {
    setPhase("starting");
    const r = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "start" }),
    }).then((r) => r.json());
    if (r.error) {
      if (r.chromeMissing) {
        if (confirm(`${r.error}\n\nOpen the Chrome download page now?`)) {
          openExternal("https://www.google.com/chrome/");
        }
      } else {
        alert(r.error);
      }
      setPhase("idle");
    } else {
      setPhase("connecting");
    }
  }

  async function done() {
    setPhase("saving");
    const r = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "done" }),
    }).then((r) => r.json());
    if (r.error) {
      alert(r.error);
      setPhase("connecting");
      return;
    }
    setPhase("idle");
    refresh();
  }

  async function cancel() {
    await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "cancel" }),
    });
    setPhase("idle");
    refresh();
  }

  async function disconnect(account: SocialAccount) {
    if (
      !confirm(
        `Disconnect @${account.handle}? This wipes the saved Chrome session — you'll need to log in again to re-add it.`,
      )
    )
      return;
    const r = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "disconnect", accountId: account.id }),
    }).then((r) => r.json());
    if (r.error) alert(r.error);
    refresh();
  }

  if (!state) {
    return <div className="card text-sm text-zinc-500">Loading…</div>;
  }

  const isConnecting = phase !== "idle" || state.connecting;

  return (
    <div className="space-y-4">
      {state.accounts.length > 0 ? (
        <div className="space-y-2">
          {state.accounts.map((a) => (
            <AccountRow
              key={a.id}
              account={a}
              platform={platform}
              onDisconnect={() => disconnect(a)}
            />
          ))}
        </div>
      ) : (
        <div className="card text-sm text-zinc-500">
          No {platform.label} accounts connected yet.
        </div>
      )}

      <div className="card space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-zinc-100">
              Add a {platform.label} account
            </div>
            <div className="mt-0.5 text-xs text-zinc-500">
              {phase === "starting"
                ? "Opening Chrome…"
                : phase === "connecting"
                  ? `Log in to ${platform.label} in the Chrome window that opened. You can use email/username — Google blocks automated browsers.`
                  : phase === "saving"
                    ? "Saving session…"
                    : `Connect opens Chrome to the ${platform.label} login page. Sign in once and the session is saved to its own profile directory.`}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {phase === "idle" && !state.connecting && (
            <button onClick={start} className="btn-primary text-sm">
              Connect with {platform.label}
            </button>
          )}
          {phase === "connecting" && (
            <>
              <button onClick={done} className="btn-primary text-sm">
                I&apos;m logged in
              </button>
              <button onClick={cancel} className="btn-ghost text-sm">
                Cancel
              </button>
            </>
          )}
          {phase === "starting" && (
            <button disabled className="btn-ghost text-sm">
              Starting…
            </button>
          )}
          {phase === "saving" && (
            <button disabled className="btn-ghost text-sm">
              Saving…
            </button>
          )}
        </div>

        {isConnecting && (
          <p className="text-[10px] text-zinc-500">
            Connecting in progress — scrapes and scheduled posts pause until it finishes.
          </p>
        )}
      </div>

      <div className="card text-xs leading-relaxed text-zinc-500">
        <strong className="text-zinc-300">How this works.</strong> Each account gets its own
        Chrome profile under{" "}
        <code className="text-zinc-300">
          .data/userdata/{platform.slug}/&lt;handle&gt;/
        </code>
        . Scheduled posts go through whichever account you pick on the Scheduler page. No
        credentials are sent anywhere except {platform.label}.com itself.
      </div>
    </div>
  );
}

function AccountRow({
  account,
  platform,
  onDisconnect,
}: {
  account: SocialAccount;
  platform: PlatformMeta;
  onDisconnect: () => void;
}) {
  return (
    <div className="card flex items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-black/40 text-zinc-100">
          <PlatformIcon slug={platform.slug} className="h-5 w-5" />
        </div>
        <div>
          <div className="text-sm font-semibold text-zinc-100">@{account.handle}</div>
          <div className="text-[11px] text-zinc-500">
            Added {new Date(account.addedAt).toLocaleDateString()}
          </div>
        </div>
      </div>
      <button onClick={onDisconnect} className="btn-danger text-xs">
        Disconnect
      </button>
    </div>
  );
}
