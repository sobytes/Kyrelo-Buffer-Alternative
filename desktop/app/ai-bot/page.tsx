import { AiBotPanel } from "@/components/AiBotPanel";

export const dynamic = "force-dynamic";

export default function AiBotPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6 p-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">
          AI Bot
        </h1>
        <p className="text-sm text-zinc-500">
          Your in-house growth strategist. Pick a connected account, hit{" "}
          <span className="text-zinc-300">Plan a growth run</span>, and watch
          Claude draft a batch of posts tailored to that account&apos;s voice.
          Everything lands as pending in your scheduler queue — you review and
          approve before anything goes out.
        </p>
      </header>
      <AiBotPanel />
    </div>
  );
}
