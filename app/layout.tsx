import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans_JP } from "next/font/google";
import "./globals.css";

// 05 §3 — two families, loaded together. next/font downloads them at build time, serves them from
// this origin and generates the family name, which is why the stacks in globals.css point at these
// variables rather than spelling the family (05 §10.1).
const plexSansJp = IBM_Plex_Sans_JP({
  weight: ["400", "500", "600"],
  variable: "--font-plex-sans-jp",
  display: "swap",
  // Google publishes no `japanese` subset for this family, so nothing here can be preloaded.
  preload: false,
});

const plexMono = IBM_Plex_Mono({
  weight: ["400", "500"],
  subsets: ["latin"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Suburi",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${plexSansJp.variable} ${plexMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
