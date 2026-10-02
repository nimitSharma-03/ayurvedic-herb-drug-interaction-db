"use client";

import * as React from "react";

import type { ParticleField } from "./particle-field";

/**
 * Mounts the hero's WebGL particle field, or nothing.
 *
 * The field is an enhancement over a hero that is already complete: the
 * gradient, the disc, the drawn layers and the CSS motes are in the server's
 * markup. So the field is only ever added, never waited for:
 *
 * - it loads through a dynamic import once the browser is idle after the first
 *   paint, so `three` is not in the page's first JavaScript;
 * - it is skipped when the reader asks for reduced motion, or when WebGL is
 *   unavailable, and the static hero is what they see;
 * - it pauses while the tab is hidden or the hero is off screen;
 * - it releases its GPU resources and removes its canvas on unmount.
 *
 * While it runs, the hero carries `data-webgl="on"`, which hides the CSS motes
 * so the two never double up. The canvas is aria-hidden and takes no pointer
 * events.
 */
export function HeroParticles() {
  const hostRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (motion.matches || !webglAvailable()) return;

    const hero = host.closest<HTMLElement>("[data-testid='hero']");
    let field: ParticleField | null = null;
    let cancelled = false;
    let inView = true;

    const sync = () => {
      if (!field) return;
      if (inView && document.visibilityState === "visible") field.play();
      else field.pause();
    };

    const observer = new IntersectionObserver((entries) => {
      inView = entries.some((entry) => entry.isIntersecting);
      sync();
    });
    observer.observe(host);
    document.addEventListener("visibilitychange", sync);

    const teardown = () => {
      cancelled = true;
      observer.disconnect();
      document.removeEventListener("visibilitychange", sync);
      motion.removeEventListener("change", onMotionChange);
      field?.dispose();
      field = null;
      hero?.removeAttribute("data-webgl");
    };

    // A reader who switches reduced motion on mid-visit gets the static hero.
    function onMotionChange() {
      if (motion.matches) teardown();
    }
    motion.addEventListener("change", onMotionChange);

    const load = () => {
      import("./particle-field")
        .then(({ createParticleField }) => {
          if (cancelled) return;
          try {
            field = createParticleField(host);
          } catch {
            // The context could not be created after all; the static hero
            // stays as it is.
            return;
          }
          hero?.setAttribute("data-webgl", "on");
          sync();
        })
        .catch(() => {
          // A chunk that failed to load leaves the static hero in place.
        });
    };

    const idle = window.requestIdleCallback
      ? window.requestIdleCallback(load, { timeout: 2000 })
      : window.setTimeout(load, 300);

    return () => {
      if (window.cancelIdleCallback) window.cancelIdleCallback(idle);
      else window.clearTimeout(idle);
      teardown();
    };
  }, []);

  return (
    <div
      ref={hostRef}
      data-testid="hero-particles"
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-[1]"
    />
  );
}

/** Whether a WebGL context can be had at all, checked before any download. */
function webglAvailable(): boolean {
  try {
    const probe = document.createElement("canvas");
    const context = probe.getContext("webgl2") ?? probe.getContext("webgl");
    // Hand the probe's context straight back: browsers cap live contexts.
    context?.getExtension("WEBGL_lose_context")?.loseContext();
    return context !== null;
  } catch {
    return false;
  }
}
