import { QueuePanel } from "@/components/QueuePanel";

export default function QueuePage() {
  return (
    <main className="mx-auto max-w-3xl px-6 pb-6 pt-10">
      <h1 className="text-xl font-semibold tracking-tight text-zinc-100">
        Scheduler · Queue
      </h1>
      <p className="mt-1 text-sm text-zinc-400">
        Every post that&apos;s still going out, across every connected platform.
      </p>

      <div className="mt-6">
        <QueuePanel />
      </div>
    </main>
  );
}
