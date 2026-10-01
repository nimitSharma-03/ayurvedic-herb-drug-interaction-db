"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { BrandMark } from "@/components/brand-mark";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/ask", label: "Describe a problem" },
  { href: "/check", label: "Check two medicines" },
  { href: "/medicines", label: "Medicines" },
  { href: "/how-it-works", label: "How it works" },
];

export function SiteHeader() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-30 border-b border-[var(--color-line)] bg-[var(--color-paper)]/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:px-6">
        <Link
          href="/"
          className="flex min-w-0 items-center gap-2.5 rounded-full py-1 pr-2"
          aria-label="Herb–Drug Interaction Database, home"
        >
          <BrandMark />
          <span className="truncate font-[family-name:var(--font-heading)] text-[0.95rem] leading-tight font-semibold sm:text-base">
            Herb–Drug Interaction Database
          </span>
        </Link>

        <nav aria-label="Main" className="ml-auto hidden items-center gap-1 md:flex">
          {LINKS.map((link) => {
            const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-full px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-[var(--color-wash)] font-semibold text-[var(--color-ink)]"
                    : "text-[var(--color-ink-2)] hover:bg-[var(--color-wash)] hover:text-[var(--color-ink)]",
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto md:ml-0">
          <ThemeToggle />
        </div>
      </div>

      {/* Below the medium breakpoint the same links sit on their own scrolling
          row, so nothing is hidden behind a menu the reader has to find. */}
      <nav
        aria-label="Main, compact"
        className="flex gap-1 overflow-x-auto border-t border-[var(--color-line)] px-4 py-2 md:hidden"
      >
        {LINKS.map((link) => {
          const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "shrink-0 rounded-full px-3 py-1.5 text-sm transition-colors",
                active
                  ? "bg-[var(--color-wash)] font-semibold text-[var(--color-ink)]"
                  : "text-[var(--color-ink-2)]",
              )}
            >
              {link.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
