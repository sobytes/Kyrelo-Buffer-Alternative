import { CrossPostPanel } from "@/components/CrossPostPanel";

export default function CrossPostPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 pb-6 pt-10">
      <h1 className="text-xl font-semibold tracking-tight text-zinc-100">
        Scheduler · All platforms
      </h1>
      <p className="mt-1 text-sm text-zinc-400">
        Write one post, schedule it across every connected account in one go.
      </p>

      <div className="mt-6">
        <CrossPostPanel />
      </div>
    </main>
  );
}
