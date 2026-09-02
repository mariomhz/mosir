import * as THREE from "three";
import { OrbitControls } from 'jsm/controls/OrbitControls.js';
import getStarfield from "./src/getStarfield.js";
import { createMarkers, latLonToVec3, LANGUAGES } from "./src/languageMarkers.js";
import { buildGlobeTextures } from "./src/globeTextures.js";
import { createAtmosphere } from "./src/atmosphere.js";
import { createCountryPicker } from "./src/countryPicker.js";
import { subsolarPoint } from "./src/sunPosition.js";

/*
 * Switches for looking at a slow machine, both off unless asked for:
 *   ?stats   frame timings and the name of the GPU doing the work
 *   ?half    pins the resolution to half, skipping the automatic watch
 */
const PARAMS = new URLSearchParams(location.search);
const SHOW_STATS = PARAMS.has('stats');
const HALF_RES = PARAMS.has('half');

const w = window.innerWidth;
const h = window.innerHeight;
const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(75, w / h, 1, 100);
camera.position.z = 5;
/*
 * Capped at 2 because rendering a displaced sphere at 3x costs more than it
 * gains. Lowered further by the quality watch below if the machine cannot
 * keep up with it.
 */
const BASE_PIXEL_RATIO = Math.min(window.devicePixelRatio || 1, 2);
let qualityScale = 1;

/*
 * Multisampling is charged per sample across the entire framebuffer. A 4K
 * display at 1.5 device pixels is 8.3 million of them before anything is
 * drawn, and asking for 4x MSAA on top quadruples the samples the card has to
 * write and resolve. At that pixel density the aliasing it removes is already
 * smaller than a pixel, so it is paying a lot to fix something nobody can
 * see. Below that it is cheap and worth having.
 *
 * powerPreference is separate: on a machine with both an integrated chip and
 * a discrete card, the default lets the browser choose, and it often picks
 * the integrated one.
 */
const FRAMEBUFFER_PIXELS = w * h * BASE_PIXEL_RATIO * BASE_PIXEL_RATIO;
const renderer = new THREE.WebGLRenderer({
  antialias: FRAMEBUFFER_PIXELS < 4e6,
  powerPreference: "high-performance",
});

/*
 * Without this the framebuffer is one device pixel per CSS pixel, so on a
 * phone at devicePixelRatio 3 the whole scene was rendered at a third of the
 * screen resolution and upscaled. That, not the texture size, is what made the
 * borders look pixelated. Capped at 2 because rendering a displaced sphere at
 * 3x costs more than it gains.
 */
function pixelRatio() {
  const ratio = HALF_RES ? BASE_PIXEL_RATIO * 0.5 : BASE_PIXEL_RATIO;
  return ratio * qualityScale;
}

renderer.setPixelRatio(pixelRatio());
renderer.setSize(w, h);
document.body.appendChild(renderer.domElement);

/*
 * Anisotropic filtering costs a texture sample per step, so asking for the
 * maximum the driver reports, usually 16, means up to sixteen reads per
 * fragment across the whole globe. Eight keeps the grazing angles sharp for
 * half the bandwidth, and the difference is not visible at this size.
 */
const ANISOTROPY = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);

/*
 * 4096 is what the phone runs, and the phone runs it smoothly. Desktop was on
 * 6144 from an attempt to fix blurry borders that turned out to be a pixel
 * ratio problem instead, so the extra 2.25x of texels was buying very little
 * and costing a slower load and a lot of texture bandwidth.
 */
const TEXTURE_SIZE = 4096;

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.minDistance = 3.5;
controls.maxDistance = 5;

const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth < 768;

const globeGroup = new THREE.Group();
scene.add(globeGroup);

const geometry = new THREE.SphereGeometry(2);
const lineMat = new THREE.LineBasicMaterial({
  color: 0xffffff,
  transparent: true,
  opacity: 0.15,
});
const edges = new THREE.EdgesGeometry(geometry, 1);
const line = new THREE.LineSegments(edges, lineMat);
globeGroup.add(line);

/*
 * Lit rather than MeshBasic, so the sphere actually shades and shows a
 * terminator instead of reading as a flat disc.
 *
 * The sun is the real one. Its direction is the subsolar point for the
 * current clock time, which is why the light hangs off the globe and not off
 * the scene: however the globe is turned or dragged, the lit half stays over
 * the countries that are in daylight right now.
 */
const sunDirection = new THREE.Vector3(0, 0, 1);
const sunLight = new THREE.DirectionalLight(0xfff4e6, 2.6);
globeGroup.add(sunLight);
// The target has to be in the graph for three to read its world matrix. Left
// at the origin, which is the globe's centre.
globeGroup.add(sunLight.target);
scene.add(new THREE.AmbientLight(0x2a3a4a, 1.1));

const SUN_DISTANCE = 50;
// Once a second. The sun crosses 0.004 degrees in that time, so nothing on
// screen ever steps, and it saves recomputing the almanac every frame.
const SUN_UPDATE_MS = 1000;
let lastSunUpdate = -Infinity;

