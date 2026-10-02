"use client";

import * as React from "react";

/**
 * The home page's scroll motion: parallax depth and scene reveals.
 *
 * Parallax: the scroll position is written to `--scroll` on the scenes root,
 * once per frame at most, and each `.parallax` layer turns it into its own
 * translate through its `--depth`. Only CSS variables change, so scrolling
 * never re-renders React. It stops updating once the hero is well off screen,
 * because nothing that moves is visible below it.
 *
 * Reveals: each `.reveal` fades up 24px the first time it enters the viewport.
 * They are hidden only after this component has marked the document
 * `reveal-ready`, so with scripts off every scene is simply there; anything
 * already on screen at that moment is marked revealed first, so nothing
 * visible blinks out.
 *
 * Under prefers-reduced-motion neither runs, and the CSS holds every layer
 * still and every scene visible.
 */
export function SceneMotion({ rootId }: { rootId: string }) {
  React.useEffect(() => {
    const root = document.getElementById(rootId);
    if (!root) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    /* ------------------------------------------------------------ parallax */
    let frame = 0;
    const update = () => {
      frame = 0;
      const y = window.scrollY;
      if (y > window.innerHeight * 1.5) return;
      root.style.setProperty("--scroll", y.toFixed(1));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });

    /* ------------------------------------------------------------- reveals */
    const targets = Array.from(root.querySelectorAll<HTMLElement>(".reveal"));
    for (const target of targets) {
      const box = target.getBoundingClientRect();
      if (box.top < window.innerHeight && box.bottom > 0) {
        target.dataset.revealed = "";
      }
    }
    document.documentElement.classList.add("reveal-ready");

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          (entry.target as HTMLElement).dataset.revealed = "";
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    for (const target of targets) {
      if (target.dataset.revealed === undefined) observer.observe(target);
    }

    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
      document.documentElement.classList.remove("reveal-ready");
    };
  }, [rootId]);

  return null;
}
