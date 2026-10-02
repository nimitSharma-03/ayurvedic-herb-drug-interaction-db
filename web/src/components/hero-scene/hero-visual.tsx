"use client";

import * as React from "react";
import dynamic from "next/dynamic";

import { cn } from "@/lib/utils";

import { HeroEmblem } from "./hero-emblem";

/**
 * The 3D scene is loaded on its own, in the browser only.
 *
 * `ssr: false` is not a convenience here: three.js has no business running on
 * the server, and splitting it out is what keeps it off every other page and
 * out of the first response the reader waits for.
 */
const HeroCanvas = dynamic(() => import("./hero-canvas"), { ssr: false });

/**
 * The hero visual: a flat emblem that the 3D scene fades in over.
 *
 * The emblem is server-rendered at the final size, so the hero is composed in
 * the first paint and nothing on the page moves when the canvas arrives. The
 * canvas is layered over it, and the emblem is faded out once a frame has
 * actually been drawn -- not when the chunk loads, which would blank the space
 * for however long the first shader compile takes.
 *
 * Every way this can fail ends in the same place. No WebGL, a chunk that never
 * arrives, a context that cannot be created: the emblem is already on screen
 * and simply stays there.
 */
export function HeroVisual({ className }: { className?: string }) {
  const supported = useWebGL();
  const [state, setState] = React.useState<"waiting" | "drawn" | "failed">("waiting");
  const container = React.useRef<HTMLDivElement>(null);
  const onScreen = useOnScreen(container);

  const live = supported && state === "drawn";
  const showCanvas = supported && state !== "failed";

  return (
    <div
      ref={container}
      className={cn("relative isolate w-full", className)}
      data-testid="hero-visual"
      data-hero-status={showCanvas ? state : "flat"}
      data-hero-running={showCanvas && onScreen ? "true" : "false"}
    >
      <HeroEmblem
        className={cn(
          "absolute inset-0 h-full w-full transition-opacity duration-500 ease-out",
          live ? "opacity-0" : "opacity-100",
        )}
      />
      {showCanvas ? (
        <CanvasBoundary onFailure={() => setState("failed")}>
          <div className="absolute inset-0">
            <HeroCanvas running={onScreen} onFirstFrame={() => setState("drawn")} />
          </div>
        </CanvasBoundary>
      ) : null}
    </div>
  );
}

/**
 * Whether the visual is anywhere near the viewport.
 *
 * A scene that orbits forever would otherwise keep a GPU and a render loop busy
 * for a reader who has scrolled past it and is reading an answer further down
 * the page. The observer is kept deliberately generous -- it starts the loop
 * before the visual is on screen -- so coming back to the top never shows a
 * frozen frame.
 *
 * Without IntersectionObserver the answer is a plain yes, which is the old
 * behaviour rather than a broken one.
 */
function useOnScreen(ref: React.RefObject<HTMLElement | null>): boolean {
  const [onScreen, setOnScreen] = React.useState(true);

  React.useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) setOnScreen(entry.isIntersecting);
      },
      { rootMargin: "200px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);

  return onScreen;
}

/**
 * Whether this browser can give us a WebGL context at all.
 *
 * Settled through an external store rather than in an effect, for the same
 * reason the theme is: the server has no answer, the first client render must
 * agree with the server's markup, and after that the real answer is read once
 * and kept. A machine that cannot draw the scene never downloads three.js to
 * find that out.
 */
function useWebGL(): boolean {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Nothing can change this answer during a visit, so there is nothing to
 *  subscribe to. */
function subscribe() {
  return () => {};
}

let support: boolean | null = null;

function getSnapshot(): boolean {
  // Cached because getSnapshot is called on every render and has to return the
  // same value each time, and because probing costs a real GL context.
  if (support === null) support = probe();
  return support;
}

function getServerSnapshot(): boolean {
  return false;
}

/** The test context is thrown away immediately; some drivers allow only a
 *  handful of them at a time. */
function probe(): boolean {
  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (!context) return false;
    context.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}

interface BoundaryProps {
  children: React.ReactNode;
  onFailure: () => void;
}

/**
 * Anything the 3D scene throws stops here.
 *
 * A failed chunk, a lost context or a driver that gives up mid-scene is a
 * reason to show the flat hero, never a reason to take the home page down with
 * it.
 */
class CanvasBoundary extends React.Component<BoundaryProps, { failed: boolean }> {
  constructor(props: BoundaryProps) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch() {
    this.props.onFailure();
  }

  override render() {
    return this.state.failed ? null : this.props.children;
  }
}