function updateSun(date = new Date()) {
  const { lat, lon } = subsolarPoint(date);
  // The same projection the language pins use, so "over Tokyo" means the same
  // thing to the light as it does to a marker.
  sunDirection.copy(latLonToVec3(lat, lon, 1));
  sunLight.position.copy(sunDirection).multiplyScalar(SUN_DISTANCE);
}

updateSun();

/*
 * Open on the daylit side. The globe keeps turning and the terminator still
 * crosses it within the first minute, this only decides which face the very
 * first frame shows, which would otherwise be the middle of the night for a
 * good part of every day. The offset leaves the terminator near the limb
 * rather than putting the brightest point dead centre, where the sphere
 * flattens out.
 */
const OPENING_SUN_OFFSET_DEG = 35;
globeGroup.rotation.y = THREE.MathUtils.degToRad(
  -90 - subsolarPoint().lon + OPENING_SUN_OFFSET_DEG
);

const SPHERE_SEGMENTS = isMobile ? 256 : 512;
const solidSphereGeo = new THREE.SphereGeometry(1.99, SPHERE_SEGMENTS, SPHERE_SEGMENTS / 2);
// A 1x1 placeholder so the material always compiles with the map chunk in it.
// Without a map three never declares vMapUv, and the highlight code injected
// below references it, so the first frames would fail to compile.
const placeholderMap = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
placeholderMap.needsUpdate = true;

const solidSphereMat = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  roughness: 0.92,
  metalness: 0.0,
  map: placeholderMap,
  displacementScale: 0.0,
});

// Country highlighting rides along inside the standard material: the id map
// and the hovered id go in as uniforms, and matching pixels get tinted. No
// canvas redraw or texture upload when the hovered country changes.
const highlightUniforms = {
  // Points at the placeholder until the real id map is built; a null sampler
  // binds to whatever is on unit 0.
  uIdMap: { value: placeholderMap },
  uHighlightId: { value: -1.0 },
  uHighlightColor: { value: new THREE.Color(0xff4d4d) },
};

