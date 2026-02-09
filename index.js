import * as THREE from "three";
import { OrbitControls } from 'jsm/controls/OrbitControls.js';
import getStarfield from "./src/getStarfield.js";
import { drawThreeGeo } from "./src/threeGeoJSON.js";
import { createMarkers } from "./src/languageMarkers.js";

const w = window.innerWidth;
const h = window.innerHeight;
const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(75, w / h, 1, 100);
camera.position.z = 5;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(w, h);
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.minDistance = 3.5;
controls.maxDistance = 5;

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

const solidSphereGeo = new THREE.SphereGeometry(1.99, 64, 64);
const solidSphereMat = new THREE.MeshBasicMaterial({ color: 0x282828 });
const solidSphere = new THREE.Mesh(solidSphereGeo, solidSphereMat);
globeGroup.add(solidSphere);

const stars = getStarfield({ numStars: 1000, fog: false });
scene.add(stars);

const GLOBE_RADIUS = 2;
const markers = createMarkers(globeGroup, GLOBE_RADIUS);
const pinHeads = markers.map(m => m.head);

fetch('./geojson/ne_50m_land.json')
  .then(response => response.text())
  .then(text => {
    const data = JSON.parse(text);
    const land = drawThreeGeo({
      json: data,
      radius: GLOBE_RADIUS,
      materialOptions: {
        color: 0x80FF80,
      },
    });
    globeGroup.add(land);
  });

fetch('./geojson/ne_50m_admin_0_boundary_lines_land.json')
  .then(response => response.text())
  .then(text => {
    const data = JSON.parse(text);
    const borders = drawThreeGeo({
      json: data,
      radius: GLOBE_RADIUS,
      materialOptions: {
        color: 0xffffff,
      },
    });
    globeGroup.add(borders);
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
const pointerDownPos = new THREE.Vector2();
let hoveredIndex = -1;
const HOVER_SCALE = 5.0;
const SELECTED_SCALE = 2.0;
const HOVER_SCREEN_RADIUS = 60; 
const SCALE_LERP_SPEED = 0.12;

const markerTargetScales = markers.map(() => 1.0);

controls.target.set(1.5, -1.0, 0);
camera.position.set(1.5, -1.0, 3.5);
controls.enabled = false;
controls.update();

let transitionAnim = null;

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
  if (dx * dx + dy * dy > 25) return;

  const clickNDC = new THREE.Vector2(
    (e.clientX / window.innerWidth) * 2 - 1,
    -(e.clientY / window.innerHeight) * 2 + 1
  );
  raycaster.setFromCamera(clickNDC, camera);

  if (appState === "landing") {
    const globeHits = raycaster.intersectObject(solidSphere, false);
    if (globeHits.length > 0) {
      startTransition();
    }
    return;
  }


  if (appState === "transitioning") return;


  if (hoveredIndex >= 0) {
    selectMarker(hoveredIndex);
  } else {
    const hits = raycaster.intersectObjects(pinHeads, false);
    if (hits.length > 0) {
      const hitIndex = pinHeads.indexOf(hits[0].object);
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
    
    if (hoveredIndex >= 0 && hoveredIndex !== selectedIndex) {
      markerTargetScales[hoveredIndex] = 1.0;
    }
    hoveredIndex = newHovered;
    
    if (hoveredIndex >= 0 && hoveredIndex !== selectedIndex) {
      markerTargetScales[hoveredIndex] = HOVER_SCALE;
    }
  }

  renderer.domElement.style.cursor = (hoveredIndex >= 0) ? 'pointer' : 'default';
});

function selectMarker(index) {
  if (selectedIndex >= 0) {
    markerTargetScales[selectedIndex] = 1.0;
  }

  if (hoveredIndex >= 0 && hoveredIndex !== index) {
    markerTargetScales[hoveredIndex] = 1.0;
  }
  hoveredIndex = -1;

  selectedIndex = index;
  if (index >= 0) {
    markerTargetScales[index] = SELECTED_SCALE;
    rotateGlobeToMarker(index);
    startZoom(ZOOM_CLOSE);
    showInfoCard(index);
  }
}

function deselectMarker() {
  if (selectedIndex >= 0) {
    markerTargetScales[selectedIndex] = 1.0;
    startZoom(ZOOM_DEFAULT);
    hideInfoCard();
  }
  selectedIndex = -1;
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

  const isMobile = window.innerWidth < 768;
  const cardWidth = isMobile ? Math.min(260, window.innerWidth - 40) : 280;
  const cardHeight = infoCardEl.offsetHeight || 120;
  const margin = isMobile ? 10 : 20;

  let left, top;

  if (isMobile) {
    // On mobile, center the card at the bottom
    left = (window.innerWidth - cardWidth) / 2;
    top = window.innerHeight - cardHeight - margin - 60; // 60px from bottom for better visibility
  } else {
    // Desktop behavior - position next to marker
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

    if (i === selectedIndex && dot < 0) {
      deselectMarker();
    }
  });
}

function cubicEaseInOut(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function animate() {
  requestAnimationFrame(animate);

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

  // scale smoothely
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
  renderer.render(scene, camera);
}

animate();

function handleWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', handleWindowResize, false);
