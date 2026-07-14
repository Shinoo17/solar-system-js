// ============================================================
//  Earth — standalone Three.js WebGPU page
//
//  Everything this page needs lives inside the earth/ folder.
//
//  This page uses the WebGPU build of Three.js. Materials are
//  written in TSL (Three Shading Language) — small chainable
//  nodes instead of raw shader strings. If the browser has no
//  WebGPU, Three.js automatically falls back to WebGL2.
//
//  Earth is the most detailed page in this project:
//    1. a day/night surface material  (city lights on the dark side)
//    2. a separate cloud layer        (slightly larger sphere)
//    3. a blue atmosphere haze        (thin band hugging the edge)
//
//  How the lighting works:
//  We choose one fixed direction to act as "the Sun".
//  Any part of the globe whose surface points toward that
//  direction is in daylight. The opposite side points away,
//  receives no light, and shows the night texture instead.
//  The soft blend between the two is the TERMINATOR — the
//  moving line between day and night you can see from space.
// ============================================================

import * as THREE from "three/webgpu";
import {
  cameraPosition,
  mix,
  normalWorldGeometry,
  normalize,
  positionWorld,
  texture,
  uniform,
  uv,
  vec3,
  vec4,
} from "three/tsl";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import GUI from "lil-gui";

// ---------- Page settings (also editable from the GUI) ----------

const DAY_TEXTURE_URL = "./texture/8k_earth_daymap.jpg";
const NIGHT_TEXTURE_URL = "./texture/8k_earth_nightmap.jpg";
const CLOUD_TEXTURE_URL = "./texture/8k_earth_fair_clouds.jpg";
const EARTH_RADIUS = 2;
const BASE_SPIN_SPEED = 0.15; // radians per second at speed 1.0

const settings = {
  autoRotate: true,
  rotationSpeed: 0.5,
  axialTiltDegrees: 23.4,  // Earth's real tilt — the reason we have seasons
  cameraDistance: 6.0,
  lightIntensity: 1.0,     // brightness of the day side
  cityLights: 1.2,         // brightness of the night-side city lights
  bloom: 0.1,              // small extra brightness in rim/specular effects
  rimLight: 0.8,           // blue-white light near the edge of the globe
  glowIntensity: 0.8,      // strength of the outer atmosphere haze band
  glowOpacity: 1.0,
  glowRadius: 1.1,         // size of the haze shell (times planet radius)
  cloudOpacity: 0.58,
  cloudSpecular: 0.24,
  landSpecular: 0.12,
  waterSpecular: 0.66,
};

// ---------- Loading / error helpers ----------

const loadingOverlay = document.getElementById("loading");
const errorOverlay = document.getElementById("error");
const errorText = document.getElementById("errorText");

function showError(error) {
  console.error(error);
  loadingOverlay.classList.add("hidden");
  errorOverlay.classList.remove("hidden");

  let message = error?.message || String(error);
  if (window.location.protocol === "file:") {
    message += "\n\nBrowsers block texture loading from file://." +
      "\nRun a small local server from the project folder:" +
      "\n\nnnpx serve ." +
      "\n\nthen open http://localhost:3000/earth/earth.html";
  }
  errorText.textContent = message;
}

window.addEventListener("error", event => {
  if (event.error) showError(event.error);
});
window.addEventListener("unhandledrejection", event => {
  event.preventDefault();
  showError(event.reason || new Error("Unhandled promise rejection"));
});

// Wraps Three's texture loader in a promise, so we can use await.
// If a file is missing, the promise rejects and showError() runs.
// Color pictures need SRGB decoding; data pictures (like the cloud
// mask) must stay linear, so that is an option.
function loadTexture(url, { srgb = true } = {}) {
  const loader = new THREE.TextureLoader();
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      tex => {
        if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = renderer.capabilities?.getMaxAnisotropy?.() || 8;
        resolve(tex);
      },
      undefined,
      () => reject(new Error(`Could not load texture: ${url}`))
    );
  });
}

