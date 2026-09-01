import * as THREE from "three";

/*
 * A slightly larger sphere rendered from the inside, so all you see is the
 * part of it that falls outside the globe's silhouette. The fresnel term goes
 * to 1 where the surface turns away from the camera, which is exactly the rim,
 * and additive blending lets it sit over the starfield without a hard edge.
 */

const vertexShader = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vViewPosition;

  void main() {
    vNormal = normalize(normalMatrix * normal);
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    vViewPosition = -viewPosition.xyz;
    gl_Position = projectionMatrix * viewPosition;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uPower;
  uniform float uIntensity;

  varying vec3 vNormal;
  varying vec3 vViewPosition;

  void main() {
    vec3 normal = normalize(vNormal);
    vec3 viewDir = normalize(vViewPosition);

    // Rendered with BackSide, so the normals point away from the camera and
    // the dot product has to be flipped to get 0 at the centre, 1 at the rim.
    float fresnel = pow(1.0 - abs(dot(normal, viewDir)), uPower);

    gl_FragColor = vec4(uColor, fresnel * uIntensity);
  }
`;

export function createAtmosphere({
  radius,
  color = new THREE.Color(0x4a7fb5),
  power = 3.0,
  intensity = 1.0,
  scale = 1.06,
} = {}) {
  const geometry = new THREE.SphereGeometry(radius * scale, 64, 32);
  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uColor: { value: color },
      uPower: { value: power },
      uIntensity: { value: intensity },
    },
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });

  return new THREE.Mesh(geometry, material);
}
