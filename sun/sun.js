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
  float,
  mix,
  mx_fractal_noise_float,
  mx_noise_float,
  normalWorldGeometry,
  positionWorld,
  uniform,
  vec3,
  vec4,
} from "three/tsl";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import GUI from "lil-gui";

// ---------- Page settings (also editable from the GUI) ----------

const TEXTURE_URL = "./texture/8k_sun.jpg";
const SUN_RADIUS = 2;
const BASE_SPIN_SPEED = 0.15; // radians per second at speed 1.0

// The GUI exposes one neutral streak-length multiplier. Camera distance
// automatically scales it from a compact close-up to a longer wide view.
const STREAK_LENGTH_NEAR_SCALE = 0.43;
const STREAK_LENGTH_FAR_SCALE = 1.5;
const STREAK_ZOOM_NEAR_DISTANCE = 4.2;
const STREAK_ZOOM_FAR_DISTANCE = 10;

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
  streakIntensity: 1.0,    // brightness of the corona streaks
  streakLength: 1.0,       // master multiplier; camera distance supplies the scale
  streakDensity: 0.45,     // how many streaks survive the noise threshold
  streakSpeed: 0.3,        // how fast the streak noise flows
  streakOpacity: 0.65,     // overall transparency of the streak layers
  showFps: true,           // little frame-rate readout in the corner
};

// Respect the user's "reduce motion" preference: the streaks still
// render, they just stop flowing (rotation stays — it IS the content).
if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
  settings.streakSpeed = 0;
}

// ---------- Loading / error helpers ----------

const loadingOverlay = document.getElementById("loading");
const errorOverlay = document.getElementById("error");
const errorText = document.getElementById("errorText");
const fpsMeter = document.getElementById("fpsMeter");

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
controls.maxDistance = 20;

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

// ---------- Corona streaks ----------
// Faint radial plasma streaks around the limb. One transparent
// sphere shell (2x the Sun) whose material ignores the sphere's
// own surface and instead works per screen pixel:
//
//   1. Shoot the view ray for this pixel and find how far it
//      passes from the Sun's center ("apparent radius"). That
//      says exactly where the pixel sits: on the disc, just off
//      the edge, or far out.
//   2. The DIRECTION of that closest point picks a value from a
//      3D noise field. Because the direction is the same all the
//      way along a ray, one noise blob smears into a thin streak
//      pointing radially outward — like combed plasma.
//   3. Noise also decides each streak's length and brightness,
//      so they are irregular and sparse instead of a uniform fan.
//
// Three noise LAYERS (short fine streaks / medium / long sparse
// wisps) are summed inside one material. They started life as
// three separate shells, but every shell repeated the ray math
// and re-shaded the same limb pixels; merged, the same picture
// costs roughly a third of the fragment work and one draw call.
//
// BackSide keeps the shell visible even when the camera dips
// inside it, and the Sun's depth buffer hides everything behind
// the disc. Blending is One + One with the color pre-multiplied
// in the shader — exactly what the three additive shells used to
// add up to, just done in a single pass.

const streakIntensity = uniform(settings.streakIntensity);
const streakLength = uniform(settings.streakLength);
const streakDensity = uniform(settings.streakDensity);
const streakOpacity = uniform(settings.streakOpacity);
const streakPhase = uniform(0); // advanced a little every frame

// Warm white at the surface, deeper orange further out
const streakColorInner = uniform(new THREE.Color("#ffe9c4"));
const streakColorOuter = uniform(new THREE.Color("#ff8f3c"));

const CORONA_SHELL_SCALE = 2.0; // outermost layer's reach, in Sun radii

// -- Where is this pixel relative to the Sun's silhouette? --
// Computed once and shared by all three layers.
const rayDirection = positionWorld.sub(cameraPosition).normalize();
const toSunCenter = cameraPosition.negate(); // the Sun sits at the origin
const alongRay = toSunCenter.dot(rayDirection);
const closestPoint = cameraPosition.add(rayDirection.mul(alongRay));
const apparentRadius = closestPoint.length();
const radialDirection = closestPoint.div(apparentRadius.max(0.001));

