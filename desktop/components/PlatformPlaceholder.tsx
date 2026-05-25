import { PlatformMeta } from "@/lib/platforms";
import { PlatformIcon } from "@/components/PlatformIcon";

interface Props {
  section: "Monitor" | "Scheduler" | "Connected";
  platform: PlatformMeta;
}

export function PlatformPlaceholder({ section, platform }: Props) {
  return (
    <div className="card flex flex-col items-center justify-center gap-3 py-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-panel2 text-zinc-300">
        <PlatformIcon slug={platform.slug} className="h-6 w-6" />
      </div>
      <div className="space-y-1">
        <div className="text-sm font-medium text-zinc-100">
          {section} for {platform.label}
        </div>
        <p className="max-w-sm text-xs leading-relaxed text-zinc-500">
          {platform.teaser}
        </p>
      </div>
      <span className="inline-flex items-center rounded-full border border-line bg-panel2 px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-zinc-400">
        Coming soon
      </span>
    </div>
  );
}
