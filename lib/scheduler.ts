import {
  deleteScheduledPost,
  listScheduledPosts,
  upsertScheduledPost,
} from "./storage";
import {
  getDefaultAccountId,
  isConnectActive,
  listXConnectedAccounts,
} from "./twitter-connect";
import { ScheduledPost } from "./types";

export interface DispatchOutcome {
  ran: number;
  posted: number;
  failed: number;
  skipped?: string;
}

export async function runDueScheduledPosts(): Promise<DispatchOutcome> {
  if (isConnectActive()) return { ran: 0, posted: 0, failed: 0, skipped: "connecting" };

  const all = await listScheduledPosts();
  const now = Date.now();
  const due = all.filter(
    (p) => p.status === "pending" && new Date(p.scheduledFor).getTime() <= now,
  );
  if (due.length === 0) return { ran: 0, posted: 0, failed: 0 };

  const accounts = await listXConnectedAccounts();
  const accountIds = new Set(accounts.map((a) => a.id));
  if (accountIds.size === 0) {
    return { ran: 0, posted: 0, failed: 0, skipped: "no-account" };
  }

  const { postTweetBrowser } = await import("./browser/twitter-post");
  const fallback = await getDefaultAccountId();

  let posted = 0;
  let failed = 0;
  for (const post of due) {
    const accountId = post.accountId && accountIds.has(post.accountId)
      ? post.accountId
      : fallback;
    if (!accountId) {
      post.status = "failed";
      post.error = "No connected X account for this post.";
      await upsertScheduledPost(post);
      failed++;
      continue;
    }
    post.status = "posting";
    await upsertScheduledPost(post);
    try {
      const r = await postTweetBrowser(accountId, post.text);
      post.status = "posted";
      post.postedAt = new Date().toISOString();
      post.postedUrl = r.url;
      post.error = undefined;
      posted++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      post.status = "failed";
      post.error = msg;
      failed++;
    }
    await upsertScheduledPost(post);
  }

  return { ran: due.length, posted, failed };
}

export async function createScheduledPost(input: {
  platform: ScheduledPost["platform"];
  accountId: string;
  text: string;
  scheduledFor: string;
}): Promise<ScheduledPost> {
  const post: ScheduledPost = {
    id: crypto.randomUUID(),
    platform: input.platform,
    accountId: input.accountId,
    text: input.text,
    scheduledFor: input.scheduledFor,
    createdAt: new Date().toISOString(),
    status: "pending",
  };
  await upsertScheduledPost(post);
  return post;
}

export async function cancelScheduledPost(id: string): Promise<void> {
  await deleteScheduledPost(id);
}
