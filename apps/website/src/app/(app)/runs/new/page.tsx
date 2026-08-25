import { redirect } from "next/navigation";

export default function LegacyNewRunPage() {
  redirect("/conversations/new");
}
