import { notFound } from "next/navigation";
import { SchedulerPanel } from "@/components/SchedulerPanel";
import { PlatformPlaceholder } from "@/components/PlatformPlaceholder";
import { getPlatform } from "@/lib/platforms";

export default async function SchedulerPlatformPage({
  params,
}: {
  params: Promise<{ platform: string }>;
}) {
  const { platform: slug } = await params;
  const platform = getPlatform(slug);
  if (!platform) notFound();

  return (
    <main className="mx-auto max-w-3xl px-6 pb-6 pt-10">
      <h1 className="text-xl font-semibold tracking-tight text-zinc-100">
        Scheduler · {platform.label}
      </h1>
      <p className="mt-1 text-sm text-zinc-400">
        {platform.status === "live"
          ? `Queue posts to send through your connected ${platform.label} account at a specific time.`
          : platform.teaser}
      </p>

      <div className="mt-6">
        {platform.status === "live" ? (
          <SchedulerPanel platform={platform} />
        ) : (
          <PlatformPlaceholder section="Scheduler" platform={platform} />
        )}
      </div>
    </main>
  );
}
