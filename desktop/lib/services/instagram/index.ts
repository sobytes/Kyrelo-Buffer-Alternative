import { PlatformService } from "../types";
import { listAccounts } from "@/lib/storage";
import { instagramConnect } from "./connect";
import { postToInstagram } from "./post";

async function getDefaultInstagramAccountId(): Promise<string | null> {
  const accounts = await listAccounts("instagram");
  return accounts[0]?.id ?? null;
}

export const instagramService: PlatformService = {
  slug: "instagram",

  isConnectActive: instagramConnect.isConnectActive,
  startConnect: instagramConnect.startConnect,
  endConnect: instagramConnect.endConnect,
  cancelConnect: instagramConnect.cancelConnect,
  disconnect: instagramConnect.disconnect,

  listAccounts: () => listAccounts("instagram"),
  getDefaultAccountId: getDefaultInstagramAccountId,

  post: postToInstagram,
};
