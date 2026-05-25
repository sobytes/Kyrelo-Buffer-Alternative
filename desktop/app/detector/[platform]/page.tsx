import { notFound } from "next/navigation";
import { DetectorPanel } from "@/components/DetectorPanel";
import { MonitorPanel } from "@/components/MonitorPanel";
import { PlatformPlaceholder } from "@/components/PlatformPlaceholder";
import { getPlatform } from "@/lib/platforms";
import { getService } from "@/lib/services";

export default async function DetectorPlatformPage({
  params,
}: {
  params: Promise<{ platform: string }>;
}) {
  const { platform: slug } = await params;
  const platform = getPlatform(slug);
  if (!platform) notFound();

  // The X panel has its own X-specific UI (handle suggestions, @grok reply
  // flow); other platforms get the generic Monitor panel.
  if (platform.slug === "twitter") {
    return (
      <main className="mx-auto max-w-7xl px-6 pb-6 pt-10">
        <DetectorPanel />
      </main>
    );
  }

  // Only render the live Monitor panel for platforms whose service actually
  // implements `watch`. Without it, the page would render an empty feed
  // forever — better to show "coming soon" until the scraper is in place.
  const service = getService(platform.slug);
  const hasWatcher = !!service?.watch;

  return (
    <main className="mx-auto max-w-5xl px-6 pb-6 pt-10">
      <h1 className="text-xl font-semibold tracking-tight text-zinc-100">
        Monitor · {platform.label}
      </h1>
      <p className="mt-1 text-sm text-zinc-400">
        {hasWatcher
          ? `Track new posts from ${platform.label} handles you care about. New posts surface here and fire a desktop notification.`
          : `Watching ${platform.label} timelines is coming soon — the plumbing's in place, the scraper isn't.`}
      </p>

      <div className="mt-6">
        {hasWatcher ? (
          <MonitorPanel platform={platform} />
        ) : (
          <PlatformPlaceholder section="Monitor" platform={platform} />
        )}
      </div>
    </main>
  );
}
