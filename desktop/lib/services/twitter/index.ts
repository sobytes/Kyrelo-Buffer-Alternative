import { PlatformService, WatchInput, WatchedScrapedPost } from "../types";
import { listAccounts } from "@/lib/storage";
import { twitterConnect } from "./connect";
import { postToTwitter } from "./post";
import { scrapeManyTimelines } from "./watch";

async function getDefaultTwitterAccountId(): Promise<string | null> {
  const accounts = await listAccounts("twitter");
  return accounts[0]?.id ?? null;
}

async function watchTwitter(input: WatchInput): Promise<WatchedScrapedPost[]> {
  return scrapeManyTimelines(input);
}

export const twitterService: PlatformService = {
  slug: "twitter",

  isConnectActive: twitterConnect.isConnectActive,
  startConnect: twitterConnect.startConnect,
  endConnect: twitterConnect.endConnect,
  cancelConnect: twitterConnect.cancelConnect,
  disconnect: twitterConnect.disconnect,

  listAccounts: () => listAccounts("twitter"),
  getDefaultAccountId: getDefaultTwitterAccountId,

  post: postToTwitter,
  watch: watchTwitter,
};
