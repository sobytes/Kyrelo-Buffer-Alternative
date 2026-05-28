import { NextRequest, NextResponse } from "next/server";
import { getAiBotConfig, setAiBotAccountConfig } from "@/lib/storage";
import { getPlatform } from "@/lib/platforms";
import { AiBotAccountConfig } from "@/lib/types";

export const dynamic = "force-dynamic";

const MAX_WEBSITE_URLS = 5;

// GET — full config object so the page can render saved URLs without one
// fetch per account card.
export async function GET() {
  const cfg = await getAiBotConfig();
  return NextResponse.json({ config: cfg });
}

// POST — update a single account's config. Body: { platform, accountId,
// websiteUrls? }. websiteUrls is normalised: each entry is validated as an
// http/https URL, duplicates are dropped, and the list is capped at 5.
// An explicit empty array clears the list.
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    platform?: string;
    accountId?: string;
    websiteUrls?: string[] | null;
  };
  const platform = body.platform ? getPlatform(body.platform) : null;
  if (!platform) {
    return NextResponse.json({ error: "unknown platform" }, { status: 400 });
  }
  if (!body.accountId) {
    return NextResponse.json(
      { error: "accountId is required" },
      { status: 400 },
    );
  }
  const patch: AiBotAccountConfig = {};
  if ("websiteUrls" in body) {
    if (!Array.isArray(body.websiteUrls)) {
      return NextResponse.json(
        { error: "websiteUrls must be an array of strings" },
        { status: 400 },
      );
    }
    if (body.websiteUrls.length > MAX_WEBSITE_URLS) {
      return NextResponse.json(
        { error: `At most ${MAX_WEBSITE_URLS} knowledge URLs per account.` },
        { status: 400 },
      );
    }
    const cleaned: string[] = [];
    for (const raw of body.websiteUrls) {
      if (typeof raw !== "string") {
        return NextResponse.json(
          { error: "Each websiteUrls entry must be a string" },
          { status: 400 },
        );
      }
      const trimmed = raw.trim();
      if (!trimmed) continue;
      let u: URL;
      try {
        u = new URL(trimmed);
      } catch {
        return NextResponse.json(
          { error: `Not a valid URL: ${trimmed}` },
          { status: 400 },
        );
      }
      if (u.protocol !== "http:" && u.protocol !== "https:") {
        return NextResponse.json(
          { error: `URL must use http:// or https://: ${trimmed}` },
          { status: 400 },
        );
      }
      if (!cleaned.includes(u.toString())) cleaned.push(u.toString());
    }
    patch.websiteUrls = cleaned;
  }
  await setAiBotAccountConfig(platform.slug, body.accountId, patch);
  return NextResponse.json({ ok: true });
}
