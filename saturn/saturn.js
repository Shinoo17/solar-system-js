// ============================================================
//  Saturn — standalone Three.js WebGPU page
//
//  Everything this page needs lives inside the saturn/ folder.
//
//  This page uses the WebGPU build of Three.js. The glow
//  effects are written in TSL (Three Shading Language) — small
//  chainable nodes instead of raw shader strings. If the browser
//  has no WebGPU, Three.js automatically falls back to WebGL2.
//
//  Saturn has four extra visual layers on top of the planet:
//    1. RINGS        — a flat disc with a radial texture strip
//    2. Rim light    — a subtle haze band hugging the planet's edge
//    3. Ring scatter — the rings glow softly when seen edge-on,
//                      like sunlight bouncing through the ice
//    4. Ice sparkle  — tiny glinting points inside the rings
//    5. Edge bloom   — a thin soft light just past the outer edge
//
//  How the lighting works:
//  One directional light acts as the Sun. The side of the planet
//  (and the rings) facing it is bright; the far side receives no
//  light and stays dark. The soft blend in between is called the
//  terminator line.
// ============================================================

import * as THREE from "three/webgpu";
import {
  cameraPosition,
  normalWorldGeometry,
  positionWorld,
  texture,
  uniform,
  uv,
  vec4,
} from "three/tsl";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import GUI from "lil-gui";

// ---------- Page settings (also editable from the GUI) ----------

const TEXTURE_URL = "./texture/8k_saturn.jpg";
const RING_TEXTURE_URL = "./texture/8k_saturn_ring_alpha.png";
const SATURN_RADIUS = 2;
const RING_INNER_RADIUS = SATURN_RADIUS * 1.24;
const RING_OUTER_RADIUS = SATURN_RADIUS * 2.27;
const BASE_SPIN_SPEED = 0.15; // radians per second at speed 1.0

