import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  PerspectiveCamera,
  Points,
  Scene,
  ShaderMaterial,
  WebGLRenderer,
} from "three";

/**
 * The hero's particle field: slow pollen and embers drifting up through the
 * night, in vermilion and stone, with the camera easing a little toward the
 * pointer and the scroll position.
 *
 * Loaded only by hero-particles.tsx, through a dynamic import after the first
 * paint, so none of this is in the page's first JavaScript. Only the classes
 * named above are imported, which is what lets the bundler leave the rest of
 * the library out of the chunk.
 *
 * The drift is computed in the vertex shader from one time uniform, so a frame
 * costs the CPU a few uniform writes and nothing per particle.
 */

const COUNT = 900;
/** The box the particles live in, in world units. */
const SPREAD = { x: 18, y: 10, zNear: 5, zFar: -12 };
const MAX_PIXEL_RATIO = 1.5;

const VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uHeight;
  attribute float aSeed;
  attribute float aSize;
  attribute vec3 aColor;
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vec3 p = position;
    float t = uTime * (0.05 + aSeed * 0.05);
    // Rise slowly and wrap, with a lazy sideways wander.
    p.y = mod(position.y + uHeight * 0.5 + uTime * (0.08 + aSeed * 0.14), uHeight) - uHeight * 0.5;
    p.x += sin(t * 6.0 + aSeed * 40.0) * 0.7;
    p.z += cos(t * 4.0 + aSeed * 20.0) * 0.5;

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * uPixelRatio * (14.0 / -mv.z);

    // Twinkle, and fade out at the top and bottom of the box so nothing pops.
    float edge = 1.0 - smoothstep(0.35, 0.5, abs(p.y) / uHeight);
    vAlpha = (0.45 + 0.35 * sin(uTime * 0.6 + aSeed * 60.0)) * edge;
    vColor = aColor;
  }
`;

const FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.05, d);
    gl_FragColor = vec4(vColor, a * vAlpha);
  }
`;

/** Vermilion embers and stone pollen, as linear-ish RGB. */
const VERMILION: [number, number, number] = [0.92, 0.2, 0.12];
const STONE: [number, number, number] = [0.6, 0.58, 0.55];

export interface ParticleField {
  /** Start or resume the render loop. */
  play(): void;
  /** Stop the render loop; the last frame stays on the canvas. */
  pause(): void;
  /** Stop, release every GPU resource and remove the canvas. */
  dispose(): void;
}

export function createParticleField(host: HTMLElement): ParticleField {
  const renderer = new WebGLRenderer({
    alpha: true,
    antialias: false,
    powerPreference: "low-power",
  });
  const pixelRatio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
  renderer.setPixelRatio(pixelRatio);
  renderer.setClearColor(0x000000, 0);

  const canvas = renderer.domElement;
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.position = "absolute";
  canvas.style.inset = "0";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.pointerEvents = "none";
  host.appendChild(canvas);

  const scene = new Scene();
  const camera = new PerspectiveCamera(55, 1, 0.1, 60);
  camera.position.set(0, 0, 12);

  const positions = new Float32Array(COUNT * 3);
  const colors = new Float32Array(COUNT * 3);
  const seeds = new Float32Array(COUNT);
  const sizes = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i += 1) {
    positions[i * 3] = (Math.random() - 0.5) * SPREAD.x * 2;
    positions[i * 3 + 1] = (Math.random() - 0.5) * SPREAD.y * 2;
    positions[i * 3 + 2] = SPREAD.zFar + Math.random() * (SPREAD.zNear - SPREAD.zFar);
    // About one in four is an ember; the rest is pollen.
    const color = Math.random() < 0.26 ? VERMILION : STONE;
    colors.set(color, i * 3);
    seeds[i] = Math.random();
    sizes[i] = 1.2 + Math.random() * 2.6;
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("aColor", new BufferAttribute(colors, 3));
  geometry.setAttribute("aSeed", new BufferAttribute(seeds, 1));
  geometry.setAttribute("aSize", new BufferAttribute(sizes, 1));

  const material = new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: pixelRatio },
      uHeight: { value: SPREAD.y * 2 },
    },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });

  scene.add(new Points(geometry, material));

  /* Size follows the host, not the window, so the hero's own height rules. */
  const resize = () => {
    const width = host.clientWidth || 1;
    const height = host.clientHeight || 1;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  resize();
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(host);

  /* Where the camera is easing toward: the pointer, and how far down the page
     the reader is. Eased each frame so it never jumps. */
  const target = { x: 0, y: 0 };
  const onPointer = (event: PointerEvent) => {
    target.x = (event.clientX / window.innerWidth - 0.5) * 1.6;
    target.y = -(event.clientY / window.innerHeight - 0.5) * 1.0;
  };
  window.addEventListener("pointermove", onPointer, { passive: true });

  let frame = 0;
  let last = 0;
  let elapsed = 0;

  const render = (now: number) => {
    frame = requestAnimationFrame(render);
    // Clamp the step, so a tab that was paused does not jump the field ahead.
    const delta = last ? Math.min((now - last) / 1000, 0.1) : 0;
    last = now;
    elapsed += delta;

    const scrollShift = Math.min(window.scrollY / Math.max(window.innerHeight, 1), 1.5);
    camera.position.x += (target.x - camera.position.x) * 0.03;
    camera.position.y += (target.y - scrollShift * 1.6 - camera.position.y) * 0.05;
    camera.lookAt(0, -scrollShift * 0.8, 0);

    material.uniforms.uTime!.value = elapsed;
    renderer.render(scene, camera);
  };

  return {
    play() {
      if (frame) return;
      last = 0;
      frame = requestAnimationFrame(render);
    },
    pause() {
      if (!frame) return;
      cancelAnimationFrame(frame);
      frame = 0;
    },
    dispose() {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      window.removeEventListener("pointermove", onPointer);
      resizeObserver.disconnect();
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}
