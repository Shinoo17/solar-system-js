// ============================================================
//  Mars — standalone Three.js WebGPU page
//
//  Everything this page needs lives inside the mars/ folder.
//
//  How the lighting works:
//  One directional light acts as the Sun. The side of the planet
//  facing that light is bright — that is the DAY side. The other
//  side points away, receives no light, and stays dark — that is
//  the NIGHT side. The soft blend between the two is called the
//  TERMINATOR line, the same line you can see on the Moon as its
//  phases change.
// ============================================================

import * as THREE from "three/webgpu";
import {
  cameraPosition,
  normalWorldGeometry,
  positionWorld,
  uniform,
  vec4,
} from "three/tsl";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import GUI from "lil-gui";

// ---------- Page settings (also editable from the GUI) ----------

const TEXTURE_URL = "./texture/8k_mars.jpg";
const PLANET_RADIUS = 2;
const BASE_SPIN_SPEED = 0.15; // radians per second at speed 1.0

const settings = {
  autoRotate: true,
  rotationSpeed: 0.5,
  axialTiltDegrees: 25.2, // similar to Earth's tilt, so Mars has seasons too
  cameraDistance: 6.0,
  lightIntensity: 3.2,
  fillIntensity: 0.55,
  backIntensity: 0.35,
  glowIntensity: 0.28, // strength of the thin dusty atmosphere haze
  glowOpacity: 0.55,
  glowRadius: 1.1,     // size of the haze shell (times planet radius)
  roughness: 1.0,
  colorTint: "#ffffff",
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
      "\n\nthen open http://localhost:8000/mars/mars.html";
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
// If the file is missing, the promise rejects and showError() runs.
function loadTexture(url) {
  const loader = new THREE.TextureLoader();
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      texture => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = renderer.capabilities?.getMaxAnisotropy?.() || 8;
        resolve(texture);
      },
      undefined,
      () => reject(new Error(`Could not load texture: ${url}`))
    );
  });
}

// ---------- Scene, camera, renderer (the basic Three.js trio) ----------

// The scene is the 3D world. It contains the planet, lights and camera.
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x030409);

const camera = new THREE.PerspectiveCamera(
  45, window.innerWidth / window.innerHeight, 0.1, 300
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
renderer.toneMappingExposure = 1.1;

// Its setup is asynchronous, so wait before creating controls and objects.
await renderer.init();

// OrbitControls: dragging empty space orbits the camera around the planet.
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; // gives the camera a smooth, weighty feel
controls.dampingFactor = 0.06;
controls.enablePan = false;
controls.minDistance = 3.2;
controls.maxDistance = 20;

// ---------- Lighting ----------
// Three lights make the day/night shadow read as light, not just a
// flat cutout: a warm KEY light (the Sun) lights one hemisphere and
// leaves the other in shadow — that's the terminator line. A dim,
// cool BACK light from roughly the opposite direction keeps the
// shadow side from going pure black and puts a faint highlight on
// the silhouette edge. A tinted ambient FILL softens the shadow a
// little more without erasing it.

const keyLight = new THREE.DirectionalLight(0xfff1dc, settings.lightIntensity);
keyLight.position.set(5, 2, 4);
scene.add(keyLight);

const backLight = new THREE.DirectionalLight(0x4a5a80, settings.backIntensity);
backLight.position.set(-5, -1, -3);
scene.add(backLight);

const fillLight = new THREE.AmbientLight(0x2a3040, settings.fillIntensity);
scene.add(fillLight);

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

// ---------- The planet ----------

const planetTexture = await loadTexture(TEXTURE_URL);

// This group carries the axial tilt. The mesh spins inside it,
// so the spin axis stays tilted no matter how fast it rotates.
const planetGroup = new THREE.Group();
scene.add(planetGroup);

const planetGeometry = new THREE.SphereGeometry(PLANET_RADIUS, 128, 64);

// StandardMaterial reacts to lights: bright toward the sun light,
// dark away from it, with a soft terminator line in between.
// That lighting is what makes the sphere LOOK like a sphere.
const planetMaterial = new THREE.MeshStandardMaterial({
  map: planetTexture,
  roughness: settings.roughness,
});

const planetMesh = new THREE.Mesh(planetGeometry, planetMaterial);
planetGroup.add(planetMesh);

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
const glowColor = uniform(new THREE.Color("#d98e66"));

// 0 when the surface faces the camera, 1 at the silhouette edge
const viewDirection = cameraPosition.sub(positionWorld).normalize();
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
  new THREE.SphereGeometry(PLANET_RADIUS, 96, 48),
  glowMaterial
);
// The shell is scaled up around the planet; the Radius slider changes this
glowMesh.scale.setScalar(settings.glowRadius);
planetGroup.add(glowMesh);

// ---------- Apply settings ----------

function applyAxialTilt() {
  // Tilt the whole group; the spin (rotation.y) happens inside it
  planetGroup.rotation.z = THREE.MathUtils.degToRad(settings.axialTiltDegrees);
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

const gui = new GUI({ title: "Mars" });

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
lightingFolder.add(settings, "lightIntensity", 0, 8, 0.1).name("Key light")
  .onChange(value => { keyLight.intensity = value; });
lightingFolder.add(settings, "fillIntensity", 0, 3, 0.01).name("Ambient")
  .onChange(value => { fillLight.intensity = value; });
lightingFolder.add(settings, "backIntensity", 0, 3, 0.01).name("Rim light")
  .onChange(value => { backLight.intensity = value; });

const glowFolder = gui.addFolder("Glow");
glowFolder.add(settings, "glowIntensity", 0, 2, 0.01).name("Intensity")
  .onChange(value => { glowIntensity.value = value; });
glowFolder.add(settings, "glowOpacity", 0, 1, 0.01).name("Opacity")
  .onChange(value => { glowOpacity.value = value; });
glowFolder.add(settings, "glowRadius", 1.02, 1.6, 0.01).name("Radius")
  .onChange(value => { glowMesh.scale.setScalar(value); });

const materialFolder = gui.addFolder("Material");
materialFolder.add(settings, "roughness", 0, 1, 0.01).name("Roughness")
  .onChange(value => { planetMaterial.roughness = value; });
materialFolder.addColor(settings, "colorTint").name("Color tint")
  .onChange(value => { planetMaterial.color.set(value); });

// If the user zooms with the mouse wheel, keep the GUI slider in sync.
controls.addEventListener("change", () => {
  if (applyingCameraDistance) return;
  settings.cameraDistance = camera.position.distanceTo(controls.target);
  distanceController.updateDisplay();
});

// ---------- Dragging: the planet vs empty space ----------
// OrbitControls already orbits the camera when you drag anywhere.
// Extra rule: if a drag STARTS on the planet itself, spin the
// planet instead, and pause the camera controls until it ends.

const raycaster = new THREE.Raycaster();
const pointerPosition = new THREE.Vector2();
let draggingPlanet = false;
let lastPointerX = 0;
let spinAngle = 0; // current rotation of the planet around its axis

function pointerHitsPlanet(event) {
  // Convert the mouse position to the -1..+1 range Three.js expects
  const bounds = renderer.domElement.getBoundingClientRect();
  pointerPosition.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
  pointerPosition.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;

  // The raycaster shoots a line from the camera through the pointer
  raycaster.setFromCamera(pointerPosition, camera);
  return raycaster.intersectObject(planetMesh, false).length > 0;
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
  }
  planetMesh.rotation.y = spinAngle;

  controls.update(); // needed for the damping to work
  renderer.render(scene, camera);
}

renderer.setAnimationLoop(animate);