const settings = {
  autoRotate: true,
  rotationSpeed: 0.7,
  axialTiltDegrees: 26.7,  // Saturn's real tilt — why we see the rings at an angle
  cameraDistance: 9.5,
  lightIntensity: 2.4,
  fillIntensity: 0.35,
  backIntensity: 0.9,
  glowIntensity: 0.5,     // subtle haze band on the planet's edge
  glowOpacity: 0.9,
  glowRadius: 1.12,        // size of the haze shell (times planet radius)
  roughness: 0.95,
  metalness: 0.0,
  colorTint: "#ffffff",
  showRings: true,
  ringOpacity: 1.0,
  ringScatter: 0.5,        // soft glow when the rings are seen edge-on
  ringSparkle: 0.7,        // tiny ice glints inside the rings
  ringEdgeBloom: 0.6,      // thin light just past the outer edge
  showFps: true,           // little frame-rate readout in the corner
};

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
      "\n\nthen open http://localhost:8000/saturn/saturn.html";
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
function loadTexture(url) {
  const loader = new THREE.TextureLoader();
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      tex => {
        tex.colorSpace = THREE.SRGBColorSpace;
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
scene.background = new THREE.Color(0x030409);

const camera = new THREE.PerspectiveCamera(
  45, window.innerWidth / window.innerHeight, 0.1, 300
);
camera.position.set(0, 1.4, settings.cameraDistance);

// WebGPURenderer is the single renderer used by every body page.
const renderer = new THREE.WebGPURenderer({
  canvas: document.getElementById("planetCanvas"),
  antialias: true,
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;

// Its setup is asynchronous, so wait before creating controls and objects.
await renderer.init();

// OrbitControls: dragging empty space orbits the camera around Saturn.
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.enablePan = false;
controls.minDistance = 4.5;
controls.maxDistance = 26;

// ---------- Lighting ----------
// Three lights make the day/night shadow read as light, not just a
// flat cutout: a warm KEY light (the Sun) lights one hemisphere and
// leaves the other in shadow — that's the terminator line. A dim,
// cool BACK light from roughly the opposite direction keeps the
// shadow side from going pure black and puts a faint highlight on
// the silhouette edge. A tinted ambient FILL softens the shadow a
// little more without erasing it.

const keyLight = new THREE.DirectionalLight(0xfff2dc, settings.lightIntensity);
// Placed a little above the ring plane, so the rings catch light too
keyLight.position.set(80, 30, 40);
scene.add(keyLight);

const backLight = new THREE.DirectionalLight(0xbfd4ff, settings.backIntensity);
backLight.position.set(-60, 12, -80);
scene.add(backLight);

const fillLight = new THREE.AmbientLight(0x223044, settings.fillIntensity);
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

// ---------- Load both textures before building Saturn ----------

const [saturnTexture, ringTexture] = await Promise.all([
  loadTexture(TEXTURE_URL),
  loadTexture(RING_TEXTURE_URL),
]);

// ---------- The planet ----------

// This group carries the axial tilt. Planet AND rings live inside
// it, so tilting the group tilts them together — just like reality.
const saturnGroup = new THREE.Group();
scene.add(saturnGroup);

const saturnGeometry = new THREE.SphereGeometry(SATURN_RADIUS, 128, 64);

// StandardMaterial reacts to lights: bright toward the sun light,
// dark away from it, with a soft terminator in between.
const saturnMaterial = new THREE.MeshStandardMaterial({
  map: saturnTexture,
  roughness: settings.roughness,
});

const saturnMesh = new THREE.Mesh(saturnGeometry, saturnMaterial);
saturnGroup.add(saturnMesh);

// ---------- Rim light (subtle planet haze) ----------
// A slightly larger sphere rendered inside-out (BackSide), so we
// only see its far half behind the planet — a ring around the edge.
// The haze fades IN near the silhouette edge and OUT right at the
// edge ("faint → bright → faint"), hugging the limb like a thin
// atmosphere. Kept subtle — Saturn's haze is much fainter than
// Earth's blue sky. This is a visual approximation, not physics.

const glowIntensity = uniform(settings.glowIntensity);
const glowOpacity = uniform(settings.glowOpacity);
const glowColor = uniform(new THREE.Color("#ffe3b0"));

// 0 when the surface faces the camera, 1 at the silhouette edge
const glowViewDirection = cameraPosition.sub(positionWorld).normalize();
const edgeCloseness = normalWorldGeometry.dot(glowViewDirection).abs().oneMinus();

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
  new THREE.SphereGeometry(SATURN_RADIUS, 96, 48),
  glowMaterial
);
// The shell is scaled up around the planet; the Radius slider changes this
glowMesh.scale.setScalar(settings.glowRadius);
saturnGroup.add(glowMesh);

// ---------- Ring geometry helper ----------
// RingGeometry's default UVs map a texture like a flat photo, but
// our ring texture is a thin STRIP (inner edge → outer edge). So we
// rewrite the UVs: u = 0 at innerRadius, u = 1 at outerRadius.
// The texture strip AND the edge-bloom fade both read this value.

function createRadialRingGeometry(innerRadius, outerRadius) {
  const geometry = new THREE.RingGeometry(innerRadius, outerRadius, 256, 1);

  const positions = geometry.attributes.position;
  const uvs = geometry.attributes.uv;
  const vertex = new THREE.Vector3();

  for (let i = 0; i < positions.count; i++) {
    vertex.fromBufferAttribute(positions, i);
    // Distance of this vertex from the planet center
    const radius = vertex.length();
    // 0 at the inner edge, 1 at the outer edge
    const along = (radius - innerRadius) / (outerRadius - innerRadius);
    uvs.setXY(i, along, 0.5);
  }

  return geometry;
}

// All ring layers live in one group, so "Show rings" hides them all
const ringGroup = new THREE.Group();
saturnGroup.add(ringGroup);

// ---------- 1. The main ring disc ----------

const ringGeometry = createRadialRingGeometry(RING_INNER_RADIUS, RING_OUTER_RADIUS);

// The ring texture PNG has transparency built in (the gaps
// between the rings), so we just enable `transparent`.
const ringMaterial = new THREE.MeshStandardMaterial({
  map: ringTexture,
  transparent: true,
  opacity: settings.ringOpacity,
  side: THREE.DoubleSide, // visible from above AND below
  roughness: 1,
  metalness: 0,
  // Keep the texture readable when the camera sees the side facing away
  // from the key light. This is a small ambient-light approximation, not
  // a glow: the brighter ring bands still come from the original texture.
  emissive: new THREE.Color("#514838"),
  emissiveMap: ringTexture,
  emissiveIntensity: 0.45,
  depthWrite: false,
});

const ringMesh = new THREE.Mesh(ringGeometry, ringMaterial);
// RingGeometry starts standing upright — lay it flat like a table
ringMesh.rotation.x = -Math.PI / 2;
ringGroup.add(ringMesh);

// ---------- 2. Ring scattering glow ----------
// Real rings are countless ice chunks. When you look along the ring
// plane (edge-on), you look through more ice, and scattered sunlight
// makes the rings glow. Approximation: the flatter the viewing
// angle, the stronger an additive glow masked by the ring texture.

const scatterStrength = uniform(settings.ringScatter);
const scatterColor = uniform(new THREE.Color("#f4e3c2"));

const scatterViewDirection = cameraPosition.sub(positionWorld).normalize();
// 0 when looking straight down at the ring plane, 1 when edge-on
const edgeOnAmount = normalWorldGeometry.dot(scatterViewDirection).abs().oneMinus().pow(2.0);

// The old formula used edgeOnAmount directly, so the scatter became exactly
// zero in top view. Keep 35% as a soft visibility floor, then smoothly add the
// remaining 65% as the camera moves toward an edge-on view.
const scatterByView = edgeOnAmount.mul(0.65).add(0.35);

// Only where the ring actually has material (texture alpha)
const ringDensity = texture(ringTexture, uv()).a;
const scatter = ringDensity.mul(scatterByView).mul(scatterStrength);

const scatterMaterial = new THREE.MeshBasicNodeMaterial({
  side: THREE.DoubleSide,
  transparent: true,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});
scatterMaterial.outputNode = vec4(scatterColor.mul(scatter), scatter.mul(0.5));

const scatterMesh = new THREE.Mesh(ringGeometry, scatterMaterial);
scatterMesh.rotation.x = -Math.PI / 2;
scatterMesh.renderOrder = 2; // draw after the main ring disc
ringGroup.add(scatterMesh);

// ---------- 3. Ice particle sparkle ----------
// A few hundred tiny additive points scattered inside the ring
// band. Two clouds pulse with offset rhythms, so some points are
// always brightening while others fade — a gentle glitter.

function createSparkleCloud(count) {
  const positions = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    // Random spot inside the ring band (in the flat ring plane)
    const angle = Math.random() * Math.PI * 2;
    const radius = RING_INNER_RADIUS +
      Math.random() * (RING_OUTER_RADIUS - RING_INNER_RADIUS);

    positions[i * 3 + 0] = Math.cos(angle) * radius;
    positions[i * 3 + 1] = (Math.random() - 0.5) * 0.03; // tiny thickness
    positions[i * 3 + 2] = Math.sin(angle) * radius;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

  const material = new THREE.PointsMaterial({
    color: 0xfff6e0,
    size: 0.035,
    transparent: true,
    opacity: 0,                       // set every frame in animate()
    blending: THREE.AdditiveBlending, // sparkles add light
    depthWrite: false,
  });

  return new THREE.Points(geometry, material);
}

const sparkleCloudA = createSparkleCloud(320);
const sparkleCloudB = createSparkleCloud(320);
ringGroup.add(sparkleCloudA, sparkleCloudB);

// ---------- 4. Thin bloom on the ring edge ----------
// A narrow extra ring just OUTSIDE the outer edge. Its radial uv
// goes 0 → 1 across the narrow band, so fading by (1 - u) makes
// the light strongest at the ring edge and gone a little further
// out — a thin soft bloom.

const edgeBloomStrength = uniform(settings.ringEdgeBloom);
const edgeBloomColor = uniform(new THREE.Color("#f0dcb4"));

const bloomFade = uv().x.oneMinus().pow(2.5);
const bloom = bloomFade.mul(edgeBloomStrength);

const edgeBloomMaterial = new THREE.MeshBasicNodeMaterial({
  side: THREE.DoubleSide,
  transparent: true,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});
edgeBloomMaterial.outputNode = vec4(edgeBloomColor.mul(bloom), bloom.mul(0.5));

const edgeBloomMesh = new THREE.Mesh(
  createRadialRingGeometry(RING_OUTER_RADIUS, RING_OUTER_RADIUS * 1.06),
  edgeBloomMaterial
);
edgeBloomMesh.rotation.x = -Math.PI / 2;
edgeBloomMesh.renderOrder = 3;
ringGroup.add(edgeBloomMesh);

// ---------- Apply settings ----------

function applyAxialTilt() {
  saturnGroup.rotation.z = THREE.MathUtils.degToRad(settings.axialTiltDegrees);
}

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

const gui = new GUI({ title: "Saturn" });

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
lightingFolder.add(settings, "lightIntensity", 0, 6, 0.05).name("Key light")
  .onChange(value => { keyLight.intensity = value; });
lightingFolder.add(settings, "fillIntensity", 0, 2, 0.01).name("Ambient")
  .onChange(value => { fillLight.intensity = value; });
lightingFolder.add(settings, "backIntensity", 0, 3, 0.01).name("Rim light")
  .onChange(value => { backLight.intensity = value; });

const glowFolder = gui.addFolder("Glow");
glowFolder.add(settings, "glowIntensity", 0, 3, 0.01).name("Outer glow")
  .onChange(value => { glowIntensity.value = value; });
glowFolder.add(settings, "glowOpacity", 0, 1, 0.01).name("Glow opacity")
  .onChange(value => { glowOpacity.value = value; });
glowFolder.add(settings, "glowRadius", 1.01, 1.35, 0.001).name("Glow radius")
  .onChange(value => { glowMesh.scale.setScalar(value); });

const ringFolder = gui.addFolder("Rings");
ringFolder.add(settings, "showRings").name("Show rings")
  .onChange(value => { ringGroup.visible = value; });
ringFolder.add(settings, "ringOpacity", 0, 1, 0.01).name("Opacity")
  .onChange(value => { ringMaterial.opacity = value; });
ringFolder.add(settings, "ringScatter", 0, 2, 0.01).name("Scatter glow")
  .onChange(value => { scatterStrength.value = value; });
ringFolder.add(settings, "ringSparkle", 0, 2, 0.01).name("Ice sparkle");
ringFolder.add(settings, "ringEdgeBloom", 0, 2, 0.01).name("Edge bloom")
  .onChange(value => { edgeBloomStrength.value = value; });

const materialFolder = gui.addFolder("Material");
materialFolder.add(settings, "roughness", 0, 1, 0.01).name("Roughness")
  .onChange(value => { saturnMaterial.roughness = value; });
materialFolder.add(settings, "metalness", 0, 1, 0.01).name("Metalness")
  .onChange(value => { saturnMaterial.metalness = value; });
materialFolder.addColor(settings, "colorTint").name("Color tint")
  .onChange(value => { saturnMaterial.color.set(value); });

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

// ---------- Dragging: planet vs camera ----------
// Dragging the planet spins Saturn. Dragging the rings or empty space
// orbits the camera via OrbitControls. When the rings visually overlap
// the planet, the planet wins so the interaction follows what is visible.

const raycaster = new THREE.Raycaster();
const pointerPosition = new THREE.Vector2();
let draggingPlanet = false;
let lastPointerX = 0;
let spinAngle = 0;

function pointerHitsPlanet(event) {
  // Convert the mouse position to the -1..+1 range Three.js expects
  const bounds = renderer.domElement.getBoundingClientRect();
  pointerPosition.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
  pointerPosition.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;

  // The raycaster shoots a line from the camera through the pointer
  raycaster.setFromCamera(pointerPosition, camera);
  // Test the planet independently from the rings. This intentionally
  // gives the planet first priority even if a ring surface is closer.
  return raycaster.intersectObject(saturnMesh, false).length > 0;
}

renderer.domElement.addEventListener("pointerdown", event => {
  if (!event.isPrimary || event.button !== 0) return;
  if (!pointerHitsPlanet(event)) return; // rings / empty space → OrbitControls

  // This listener runs in the capture phase, before OrbitControls starts
  // a camera drag. Only planet drags are intercepted.
  event.stopImmediatePropagation();
  draggingPlanet = true;
  lastPointerX = event.clientX;
  controls.enabled = false; // pause the camera while spinning Saturn
  renderer.domElement.setPointerCapture(event.pointerId);
}, { capture: true });

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
  const elapsed = clock.elapsedTime;

  // Auto rotation (paused while the user is dragging Saturn)
  if (settings.autoRotate && !draggingPlanet) {
    spinAngle += deltaTime * BASE_SPIN_SPEED * settings.rotationSpeed;
  }
  // Planet and rings rotate together around the same tilted axis
  saturnMesh.rotation.y = spinAngle;
  ringMesh.rotation.z = spinAngle; // the ring lies flat, so its spin axis is z

  // Sparkle: the two clouds drift slowly and pulse with offset
  // rhythms, so some ice glints brighten while others fade.
  sparkleCloudA.rotation.y = elapsed * 0.015;
  sparkleCloudB.rotation.y = -elapsed * 0.011;
  const pulseA = 0.35 + 0.3 * Math.sin(elapsed * 2.1);
  const pulseB = 0.35 + 0.3 * Math.sin(elapsed * 2.7 + 2.0);
  sparkleCloudA.material.opacity = settings.ringSparkle * pulseA;
  sparkleCloudB.material.opacity = settings.ringSparkle * pulseB;

  controls.update(); // needed for the damping to work
  renderer.render(scene, camera);
}

renderer.setAnimationLoop(animate);
