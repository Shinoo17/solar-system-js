// ============================================================
//  Sun — standalone Three.js WebGPU page
//
//  Everything this page needs lives inside the sun/ folder.
//
//  This page uses the WebGPU build of Three.js. The glow is
//  written in TSL (Three Shading Language) — small chainable
//  nodes instead of raw shader strings. If the browser has no
//  WebGPU, Three.js automatically falls back to WebGL2.
//
//  The Sun is special: it does not need an external light,
//  because it IS the light source. So the surface uses a
//  MeshBasicMaterial (always fully bright), and the "glow"
//  is built from two visual tricks:
//    1. a haze band that brightens the edge of the disc
//    2. a soft corona halo drawn on a sprite behind the Sun
//  Both are approximations — real coronas are plasma physics,
//  here we only care about how it looks.
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

const TEXTURE_URL = "./texture/8k_sun.jpg";
const SUN_RADIUS = 2;
const BASE_SPIN_SPEED = 0.15; // radians per second at speed 1.0

const settings = {
  autoRotate: true,
  rotationSpeed: 0.5,
  axialTiltDegrees: 7.25,  // the real Sun's axis is tilted about 7 degrees
  cameraDistance: 5.6,
  surfaceBrightness: 1.0,  // multiplies the texture color
  glowIntensity: 2.4,      // strength of the hot haze at the edge
  glowOpacity: 0.94,
  glowRadius: 1.067,       // almost on the surface, like the shared edge glow
  coronaIntensity: 1.85,   // brightness of the outer halo
  coronaSize: 1.1,         // how far the halo spreads (in sun radii)
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
      "\n\nthen open http://localhost:8000/sun/sun.html";
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

// The scene is the 3D world. It contains the Sun, the stars and the camera.
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);

const camera = new THREE.PerspectiveCamera(
  40, window.innerWidth / window.innerHeight, 0.1, 300
);
camera.position.set(0, 0, settings.cameraDistance);