solidSphereMat.onBeforeCompile = (shader) => {
  shader.uniforms.uIdMap = highlightUniforms.uIdMap;
  shader.uniforms.uHighlightId = highlightUniforms.uHighlightId;
  shader.uniforms.uHighlightColor = highlightUniforms.uHighlightColor;

  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>
      uniform sampler2D uIdMap;
      uniform float uHighlightId;
      uniform vec3 uHighlightColor;`)
    .replace('#include <map_fragment>', `#include <map_fragment>
      // Nothing is hovered most of the time, and uHighlightId is the same for
      // every fragment in the draw call, so the whole lookup can be skipped
      // rather than sampling the id map once per pixel on screen.
      if (uHighlightId >= 0.0) {
        vec3 idTexel = texture2D(uIdMap, vMapUv).rgb;
        float id = floor(idTexel.r * 255.0 + 0.5) * 65536.0
                 + floor(idTexel.g * 255.0 + 0.5) * 256.0
                 + floor(idTexel.b * 255.0 + 0.5);
        if (abs(id - uHighlightId) < 0.5) {
          diffuseColor.rgb = mix(diffuseColor.rgb, uHighlightColor, 0.55);
        }
      }`);
};

const solidSphere = new THREE.Mesh(solidSphereGeo, solidSphereMat);
globeGroup.add(solidSphere);

// Shares the vector by reference, so moving the sun moves the glow with it.
const atmosphere = createAtmosphere({ radius: 2, sunDirection });
globeGroup.add(atmosphere);

const stars = getStarfield({ numStars: 1000 });
scene.add(stars);

const GLOBE_RADIUS = 2;
const markers = createMarkers(globeGroup, GLOBE_RADIUS);
const pinHeads = markers.map(m => m.head);

let countryPicker = null;

const loaderEl = document.getElementById('loader');
const loaderBarEl = document.getElementById('loader-bar');
const loaderFillEl = document.getElementById('loader-fill');
const loaderStatusEl = document.getElementById('loader-status');

function setLoaderProgress(fraction, label) {
  const clamped = Math.max(0, Math.min(1, fraction));
  loaderFillEl.style.transform = 'scaleX(' + clamped + ')';
  loaderBarEl.setAttribute('aria-valuenow', String(Math.round(clamped * 100)));
  if (label) loaderStatusEl.textContent = label;
}

function hideLoader() {
  loaderEl.classList.add('done');
  // Releases the landing copy, which has been sitting paused at the start of
  // its own fade in.
  document.body.classList.remove('loading');
  // Pulled out of the tree once it has faded so it can never swallow a click.
  // On a timer rather than transitionend, which does not fire when a reduced
  // motion setting has removed the transition.
  setTimeout(() => { loaderEl.hidden = true; }, 800);
  // Not immediately: the first frames after this are uploading textures and
  // compiling shaders, and judging the machine on those would knock the
  // quality down on hardware that is actually fine.
  setTimeout(startQualityWatch, 1200);
}

/*
 * Weighted by file size so the bar moves roughly in step with what is left to
 * download. Byte level progress is not usable here: Pages serves these
 * gzipped, so the reported content length is the compressed size and the
 * decompressed stream runs straight past it.
 */
const DATA_FILES = [
  { url: './geojson/ne_50m_land.json', weight: 0.69 },
  { url: './geojson/ne_50m_admin_0_boundary_lines_land.json', weight: 0.24 },
  { url: './geojson/countries.json', weight: 0.07 },
];

// Downloading owns the first third of the bar and rasterising the rest, which
// is roughly how the wait splits on a normal connection.
const DOWNLOAD_SHARE = 0.35;

function loadGeoData() {
  let done = 0;
  setLoaderProgress(0.02, 'Loading map data');

  return Promise.all(
    DATA_FILES.map(({ url, weight }) =>
      fetch(url).then((response) => {
        if (!response.ok) throw new Error(url + ' returned ' + response.status);
        return response.json();
      }).then((json) => {
        done += weight;
        setLoaderProgress(done * DOWNLOAD_SHARE);
        return json;
      })
    )
  );
}

// One pass over the GeoJSON produces everything: the surface texture, the
// land mask that raises the continents, and the id map used for picking.
// The vector coastlines stay on top so edges keep their crispness.
async function boot() {
  const [landJson, bordersJson, countriesJson] = await loadGeoData();

  const textures = await buildGlobeTextures({
    land: landJson,
    borders: bordersJson,
    countries: countriesJson,
    // iOS Safari caps total canvas area near 16.7M pixels, so 4096x2048 is
    // also the most a phone can take.
    size: TEXTURE_SIZE,
    maxAnisotropy: ANISOTROPY,
    onProgress: (fraction, label) =>
      setLoaderProgress(DOWNLOAD_SHARE + fraction * (1 - DOWNLOAD_SHARE), label),
  });

  solidSphereMat.map = textures.colorMap;
  solidSphereMat.displacementMap = textures.displacementMap;
  solidSphereMat.displacementScale = 0.035;
  solidSphereMat.needsUpdate = true;
  highlightUniforms.uIdMap.value = textures.idMap;

  countryPicker = createCountryPicker({
    globeMesh: solidSphere,
    idData: textures.idData,
    countryNames: textures.countryNames,
    radius: GLOBE_RADIUS,
  });

  // The textures are uploaded and the material recompiled on the first frame
  // that actually draws them. Uncovering before that lands shows the bare
  // white placeholder sphere for a beat.
  await new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve))
  );
  hideLoader();
}

boot().catch((error) => {
  console.error(error);
  setLoaderProgress(1, 'Could not load the map. Try reloading.');
  loaderEl.classList.add('failed');
});

const titleEl = document.getElementById('title');
const descriptionEl = document.getElementById('description');
const hintEl = document.getElementById('hint');
const infoCardEl = document.getElementById('info-card');
const infoCardTitleEl = document.getElementById('info-card-title');
const infoCardTextEl = document.getElementById('info-card-text');

let appState = "landing";

let autoRotate = true;
const AUTO_ROTATE_SPEED = 0.002;
let selectedIndex = -1;
let rotAnim = null;
let zoomAnim = null;
const ZOOM_CLOSE = 3.5;
const ZOOM_DEFAULT = 5;
const TITLE_MAX_SIZE = 28;
const TITLE_MIN_SIZE = 14;

const raycaster = new THREE.Raycaster();
const _globeSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 2);
const _globeHit = new THREE.Vector3();
const pointerDownPos = new THREE.Vector2();
let hoveredIndex = -1;


const HOVER_SCALE = 5.0;
const SELECTED_SCALE = 2.0;
const HOVER_SCREEN_RADIUS = isMobile ? 80 : 60;
const SCALE_LERP_SPEED = 0.12;
const BASE_SCALE_MOBILE = 2.5;

const markerTargetScales = markers.map(() => isMobile ? BASE_SCALE_MOBILE : 1.0);

raycaster.params.Points = { threshold: isMobile ? 0.15 : 0.1 };

const hitboxes = [];
if (isMobile) {
  markers.forEach((marker) => {
    const hitboxGeo = new THREE.SphereGeometry(0.035, 8, 8); // Much larger than visible pin
    const hitboxMat = new THREE.MeshBasicMaterial({
      visible: false // Invisible but still detectable by raycaster
    });
    const hitbox = new THREE.Mesh(hitboxGeo, hitboxMat);
    hitbox.position.copy(marker.tipPos);
    globeGroup.add(hitbox);
    hitboxes.push(hitbox);
  });
}

controls.target.set(1.5, -1.0, 0);
camera.position.set(1.5, -1.0, 3.5);
controls.enabled = false;
controls.update();

let transitionAnim = null;

/*
 * The landing flight drives the camera itself for two seconds. Selecting a
 * marker during it starts a second camera animation that the transition then
 * overwrites every frame, so the marker never actually gets flown to and its
 * card closes as soon as the shorter rotation ends. Anything that selects
 * from the landing state has to wait for the flight to land first.
 */
let pendingAfterTransition = null;

function startTransition() {
  if (appState !== "landing") return;
  appState = "transitioning";

  titleEl.classList.add('collapsed');
  descriptionEl.classList.add('hidden');
  hintEl.classList.add('hidden');

  const startTarget = controls.target.clone();
  const endTarget = new THREE.Vector3(0, 0, 0);
  const startCamPos = camera.position.clone();
  const startDist = startCamPos.clone().sub(startTarget).length();
  const endDist = ZOOM_DEFAULT;

  transitionAnim = {
    startTarget,
    endTarget,
    startCamPos,
    startDist,
    endDist,
    startTime: performance.now(),
    duration: 2000,
  };
}

renderer.domElement.addEventListener("pointerdown", (e) => {
  pointerDownPos.set(e.clientX, e.clientY);
});

renderer.domElement.addEventListener("pointerup", (e) => {
  const dx = e.clientX - pointerDownPos.x;
  const dy = e.clientY - pointerDownPos.y;
  if (dx * dx + dy * dy > 25) {
    // Actually dragged the globe, so the tour should get out of the way.
    stopTour();
    return;
  }

  const clickNDC = new THREE.Vector2(
    (e.clientX / window.innerWidth) * 2 - 1,
    -(e.clientY / window.innerHeight) * 2 + 1
  );
  raycaster.setFromCamera(clickNDC, camera);

  if (appState === "landing") {
    // Analytic, for the same reason the country picker is: there is no point
    // walking a quarter of a million triangles to find out whether a click
    // landed on a sphere.
    if (raycaster.ray.intersectSphere(_globeSphere, _globeHit)) {
      startTransition();
    }
    return;
  }


  if (appState === "transitioning") return;

  // A deliberate tap on the globe also ends the tour.
  stopTour();

  if (hoveredIndex >= 0) {
    selectMarker(hoveredIndex);
  } else {
    // On mobile, check hitboxes first for easier targeting
    const checkObjects = isMobile && hitboxes.length > 0 ? hitboxes : pinHeads;
    const hits = raycaster.intersectObjects(checkObjects, false);
    if (hits.length > 0) {
      const hitIndex = checkObjects.indexOf(hits[0].object);
      if (hitIndex >= 0) selectMarker(hitIndex);
    } else {
      deselectMarker();
    }
  }
});

renderer.domElement.addEventListener("pointermove", (e) => {
  if (appState !== "interactive") return;

  const cursorX = e.clientX;
  const cursorY = e.clientY;
  let closestIdx = -1;
  let closestDist = Infinity;

  camera.getWorldPosition(_camWorldPos);
  globeGroup.getWorldPosition(_globeWorldPos);

  markers.forEach((m, i) => {
    m.head.getWorldPosition(_markerWorldPos);
    const toMarker = _markerWorldPos.clone().sub(_globeWorldPos).normalize();
    const toCam = _camWorldPos.clone().sub(_globeWorldPos).normalize();
    if (toMarker.dot(toCam) < 0.1) return;

    const projected = _markerWorldPos.clone().project(camera);
    const sx = (projected.x * 0.5 + 0.5) * window.innerWidth;
    const sy = (-projected.y * 0.5 + 0.5) * window.innerHeight;

    const dx = cursorX - sx;
    const dy = cursorY - sy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < closestDist) {
      closestDist = dist;
      closestIdx = i;
    }
  });

  const newHovered = (closestDist < HOVER_SCREEN_RADIUS) ? closestIdx : -1;

  if (newHovered !== hoveredIndex) {
    const baseScale = isMobile ? BASE_SCALE_MOBILE : 1.0;

    if (hoveredIndex >= 0 && hoveredIndex !== selectedIndex) {
      markerTargetScales[hoveredIndex] = baseScale;
    }
    hoveredIndex = newHovered;

    if (hoveredIndex >= 0 && hoveredIndex !== selectedIndex) {
      markerTargetScales[hoveredIndex] = HOVER_SCALE;
    }
  }

  updateCountryHover(e);

  renderer.domElement.style.cursor = (hoveredIndex >= 0) ? 'pointer' : 'default';
});

const countryLabelEl = document.getElementById('country-label');
let hoveredCountry = -1;

function updateCountryHover(e) {
  if (!countryPicker) return;

  // A marker under the cursor wins; the country tint would only distract.
  if (hoveredIndex >= 0) {
    setHoveredCountry(null);
    return;
  }

  const ndc = new THREE.Vector2(
    (e.clientX / window.innerWidth) * 2 - 1,
    -(e.clientY / window.innerHeight) * 2 + 1
  );
  setHoveredCountry(countryPicker.pick(ndc, camera), e);
}

function setHoveredCountry(hit, e) {
  const index = hit ? hit.index : -1;
  if (index !== hoveredCountry) {
    hoveredCountry = index;
    highlightUniforms.uHighlightId.value = index >= 0 ? index + 1 : -1;
  }
  if (!countryLabelEl) return;

  if (hit && e) {
    countryLabelEl.textContent = hit.name;
    countryLabelEl.style.left = (e.clientX + 14) + 'px';
    countryLabelEl.style.top = (e.clientY + 14) + 'px';
    countryLabelEl.classList.remove('hidden');
  } else {
    countryLabelEl.classList.add('hidden');
  }
}

// --- Marker selection/deselection ---
function selectMarker(index) {
  const baseScale = isMobile ? BASE_SCALE_MOBILE : 1.0;

  if (selectedIndex >= 0) {
    markerTargetScales[selectedIndex] = baseScale;
  }

  if (hoveredIndex >= 0 && hoveredIndex !== index) {
    markerTargetScales[hoveredIndex] = baseScale;
  }
  hoveredIndex = -1;

  selectedIndex = index;
  if (index >= 0) {
    markerTargetScales[index] = isMobile ? BASE_SCALE_MOBILE * 1.5 : SELECTED_SCALE;
    rotateGlobeToMarker(index);
    startZoom(ZOOM_CLOSE);
    showInfoCard(index);
  }
  updateLanguageListActive();
}

function deselectMarker() {
  const baseScale = isMobile ? BASE_SCALE_MOBILE : 1.0;
  if (selectedIndex >= 0) {
    markerTargetScales[selectedIndex] = baseScale;
    startZoom(ZOOM_DEFAULT);
    hideInfoCard();
  }
  selectedIndex = -1;
  updateLanguageListActive();
}

function showInfoCard(index) {
  const lang = markers[index].lang;
  infoCardTitleEl.textContent = lang.name;
  infoCardTextEl.textContent = lang.description || '';
  infoCardEl.classList.remove('hidden');
}

function hideInfoCard() {
  infoCardEl.classList.add('hidden');
}

function updateInfoCardPosition() {
  if (selectedIndex < 0) return;

  const marker = markers[selectedIndex];
  const worldPos = new THREE.Vector3();
  marker.head.getWorldPosition(worldPos);

  const projected = worldPos.clone().project(camera);
  const screenX = (projected.x * 0.5 + 0.5) * window.innerWidth;
  const screenY = (-projected.y * 0.5 + 0.5) * window.innerHeight;

  const cardWidth = isMobile ? Math.min(260, window.innerWidth - 40) : 280;
  const cardHeight = infoCardEl.offsetHeight || 120;
  const margin = isMobile ? 10 : 20;

  let left, top;

  if (isMobile) {
    left = (window.innerWidth - cardWidth) / 2;
    top = window.innerHeight - cardHeight - margin - 60; // 60px from bottom for better visibility
  } else {

    left = screenX + margin;
    top = screenY - cardHeight / 2;

    if (left + cardWidth + margin > window.innerWidth) {
      left = screenX - cardWidth - margin;
    }

    top = Math.max(margin, Math.min(window.innerHeight - cardHeight - margin, top));
    left = Math.max(margin, left);
  }

  infoCardEl.style.left = left + 'px';
  infoCardEl.style.top = top + 'px';
}

function startZoom(targetDist) {
  controls.enableZoom = false;
  zoomAnim = {
    startDist: camera.position.length(),
    endDist: targetDist,
    startTime: performance.now(),
    duration: 1200,
  };
}

function rotateGlobeToMarker(index) {
  const marker = markers[index];
  const tipPos = marker.tipPos;
  const lang = marker.lang;
  const camAngle = Math.atan2(camera.position.x, camera.position.z);
  const markerAngle = Math.atan2(tipPos.x, tipPos.z);
  const endGlobeY = camAngle - markerAngle;
  const startGlobeY = globeGroup.rotation.y;
  const diffY = Math.atan2(Math.sin(endGlobeY - startGlobeY), Math.cos(endGlobeY - startGlobeY));
  const spherical = new THREE.Spherical().setFromVector3(camera.position);
  const startPhi = spherical.phi;
  const latRad = lang.lat * (Math.PI / 180);
  const endPhi = Math.PI / 2 - latRad; 

  rotAnim = {
    startGlobeY,
    endGlobeY: startGlobeY + diffY,
    startPhi,
    endPhi,
    startTime: performance.now(),
    duration: 1200,
  };
}

const _camWorldPos = new THREE.Vector3();
const _markerWorldPos = new THREE.Vector3();
const _globeWorldPos = new THREE.Vector3();

function updateBackfaceVisibility() {
  camera.getWorldPosition(_camWorldPos);
  globeGroup.getWorldPosition(_globeWorldPos);

  markers.forEach((m, i) => {
    m.head.getWorldPosition(_markerWorldPos);
    const toMarker = _markerWorldPos.clone().sub(_globeWorldPos).normalize();
    const toCam = _camWorldPos.clone().sub(_globeWorldPos).normalize();
    const dot = toMarker.dot(toCam);
    const opacity = THREE.MathUtils.smoothstep(dot, -0.1, 0.3);
    m.stalk.material.opacity = opacity * 0.8;
    m.head.material.opacity = opacity;

    // Only drop the selection when the marker has been turned away from by
    // hand. While the camera is still flying to it the marker is legitimately
    // behind the globe, and deselecting there closed the card before it
    // arrived. Japanese sits at 140 east, far from every other marker, so it
    // was always on the far side when picked and never got to show at all.
    if (i === selectedIndex && dot < 0 && !rotAnim) {
      deselectMarker();
    }
  });
}

function cubicEaseInOut(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function animate() {
  requestAnimationFrame(animate);
  const frameStart = performance.now();
  considerQuality(frameStart);

  const nowMs = performance.now();
  if (nowMs - lastSunUpdate >= SUN_UPDATE_MS) {
    lastSunUpdate = nowMs;
    updateSun();
  }

  if (transitionAnim) {
    const elapsed = performance.now() - transitionAnim.startTime;
    const t = Math.min(elapsed / transitionAnim.duration, 1.0);
    const ease = cubicEaseInOut(t);

    controls.target.lerpVectors(transitionAnim.startTarget, transitionAnim.endTarget, ease);

    const dir = transitionAnim.startCamPos.clone().sub(transitionAnim.startTarget).normalize();
    const dist = THREE.MathUtils.lerp(transitionAnim.startDist, transitionAnim.endDist, ease);
    camera.position.copy(controls.target).add(dir.multiplyScalar(dist));

    if (t >= 1.0) {
      transitionAnim = null;
      appState = "interactive";
      controls.enabled = true;
      autoRotate = false;

      if (pendingAfterTransition) {
        const queued = pendingAfterTransition;
        pendingAfterTransition = null;
        queued();
      }
    }
  }

  if (rotAnim) {
    const elapsed = performance.now() - rotAnim.startTime;
    const t = Math.min(elapsed / rotAnim.duration, 1.0);
    const ease = cubicEaseInOut(t);

    globeGroup.rotation.y = THREE.MathUtils.lerp(rotAnim.startGlobeY, rotAnim.endGlobeY, ease);

    const spherical = new THREE.Spherical().setFromVector3(camera.position);
    spherical.phi = THREE.MathUtils.lerp(rotAnim.startPhi, rotAnim.endPhi, ease);
    spherical.makeSafe();
    camera.position.setFromSpherical(spherical);

    if (t >= 1.0) rotAnim = null;
  } else if (autoRotate) {
    globeGroup.rotation.y += AUTO_ROTATE_SPEED;
  }

  if (zoomAnim) {
    const elapsed = performance.now() - zoomAnim.startTime;
    const t = Math.min(elapsed / zoomAnim.duration, 1.0);
    const ease = cubicEaseInOut(t);
    const dist = THREE.MathUtils.lerp(zoomAnim.startDist, zoomAnim.endDist, ease);
    camera.position.normalize().multiplyScalar(dist);
    if (t >= 1.0) {
      zoomAnim = null;
      controls.enableZoom = true;
    }
  }

  if (appState === "interactive") {
    const dist = camera.position.length();
    const t_title = (dist - controls.minDistance) / (controls.maxDistance - controls.minDistance);
    const fontSize = THREE.MathUtils.lerp(TITLE_MIN_SIZE, TITLE_MAX_SIZE, Math.max(0, Math.min(1, t_title)));
    titleEl.style.fontSize = fontSize + 'px';
  }

  if (selectedIndex >= 0 && !infoCardEl.classList.contains('hidden')) {
    updateInfoCardPosition();
  }

  markers.forEach((m, i) => {
    const current = m.head.scale.x;
    const target = markerTargetScales[i];
    if (Math.abs(current - target) > 0.01) {
      const newScale = THREE.MathUtils.lerp(current, target, SCALE_LERP_SPEED);
      m.head.scale.setScalar(newScale);
    } else if (current !== target) {
      m.head.scale.setScalar(target);
    }
  });

  updateBackfaceVisibility();
  controls.update();

  const drawStart = performance.now();
  renderer.render(scene, camera);
  // After the draw, so the triangle and call counts are this frame's.
  updateStats(frameStart, drawStart, performance.now());
}

markers.forEach((m, i) => {
  const initialScale = isMobile ? BASE_SCALE_MOBILE : 1.0;
  m.head.scale.setScalar(initialScale);
});

// --- Diagnostics ------------------------------------------------------------
/*
 * Add ?stats to the URL for a frame counter and the name of the GPU actually
 * doing the work. That name is the important one: a machine can have a decent
 * card and still be handing WebGL the integrated chip, and there is no way to
 * tell from the frame rate alone.
 */

let statsEl = null;
let statsFrames = 0;
let statsSince = performance.now();
let gpuName = null;
// Split three ways, because the fix depends entirely on which one is big.
// logic is everything this file does per frame, draw is the render call
// itself, and frame is wall clock between frames. If frame is far larger than
// logic plus draw, the time is going somewhere outside the loop.
let statsLogic = 0;
let statsDraw = 0;
let statsWall = 0;
let statsPrevStart = 0;

if (SHOW_STATS) {
  statsEl = document.createElement('div');
  statsEl.style.cssText =
    'position:fixed;left:12px;bottom:12px;z-index:60;padding:8px 10px;' +
    'font:11px/1.6 monospace;color:#7CFC98;background:rgba(0,0,0,0.75);' +
    'white-space:pre;pointer-events:none;';
  document.body.appendChild(statsEl);

  const gl = renderer.getContext();
  // Only exposed through an extension, and some browsers withhold it to make
  // fingerprinting harder, so it can legitimately come back empty.
  const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
  gpuName = debugInfo
    ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
    : 'not reported';
  // Also to the console, so it can be copied rather than read off the canvas.
  console.log('[mosir] GPU:', gpuName);
  console.log('[mosir] WebGL:', gl.getParameter(gl.VERSION));
}

function updateStats(frameStart, drawStart, drawEnd) {
  if (!statsEl) return;
  statsFrames++;
  statsLogic += drawStart - frameStart;
  statsDraw += drawEnd - drawStart;
  if (statsPrevStart) statsWall += frameStart - statsPrevStart;
  statsPrevStart = frameStart;

  const now = performance.now();
  const elapsed = now - statsSince;
  if (elapsed < 500) return;

  const n = statsFrames;
  const fps = (n * 1000) / elapsed;
  const ratio = renderer.getPixelRatio();

  statsEl.textContent = [
    'fps      ' + fps.toFixed(0),
    'logic    ' + (statsLogic / n).toFixed(1) + ' ms',
    'draw     ' + (statsDraw / n).toFixed(1) + ' ms',
    'frame    ' + (statsWall / Math.max(1, n - 1)).toFixed(1) + ' ms',
    'gpu      ' + gpuName,
    'buffer   ' + Math.round(window.innerWidth * ratio) + ' x ' +
      Math.round(window.innerHeight * ratio) + '  (dpr ' + ratio + ')',
    'scale    ' + qualityScale + (watchingQuality ? ' (watching)' : ''),
    'msaa     ' + (renderer.capabilities.isWebGL2 && FRAMEBUFFER_PIXELS < 4e6 ? 'on' : 'off'),
    'texture  ' + TEXTURE_SIZE + ' x ' + TEXTURE_SIZE / 2,
    'aniso    ' + ANISOTROPY,
    'tris     ' + renderer.info.render.triangles.toLocaleString(),
    'calls    ' + renderer.info.render.calls,
  ].join('\n');

  statsFrames = 0;
  statsSince = now;
  statsLogic = 0;
  statsDraw = 0;
  statsWall = 0;
}

// --- Adaptive quality -------------------------------------------------------
/*
 * Not every visitor gets a GPU. Both Firefox and Chrome fall back to a
 * software rasteriser when they distrust the graphics driver, and rendering
 * on the CPU is close to purely fill rate bound: the same scene that crawls
 * at 2 fps full size runs above 30 with a quarter of the pixels. Shader
 * complexity barely moves it, resolution moves it enormously.
 *
 * So rather than hand those visitors a slideshow, measure what the machine
 * actually manages once the globe is up and step the resolution down until it
 * is smooth. A slightly softer globe that turns beats a sharp one that does
 * not.
 */

const QUALITY_SCALES = [1, 0.75, 0.55, 0.4];
const QUALITY_TARGET_FPS = 30;
/*
 * One bad second can be a background tab loading or a collection pause, and
 * the step down is never reversed, so a merely marginal reading has to repeat
 * before it counts. A catastrophic one does not have to: nothing transient
 * looks like six frames a second.
 */
const QUALITY_URGENT_FPS = 15;
let qualityStrikes = 0;
let qualityIndex = 0;
let qualityFrames = 0;
let qualityStart = 0;
let watchingQuality = false;

function startQualityWatch() {
  // ?half is a deliberate override, so leave it where it was put.
  if (HALF_RES) return;
  watchingQuality = true;
  qualityFrames = 0;
  qualityStart = performance.now();
}

function considerQuality(now) {
  if (!watchingQuality) return;
  qualityFrames++;

  const elapsed = now - qualityStart;
  // Long enough to be a real average, short enough that a struggling machine
  // is not left struggling.
  if (elapsed < 1000) return;

  const fps = (qualityFrames * 1000) / elapsed;
  qualityFrames = 0;
  qualityStart = now;

  if (fps >= QUALITY_TARGET_FPS) {
    watchingQuality = false;
    return;
  }

  if (fps >= QUALITY_URGENT_FPS && qualityStrikes === 0) {
    qualityStrikes = 1;
    return;
  }

  qualityStrikes = 0;
  if (qualityIndex >= QUALITY_SCALES.length - 1) {
    watchingQuality = false;
    return;
  }

  qualityIndex++;
  qualityScale = QUALITY_SCALES[qualityIndex];
  // setPixelRatio reapplies the canvas size itself, so this is the whole
  // change: the scene is untouched, it just renders into fewer pixels.
  renderer.setPixelRatio(pixelRatio());
}

animate();

// --- Deep links -------------------------------------------------------------
/*
 * A hash still opens a marker, so a link to one language can be shared, but it
 * is read once and then wiped from the address bar, and clicking a marker no
 * longer writes to the URL at all. Mirroring the selection into the hash meant
 * a reload reopened whatever was last clicked, which made the piece feel like
 * it remembered you. It should always start from the landing.
 */

function slugFor(lang) {
  return lang.name.toLowerCase().replace(/[^a-z]/g, '');
}

function consumeHash() {
  const slug = location.hash.replace('#', '').toLowerCase();
  if (location.hash) {
    history.replaceState(null, '', location.pathname + location.search);
  }
  if (!slug) return -1;
  return markers.findIndex((m) => slugFor(m.lang) === slug);
}

function skipLandingTo(index) {
  appState = "interactive";
  controls.target.set(0, 0, 0);
  controls.enabled = true;
  autoRotate = false;
  titleEl.classList.add('collapsed');
  descriptionEl.classList.add('hidden');
  hintEl.classList.add('hidden');
  selectMarker(index);
}

// --- Keyboard ---------------------------------------------------------------

function whenInteractive(action) {
  if (appState === "interactive") {
    action();
    return;
  }
  if (appState === "landing") startTransition();
  pendingAfterTransition = action;
}

function focusMarker(step) {
  stopTour();
  const next = selectedIndex < 0
    ? 0
    : (selectedIndex + step + markers.length) % markers.length;
  whenInteractive(() => selectMarker(next));
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    stopTour();
    deselectMarker();
    return;
  }
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
    e.preventDefault();
    focusMarker(1);
  } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
    e.preventDefault();
    focusMarker(-1);
  } else if (e.key === 'Enter' || e.key === ' ') {
    if (appState === "landing") {
      e.preventDefault();
      startTransition();
    }
  }
});

// --- Language index ---------------------------------------------------------

const languageListEl = document.getElementById('language-list');
const panelToggleEl = document.getElementById('panel-toggle');

if (languageListEl) {
  markers.forEach((m, i) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'language-item';
    item.textContent = m.lang.name;
    item.addEventListener('click', () => {
      stopTour();
      if (appState === "landing") {
        skipLandingTo(i);
      } else {
        selectMarker(i);
      }
    });
    languageListEl.appendChild(item);
  });
}

if (panelToggleEl) {
  panelToggleEl.addEventListener('click', () => {
    document.body.classList.toggle('panel-open');
  });
}

function updateLanguageListActive() {
  if (!languageListEl) return;
  Array.from(languageListEl.children).forEach((el, i) => {
    el.classList.toggle('active', i === selectedIndex);
  });
}

// --- Guided tour ------------------------------------------------------------

const tourButtonEl = document.getElementById('tour-button');
let tourTimer = null;

function stopTour() {
  if (tourTimer === null) return;
  clearInterval(tourTimer);
  tourTimer = null;
  if (tourButtonEl) tourButtonEl.textContent = 'Play tour';
}

function showTourProgress(i) {
  if (tourButtonEl) {
    tourButtonEl.textContent = `Stop tour ${i + 1}/${markers.length}`;
  }
}

function startTour() {
  let i = selectedIndex >= 0 ? selectedIndex : -1;
  const step = () => {
    i = (i + 1) % markers.length;
    selectMarker(i);
    showTourProgress(i);
  };
  whenInteractive(step);
  // The flight takes 1.2s and the zoom another 1.2s, so a 4.5s cycle left
  // barely a second to actually read the card.
  tourTimer = setInterval(step, 9000);
  if (tourButtonEl) tourButtonEl.textContent = 'Stop tour';
}

if (tourButtonEl) {
  tourButtonEl.addEventListener('click', () => {
    if (tourTimer !== null) stopTour();
    else startTour();
  });
}

// Zooming is deliberate, so it ends the tour. A bare pointerdown is not:
// on a touch screen it fires for any incidental contact, and it was killing
// the tour within seconds of starting it.
renderer.domElement.addEventListener('wheel', stopTour, { passive: true });

// --- Entry point ------------------------------------------------------------

window.addEventListener('load', () => {
  const index = consumeHash();
  if (index >= 0) skipLandingTo(index);
});

function handleWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  // Rotating a phone can move it between displays or change the ratio.
  renderer.setPixelRatio(pixelRatio());
  renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', handleWindowResize, false);