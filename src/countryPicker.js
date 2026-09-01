import * as THREE from "three";
import { colorToIndex } from "./globeTextures.js";

/*
 * Which country is under the cursor is answered by reading one pixel out of
 * the id map, not by intersecting geometry. Raycast the sphere, turn the hit
 * point back into lat/lon, and index the buffer. Constant time, and it needs
 * no per-country meshes.
 */

const _localHit = new THREE.Vector3();

export function createCountryPicker({ globeMesh, idData, countryNames }) {
  const raycaster = new THREE.Raycaster();

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
    const hits = raycaster.intersectObject(globeMesh, false);
    if (hits.length === 0) return null;

    // The globe group rotates, so the hit has to come back into the mesh's
    // own space before it means anything in lat/lon.
    _localHit.copy(hits[0].point);
    globeMesh.worldToLocal(_localHit);

    const { lat, lon } = pointToLatLon(_localHit);
    const index = sample(lat, lon);
    if (index < 0 || index >= countryNames.length) return null;

    return { index, name: countryNames[index] };
  }

  return { pick };
}