// Fade in right at the limb, so the disc itself never brightens
const limbFade = apparentRadius.smoothstep(SUN_RADIUS * 0.98, SUN_RADIUS * 1.015);

// One slow shimmer shared by every layer
const flicker = mx_noise_float(
  radialDirection.mul(2.5).add(vec3(0, streakPhase.mul(0.6), streakPhase.mul(0.4)))
).mul(0.5).add(0.5).mul(0.35).add(0.75);

function coronaLayer({ scale, frequency, octaves, sparsity, weight, drift }) {
  // 0 at the Sun's edge, 1 at this layer's outer reach
  const layerDepth = SUN_RADIUS * scale - SUN_RADIUS;
  const reach = apparentRadius.sub(SUN_RADIUS).div(layerDepth).clamp(0, 1);

  // -- Streak pattern from noise --
  // A tiny reach-dependent shear bends the streaks so they are
  // not perfectly straight spokes; the phase offset makes the
  // whole field drift and flicker very slowly.
  const phase = streakPhase.mul(drift);
  const bend = radialDirection.cross(vec3(0, 1, 0)).mul(reach.mul(0.35));
  const samplePoint = radialDirection.mul(frequency)
    .add(bend)
    .add(vec3(phase.mul(0.31), phase.mul(0.17), phase.mul(-0.23)));

  // Only the peaks of the noise survive the threshold, which is
  // what keeps the streaks sparse. Density lowers the threshold.
  const noiseValue = mx_fractal_noise_float(samplePoint, octaves, 2.3, 0.55);
  const threshold = float(0.55 + sparsity).sub(streakDensity.mul(0.45));
  const streakMask = noiseValue.smoothstep(threshold, threshold.add(0.35));

  // Each streak gets its own length and brightness from more noise
  // (sampled at fixed offsets so the values are independent).
  const lengthNoise = mx_noise_float(
    radialDirection.mul(frequency * 0.55).add(vec3(13.7, 31.4, 7.9))
  ).mul(0.5).add(0.5);
  // Squaring the noise biases toward short streaks with a few long ones
  const localLength = streakLength
    .mul(lengthNoise.mul(lengthNoise).mul(1.4).add(0.25)).max(0.06);
  const radialFalloff = reach.div(localLength).oneMinus().max(0).pow(1.7);

  const brightness = mx_noise_float(
    radialDirection.mul(frequency * 1.4).add(vec3(3.1, 91.2, 41.5))
  ).mul(0.5).add(0.5).mul(0.55).add(0.6);

  // Fade out well before the layer's outer rim, no hard edge
  const rimFade = reach.oneMinus().smoothstep(0, 0.25);

  const strength = streakMask
    .mul(radialFalloff).mul(brightness).mul(flicker)
    .mul(limbFade).mul(rimFade)
    .mul(streakIntensity).mul(weight);

  const color = mix(streakColorInner, streakColorOuter, reach.smoothstep(0, 0.75));

  // Pre-multiplied additive contribution. The strength² matches
  // what AdditiveBlending's srcColor × srcAlpha used to produce,
  // so the merged shell looks identical to the three old ones.
  return color.mul(strength.mul(strength));
}

// Inner layer: many short fine streaks hugging the surface.
// Outer layers: progressively sparser, wider, fainter wisps
// (and cheaper: 2 noise octaves instead of 3 — the extra detail
// octave is invisible at their lower frequencies).
const coronaLight = coronaLayer(
  { scale: 1.3, frequency: 14.0, octaves: 3, sparsity: 0.0,  weight: 1.0,  drift: 1.0 })
  .add(coronaLayer(
  { scale: 1.6, frequency: 9.0,  octaves: 2, sparsity: 0.12, weight: 0.55, drift: 0.7 }))
  .add(coronaLayer(
  { scale: 2.0, frequency: 5.5,  octaves: 2, sparsity: 0.26, weight: 0.32, drift: 0.5 }))
  .mul(streakOpacity);

