import * as THREE from "three";
import { colorToIndex } from "./globeTextures.js";

/*
 * Which country is under the cursor is answered by reading one pixel out of
 * the id map, not by intersecting geometry. Work out where the ray meets the
 * globe, turn that point back into lat/lon, and index the buffer. Constant
 * time, and it needs no per-country meshes.
 */

const _localHit = new THREE.Vector3();

export function createCountryPicker({ globeMesh, idData, countryNames, radius = 2 }) {
  const raycaster = new THREE.Raycaster();

  /*
   * The globe is a sphere centred on the origin, so where a ray meets it is a
   * quadratic, not a search. Handing the mesh to the raycaster instead meant
   * testing all 262,144 triangles of the displaced sphere on every single
   * mouse move, in JavaScript, on the CPU.
   *
   * That is why this was unusable on a desktop and fine on a phone: a mouse
   * fires pointermove constantly while it sits over the canvas, whereas touch
   * only fires it mid drag, so the phone almost never paid the cost.
   */
  const sphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), radius);

  /** Inverse of latLonToVec3 in languageMarkers.js. */
  function pointToLatLon(point) {
    const v = point.clone().normalize();
    const lat = Math.asin(v.y) * (180 / Math.PI);
    const lon = -Math.atan2(v.z, v.x) * (180 / Math.PI);
    return { lat, lon };
  }

  function sample(lat, lon) {
    const u = (lon + 180) / 360;
    const v = (90 - lat) / 180;
    const x = Math.min(idData.width - 1, Math.max(0, Math.floor(u * idData.width)));
    const y = Math.min(idData.height - 1, Math.max(0, Math.floor(v * idData.height)));
    const offset = (y * idData.width + x) * 4;
    const d = idData.data;
    return colorToIndex(d[offset], d[offset + 1], d[offset + 2]);
  }

  /** Returns { index, name } for the country under the pointer, or null. */
  function pick(ndc, camera) {
    raycaster.setFromCamera(ndc, camera);
    if (!raycaster.ray.intersectSphere(sphere, _localHit)) return null;

    // The globe group rotates, so the hit has to come back into the mesh's
    // own space before it means anything in lat/lon.
    globeMesh.worldToLocal(_localHit);

    const { lat, lon } = pointToLatLon(_localHit);
    const index = sample(lat, lon);
    if (index < 0 || index >= countryNames.length) return null;

    return { index, name: countryNames[index] };
  }

  return { pick };
}
