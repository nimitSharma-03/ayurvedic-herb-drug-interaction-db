"use client";

import * as React from "react";
import { ContactShadows } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import type { Group, Mesh, MeshStandardMaterial } from "three";

import { buildBladeGeometry, buildMidribGeometry } from "./leaf-geometry";
import type { HeroPalette } from "./palette";
import {
  ENTRANCE_SECONDS,
  capsuleObject,
  heroSheet,
  leafObject,
  stageObject,
} from "./sheet";

/**
 * The hero composition: one leaf and one capsule, each on its own, travelling
 * the same circle around the same centre.
 *
 * That is the whole picture this project is about, and it is drawn with care
 * about what it must not say. The two bodies stay separate and never touch:
 * nothing here merges a herb and a medicine into a third thing. They share
 * only the centre they both move around, which is the question a reader
 * arrives with -- two systems, one answer.
 */

/** How far each piece sits from the shared centre, in scene units. */
const ORBIT_RADIUS = 1.25;

/** Radians a second, once the entrance has blended the idle motion in. */
const IDLE_RATE = 0.17;

/** How far a piece rises and falls as it goes round, twice per turn. */
const WEAVE = 0.16;

/** The circle is seen from a little above and tipped, never face-on. */
const PLANE_TILT_X = 0.32;
const PLANE_TILT_Z = 0.11;

/** The traced circle, faint on purpose: it anchors the pair, not the eye. */
const RING_OPACITY = 0.4;

type PieceValue = typeof leafObject.value;

