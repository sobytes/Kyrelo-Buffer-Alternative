import { redirect } from "next/navigation";
import { DEFAULT_PLATFORM } from "@/lib/platforms";

export default function ConnectedIndex() {
  redirect(`/connected/${DEFAULT_PLATFORM}`);
}
