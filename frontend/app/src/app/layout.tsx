import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/shell/AppShell";

export const metadata: Metadata = {
  title: {
    default: "Cascade Zero — Safety Firewall for Autonomous Recovery Agents",
    template: "%s | Cascade Zero",
  },
  description:
    "Cascade Zero prevents autonomous infrastructure recovery agents from conflicting with each other by evaluating joint-action risk and selecting the safest coordinated recovery plan.",
  robots: "noindex", // Internal SRE tool
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
