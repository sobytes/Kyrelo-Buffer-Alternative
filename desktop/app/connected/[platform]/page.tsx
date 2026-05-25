import { notFound } from "next/navigation";
import { ConnectedPanel } from "@/components/ConnectedPanel";
import { PlatformPlaceholder } from "@/components/PlatformPlaceholder";
import { getPlatform } from "@/lib/platforms";

export default async function ConnectedPlatformPage({
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
        Connected · {platform.label}
      </h1>
      <p className="mt-1 text-sm text-zinc-400">
        {platform.status === "live"
          ? `Manage which ${platform.label} accounts the scheduler can post through.`
          : platform.teaser}
      </p>

      <div className="mt-6">
        {platform.status === "live" ? (
          <ConnectedPanel platform={platform} />
        ) : (
          <PlatformPlaceholder section="Connected" platform={platform} />
        )}
      </div>
    </main>
  );
}
