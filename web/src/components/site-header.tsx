"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

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
 * On the home page it lies over the hero, transparent and in the night palette
 * whatever the theme, and takes a charred backdrop once the reader scrolls so
 * it stays legible over every scene and over the form below them. On every
 * other page it is a solid paper or charred bar with a hairline under it.
 *
 * Its two rows are exactly the heights `--nav-h` in globals.css claims they
 * are, because the hero pads itself by that variable -- change one and the
 * other has to follow.
 *
 * A 2px vermilion line along its bottom edge fills with the scroll position.
 * It is written straight to the element's transform rather than through React
 * state, so scrolling never re-renders the header.
 *
 * The active link is marked by an underline as well as by colour, so which
 * page you are on is not said by colour alone.
 */
export function SiteHeader() {
  const pathname = usePathname();
  const onHome = pathname === "/";
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const progressRef = React.useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = React.useState(false);

  React.useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const doc = document.documentElement;
      const max = doc.scrollHeight - window.innerHeight;
      const progress = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
      if (progressRef.current) {
        progressRef.current.style.transform = `scaleX(${progress})`;
      }
      setScrolled(window.scrollY > 24);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [pathname]);

  return (
    <header
      data-testid="site-header"
      className={cn(
        "sticky top-0 z-30 transition-[background-color,border-color] duration-300",
        onHome
          ? cn(
              "night border-b",
              scrolled
                ? "border-[var(--color-line)] bg-[var(--color-charred)]/85 backdrop-blur"
                : "border-transparent bg-transparent",
            )
          : "border-b border-[var(--color-line)] bg-[var(--color-paper)]",
      )}
    >
      <div className="page-shell flex h-16 items-center gap-3">
        <Link
          href="/"
          className="flex min-w-0 items-center gap-2.5 rounded-[var(--radius-tight)] py-1 pr-2"
          aria-label="Ayurvedic HDI, home"
        >
          <span
            aria-hidden="true"
            className="size-2.5 shrink-0 rounded-full bg-[var(--color-primary-fill)]"
          />
          <span className="truncate text-base font-medium tracking-[0.01em]">
            Ayurvedic HDI
          </span>
        </Link>

        <nav aria-label="Main" className="ml-auto hidden items-center gap-1 lg:flex">
          {LINKS.map((link) => (
            <NavLink key={link.href} {...link} active={isActive(link.href)} />
          ))}
        </nav>

        <div className="ml-auto lg:ml-2">
          <ThemeToggle />
        </div>
      </div>

      {/* Below the large breakpoint the same links sit on their own scrolling
          row, so nothing is hidden behind a menu the reader has to find. */}
      <nav
        aria-label="Main, compact"
        className="flex h-12 items-center gap-1 overflow-x-auto border-t border-[var(--color-line)] px-2 lg:hidden"
      >
        {LINKS.map((link) => (
          <NavLink key={link.href} {...link} active={isActive(link.href)} compact />
        ))}
      </nav>

      <div aria-hidden="true" className="absolute inset-x-0 -bottom-px h-0.5">
        <div
          ref={progressRef}
          data-testid="scroll-progress"
          className="h-full origin-left bg-[var(--color-primary-fill)]"
          style={{ transform: "scaleX(0)" }}
        />
      </div>
    </header>
  );
}

function NavLink({
  href,
  label,
  active,
  compact = false,
}: {
  href: string;
  label: string;
  active: boolean;
  compact?: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "rounded-[var(--radius-tight)] px-3 text-[0.9375rem] transition-colors",
        compact ? "shrink-0 py-1.5" : "py-2",
        active
          ? "text-[var(--color-ink)] underline decoration-[var(--color-primary)] decoration-2 underline-offset-[6px]"
          : "text-[var(--color-ink-2)] hover:text-[var(--color-ink)]",
      )}
    >
      {label}
    </Link>
  );
}
