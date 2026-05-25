import { PlatformService, WatchInput, WatchedScrapedPost } from "../types";
import { listAccounts } from "@/lib/storage";
import { linkedinConnect } from "./connect";
import { postToLinkedIn } from "./post";
import { scrapeManyLinkedInTimelines } from "./watch";

async function getDefaultLinkedInAccountId(): Promise<string | null> {
  const accounts = await listAccounts("linkedin");
  return accounts[0]?.id ?? null;
}

async function watchLinkedIn(input: WatchInput): Promise<WatchedScrapedPost[]> {
  return scrapeManyLinkedInTimelines(input);
}

export const linkedinService: PlatformService = {
  slug: "linkedin",

  isConnectActive: linkedinConnect.isConnectActive,
  startConnect: linkedinConnect.startConnect,
  endConnect: linkedinConnect.endConnect,
  cancelConnect: linkedinConnect.cancelConnect,
  disconnect: linkedinConnect.disconnect,

  listAccounts: () => listAccounts("linkedin"),
  getDefaultAccountId: getDefaultLinkedInAccountId,

  post: postToLinkedIn,
  watch: watchLinkedIn,
};
