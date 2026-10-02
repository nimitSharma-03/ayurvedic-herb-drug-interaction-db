import {
  type BufferGeometry,
  ExtrudeGeometry,
  Shape,
} from "three";

/**
 * The leaf, built as geometry rather than drawn on a texture.
 *
 * Two mirrored cubic curves give a pointed oval, widest below the middle, which
 * is the silhouette of the leaf in the project's own mark. It is extruded with
 * a bevel so every edge catches the key light softly instead of ending in a
 * hard rim, and then curled: a flat extrusion reads as a sticker, while a blade
 * with a slight fold across it reads as something grown.
 *
 * No texture, no imported model. One shape, one small displacement pass.
 */

/** Half the blade's length and the widest half-width, in scene units. */
const REACH = 0.84;

/**
 * The fold, as a depth offset for a point on the blade.
 *
 * Quadratic across the blade so the two edges lift evenly away from the midrib,
 * and much gentler along it so the tip and the base only just dip back.
 */
function fold(x: number, y: number): number {
  return -0.46 * x * x - 0.05 * y * y;
}

function curl(geometry: BufferGeometry, lift: number): BufferGeometry {
  const position = geometry.attributes.position!;
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const y = position.getY(i);
    position.setZ(i, position.getZ(i) + fold(x, y) + lift);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

export function buildBladeGeometry(): BufferGeometry {
  const blade = new Shape();
  blade.moveTo(0, -REACH);
  blade.bezierCurveTo(0.52, -0.42, 0.46, 0.34, 0, REACH);
  blade.bezierCurveTo(-0.46, 0.34, -0.52, -0.42, 0, -REACH);

  const geometry = new ExtrudeGeometry(blade, {
    depth: 0.04,
    bevelEnabled: true,
    bevelThickness: 0.032,
    bevelSize: 0.032,
    bevelSegments: 3,
    curveSegments: 30,
  });
  // The extrusion runs from z=0 forwards, so half the depth and both bevels
  // come back to put the blade's own middle on z=0.
  geometry.translate(0, 0, -0.02);
  return curl(geometry, 0);
}

/**
 * The midrib: the same fold applied to a long thin lens, floated just clear of
 * the blade's front face so it stands as a raised ridge rather than a stripe.
 */
export function buildMidribGeometry(): BufferGeometry {
  const rib = new Shape();
  rib.moveTo(0, -REACH + 0.04);
  rib.bezierCurveTo(0.035, -0.3, 0.03, 0.3, 0, REACH - 0.07);
  rib.bezierCurveTo(-0.03, 0.3, -0.035, -0.3, 0, -REACH + 0.04);

  const geometry = new ExtrudeGeometry(rib, {
    depth: 0.022,
    bevelEnabled: true,
    bevelThickness: 0.012,
    bevelSize: 0.012,
    bevelSegments: 2,
    curveSegments: 24,
  });
  geometry.translate(0, 0, -0.011);
  return curl(geometry, 0.052);
}
