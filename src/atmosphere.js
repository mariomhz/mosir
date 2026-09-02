import * as THREE from "three";

/*
 * A slightly larger sphere rendered from the inside, so all you see is the
 * part of it that falls outside the globe's silhouette. The fresnel term goes
 * to 1 where the surface turns away from the camera, which is exactly the rim,
 * and additive blending lets it sit over the starfield without a hard edge.
 *
 * The rim is also lit by the sun, otherwise a globe with half of it in night
 * would still be ringed by an even glow all the way round. Air only scatters
 * light where light is falling on it, so the glow follows the terminator and
 * warms as it crosses it.
 */

const vertexShader = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vViewPosition;
  varying vec3 vSurfaceDir;

  void main() {
    vNormal = normalize(normalMatrix * normal);
    // The sphere is centred on the origin, so the position doubles as the
    // outward direction, and it stays in the globe's own space where the
    // sun direction is expressed.
    vSurfaceDir = normalize(position);
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    vViewPosition = -viewPosition.xyz;
    gl_Position = projectionMatrix * viewPosition;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uTwilightColor;
  uniform float uPower;
  uniform float uIntensity;
  uniform float uNightIntensity;
  uniform vec3 uSunDirection;

  varying vec3 vNormal;
  varying vec3 vViewPosition;
  varying vec3 vSurfaceDir;

  void main() {
    vec3 normal = normalize(vNormal);
    vec3 viewDir = normalize(vViewPosition);

    // Rendered with BackSide, so the normals point away from the camera and
    // the dot product has to be flipped to get 0 at the centre, 1 at the rim.
    float fresnel = pow(1.0 - abs(dot(normal, viewDir)), uPower);

    float sun = dot(normalize(vSurfaceDir), normalize(uSunDirection));
    // Softened across the terminator rather than cut at zero, because the
    // atmosphere is still lit for a while after the ground below it is not.
    float daylight = smoothstep(-0.25, 0.30, sun);
    float strength = mix(uNightIntensity, 1.0, daylight);

    // Light grazing the terminator has taken the longest path through the
    // air, which is why sunrise seen from orbit is a thin orange band.
    float twilight = 1.0 - smoothstep(0.0, 0.35, abs(sun));
    vec3 color = mix(uColor, uTwilightColor, twilight * 0.65);

    gl_FragColor = vec4(color, fresnel * uIntensity * strength);
  }
`;

export function createAtmosphere({
  radius,
  color = new THREE.Color(0x4a7fb5),
  twilightColor = new THREE.Color(0xd98a4a),
  power = 3.0,
  intensity = 1.0,
  nightIntensity = 0.18,
  scale = 1.06,
  sunDirection = new THREE.Vector3(0, 0, 1),
} = {}) {
  const geometry = new THREE.SphereGeometry(radius * scale, 64, 32);
  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uColor: { value: color },
      uTwilightColor: { value: twilightColor },
      uPower: { value: power },
      uIntensity: { value: intensity },
      uNightIntensity: { value: nightIntensity },
      // Held by reference so the caller can move the sun without touching
      // the material again.
      uSunDirection: { value: sunDirection },
    },
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });

  return new THREE.Mesh(geometry, material);
}
