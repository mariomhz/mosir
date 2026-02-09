import * as THREE from "three";

export const LANGUAGES = [
  { id: "es", name: "Spanish",    lat: 28.5,  lon: -16.2, color: "#ff0000", description: "Having a Spanish mom, spanish is one of my first and most spoken languages as I currently reside in the Canary Islands." },
  { id: "pt", name: "Portuguese", lat: -22.2, lon: -43.2, color: "#ff0000", description: "As someone of Brazilian descent it was extremely important to connect to my roots through language which is why portuguese is one of my first learnt and most spoken lannguages." },
  { id: "it", name: "Italian",    lat: 40.8,  lon: 14.2,  color: "#ff0000", description: "My dad is Italian and I spent a great deal of my life studying and living in Italy which makes italian one of my first languages." },
  { id: "fr", name: "French",     lat: 46.6,  lon: 2.2,   color: "#ff0000", description: "When I was in Italy we had to study french in school and, as a language enthusiast, I took great pleasure in learning it. It also gave me the chance to help with interpretation when I volunteered." },
  { id: "no", name: "Norwegian",  lat: 60.5,  lon: 8.5,   color: "#ff0000", description: "Learnt it when I was in high school it is the only Scandinavian lannguage I know, it all started because of a TV show I loved which led to me dedicating hours to learn the language." },
  { id: "ca", name: "Catalan",    lat: 41.6,  lon: 1.5,   color: "#ff0000", description: "Back in the day I wanted to learn more romance languages, Catalan was one of the first options considering its familiarity with the other languages I speak. I travel often to Barcelona and knowing the language has led to wonderful interactions in the city." },
  { id: "en", name: "English",    lat: 39.8,  lon: -98.6, color: "#ff0000", description: "As the son of an English teacher my mother was never pushy but gently helped me learn english through the years, making it one of the first languages I ever spoke." },
  { id: "asl", name: "ASL",       lat: 42.3,  lon: -95.6, color: "#ff0000", description: "ASL was a wonderful and eyeopening learning experience, I had never thought of languages as something visual and the experience of seeing something I was so passionate about in a different concept really opened my eyes to the true meaning of language." },
];

export function latLonToVec3(lat, lon, radius) {
  const latRad = lat * (Math.PI / 180);
  const lonRad = lon * (Math.PI / 180);
  return new THREE.Vector3(
    radius * Math.cos(latRad) * Math.cos(lonRad),
    radius * Math.sin(latRad),
    -radius * Math.cos(latRad) * Math.sin(lonRad)
  );
}

export function createMarkers(parentGroup, radius) {
  const markers = [];

  LANGUAGES.forEach((lang) => {
    const surfacePos = latLonToVec3(lang.lat, lang.lon, radius);
    const tipPos     = latLonToVec3(lang.lat, lang.lon, radius * 1.12);

    const stalkLen = surfacePos.distanceTo(tipPos);
    const stalkGeo = new THREE.CylinderGeometry(0.003, 0.003, stalkLen, 6);
    stalkGeo.translate(0, stalkLen / 2, 0);
    stalkGeo.rotateX(Math.PI / 2);
    const stalkMat = new THREE.MeshBasicMaterial({ color: lang.color, transparent: true, opacity: 0.8 });
    const stalk = new THREE.Mesh(stalkGeo, stalkMat);
    stalk.position.copy(surfacePos);
    stalk.lookAt(tipPos);

    const headGeo = new THREE.SphereGeometry(0.012, 8, 8);
    const headMat = new THREE.MeshBasicMaterial({ color: lang.color, transparent: true });
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.copy(tipPos);

    parentGroup.add(stalk);
    parentGroup.add(head);

    markers.push({ lang, stalk, head, surfacePos, tipPos });
  });

  return markers;
}
