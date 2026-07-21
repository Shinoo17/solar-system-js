// ============================================================
//  Jupiter — standalone Three.js WebGPU page
//
//  Everything this page needs lives inside the jupiter/ folder.
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
  cameraPosition, Fn, mx_noise_float, normalView, normalWorldGeometry,
  positionWorld, texture, uniform, uv, vec2, vec3, vec4,
} from "three/tsl";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import GUI from "lil-gui";

// ---------- Page settings (also editable from the GUI) ----------

const TEXTURE_URL = "./texture/8k_jupiter.jpg";
const PLANET_RADIUS = 2;
const BASE_SPIN_SPEED = 0.15; // radians per second at speed 1.0

// Beginner config: change this to false to start with a frozen atmosphere.
// Pausing keeps the latest shader frame, so the image does not jump.
const CONFIG = {
  atmosphereAnimation: true,
};

const settings = {
  atmosphereAnimation: CONFIG.atmosphereAnimation,
  windSpeed: 1.0,
  turbulence: 1.0,
  redSpotStorm: 1.0,
  autoRotate: true,
  rotationSpeed: 0.25,
  axialTiltDegrees: 3.1, // Jupiter stands almost straight up
  cameraDistance: 6.0,
  lightIntensity: 3.2,
  fillIntensity: 1.6,   // thick cloud deck scatters a lot of light around
  backIntensity: 0.5,
  roughness: 1.0,
  colorTint: "#ffffff",
  glowIntensity: 0.65,
  glowOpacity: 1.0,
  glowRadius: 1.1,
  glowColor: "#b89f75",
  showFps: true,         // little frame-rate readout in the corner
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
      "\n\nnpx serve ." +
      "\n\nthen open http://localhost:8000/jupiter/jupiter.html";
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
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
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
renderer.toneMappingExposure = 1.15;

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

// ---------- Animated atmosphere physics ----------
// The idea has three simple steps:
// 1. Wind moves cloud bands in different directions.
// 2. Turbulence bends the edges between those bands.
// 3. The Great Red Spot rotates the texture around the storm.
// Three animation phases are blended to create a smooth loop.

const flowPhase = uniform(0);
const noiseTime = uniform(0);
const turbulence = uniform(settings.turbulence);
const redSpotStorm = uniform(settings.redSpotStorm);
const animatedTint = uniform(new THREE.Color(settings.colorTint));

function gaussian(value, center, width) {
  const distance = value.sub(center).div(width);
  return distance.mul(distance).negate().exp(); // exp(-distance²)
}

const animatedJupiterColor = Fn(() => {
  const originalUV = uv();
  const latitude = originalUV.y.mul(2).sub(1); // -1 south to +1 north

  // Positive and negative speeds make neighboring bands flow in opposite directions.
  const polarDistance = latitude.div(0.62);
  const polarDistanceSquared = polarDistance.mul(polarDistance);
  const polarFade = polarDistanceSquared
    .mul(polarDistanceSquared)
    .mul(polarDistanceSquared)
    .negate()
    .exp();
  const wind = gaussian(latitude, 0.00, 0.09)
    .sub(gaussian(latitude, 0.17, 0.07).mul(0.85))
    .sub(gaussian(latitude, -0.17, 0.07).mul(0.85))
    .add(gaussian(latitude, 0.32, 0.05).mul(0.45))
    .add(gaussian(latitude, -0.32, 0.05).mul(0.45))
    .sub(gaussian(latitude, 0.46, 0.05).mul(0.25))
    .sub(gaussian(latitude, -0.46, 0.05).mul(0.25))
    .mul(polarFade);

  // Turbulence is strongest at the boundaries between wind bands.
  const shear = gaussian(latitude, 0.095, 0.05)
    .add(gaussian(latitude, -0.095, 0.05))
    .add(gaussian(latitude, 0.25, 0.05).mul(0.85))
    .add(gaussian(latitude, -0.25, 0.05).mul(0.85))
    .mul(polarFade)
    .add(0.12);

  function sampleAtmosphere(phase) {
    const centeredPhase = phase.sub(0.5);
    const movedX = originalUV.x.add(centeredPhase.mul(0.07).mul(wind));

    const noisePosition = vec3(movedX.mul(6), originalUV.y.mul(12), noiseTime);
    const noiseX = mx_noise_float(noisePosition)
      .add(mx_noise_float(noisePosition.mul(2.3)).mul(0.5));
    const noiseY = mx_noise_float(noisePosition.add(vec3(11.31, 7.77, 3.13)))
      .add(mx_noise_float(noisePosition.mul(2.3).add(vec3(4.1, 9.2, 1.7))).mul(0.5));
    const turbulenceOffset = vec2(noiseX, noiseY)
      .mul(turbulence.mul(0.0065).mul(shear))
      .mul(centeredPhase.mul(2));

    // This is the approximate Great Red Spot position in the texture.
    const spotX = movedX.sub(0.362).add(0.5).fract().sub(0.5);
    const spotDistance = vec2(spotX.mul(2), originalUV.y.sub(0.385));
    const spotRadius = spotDistance.length().div(0.055);
    const spotFade = spotRadius.mul(spotRadius).negate().exp();
    const angle = spotFade.mul(centeredPhase).mul(redSpotStorm).mul(2.4);
    const rotatedSpot = vec2(
      spotDistance.x.mul(angle.cos()).sub(spotDistance.y.mul(angle.sin())),
      spotDistance.x.mul(angle.sin()).add(spotDistance.y.mul(angle.cos())),
    );
    const spotOffset = vec2(
      rotatedSpot.x.sub(spotDistance.x).mul(0.5),
      rotatedSpot.y.sub(spotDistance.y),
    );

    const animatedUV = vec2(movedX, originalUV.y)
      .add(turbulenceOffset)
      .add(spotOffset);
    return texture(planetTexture, animatedUV);
  }

  function phaseWeight(phase) {
    const sine = phase.mul(Math.PI).sin();
    return sine.mul(sine);
  }

  const phase0 = flowPhase.fract();
  const phase1 = flowPhase.add(1 / 3).fract();
  const phase2 = flowPhase.add(2 / 3).fract();
  const color = sampleAtmosphere(phase0).mul(phaseWeight(phase0))
    .add(sampleAtmosphere(phase1).mul(phaseWeight(phase1)))
    .add(sampleAtmosphere(phase2).mul(phaseWeight(phase2)))
    .div(1.5);

  // Slightly darken the edge where we see the atmosphere at an angle.
  const viewAngle = normalView.z.clamp(0, 1);
  const limbDarkening = viewAngle.pow(0.55).mul(0.42).add(0.62);
  return color.rgb.mul(limbDarkening).mul(animatedTint);
});

const animatedMaterial = new THREE.MeshStandardNodeMaterial({
  roughness: settings.roughness,
  metalness: 0,
});
animatedMaterial.colorNode = animatedJupiterColor();

// Keep one material at all times. Pausing only stops the shader clock.
const planetMesh = new THREE.Mesh(planetGeometry, animatedMaterial);
planetGroup.add(planetMesh);

// ---------- Atmosphere glow ----------
// This uses the same edge-band effect as the original Jupiter and Earth.
// It fades in near the silhouette, then fades out at the outer edge.
const glowIntensity = uniform(settings.glowIntensity);
const glowOpacity = uniform(settings.glowOpacity);
const glowColor = uniform(new THREE.Color(settings.glowColor));

const glowViewDirection = cameraPosition.sub(positionWorld).normalize();
const edgeCloseness = normalWorldGeometry
  .dot(glowViewDirection)
  .abs()
  .oneMinus();
const glowFadeIn = edgeCloseness.smoothstep(0.10, 0.45);
const glowFadeOut = edgeCloseness.oneMinus().smoothstep(0.10, 0.55);
const glowBand = glowFadeIn.mul(glowFadeOut);
const haze = glowBand.pow(1.4).mul(glowIntensity);

const glowMaterial = new THREE.MeshBasicNodeMaterial({
  transparent: true,
  side: THREE.BackSide,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  depthTest: true,
  toneMapped: false,
});
glowMaterial.outputNode = vec4(
  glowColor.mul(haze),
  haze.mul(0.55).mul(glowOpacity),
);

const glowMesh = new THREE.Mesh(planetGeometry, glowMaterial);
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

const gui = new GUI({ title: "Jupiter" });

const planetFolder = gui.addFolder("Planet");
planetFolder.add(settings, "atmosphereAnimation")
  .name("Atmosphere animation");
planetFolder.add(settings, "autoRotate").name("Auto rotate");
planetFolder.add(settings, "rotationSpeed", 0, 2, 0.01).name("Rotation speed");
planetFolder.add(settings, "axialTiltDegrees", -180, 180, 0.1)
  .name("Axial tilt (deg)").onChange(applyAxialTilt);

const atmosphereFolder = gui.addFolder("Atmosphere physics");
atmosphereFolder.add(settings, "windSpeed", 0, 3, 0.01).name("Wind flow");
atmosphereFolder.add(settings, "turbulence", 0, 2.5, 0.01)
  .name("Turbulence").onChange(value => { turbulence.value = value; });
atmosphereFolder.add(settings, "redSpotStorm", 0, 1.5, 0.01)
  .name("Red Spot storm").onChange(value => { redSpotStorm.value = value; });

const glowFolder = gui.addFolder("Atmosphere glow");
glowFolder.add(settings, "glowIntensity", 0, 2, 0.01).name("Outer glow")
  .onChange(value => { glowIntensity.value = value; });
glowFolder.add(settings, "glowOpacity", 0, 1, 0.01).name("Glow opacity")
  .onChange(value => { glowOpacity.value = value; });
glowFolder.add(settings, "glowRadius", 1.01, 1.35, 0.001).name("Glow radius")
  .onChange(value => { glowMesh.scale.setScalar(value); });
glowFolder.addColor(settings, "glowColor").name("Glow color")
  .onChange(value => { glowColor.value.set(value); });

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

const materialFolder = gui.addFolder("Material");
materialFolder.add(settings, "roughness", 0, 1, 0.01).name("Roughness")
  .onChange(value => { animatedMaterial.roughness = value; });
materialFolder.addColor(settings, "colorTint").name("Color tint")
  .onChange(value => { animatedTint.value.set(value); });

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

// FPS: count frames, refresh the label twice a second
let fpsFrames = 0;
let fpsElapsed = 0;
let currentFlowPhase = 0;
let currentNoiseTime = 0;
let noiseDirection = 1;

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

  // Pausing stops time, so the atmosphere stays on its latest frame.
  if (settings.atmosphereAnimation) {
    currentFlowPhase = (
      currentFlowPhase + deltaTime * 0.06 * settings.windSpeed
    ) % 1;
    flowPhase.value = currentFlowPhase;

    currentNoiseTime += deltaTime * 0.05 * noiseDirection;
    if (currentNoiseTime > 240 || currentNoiseTime < 0) {
      noiseDirection *= -1;
      currentNoiseTime = THREE.MathUtils.clamp(currentNoiseTime, 0, 240);
    }
    noiseTime.value = currentNoiseTime;
  }

  // Auto rotation (paused while the user is dragging the planet)
  if (settings.autoRotate && !draggingPlanet) {
    spinAngle += deltaTime * BASE_SPIN_SPEED * settings.rotationSpeed;
  }
  planetMesh.rotation.y = spinAngle;

  controls.update(); // needed for the damping to work
  renderer.render(scene, camera);
}

renderer.setAnimationLoop(animate);
