import { PlatformService, WatchInput, WatchedScrapedPost } from "../types";
import { listAccounts } from "@/lib/storage";
import { threadsConnect } from "./connect";
import { postToThreads } from "./post";
import { scrapeManyThreadsTimelines } from "./watch";

async function getDefaultThreadsAccountId(): Promise<string | null> {
  const accounts = await listAccounts("threads");
  return accounts[0]?.id ?? null;
}

async function watchThreads(input: WatchInput): Promise<WatchedScrapedPost[]> {
  return scrapeManyThreadsTimelines(input);
}

export const threadsService: PlatformService = {
  slug: "threads",

  isConnectActive: threadsConnect.isConnectActive,
  startConnect: threadsConnect.startConnect,
  endConnect: threadsConnect.endConnect,
  cancelConnect: threadsConnect.cancelConnect,
  disconnect: threadsConnect.disconnect,

  listAccounts: () => listAccounts("threads"),
  getDefaultAccountId: getDefaultThreadsAccountId,

  post: postToThreads,
  watch: watchThreads,
};