const streakMaterial = new THREE.MeshBasicNodeMaterial({
  side: THREE.BackSide,
  transparent: true,
  depthWrite: false,
});
streakMaterial.blending = THREE.CustomBlending;
streakMaterial.blendEquation = THREE.AddEquation;
streakMaterial.blendSrc = THREE.OneFactor;
streakMaterial.blendDst = THREE.OneFactor;
streakMaterial.outputNode = vec4(coronaLight, 0);

const coronaStreakMesh = new THREE.Mesh(
  new THREE.SphereGeometry(SUN_RADIUS, 64, 32),
  streakMaterial
);
coronaStreakMesh.scale.setScalar(CORONA_SHELL_SCALE);
sunGroup.add(coronaStreakMesh);

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

const streaksFolder = gui.addFolder("Corona streaks");
streaksFolder.add(settings, "streakIntensity", 0, 3, 0.01).name("Intensity")
  .onChange(value => { streakIntensity.value = value; });
streaksFolder.add(settings, "streakLength", 0.1, 2, 0.01)
  .name("Streak length");
streaksFolder.add(settings, "streakDensity", 0, 1, 0.01).name("Density")
  .onChange(value => { streakDensity.value = value; });
streaksFolder.add(settings, "streakSpeed", 0, 2, 0.01).name("Flow speed");
streaksFolder.add(settings, "streakOpacity", 0, 1, 0.01).name("Opacity")
  .onChange(value => { streakOpacity.value = value; });

function applyFpsVisibility() {
  fpsMeter.classList.toggle("hidden", !settings.showFps);
}
gui.add(settings, "showFps").name("Show FPS").onChange(applyFpsVisibility);
applyFpsVisibility();

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

// FPS: count frames, refresh the label twice a second
let fpsFrames = 0;
let fpsElapsed = 0;

function animate() {
  const deltaTime = clock.getDelta();

  fpsFrames++;
  fpsElapsed += deltaTime;
  if (fpsElapsed >= 0.5) {
    if (settings.showFps) {
      fpsMeter.textContent = `${Math.round(fpsFrames / fpsElapsed)} fps`;
    }
    fpsFrames = 0;
    fpsElapsed = 0;
  }

  // Auto rotation (paused while the user is dragging the Sun)
  if (settings.autoRotate && !draggingSun) {
    spinAngle += deltaTime * BASE_SPIN_SPEED * settings.rotationSpeed;
  }
  sunMesh.rotation.y = spinAngle;

  // Drift the corona noise. Advancing an accumulated phase (rather
  // than multiplying raw time by speed) means changing the speed
  // slider never makes the pattern jump.
  streakPhase.value += deltaTime * settings.streakSpeed;

  // Keep the corona slightly behind the Sun along the view direction,
  // so the sphere hides the halo's center and only the ring shows.
  towardCamera.copy(camera.position).sub(sunGroup.position).normalize();
  coronaSprite.position.copy(sunGroup.position)
    .addScaledVector(towardCamera, -SUN_RADIUS * 0.25);

  controls.update(); // needed for the damping to work

  // Shorten the streaks near the Sun and gradually extend them as the
  // camera zooms out. The fixed distance range makes the full effect
  // visible before the camera reaches its maximum zoom-out distance.
  const cameraDistance = camera.position.distanceTo(controls.target);
  const zoomRatio = THREE.MathUtils.smoothstep(
    cameraDistance,
    STREAK_ZOOM_NEAR_DISTANCE,
    STREAK_ZOOM_FAR_DISTANCE,
  );
  const distanceScale = THREE.MathUtils.lerp(
    STREAK_LENGTH_NEAR_SCALE,
    STREAK_LENGTH_FAR_SCALE,
    zoomRatio,
  );
  const targetStreakLength = settings.streakLength * distanceScale;

  // Ease toward the target so wheel and touch zooming do not make the
  // corona jump abruptly. This remains consistent across frame rates.
  const streakLengthEase = 1 - Math.exp(-7 * deltaTime);
  streakLength.value = THREE.MathUtils.lerp(
    streakLength.value,
    targetStreakLength,
    streakLengthEase,
  );

  renderer.render(scene, camera);
}

renderer.setAnimationLoop(animate);
