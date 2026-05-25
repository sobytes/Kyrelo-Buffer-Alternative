import { redirect } from "next/navigation";
import { DEFAULT_PLATFORM } from "@/lib/platforms";

export default function SchedulerIndex() {
  redirect(`/scheduler/${DEFAULT_PLATFORM}`);
}
