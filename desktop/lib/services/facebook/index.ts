import { PlatformService } from "../types";
import { listAccounts } from "@/lib/storage";
import { facebookConnect } from "./connect";
import { postToFacebook } from "./post";

async function getDefaultFacebookAccountId(): Promise<string | null> {
  const accounts = await listAccounts("facebook");
  return accounts[0]?.id ?? null;
}

export const facebookService: PlatformService = {
  slug: "facebook",

  isConnectActive: facebookConnect.isConnectActive,
  startConnect: facebookConnect.startConnect,
  endConnect: facebookConnect.endConnect,
  cancelConnect: facebookConnect.cancelConnect,
  disconnect: facebookConnect.disconnect,

  listAccounts: () => listAccounts("facebook"),
  getDefaultAccountId: getDefaultFacebookAccountId,

  post: postToFacebook,
};