// WebGPURenderer is the single renderer used by every body page.
const renderer = new THREE.WebGPURenderer({
  canvas: document.getElementById("planetCanvas"),
  antialias: true,
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;

// Its setup is asynchronous, so wait before creating controls and objects.
await renderer.init();

// OrbitControls: dragging empty space orbits the camera around the Sun.
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;   // gives the camera a smooth, weighty feel
controls.dampingFactor = 0.06;
controls.enablePan = false;
controls.minDistance = 3.2;
controls.maxDistance = 10;

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

// ---------- The Sun itself ----------

// This group carries the axial tilt. The mesh spins inside it,
// so the spin axis stays tilted no matter how fast it rotates.
const sunGroup = new THREE.Group();
scene.add(sunGroup);

const sunGeometry = new THREE.SphereGeometry(SUN_RADIUS, 128, 64);

// MeshBasicMaterial ignores all lights — perfect for a star,
// which glows on its own instead of being lit by something else.
const sunMaterial = new THREE.MeshBasicMaterial();
sunMaterial.toneMapped = false;

const sunMesh = new THREE.Mesh(sunGeometry, sunMaterial);
sunGroup.add(sunMesh);

// ---------- Hot haze (the glow) ----------
// A slightly larger sphere rendered inside-out (BackSide), so we
// only see its far half behind the Sun — a ring around the edge.
//
// The trick that makes it look like hot gas instead of a halo:
// measure how close each point is to the silhouette edge, then
// fade the haze IN as it approaches the edge and OUT again right
// at the edge. That "faint → bright → faint" band hugs the disc.
// This is only a visual approximation of the Sun's real edge.

const glowIntensity = uniform(settings.glowIntensity);
const glowOpacity = uniform(settings.glowOpacity);
const glowColor = uniform(new THREE.Color("#ffd4a0"));

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
glowMaterial.outputNode = vec4(glowColor.mul(haze), haze.mul(1.0).mul(glowOpacity));

const glowMesh = new THREE.Mesh(
  new THREE.SphereGeometry(SUN_RADIUS, 96, 48),
  glowMaterial
);
// The shell is scaled up around the Sun; the Radius slider changes this
glowMesh.scale.setScalar(settings.glowRadius);
sunGroup.add(glowMesh);

// ---------- Corona halo ----------
// A sprite (a flat picture that always faces the camera) with a
// soft radial gradient painted on a canvas. It sits slightly
// behind the Sun so the sphere hides the middle of the halo.

const coronaCanvas = document.createElement("canvas");
coronaCanvas.width = 512;
coronaCanvas.height = 512;
const coronaContext = coronaCanvas.getContext("2d");

const coronaTexture = new THREE.CanvasTexture(coronaCanvas);
coronaTexture.colorSpace = THREE.SRGBColorSpace;

const coronaMaterial = new THREE.SpriteMaterial({
  map: coronaTexture,
  transparent: true,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  toneMapped: false,
});

const coronaSprite = new THREE.Sprite(coronaMaterial);
scene.add(coronaSprite);

// Paints the halo gradient. Runs once at start and again
// whenever a corona setting changes in the GUI (not every frame).
function drawCorona() {
  const size = coronaCanvas.width;
  const center = size / 2;

  // The sprite is bigger than the Sun. This is where the visible
  // edge of the disc lands inside the sprite (0 = center, 1 = border).
  const discEdge = 1 / (1 + settings.coronaSize);

  coronaContext.clearRect(0, 0, size, size);

  const gradient = coronaContext.createRadialGradient(
    center, center, center * discEdge * 0.9,
    center, center, center
  );

  const strength = settings.coronaIntensity;
  gradient.addColorStop(0.0,  `rgba(255, 214, 156, ${0.5 * strength})`);
  gradient.addColorStop(0.12, `rgba(255, 178, 94, ${0.32 * strength})`);
  gradient.addColorStop(0.35, `rgba(255, 140, 66, ${0.12 * strength})`);
  gradient.addColorStop(0.7,  `rgba(255, 110, 50, ${0.035 * strength})`);
  gradient.addColorStop(1.0,  "rgba(255, 100, 40, 0)");

  coronaContext.fillStyle = gradient;
  coronaContext.fillRect(0, 0, size, size);
  coronaTexture.needsUpdate = true;
}

function updateCoronaScale() {
  const spriteSize = SUN_RADIUS * 2 * (1 + settings.coronaSize);
  coronaSprite.scale.set(spriteSize, spriteSize, 1);
}

drawCorona();
updateCoronaScale();

// ---------- Apply settings ----------

function applyAxialTilt() {
  // Tilt the whole group; the spin (rotation.y) happens inside it
  sunGroup.rotation.z = THREE.MathUtils.degToRad(settings.axialTiltDegrees);
}

function applySurfaceBrightness() {
  // Multiplying the material color brightens or darkens the texture
  sunMaterial.color.setScalar(settings.surfaceBrightness);
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
applySurfaceBrightness();

// ---------- GUI (lil-gui control panel) ----------

const gui = new GUI({ title: "Sun" });

const starFolder = gui.addFolder("Planet");
starFolder.add(settings, "autoRotate").name("Auto rotate");
starFolder.add(settings, "rotationSpeed", 0, 2, 0.01).name("Rotation speed");
starFolder.add(settings, "axialTiltDegrees", -180, 180, 0.1)
  .name("Axial tilt (deg)").onChange(applyAxialTilt);

const cameraFolder = gui.addFolder("Camera");
const distanceController = cameraFolder
  .add(settings, "cameraDistance", controls.minDistance, controls.maxDistance, 0.1)
  .name("Distance").onChange(applyCameraDistance);

const lightingFolder = gui.addFolder("Lighting");
lightingFolder.add(settings, "surfaceBrightness", 0.2, 2, 0.01)
  .name("Surface brightness").onChange(applySurfaceBrightness);

const glowFolder = gui.addFolder("Glow");
glowFolder.add(settings, "glowIntensity", 0, 5, 0.01).name("Edge light")
  .onChange(value => { glowIntensity.value = value; });
glowFolder.add(settings, "glowOpacity", 0, 1, 0.01).name("Edge opacity")
  .onChange(value => { glowOpacity.value = value; });
glowFolder.add(settings, "glowRadius", 1.001, 1.2, 0.001).name("Edge radius")
  .onChange(value => { glowMesh.scale.setScalar(value); });
glowFolder.add(settings, "coronaIntensity", 0, 3, 0.01).name("Corona intensity")
  .onChange(drawCorona);
glowFolder.add(settings, "coronaSize", 0.2, 3, 0.01).name("Corona size")
  .onChange(() => { drawCorona(); updateCoronaScale(); });

// If the user zooms with the mouse wheel, keep the GUI slider in sync.
controls.addEventListener("change", () => {
  if (applyingCameraDistance) return;
  settings.cameraDistance = camera.position.distanceTo(controls.target);
  distanceController.updateDisplay();
});

// ---------- Dragging: the Sun vs empty space ----------
// OrbitControls already orbits the camera when you drag anywhere.
// Extra rule: if a drag STARTS on the Sun itself, spin the Sun
// instead, and pause the camera controls until the drag ends.

const raycaster = new THREE.Raycaster();
const pointerPosition = new THREE.Vector2();
let draggingSun = false;
let lastPointerX = 0;
let spinAngle = 0; // current rotation of the Sun around its own axis

function pointerHitsSun(event) {
  // Convert the mouse position to the -1..+1 range Three.js expects
  const bounds = renderer.domElement.getBoundingClientRect();
  pointerPosition.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
  pointerPosition.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;

  // The raycaster shoots a line from the camera through the pointer
  raycaster.setFromCamera(pointerPosition, camera);
  return raycaster.intersectObject(sunMesh, false).length > 0;
}

renderer.domElement.addEventListener("pointerdown", event => {
  if (!event.isPrimary || event.button !== 0) return;
  if (!pointerHitsSun(event)) return; // empty space → OrbitControls takes over

  draggingSun = true;
  lastPointerX = event.clientX;
  controls.enabled = false; // pause the camera while spinning the Sun
  renderer.domElement.setPointerCapture(event.pointerId);
});

renderer.domElement.addEventListener("pointermove", event => {
  if (!draggingSun) return;
  const deltaX = event.clientX - lastPointerX;
  lastPointerX = event.clientX;
  spinAngle += deltaX * 0.005; // pixels moved → radians of spin
});

function endSunDrag() {
  if (!draggingSun) return;
  draggingSun = false;
  controls.enabled = true;
}

renderer.domElement.addEventListener("pointerup", endSunDrag);
renderer.domElement.addEventListener("pointercancel", endSunDrag);

// ---------- Resize ----------

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- Load the texture, then start ----------

const sunTexture = await loadTexture(TEXTURE_URL);
sunMaterial.map = sunTexture;
sunMaterial.needsUpdate = true;

loadingOverlay.classList.add("hidden");

// ---------- Animation loop ----------

const clock = new THREE.Clock();
const towardCamera = new THREE.Vector3();

function animate() {
  const deltaTime = clock.getDelta();

  // Auto rotation (paused while the user is dragging the Sun)
  if (settings.autoRotate && !draggingSun) {
    spinAngle += deltaTime * BASE_SPIN_SPEED * settings.rotationSpeed;
  }
  sunMesh.rotation.y = spinAngle;

  // Keep the corona slightly behind the Sun along the view direction,
  // so the sphere hides the halo's center and only the ring shows.
  towardCamera.copy(camera.position).sub(sunGroup.position).normalize();
  coronaSprite.position.copy(sunGroup.position)
    .addScaledVector(towardCamera, -SUN_RADIUS * 0.25);

  controls.update(); // needed for the damping to work
  renderer.render(scene, camera);
}

renderer.setAnimationLoop(animate);
