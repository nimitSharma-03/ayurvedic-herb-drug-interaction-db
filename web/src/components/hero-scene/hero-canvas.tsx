"use client";

import * as React from "react";
import { Canvas } from "@react-three/fiber";
import { NeutralToneMapping } from "three";

import { useTheme } from "@/components/theme-toggle";

import { readPalette } from "./palette";
import { HeroStage } from "./scene";
import { initHeroStudio } from "./studio";

/**
 * The WebGL half of the hero visual, and the only thing in the dynamic chunk.
 *
 * Nothing else imports this file directly: hero-visual.tsx loads it with
 * next/dynamic and `ssr: false`, which is what keeps three.js, the fiber
 * renderer and Theatre.js out of the first response and out of every other
 * page's bundle.
 */
export default function HeroCanvas({
  running = true,
  onFirstFrame,
}: {
  /** False once the visual has scrolled away; the loop stops rather than
   *  orbiting out of sight. */
  running?: boolean;
  onFirstFrame?: () => void;
}) {
  // The theme lives on <html data-theme>. Subscribing to it is what re-reads
  // the tokens when a reader switches, so the materials follow the rest of the
  // page instead of carrying a second, light-only palette.
  //
  // Read during render rather than memoised: the tokens live in the DOM, not in
  // React, so the theme is not a dependency a memo could key on -- it is only
  // the reason this component renders again. This component renders a handful
  // of times in a visit, and nine getPropertyValue calls are cheaper than the
  // bookkeeping needed to avoid them.
  const [theme] = useTheme();
  const palette = readPalette(document.documentElement);

  const reducedMotion = useReducedMotion();

  React.useEffect(() => {
    void initHeroStudio();
  }, []);

  return (
    <Canvas
      className="h-full w-full"
      // Capped rather than uncapped: a 3x screen would quadruple the pixels
      // shaded for a scene whose edges are already soft.
      dpr={[1, 1.75]}
      camera={{ position: [0, 0.3, 4.3], fov: 32, near: 0.5, far: 20 }}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      // On demand means nothing is drawn until something changes. That is the
      // whole behaviour under prefers-reduced-motion -- one frame, of the
      // settled end of the entrance -- and it is also what happens whenever the
      // visual is scrolled out of the way.
      frameloop={reducedMotion || !running ? "demand" : "always"}
      onCreated={({ gl }) => {
        // Neutral rather than the default filmic curve, which pulls the greens
        // and the indigo away from the palette they were taken from.
        gl.toneMapping = NeutralToneMapping;
      }}
      // Decorative, and sitting over the hero text's column: it must never take
      // a click or a scroll gesture away from the page.
      style={{ pointerEvents: "none" }}
      aria-hidden="true"
    >
      <HeroStage
        palette={palette}
        dark={theme === "dark"}
        reducedMotion={reducedMotion}
        onFirstFrame={onFirstFrame}
      />
    </Canvas>
  );
}

/**
 * Whether the reader has asked for less motion.
 *
 * Read synchronously on the first render rather than in an effect: this module
 * only ever runs in the browser, and settling it before the first frame means
 * no motion is shown at all, not one frame of it.
 */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(
    () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
  );

  React.useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!query) return;
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return reduced;
}