// ---------- Scene, camera, renderer (the basic Three.js trio) ----------

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x01040a);
scene.fog = new THREE.FogExp2(0x01040a, 0.00062);

const camera = new THREE.PerspectiveCamera(
  42, window.innerWidth / window.innerHeight, 0.1, 2000
);
camera.position.set(0, 0.4, settings.cameraDistance);

// WebGPURenderer is the single renderer used by every body page.
const renderer = new THREE.WebGPURenderer({
  canvas: document.getElementById("planetCanvas"),
  antialias: true,
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.02;

// Its setup is asynchronous, so wait before creating controls and objects.
await renderer.init();

// OrbitControls: dragging empty space orbits the camera around Earth.
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.enablePan = false;
controls.minDistance = 3.2;
controls.maxDistance = 20;

// ---------- The Sun's direction ----------
// One fixed direction acts as the Sun. Every material on this page
// reads it, so the surface, clouds and haze all agree on where
// daylight comes from. (No Light object is needed — the TSL
// materials compute their own lighting from this direction.)

const sunDirection = uniform(new THREE.Vector3(4.6, 1.25, 3.1).normalize());

// ---------- Starfield ----------
// A few hundred tiny points scattered far away on all sides.

function createStarfield() {
  const starCount = 1500;
  const positions = new Float32Array(starCount * 3);
  const direction = new THREE.Vector3();

  for (let i = 0; i < starCount; i++) {
    // Random direction, pushed far away so stars sit behind everything
    direction.randomDirection();
    const distance = 80 + Math.random() * 100;
    positions[i * 3 + 0] = direction.x * distance;
    positions[i * 3 + 1] = direction.y * distance;
    positions[i * 3 + 2] = direction.z * distance;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

  const material = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 0.7,
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
  });

  return new THREE.Points(geometry, material);
}

scene.add(createStarfield());

// ---------- Load all three textures before building Earth ----------

const [dayTexture, nightTexture, cloudTexture] = await Promise.all([
  loadTexture(DAY_TEXTURE_URL),
  loadTexture(NIGHT_TEXTURE_URL),
  loadTexture(CLOUD_TEXTURE_URL, { srgb: false }), // used as a mask
]);

// This group carries the axial tilt. The meshes spin inside it,
// so the spin axis stays tilted no matter how fast they rotate.
const earthGroup = new THREE.Group();
scene.add(earthGroup);

// ---------- The Earth surface (day/night TSL material) ----------
// A normal material can only show ONE texture. We want the day
// texture on the lit side and the night texture (city lights) on
// the dark side, so we mix them based on the Sun direction.

// These uniforms are the knobs the GUI can turn later
const lightIntensity = uniform(settings.lightIntensity);
const cityLights = uniform(settings.cityLights);
const bloomStrength = uniform(settings.bloom);
const rimLightStrength = uniform(settings.rimLight);
const landSpecularStrength = uniform(settings.landSpecular);
const waterSpecularStrength = uniform(settings.waterSpecular);

// How much does this point face the Sun?
//  +1 = directly facing the Sun   (noon)
//   0 = the Sun is on the horizon (sunrise / sunset)
//  -1 = facing away               (midnight)
const lightAmount = normalWorldGeometry.dot(normalize(sunDirection));

// smoothstep turns that value into a soft 0..1 blend. The small
// range around zero creates the soft TERMINATOR line instead of
// a hard cut between day and night.
const daylight = lightAmount.smoothstep(-0.16, 0.22);
const nightSide = lightAmount.smoothstep(-0.24, 0.08).oneMinus();
const twilight = lightAmount.abs().smoothstep(0.02, 0.34).oneMinus();
const viewDirection = cameraPosition.sub(positionWorld).normalize();
const rim = normalWorldGeometry.dot(viewDirection).max(0).oneMinus().pow(2.4);

const dayColor = texture(dayTexture, uv()).rgb.mul(lightIntensity);
const nightColor = texture(nightTexture, uv()).rgb.pow(vec3(0.72)).mul(cityLights);

// The day texture is darker over oceans. We use that as a simple
// water/land mask so water can get a tight shiny highlight and land
// gets a broader, weaker highlight.
const dayMapColor = texture(dayTexture, uv()).rgb;
const luminance = dayMapColor.dot(vec3(0.2126, 0.7152, 0.0722));
const ocean = luminance.smoothstep(0.22, 0.62).oneMinus();
const land = ocean.oneMinus();

const halfVector = normalize(sunDirection).add(viewDirection).normalize();
const sunMask = lightAmount.smoothstep(0, 0.62);
const waterSpecular = normalWorldGeometry.dot(halfVector).max(0).pow(92)
  .mul(ocean).mul(sunMask).mul(waterSpecularStrength);
const landSpecular = normalWorldGeometry.dot(halfVector).max(0).pow(36)
  .mul(land).mul(sunMask).mul(landSpecularStrength);
const rimCore = normalWorldGeometry.dot(viewDirection).max(0).oneMinus().pow(10.0);
const rimLight = rim.mul(lightAmount.smoothstep(-0.28, 0.42))
  .mul(rimLightStrength).mul(bloomStrength.mul(0.55).add(0.75));

let finalEarthColor = mix(nightColor, dayColor, daylight);
finalEarthColor = finalEarthColor.add(vec3(0.055, 0.105, 0.19).mul(twilight).mul(nightSide.mul(0.55).add(0.35)));
finalEarthColor = finalEarthColor.add(vec3(0.93, 0.98, 1.0).mul(rimCore).mul(rimLight).mul(0.35));
finalEarthColor = finalEarthColor.add(vec3(0.46, 0.64, 0.78).mul(waterSpecular));
finalEarthColor = finalEarthColor.add(vec3(0.42, 0.36, 0.25).mul(landSpecular));

const earthMaterial = new THREE.MeshBasicNodeMaterial();
// Lit side shows the day texture, dark side the city lights
earthMaterial.outputNode = vec4(finalEarthColor, 1);

const earthMesh = new THREE.Mesh(
  new THREE.SphereGeometry(EARTH_RADIUS, 128, 64),
  earthMaterial
);
earthGroup.add(earthMesh);

// ---------- Cloud layer ----------
// A slightly larger sphere. The grayscale cloud picture works as a
// mask: white = cloud, black = clear sky. Clouds are white in
// daylight, fade toward dark blue on the night side.

const cloudOpacity = uniform(settings.cloudOpacity);
const cloudSpecularStrength = uniform(settings.cloudSpecular);

const cloudDaylight = lightAmount.smoothstep(-0.16, 0.3);
const cloudAmount = texture(cloudTexture, uv()).r;
const cloudColor = mix(vec3(0.16, 0.22, 0.3), vec3(1, 1, 1), cloudDaylight);
const cloudSpecular = normalWorldGeometry.dot(halfVector).max(0).pow(26)
  .mul(cloudAmount).mul(cloudDaylight).mul(cloudSpecularStrength);
const cloudFinalColor = cloudColor.add(vec3(0.62, 0.75, 0.9).mul(cloudSpecular).mul(bloomStrength.mul(0.65).add(1)));
// Night-side clouds are barely visible, day-side clouds fully show
const cloudAlpha = cloudAmount.mul(cloudOpacity).mul(mix(0.18, 1, cloudDaylight));

const cloudMaterial = new THREE.MeshBasicNodeMaterial({
  transparent: true,
  depthWrite: false, // never block the surface behind the clouds
});
cloudMaterial.outputNode = vec4(cloudFinalColor, cloudAlpha);

const cloudMesh = new THREE.Mesh(
  new THREE.SphereGeometry(EARTH_RADIUS * 1.008, 128, 64),
  cloudMaterial
);
earthGroup.add(cloudMesh);

// ---------- Atmosphere haze (the glow) ----------
// A slightly larger sphere rendered inside-out (BackSide), so we
// only see its far half behind the planet — a ring around the edge.
//
// The trick that makes it look like air instead of a halo:
// measure how close each point is to the silhouette edge, then
// fade the haze IN as it approaches the edge and OUT again right
// at the edge. That "faint → bright → faint" band hugs the limb
// of the planet like a real atmosphere seen from space.
// This is only a visual approximation — a real atmosphere scatters
// sunlight, which is far more complex than this page needs.

const glowIntensity = uniform(settings.glowIntensity);
const glowOpacity = uniform(settings.glowOpacity);
const glowColor = uniform(new THREE.Color(0x3d9cff));

// 0 when the surface faces the camera, 1 at the silhouette edge
const edgeCloseness = normalWorldGeometry.dot(viewDirection).abs().oneMinus();

// faint → bright → faint
const fadeIn = edgeCloseness.smoothstep(0.10, 0.45);
const fadeOut = edgeCloseness.oneMinus().smoothstep(0.10, 0.55);
const band = fadeIn.mul(fadeOut);

const haze = band.pow(1.4).mul(glowIntensity);

const glowMaterial = new THREE.MeshBasicNodeMaterial({
  side: THREE.BackSide,
  transparent: true,
  blending: THREE.AdditiveBlending, // haze adds light on top of the scene
  depthWrite: false,
});
glowMaterial.outputNode = vec4(glowColor.mul(haze), haze.mul(0.55).mul(glowOpacity));

const glowMesh = new THREE.Mesh(
  new THREE.SphereGeometry(EARTH_RADIUS, 96, 48),
  glowMaterial
);
// The shell is scaled up around the planet; the Radius slider changes this
glowMesh.scale.setScalar(settings.glowRadius);
earthGroup.add(glowMesh);

// ---------- Apply settings ----------

function applyAxialTilt() {
  earthGroup.rotation.z = THREE.MathUtils.degToRad(settings.axialTiltDegrees);
}

// Moves the camera to the chosen distance, keeping its direction.
let applyingCameraDistance = false;
function applyCameraDistance() {
  applyingCameraDistance = true;
  const direction = camera.position.clone().sub(controls.target).normalize();
  camera.position.copy(controls.target)
    .addScaledVector(direction, settings.cameraDistance);
  controls.update();
  applyingCameraDistance = false;
}

applyAxialTilt();

// ---------- GUI (lil-gui control panel) ----------

const gui = new GUI({ title: "Earth" });

const planetFolder = gui.addFolder("Planet");
planetFolder.add(settings, "autoRotate").name("Auto rotate");
planetFolder.add(settings, "rotationSpeed", 0, 2, 0.01).name("Rotation speed");
planetFolder.add(settings, "axialTiltDegrees", -180, 180, 0.1)
  .name("Axial tilt (deg)").onChange(applyAxialTilt);

const cameraFolder = gui.addFolder("Camera");
const distanceController = cameraFolder
  .add(settings, "cameraDistance", controls.minDistance, controls.maxDistance, 0.1)
  .name("Distance").onChange(applyCameraDistance);

const lightingFolder = gui.addFolder("Lighting");
lightingFolder.add(settings, "lightIntensity", 0, 3, 0.01).name("Sun light")
  .onChange(value => { lightIntensity.value = value; });
lightingFolder.add(settings, "cityLights", 0, 3, 0.01).name("City lights")
  .onChange(value => { cityLights.value = value; });

const glowFolder = gui.addFolder("Atmosphere / Glow");
glowFolder.add(settings, "bloom", 0, 2, 0.01).name("Bloom")
  .onChange(value => { bloomStrength.value = value; });
glowFolder.add(settings, "rimLight", 0, 2, 0.01).name("Rim light")
  .onChange(value => { rimLightStrength.value = value; });
glowFolder.add(settings, "glowIntensity", 0, 1.5, 0.01).name("Outer glow")
  .onChange(value => { glowIntensity.value = value; });
glowFolder.add(settings, "glowOpacity", 0, 1, 0.01).name("Glow opacity")
  .onChange(value => { glowOpacity.value = value; });
glowFolder.add(settings, "glowRadius", 1.01, 1.35, 0.001).name("Glow radius")
  .onChange(value => { glowMesh.scale.setScalar(value); });

const cloudFolder = gui.addFolder("Clouds");
cloudFolder.add(settings, "cloudOpacity", 0, 1, 0.01).name("Opacity")
  .onChange(value => { cloudOpacity.value = value; });

const materialFolder = gui.addFolder("Material");
materialFolder.add(settings, "cloudSpecular", 0, 1.5, 0.01).name("Cloud specular")
  .onChange(value => { cloudSpecularStrength.value = value; });
materialFolder.add(settings, "landSpecular", 0, 1.5, 0.01).name("Land specular")
  .onChange(value => { landSpecularStrength.value = value; });
materialFolder.add(settings, "waterSpecular", 0, 2, 0.01).name("Water specular")
  .onChange(value => { waterSpecularStrength.value = value; });

// If the user zooms with the mouse wheel, keep the GUI slider in sync.
controls.addEventListener("change", () => {
  if (applyingCameraDistance) return;
  settings.cameraDistance = camera.position.distanceTo(controls.target);
  distanceController.updateDisplay();
});

// ---------- Dragging: the planet vs empty space ----------
// OrbitControls already orbits the camera when you drag anywhere.
// Extra rule: if a drag STARTS on the planet (or its clouds), spin
// the planet instead, and pause the camera controls until it ends.

const raycaster = new THREE.Raycaster();
const pointerPosition = new THREE.Vector2();
const dragTargets = [earthMesh, cloudMesh];
let draggingPlanet = false;
let lastPointerX = 0;
let spinAngle = 0;   // rotation of the surface around its axis
let cloudDrift = 0;  // extra rotation of the clouds only

function pointerHitsPlanet(event) {
  // Convert the mouse position to the -1..+1 range Three.js expects
  const bounds = renderer.domElement.getBoundingClientRect();
  pointerPosition.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
  pointerPosition.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;

  // The raycaster shoots a line from the camera through the pointer
  raycaster.setFromCamera(pointerPosition, camera);
  return raycaster.intersectObjects(dragTargets, false).length > 0;
}

renderer.domElement.addEventListener("pointerdown", event => {
  if (!event.isPrimary || event.button !== 0) return;
  if (!pointerHitsPlanet(event)) return; // empty space → OrbitControls

  draggingPlanet = true;
  lastPointerX = event.clientX;
  controls.enabled = false; // pause the camera while spinning the planet
  renderer.domElement.setPointerCapture(event.pointerId);
});

renderer.domElement.addEventListener("pointermove", event => {
  if (!draggingPlanet) return;
  const deltaX = event.clientX - lastPointerX;
  lastPointerX = event.clientX;
  spinAngle += deltaX * 0.005; // pixels moved → radians of spin
});

function endPlanetDrag() {
  if (!draggingPlanet) return;
  draggingPlanet = false;
  controls.enabled = true;
}

renderer.domElement.addEventListener("pointerup", endPlanetDrag);
renderer.domElement.addEventListener("pointercancel", endPlanetDrag);

// ---------- Resize ----------

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- Start ----------

loadingOverlay.classList.add("hidden");

const clock = new THREE.Clock();

function animate() {
  const deltaTime = clock.getDelta();

  // Auto rotation (paused while the user is dragging the planet)
  if (settings.autoRotate && !draggingPlanet) {
    spinAngle += deltaTime * BASE_SPIN_SPEED * settings.rotationSpeed;
    // Clouds drift a little faster than the ground, like real weather
    cloudDrift += deltaTime * BASE_SPIN_SPEED * settings.rotationSpeed * 0.15;
  }
  earthMesh.rotation.y = spinAngle;
  cloudMesh.rotation.y = spinAngle + cloudDrift;

  controls.update(); // needed for the damping to work
  renderer.render(scene, camera);
}

renderer.setAnimationLoop(animate);
