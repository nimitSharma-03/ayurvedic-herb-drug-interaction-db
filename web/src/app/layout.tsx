import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Lora, Source_Sans_3 } from "next/font/google";

import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { themeScript } from "@/components/theme-toggle";

import "./globals.css";

const lora = Lora({
  subsets: ["latin"],
  weight: ["600"],
  display: "swap",
  variable: "--font-lora",
});

const sourceSans = Source_Sans_3({
  subsets: ["latin"],
  weight: ["400", "600"],
  display: "swap",
  variable: "--font-source-sans",
});

/** Only PMIDs are set in the mono face, so one weight is enough. */
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400"],
  display: "swap",
  variable: "--font-plex-mono",
});

export const metadata: Metadata = {
  title: {
    default: "Herb–Drug Interaction Database",
    template: "%s · Herb–Drug Interaction Database",
  },
  description:
    "Look up what Ayurvedic herbs and conventional medicines do together, from curated PubMed literature. Informational only and not reviewed by a clinician.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Applies the stored theme before the first paint. See theme-toggle.tsx. */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body
        className={`${lora.variable} ${sourceSans.variable} ${plexMono.variable} flex min-h-dvh flex-col overflow-x-hidden`}
      >
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-full focus:bg-[var(--color-surface)] focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:shadow-[var(--shadow-soft)]"
        >
          Skip to content
        </a>
        <SiteHeader />
        <main id="main" className="flex-1 animate-fade-in">
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}
