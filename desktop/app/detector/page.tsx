import { redirect } from "next/navigation";
import { DEFAULT_PLATFORM } from "@/lib/platforms";

export default function DetectorIndex() {
  redirect(`/detector/${DEFAULT_PLATFORM}`);
}
