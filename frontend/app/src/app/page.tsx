import { redirect } from "next/navigation";

/** Root redirects to /overview */
export default function Home() {
  redirect("/overview");
}
