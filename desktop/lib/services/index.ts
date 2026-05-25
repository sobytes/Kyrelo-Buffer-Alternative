import { PlatformSlug } from "@/lib/platforms";
import { PlatformService } from "./types";
import { twitterService } from "./twitter";
import { threadsService } from "./threads";
import { linkedinService } from "./linkedin";
import { facebookService } from "./facebook";
import { instagramService } from "./instagram";

// Registry of every platform Kyrelo knows how to drive. Add a new platform by
// dropping a folder under `lib/services/<slug>/` that exports a
// `PlatformService` and importing it here.
const REGISTRY: Record<string, PlatformService> = {
  twitter: twitterService,
  threads: threadsService,
  linkedin: linkedinService,
  facebook: facebookService,
  instagram: instagramService,
};

export function getService(slug: string): PlatformService | null {
  return REGISTRY[slug] ?? null;
}

export function listServices(): PlatformService[] {
  return Object.values(REGISTRY);
}

// True if any platform is mid-connect. The scheduler / detector tick skips
// while a connect window is open so it doesn't fight for the same Chrome
// profile.
export function isAnyConnectActive(): boolean {
  return listServices().some((s) => s.isConnectActive());
}

// Convenience for the scheduler dispatcher.
export function requireService(slug: PlatformSlug): PlatformService {
  const svc = getService(slug);
  if (!svc) throw new Error(`No service registered for platform "${slug}"`);
  return svc;
}
