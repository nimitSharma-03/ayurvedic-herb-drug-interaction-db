"use client";

import * as React from "react";

/**
 * Counts a real number up to itself, once, when it first scrolls into view.
 *
 * The value is the number the API returned; the animation only changes how it
 * arrives on screen. The final frame always sets the exact value rather than an
 * eased approximation, and the number is also rendered in the markup inside a
 * visually hidden span, so a reader with JavaScript off, a search engine, or an
 * assistive technology reads the real figure and never a partial count.
 *
 * Under prefers-reduced-motion it does not animate at all.
 */
export function CountUp({
  value,
  durationMs = 900,
  className,
}: {
  value: number;
  durationMs?: number;
  className?: string;
}) {
  const [shown, setShown] = React.useState(value);
  const [animating, setAnimating] = React.useState(false);
  const ref = React.useRef<HTMLSpanElement>(null);

  React.useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced || value <= 0) return;

    let frame = 0;
    let started = false;

    const run = () => {
      if (started) return;
      started = true;
      setAnimating(true);
      const begin = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - begin) / durationMs);
        // Ease out, so the number decelerates into its real value instead of
        // snapping to a stop.
        const eased = 1 - Math.pow(1 - t, 3);
        if (t >= 1) {
          setShown(value);
          setAnimating(false);
          return;
        }
        setShown(Math.round(value * eased));
        frame = requestAnimationFrame(step);
      };
      setShown(0);
      frame = requestAnimationFrame(step);
    };

    if (typeof IntersectionObserver === "undefined") {
      run();
      return () => cancelAnimationFrame(frame);
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          run();
          observer.disconnect();
        }
      },
      { threshold: 0.4 },
    );
    observer.observe(node);

    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [value, durationMs]);

  return (
    <span ref={ref} className={className}>
      <span aria-hidden={animating ? "true" : undefined}>
        {shown.toLocaleString("en-IN")}
      </span>
      {animating ? <span className="sr-only">{value.toLocaleString("en-IN")}</span> : null}
    </span>
  );
}
