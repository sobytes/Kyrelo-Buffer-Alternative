"use client";
import { useEffect, useState } from "react";

type Phase = "idle" | "starting" | "connecting" | "saving";

interface Status {
  connected: boolean;
  connecting: boolean;
}

export function ConnectedPanel() {
  const [status, setStatus] = useState<Status | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");

  async function refresh() {
    const r = (await fetch("/api/twitter-connect").then((r) => r.json())) as Status;
    setStatus(r);
    setPhase((p) => (r.connecting && p === "idle" ? "connecting" : p));
  }

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5_000);
    return () => clearInterval(id);
  }, []);

  async function start() {
    setPhase("starting");
    const r = await fetch("/api/twitter-connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "start" }),
    }).then((r) => r.json());
    if (r.error) {
      alert(r.error);
      setPhase("idle");
    } else {
      setPhase("connecting");
    }
  }

  async function done() {
    setPhase("saving");
    const r = await fetch("/api/twitter-connect", {
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
    await fetch("/api/twitter-connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "cancel" }),
    });
    setPhase("idle");
    refresh();
  }

  async function disconnect() {
    if (
      !confirm(
        "Disconnect from X? This wipes the saved Chrome session — you'll need to log in again next time.",
      )
    )
      return;
    const r = await fetch("/api/twitter-connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "disconnect" }),
    }).then((r) => r.json());
    if (r.error) alert(r.error);
    refresh();
  }

  const connecting = phase !== "idle" || status?.connecting;
  const connected = !!status?.connected;

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-black/40 text-lg font-bold text-zinc-100">
              𝕏
            </div>
            <div>
              <div className="text-sm font-semibold text-zinc-100">X (Twitter)</div>
              <div className="mt-0.5 text-xs text-zinc-500">
                {connected
                  ? "Session saved — used for scraping handles and posting replies."
                  : connecting
                    ? phase === "starting"
                      ? "Opening Chrome…"
                      : phase === "saving"
                        ? "Saving session…"
                        : "Log in to X in the Chrome window that opened."
                    : "Sign in once. The session is stored locally in your Chrome profile."}
              </div>
            </div>
          </div>

          <StatusPill connected={connected} connecting={!!connecting} />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {!connected && !connecting && (
            <button onClick={start} className="btn-primary text-sm">
              Connect with X
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

          {connected && !connecting && (
            <button onClick={disconnect} className="btn-danger text-sm">
              Disconnect
            </button>
          )}
        </div>
      </div>

      <div className="card text-xs leading-relaxed text-zinc-500">
        <strong className="text-zinc-300">How this works.</strong> Connecting opens a real Chrome
        window pointed at <code className="text-zinc-300">x.com/login</code>. After you sign in,
        Chrome saves the auth cookie to a profile directory on this machine. The detector then
        opens that same profile in headless mode to read timelines. No credentials are sent
        anywhere except X.com itself.
      </div>
    </div>
  );
}

function StatusPill({ connected, connecting }: { connected: boolean; connecting: boolean }) {
  if (connecting) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-300">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
        connecting
      </span>
    );
  }
  if (connected) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-live/10 px-2.5 py-1 text-[11px] font-medium text-emerald-300">
        <span className="h-1.5 w-1.5 rounded-full bg-live" />
        connected
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-800/60 px-2.5 py-1 text-[11px] font-medium text-zinc-400">
      <span className="h-1.5 w-1.5 rounded-full bg-zinc-600" />
      not connected
    </span>
  );
}
