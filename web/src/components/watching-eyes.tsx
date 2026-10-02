"use client";

import * as React from "react";

/** The eye's geometry in its own 120-unit viewBox. */
const EYE_R = 56;
const IRIS_R = 24;
/** The farthest the iris may travel from centre and still sit inside the eye. */
const MAX_TRAVEL = EYE_R - IRIS_R - 6;

/**
 * Two eyes for the 404 page whose irises follow the cursor.
 *
 * Each iris eases toward a point along the line to the cursor, clamped so it
 * never leaves the eye. On a touch screen, where there is no cursor to follow,
 * they look around on their own every couple of seconds instead. Under
 * prefers-reduced-motion they hold still, looking straight ahead.
 *
 * Decorative and aria-hidden; the page's heading says what happened.
 */
export function WatchingEyes() {
  const eyeRefs = React.useRef<(SVGSVGElement | null)[]>([]);
  const irisRefs = React.useRef<(SVGGElement | null)[]>([]);

  React.useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const eyes = eyeRefs.current.filter((eye): eye is SVGSVGElement => eye !== null);
    const irises = irisRefs.current.filter((iris): iris is SVGGElement => iris !== null);
    if (eyes.length !== irises.length || eyes.length === 0) return;

    const current = eyes.map(() => ({ x: 0, y: 0 }));
    const target = eyes.map(() => ({ x: 0, y: 0 }));
    let frame = 0;

    const step = () => {
      frame = 0;
      let moving = false;
      irises.forEach((iris, index) => {
        const now = current[index]!;
        const goal = target[index]!;
        now.x += (goal.x - now.x) * 0.18;
        now.y += (goal.y - now.y) * 0.18;
        if (Math.abs(goal.x - now.x) > 0.05 || Math.abs(goal.y - now.y) > 0.05) moving = true;
        iris.setAttribute("transform", `translate(${now.x.toFixed(2)} ${now.y.toFixed(2)})`);
      });
      if (moving) frame = requestAnimationFrame(step);
    };
    const wake = () => {
      if (!frame) frame = requestAnimationFrame(step);
    };

    /** Aim every iris at a point on screen, in each eye's own units. */
    const lookAt = (x: number, y: number) => {
      eyes.forEach((eye, index) => {
        const box = eye.getBoundingClientRect();
        const scale = 120 / (box.width || 1);
        const dx = (x - (box.left + box.width / 2)) * scale;
        const dy = (y - (box.top + box.height / 2)) * scale;
        const distance = Math.hypot(dx, dy);
        // Near the eye the iris follows closely; far away it reaches its limit.
        const travel = Math.min(distance * 0.25, MAX_TRAVEL);
        target[index] = distance > 0 ? { x: (dx / distance) * travel, y: (dy / distance) * travel } : { x: 0, y: 0 };
      });
      wake();
    };

    const touch = !window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    if (touch) {
      // No cursor: an unhurried look around, sometimes back to centre.
      const wander = () => {
        const angle = Math.random() * Math.PI * 2;
        const reach = Math.random() < 0.25 ? 0 : MAX_TRAVEL * (0.4 + Math.random() * 0.5);
        target.forEach((_, index) => {
          target[index] = { x: Math.cos(angle) * reach, y: Math.sin(angle) * reach };
        });
        wake();
      };
      const timer = window.setInterval(wander, 2400);
      return () => {
        window.clearInterval(timer);
        if (frame) cancelAnimationFrame(frame);
      };
    }

    const onMove = (event: PointerEvent) => lookAt(event.clientX, event.clientY);
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div data-testid="watching-eyes" aria-hidden="true" className="flex gap-[clamp(0.75rem,3vw,1.5rem)]">
      {[0, 1].map((index) => (
        <svg
          key={index}
          ref={(node) => {
            eyeRefs.current[index] = node;
          }}
          viewBox="0 0 120 120"
          className="size-[clamp(5.5rem,16vw,8.5rem)]"
        >
          <circle cx="60" cy="60" r={EYE_R} fill="#f4f1ea" />
          <g
            ref={(node) => {
              irisRefs.current[index] = node;
            }}
          >
            <circle cx="60" cy="60" r={IRIS_R} fill="#e0231c" />
            <circle cx="60" cy="60" r="11" fill="#0d0b0a" />
            <circle cx="66" cy="54" r="3.5" fill="#f4f1ea" opacity="0.85" />
          </g>
        </svg>
      ))}
    </div>
  );
}
