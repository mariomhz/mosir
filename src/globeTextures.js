import * as THREE from "three";

/*
 * The globe is drawn from the same GeoJSON the outlines come from, rasterised
 * once into equirectangular canvases. That keeps the vector look, avoids
 * triangulating polygons onto a sphere, and gives three textures from one pass:
 * colour for the surface, a land mask for relief, and an id map for picking.
 */

export const PALETTE = {
  ocean: "#0b0f14",
  land: "#d8d8d8",
  coast: "#f2f2f2",
  border: "rgba(90,110,130,0.85)",
};

function makeCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function project(lon, lat, width, height) {
  return [((lon + 180) / 360) * width, ((90 - lat) / 180) * height];
}

function geometriesOf(feature) {
  const geom = feature.geometry;
  if (!geom) return [];
  if (geom.type === "Polygon") return [geom.coordinates];
  if (geom.type === "MultiPolygon") return geom.coordinates;
  return [];
}

/*
 * Rings that cross the antimeridian arrive with longitude jumping from +179 to
 * -179, which as a straight line would smear all the way back across the map.
 * Unwrapping keeps the path continuous by carrying a +/-360 offset, and the
 * copies at +/-360 put the piece that ran off one edge back on the other.
 * Skipping these instead would drop Afro-Eurasia, which is one ring spanning
 * more than half the world.
 */
function unwrapRing(ring) {
  const out = [];
  let offset = 0;
  let prevLon = null;
  for (const [lon, lat] of ring) {
    if (prevLon !== null) {
      const delta = lon - prevLon;
      if (delta > 180) offset -= 360;
      else if (delta < -180) offset += 360;
    }
    out.push([lon + offset, lat]);
    prevLon = lon;
  }
  return out;
}

const WRAP_OFFSETS = [-360, 0, 360];

function traceRing(ctx, ring, width, height, shift) {
  ring.forEach(([lon, lat], i) => {
    const [x, y] = project(lon + shift, lat, width, height);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
}

function tracePolygon(ctx, polygon, width, height) {
  let drew = false;
  for (const ring of polygon) {
    if (ring.length < 3) continue;
    const unwrapped = unwrapRing(ring);
    for (const shift of WRAP_OFFSETS) {
      traceRing(ctx, unwrapped, width, height, shift);
    }
    drew = true;
  }
  return drew;
}

function fillFeatures(ctx, features, width, height, fillStyle) {
  ctx.fillStyle = fillStyle;
  for (const feature of features) {
    for (const polygon of geometriesOf(feature)) {
      ctx.beginPath();
      // "evenodd" so inner rings punch holes, which is how GeoJSON encodes
      // lakes and enclaves.
      if (tracePolygon(ctx, polygon, width, height)) ctx.fill("evenodd");
    }
  }
}

function strokeFeatures(ctx, features, width, height, strokeStyle, lineWidth) {
  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  for (const feature of features) {
    const geom = feature.geometry;
    if (!geom) continue;
    const lines =
      geom.type === "LineString"
        ? [geom.coordinates]
        : geom.type === "MultiLineString"
        ? geom.coordinates
        : geom.type === "Polygon"
        ? geom.coordinates
        : geom.type === "MultiPolygon"
        ? geom.coordinates.flat()
        : [];

    for (const line of lines) {
      if (line.length < 2) continue;
      const unwrapped = unwrapRing(line);
      for (const shift of WRAP_OFFSETS) {
        ctx.beginPath();
        unwrapped.forEach(([lon, lat], i) => {
          const [x, y] = project(lon + shift, lat, width, height);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
      }
    }
  }
}

/** Country index -> a colour we can read back exactly. Index 0 means ocean. */
export function indexToColor(index) {
  const id = index + 1;
  return [(id >> 16) & 255, (id >> 8) & 255, id & 255];
}

export function colorToIndex(r, g, b) {
  return ((r << 16) | (g << 8) | b) - 1;
}

export function buildGlobeTextures({ land, borders, countries, size }) {
  const width = size;
  const height = size / 2;

  // Surface colour: ocean, land fill, then coastlines and borders on top.
  const colorCanvas = makeCanvas(width, height);
  const colorCtx = colorCanvas.getContext("2d");
  colorCtx.fillStyle = PALETTE.ocean;
  colorCtx.fillRect(0, 0, width, height);
  // Edges live in the texture, not as separate line geometry. Lines floating
  // at a fixed radius get buried by the displaced terrain and poke through in
  // fragments, which is what the white speckling along every border was.
  fillFeatures(colorCtx, land.features, width, height, PALETTE.land);
  const edgeWidth = Math.max(1, size / 4096);
  strokeFeatures(colorCtx, borders.features, width, height, PALETTE.border, edgeWidth);
  strokeFeatures(colorCtx, land.features, width, height, PALETTE.coast, edgeWidth);

  // Land mask drives displacement, so it only needs to be black or white.
  const maskCanvas = makeCanvas(width / 2, height / 2);
  const maskCtx = maskCanvas.getContext("2d");
  maskCtx.fillStyle = "#000000";
  maskCtx.fillRect(0, 0, width / 2, height / 2);
  fillFeatures(maskCtx, land.features, width / 2, height / 2, "#ffffff");

  // Id map is never displayed, it is sampled to find out which country is
  // under the cursor, so it must not be smoothed or compressed.
  const idCanvas = makeCanvas(width / 2, height / 2);
  const idCtx = idCanvas.getContext("2d", { willReadFrequently: true });
  idCtx.fillStyle = "#000000";
  idCtx.fillRect(0, 0, width / 2, height / 2);
  countries.features.forEach((feature, index) => {
    const [r, g, b] = indexToColor(index);
    fillFeatures(idCtx, [feature], width / 2, height / 2, `rgb(${r},${g},${b})`);
  });

  const colorMap = new THREE.CanvasTexture(colorCanvas);
  colorMap.colorSpace = THREE.SRGBColorSpace;
  colorMap.anisotropy = 8;

  const displacementMap = new THREE.CanvasTexture(maskCanvas);

  const idMap = new THREE.CanvasTexture(idCanvas);
  idMap.magFilter = THREE.NearestFilter;
  idMap.minFilter = THREE.NearestFilter;
  idMap.generateMipmaps = false;

  const idData = idCtx.getImageData(0, 0, idCanvas.width, idCanvas.height);

  return {
    colorMap,
    displacementMap,
    idMap,
    idData,
    countryNames: countries.features.map(
      (f) => f.properties?.name ?? f.properties?.NAME ?? "Unknown"
    ),
  };
}
