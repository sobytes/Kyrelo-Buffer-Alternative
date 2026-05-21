import { NextResponse } from "next/server";
import { cancelScheduledPost } from "@/lib/scheduler";

export const dynamic = "force-dynamic";

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  await cancelScheduledPost(id);
  return NextResponse.json({ ok: true });
}