export function HeroStage({
  palette,
  dark,
  reducedMotion,
  onFirstFrame,
}: {
  palette: HeroPalette;
  /** The dark theme needs a different shadow, and only a different shadow. */
  dark: boolean;
  reducedMotion: boolean;
  onFirstFrame?: () => void;
}) {
  const leaf = React.useRef<Group>(null);
  const capsule = React.useRef<Group>(null);
  const ring = React.useRef<Mesh>(null);

  const elapsed = React.useRef(0);
  const angle = React.useRef(0);
  const announced = React.useRef(false);

  const blade = React.useMemo(() => buildBladeGeometry(), []);
  const midrib = React.useMemo(() => buildMidribGeometry(), []);
  React.useEffect(
    () => () => {
      blade.dispose();
      midrib.dispose();
    },
    [blade, midrib],
  );

  useFrame((_, delta) => {
    // A tab coming back from the background hands over one enormous delta.
    // Clamping it means the entrance resumes from where it left off rather
    // than jumping to the end, and the orbit never lurches.
    const step = Math.min(delta, 1 / 20);

    elapsed.current = reducedMotion
      ? ENTRANCE_SECONDS
      : Math.min(elapsed.current + step, ENTRANCE_SECONDS);

    // Theatre.js is scrubbed from the render loop rather than played on its own
    // clock, so the keyframed values and the idle orbit are read in the same
    // frame and can never disagree about where a piece is.
    heroSheet.sequence.position = elapsed.current;

    const stage = stageObject.value;
    const leafValues = leafObject.value;
    const capsuleValues = capsuleObject.value;

    if (!reducedMotion) angle.current += step * IDLE_RATE * stage.idle;

    place(leaf.current, angle.current, leafValues, stage.lift, 1);
    place(capsule.current, angle.current + Math.PI, capsuleValues, stage.lift, -1);

    if (leaf.current) {
      leaf.current.rotation.set(
        Math.sin(angle.current * 2) * 0.09,
        -angle.current + leafValues.turn,
        0.26 + Math.sin(angle.current) * 0.1,
      );
    }
    if (capsule.current) {
      capsule.current.rotation.set(
        Math.sin(angle.current * 2) * 0.07,
        -angle.current + capsuleValues.turn,
        -0.86,
      );
    }

    setOpacity(leaf.current, leafValues.opacity);
    setOpacity(capsule.current, capsuleValues.opacity);

    const ringMaterial = ring.current?.material as MeshStandardMaterial | undefined;
    if (ringMaterial) ringMaterial.opacity = RING_OPACITY * stage.ring;

    if (!announced.current) {
      announced.current = true;
      onFirstFrame?.();
    }
  });

  return (
    <>
      {/* Key, fill, and a warm rim from behind: the three-light studio set-up
          that the smooth renders this is modelled on use. No shadow map is
          asked of any of them; the only shadow here is the contact one.

          The key and the fill are white in both themes. Light is light: it is
          the materials that carry the palette, and tinting the lamps with
          surface tokens instead turned every lamp off in the dark theme, where
          those tokens are nearly black. The rim keeps the amber accent, which
          is a warm colour in both themes and is doing a lamp's job. */}
      <ambientLight intensity={1.4} />
      <directionalLight position={[2.6, 3.4, 2.4]} intensity={3.3} />
      <directionalLight position={[-3.2, 0.7, -1.6]} intensity={1.0} />
      <directionalLight
        position={[-1.6, 1.3, -2.4]}
        intensity={0.75}
        color={palette["--color-mechanism"]}
      />

      <group rotation={[PLANE_TILT_X, 0, PLANE_TILT_Z]}>
        <mesh ref={ring} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[ORBIT_RADIUS, 0.009, 6, 96]} />
          <meshBasicMaterial
            color={palette["--color-line"]}
            transparent
            opacity={RING_OPACITY}
            toneMapped={false}
          />
        </mesh>

        <group ref={leaf}>
          <mesh geometry={blade} scale={0.72}>
            <meshStandardMaterial
              color={palette["--color-herb"]}
              roughness={0.62}
              metalness={0}
            />
          </mesh>
          <mesh geometry={midrib} scale={0.72}>
            <meshStandardMaterial
              color={palette["--color-herb"]}
              roughness={0.3}
              metalness={0}
            />
          </mesh>
          {/* The stalk, short enough to read as one and no longer. */}
          <mesh position={[0.028, -0.67, 0]} rotation={[0, 0, 0.14]}>
            <capsuleGeometry args={[0.022, 0.2, 2, 8]} />
            <meshStandardMaterial
              color={palette["--color-ink-2"]}
              roughness={0.7}
              metalness={0}
            />
          </mesh>
        </group>

        <group ref={capsule} scale={1.12}>
          {/* Body and sleeve, the two pieces a real capsule is made of. The
              sleeve is a hair wider and stops at the middle, so the join reads
              as a join rather than as a painted line. */}
          <mesh>
            <capsuleGeometry args={[0.3, 0.6, 8, 28]} />
            <meshPhysicalMaterial
              color={palette["--color-surface"]}
              roughness={0.44}
              metalness={0}
              clearcoat={0.3}
              clearcoatRoughness={0.4}
            />
          </mesh>
          <mesh position={[0, 0.15, 0]}>
            <cylinderGeometry args={[0.313, 0.313, 0.3, 28, 1]} />
            <meshPhysicalMaterial
              color={palette["--color-drug"]}
              roughness={0.46}
              metalness={0}
              clearcoat={0.28}
              clearcoatRoughness={0.4}
            />
          </mesh>
          <mesh position={[0, 0.3, 0]}>
            <sphereGeometry args={[0.313, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshPhysicalMaterial
              color={palette["--color-drug"]}
              roughness={0.46}
              metalness={0}
              clearcoat={0.28}
              clearcoatRoughness={0.4}
            />
          </mesh>
        </group>
      </group>

      {/* The one thing that makes the pair look placed rather than floating.
          Contact shadows rather than a shadow map: no light has to render a
          depth pass, and the edge stays soft at every distance.

          In the light theme the shadow is tinted with the ink token, which is
          what every other shadow on the page is mixed from. In the dark theme
          it is black: the ink token inverts to a near-white there, and a shadow
          drawn in it reads as a pool of light under the pair. */}
      <ContactShadows
        position={[0, -1.24, 0]}
        scale={4.6}
        resolution={256}
        blur={2.6}
        far={2.6}
        opacity={dark ? 0.5 : 0.24}
        color={dark ? "#000000" : palette["--color-ink"]}
        frames={reducedMotion ? 1 : Infinity}
      />
    </>
  );
}

/**
 * Put a piece on the circle, then add the entrance offset on top.
 *
 * `weave` is +1 or -1: the two pieces rise and fall in opposition as they go
 * round, which is what makes the pair look like it is moving together without
 * either of them ever reaching the other.
 */
function place(
  group: Group | null,
  at: number,
  piece: PieceValue,
  lift: number,
  weave: number,
) {
  if (!group) return;
  group.position.set(
    Math.cos(at) * ORBIT_RADIUS + piece.drift.x,
    Math.sin(at * 2) * WEAVE * weave + lift + piece.drift.y,
    Math.sin(at) * ORBIT_RADIUS + piece.drift.z,
  );
  group.scale.setScalar(piece.scale);
}

/**
 * Fade a piece in.
 *
 * `transparent` is switched back off once a piece is fully opaque, so the
 * settled scene is drawn in the opaque pass where depth sorting is exact.
 */
function setOpacity(group: Group | null, opacity: number) {
  if (!group) return;
  group.visible = opacity > 0.002;
  group.traverse((child) => {
    const material = (child as Mesh).material as MeshStandardMaterial | undefined;
    if (!material || Array.isArray(material)) return;
    const solid = opacity > 0.998;
    material.transparent = !solid;
    material.depthWrite = solid;
    material.opacity = opacity;
  });
}
