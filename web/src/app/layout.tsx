import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Onest } from "next/font/google";

import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { themeScript } from "@/components/theme-toggle";

import "./globals.css";

/**
 * One family for everything that is read.
 *
 * 300 for prose in the night scenes, 400 for body text and headings on the
 * pages a reader works in, 500 and 600 for labels and table headings. There is
 * no display cut: headings get their presence from size, not weight.
 */
const onest = Onest({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  display: "swap",
  variable: "--font-onest",
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
    "Describe a problem and see what curated PubMed literature records for it: Ayurvedic herbs, conventional medicines, and the pairs to watch. Information only, not clinical advice.",
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
        className={`${onest.variable} ${plexMono.variable} flex min-h-dvh flex-col overflow-x-hidden`}
      >
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-[var(--radius-field)] focus:bg-[var(--color-ink)] focus:px-5 focus:py-2.5 focus:text-sm focus:font-semibold focus:text-[var(--color-on-ink)] focus:shadow-[var(--shadow-lift)]"
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
