import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "Lumnus Outreach", description: "Lumnus Consulting’s outreach workspace" };

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
