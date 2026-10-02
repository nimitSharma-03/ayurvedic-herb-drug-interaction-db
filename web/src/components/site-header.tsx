"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { BrandMark } from "@/components/brand-mark";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/ask", label: "Describe a problem" },
  { href: "/check", label: "Check a pair" },
  { href: "/medicines", label: "Medicines" },
  { href: "/how-it-works", label: "How it works" },
];

/**
 * The sticky top bar.
 *
 * Square-edged and flush to the page edges, like every full-width band in this
 * design. Its two rows are exactly the heights `--nav-h` in globals.css claims
 * they are, because the hero below subtracts that variable from the viewport to
 * be one screen tall -- change one and the other has to follow.
 *
 * The active link carries a wash pill *and* an underline, so which page you are
 * on is not said by colour alone. There is no call to action up here: it would
 * only repeat the link next to it.
 */
export function SiteHeader() {
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <header className="sticky top-0 z-30 border-b border-[var(--color-line)] bg-[var(--color-paper)]/90 backdrop-blur">
      <div className="page-shell flex h-16 items-center gap-3">
        <Link
          href="/"
          className="flex min-w-0 items-center gap-3 rounded-full py-1 pr-2"
          aria-label="Herb–Drug Interaction Database, home"
        >
          <BrandMark />
          <span className="truncate text-[0.95rem] font-semibold sm:text-base">
            Herb–Drug Interaction Database
          </span>
        </Link>

        <nav aria-label="Main" className="ml-auto hidden items-center gap-1 lg:flex">
          {LINKS.map((link) => {
            const active = isActive(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-full px-3.5 py-2 text-sm transition-colors",
                  active
                    ? "bg-[var(--color-wash)] font-semibold text-[var(--color-ink)] underline decoration-2 underline-offset-4"
                    : "text-[var(--color-ink-2)] hover:bg-[var(--color-wash)] hover:text-[var(--color-ink)]",
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto lg:ml-2">
          <ThemeToggle />
        </div>
      </div>

      {/* Below the large breakpoint the same links sit on their own scrolling
          row, so nothing is hidden behind a menu the reader has to find. */}
      <nav
        aria-label="Main, compact"
        className="flex h-12 items-center gap-1.5 overflow-x-auto border-t border-[var(--color-line)] px-4 lg:hidden"
      >
        {LINKS.map((link) => {
          const active = isActive(link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "shrink-0 rounded-full px-3.5 py-1.5 text-sm transition-colors",
                active
                  ? "bg-[var(--color-wash)] font-semibold text-[var(--color-ink)] underline decoration-2 underline-offset-4"
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
