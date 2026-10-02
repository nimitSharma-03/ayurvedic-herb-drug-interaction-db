"use client";

import * as React from "react";

const PHRASE = "Herbs · Medicines · Evidence · Curated by hand ·";
/** Copies of the phrase in one segment: enough to be wider than a 1920px screen. */
const COPIES = 4;
/** Drift with no scrolling, in px per second. */
const BASE_SPEED = 36;

/**
 * A band of words that drifts sideways and answers the scroll.
 *
 * Two identical segments sit side by side and the track is moved by an offset
 * that wraps at one segment's width, so the loop has no seam. Each frame the
 * scroll velocity is measured, smoothed, and added to the drift; the direction
 * follows the last scroll direction, so scrolling up runs the band backwards.
 * The offset is written straight to the track's transform, so none of this
 * re-renders React.
 *
 * The loop runs only while the band is on screen, and not at all under
 * prefers-reduced-motion, where the band is a still line of words. It is
 * aria-hidden: it repeats words the page says elsewhere.
 */
export function VelocityBand() {
  const bandRef = React.useRef<HTMLDivElement>(null);
  const trackRef = React.useRef<HTMLDivElement>(null);
  const segmentRef = React.useRef<HTMLSpanElement>(null);

  React.useEffect(() => {
    const band = bandRef.current;
    const track = trackRef.current;
    const segment = segmentRef.current;
    if (!band || !track || !segment) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let width = segment.offsetWidth;
    const resize = new ResizeObserver(() => {
      width = segment.offsetWidth;
    });
    resize.observe(segment);

    let frame = 0;
    let last = 0;
    let lastY = window.scrollY;
    let offset = 0;
    let velocity = 0;
    let direction = 1;

    const step = (now: number) => {
      frame = requestAnimationFrame(step);
      const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
      last = now;
      if (!dt || !width) return;

      const y = window.scrollY;
      const raw = (y - lastY) / dt;
      lastY = y;
      velocity += (raw - velocity) * 0.1;
      if (Math.abs(velocity) > 20) direction = Math.sign(velocity);

      const speed = direction * (BASE_SPEED + Math.min(Math.abs(velocity) * 0.4, 1200));
      offset = (((offset + speed * dt) % width) + width) % width;
      track.style.transform = `translate3d(${(-offset).toFixed(2)}px, 0, 0)`;
    };

    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) {
        if (!frame) {
          last = 0;
          lastY = window.scrollY;
          frame = requestAnimationFrame(step);
        }
      } else if (frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
    });
    observer.observe(band);

    return () => {
      observer.disconnect();
      resize.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  const segment = Array.from({ length: COPIES }, () => PHRASE).join(" ");

  return (
    <div
      ref={bandRef}
      data-testid="velocity-band"
      aria-hidden="true"
      className="overflow-hidden border-y border-[var(--color-line)] bg-[var(--color-charred)] py-5"
    >
      <div ref={trackRef} data-testid="velocity-track" className="flex w-max will-change-transform">
        <span
          ref={segmentRef}
          className="pr-[0.3em] text-[2.25rem] leading-none font-light whitespace-nowrap text-[var(--color-stone)] md:text-[3.5rem]"
        >
          {segment}
        </span>
        <span className="pr-[0.3em] text-[2.25rem] leading-none font-light whitespace-nowrap text-[var(--color-stone)] md:text-[3.5rem]">
          {segment}
        </span>
      </div>
    </div>
  );
}
