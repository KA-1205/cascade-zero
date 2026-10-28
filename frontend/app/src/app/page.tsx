import type { Metadata } from "next";
import { Landing } from "@/components/landing/Landing";

export const metadata: Metadata = {
  title: { absolute: "Cascade Zero: check recovery actions together, not one by one" },
  description:
    "Cascade Zero scores combinations of automated recovery actions, blocks risky pairs with a plain-language reason, and supports operator approval before local replay. Simulation only.",
  robots: "index, follow",
  openGraph: {
    title: "Cascade Zero",
    description: "Cascade Zero evaluates the joint risk of recovery actions in a reproducible infrastructure simulator.",
    type: "website",
  },
};

export default function Home() {
  return <Landing />;
}
