"use client";

import * as React from "react";

/** How far the cursor's influence reaches, and the most a letter moves, in px. */
const RADIUS = 90;
const PUSH = 9;
/** How quickly a letter follows its target each frame. */
const EASE = 0.14;

/**
 * The hero headline, whose letters drift a few pixels away from the cursor and
 * ease back when it leaves.
 *
 * The heading carries its full text as `aria-label` and the per-letter spans
 * are aria-hidden, so assistive technology reads one sentence, not letters.
 * The letters are server-rendered in their resting place, so without
 * JavaScript, on a touch screen, or under prefers-reduced-motion the heading
 * is simply text and nothing moves.
 *
 * Letter centres are measured once (and again on resize) relative to the
 * document, so a frame does no layout reads. The loop runs only while the
 * pointer is moving or a letter is still settling, then stops.
 */
export function RepelHeadline({
  text,
  id,
  className,
}: {
  text: string;
  id?: string;
  className?: string;
}) {
  const headingRef = React.useRef<HTMLHeadingElement>(null);

  React.useEffect(() => {
    const heading = headingRef.current;
    if (!heading) return;
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!fine || reduced) return;

    const letters = Array.from(heading.querySelectorAll<HTMLSpanElement>("[data-letter]"));
    const state = letters.map(() => ({ cx: 0, cy: 0, x: 0, y: 0 }));

    const measure = () => {
      letters.forEach((letter, index) => {
        const box = letter.getBoundingClientRect();
        const current = state[index]!;
        // Measured with the letter's own offset taken back out.
        current.cx = box.left + box.width / 2 + window.scrollX - current.x;
        current.cy = box.top + box.height / 2 + window.scrollY - current.y;
      });
    };
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(heading);
    window.addEventListener("resize", measure);
    // The web font can land after the first measure and move every letter.
    void document.fonts?.ready.then(measure);

    const pointer = { x: -1e4, y: -1e4 };
    let frame = 0;

    const step = () => {
      frame = 0;
      let moving = false;
      letters.forEach((letter, index) => {
        const current = state[index]!;
        const dx = current.cx - pointer.x;
        const dy = current.cy - pointer.y;
        const distance = Math.hypot(dx, dy);
        let tx = 0;
        let ty = 0;
        if (distance < RADIUS && distance > 0.01) {
          const force = (1 - distance / RADIUS) ** 2 * PUSH;
          tx = (dx / distance) * force;
          ty = (dy / distance) * force;
        }
        current.x += (tx - current.x) * EASE;
        current.y += (ty - current.y) * EASE;
        if (Math.abs(tx - current.x) > 0.05 || Math.abs(ty - current.y) > 0.05) moving = true;
        letter.style.transform =
          Math.abs(current.x) < 0.05 && Math.abs(current.y) < 0.05
            ? ""
            : `translate3d(${current.x.toFixed(2)}px, ${current.y.toFixed(2)}px, 0)`;
      });
      if (moving) frame = requestAnimationFrame(step);
    };

    const wake = () => {
      if (!frame) frame = requestAnimationFrame(step);
    };
    const onMove = (event: PointerEvent) => {
      pointer.x = event.pageX;
      pointer.y = event.pageY;
      wake();
    };
    const onLeave = () => {
      pointer.x = -1e4;
      pointer.y = -1e4;
      wake();
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);

    return () => {
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      resize.disconnect();
      window.removeEventListener("resize", measure);
      if (frame) cancelAnimationFrame(frame);
      for (const letter of letters) letter.style.transform = "";
    };
  }, [text]);

  const words = text.split(" ");

  return (
    <h1 ref={headingRef} id={id} aria-label={text} className={className}>
      {words.map((word, wordIndex) => (
        <React.Fragment key={wordIndex}>
          {wordIndex > 0 ? " " : null}
          <span aria-hidden="true" className="inline-block whitespace-nowrap">
            {Array.from(word).map((letter, letterIndex) => (
              <span key={letterIndex} data-letter="" className="inline-block">
                {letter}
              </span>
            ))}
          </span>
        </React.Fragment>
      ))}
    </h1>
  );
}
