import * as THREE from "three/webgpu";
import {
  cameraPosition,
  instancedBufferAttribute,
  mx_noise_float,
  normalLocal,
  normalWorldGeometry,
  positionWorld,
  texture,
  time,
  uniform,
  vec3,
  vec4,
} from "three/tsl";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import GUI from "lil-gui";

const SUN_RADIUS = 2;
const BASE_SPIN_SPEED = 0.15;

// Motion and diagnostics added alongside the visual controls below.
const controlsConfig = {
  rotationSpeed: 0.25,
  axialTiltDegrees: 7.25,
  showFps: true,
};

// Internal visual defaults.
const settings = {
  surfaceVisible: true,
  animationSpeed: 0.15,
  noiseScale: 8.0,
  noiseContrast: 2.0,
  noiseStrength: 1.35,
  baseBrightness: 0.20,
  fresnelStrength: 0.45,
  surfaceBrightness: 1.2,
  surfaceColor: "#fff1c4",

  edgeGlowVisible: true,
  edgeLightIntensity: 2.4,
  edgeOpacity: 0.94,
  edgeRadius: 1.067,

  coronaVisible: true,
  coronaCount: 600,
  coronaSize: 0.65,
  coronaStretch: 1.0,
  coronaBrightness: 0.35,
  coronaLifetime: 2.0,

  flaresVisible: true,
  flareCount: 20,
  flareEmitRate: 1.0,
  flareSize: 1.15,
  flareBrightness: 1.0,
  flareLifetime: 10,
  flareDrift: 1.0,
  flareStartColor: "#fff36a",
  flarePeakColor: "#ff9d16",
  flareEndColor: "#a92f00",

  cameraDistance: 6,
  exposure: 1.15,
};

// ---------- Error overlay ----------

const loadingOverlay = document.getElementById("loading");
const errorOverlay = document.getElementById("error");
const errorText = document.getElementById("errorText");
const fpsMeter = document.getElementById("fpsMeter");

function showError(error) {
  console.error(error);
  loadingOverlay.classList.add("hidden");
  errorOverlay.classList.remove("hidden");
  errorText.textContent = error?.message || String(error);
}

window.addEventListener("error", event => {
  showError(event.error || new Error(event.message));
});

window.addEventListener("unhandledrejection", event => {
  event.preventDefault();
  showError(event.reason || new Error("Unhandled promise rejection"));
});

function loadTexture(url) {
  return new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(
      url,
      texture => {
        texture.colorSpace = THREE.SRGBColorSpace;
        resolve(texture);
      },
      undefined,
      () => reject(new Error(`Could not load texture: ${url}`))
    );
  });
}

// ---------- Scene ----------

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x020205);

const camera = new THREE.PerspectiveCamera(
  45,
  window.innerWidth / window.innerHeight,
  0.1,
  100
);
camera.position.set(0, 0.25, settings.cameraDistance);

const renderer = new THREE.WebGPURenderer({
  canvas: document.getElementById("planetCanvas"),
  antialias: true,
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = settings.exposure;

await renderer.init();

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.enablePan = false;
controls.minDistance = 3.2;
controls.maxDistance = 14;

// The outer group tilts the Sun's axis. The inner group spins every visual
// layer together without changing the existing surface shader.
const sunGroup = new THREE.Group();
const sunSpinGroup = new THREE.Group();
sunGroup.add(sunSpinGroup);
scene.add(sunGroup);

// ---------- Sun surface ----------
// The GLSL reference samples three moving noise layers on the sphere.
// Here the same idea is written directly with TSL for WebGPU.

const animationSpeed = uniform(settings.animationSpeed);
const noiseScale = uniform(settings.noiseScale);
const noiseContrast = uniform(settings.noiseContrast);
const noiseStrength = uniform(settings.noiseStrength);
const baseBrightness = uniform(settings.baseBrightness);
const fresnelStrength = uniform(settings.fresnelStrength);
const surfaceBrightness = uniform(settings.surfaceBrightness);
const surfaceColorTint = uniform(new THREE.Color(settings.surfaceColor));

const noisePosition = normalLocal.mul(noiseScale);
const slowTime = time.mul(animationSpeed);

const noise1 = mx_noise_float(
  noisePosition.add(vec3(slowTime, slowTime.mul(0.25), 0))
).mul(0.5).add(0.5);

const noise2 = mx_noise_float(
  noisePosition.mul(2).add(vec3(0, slowTime.mul(-1.3), slowTime.mul(0.7)))
).mul(0.5).add(0.5);

const noise3 = mx_noise_float(
  noisePosition.mul(4).add(vec3(slowTime.mul(0.8), 0, slowTime.mul(-0.5)))
).mul(0.5).add(0.5);

const surfaceNoise = noise1.mul(0.55)
  .add(noise2.mul(0.3))
  .add(noise3.mul(0.15))
  .sub(0.5)
  .mul(noiseContrast)
  .add(0.5)
  .clamp(0, 1);

// Fresnel brightens the edge of the sphere, like uFresnelInfluence
// in the original sunSphere fragment shader.
const viewDirection = cameraPosition.sub(positionWorld).normalize();
const fresnel = normalWorldGeometry.dot(viewDirection)
  .max(0)
  .oneMinus()
  .pow(2)
  .mul(fresnelStrength);

const brightness = surfaceNoise
  .mul(noiseStrength)
  .add(baseBrightness)
  .add(fresnel);

// Map the animated heat field through a solar palette instead of deriving
// every channel from one value. This preserves dark granules while giving
// the midtones a saturated orange/amber body and the hottest cells a yellow
// centre, as in false-colour solar photography.
const heat = brightness.mul(0.72).clamp(0, 1);
const emberColor = uniform(new THREE.Color("#5d1003"));
const orangeColor = uniform(new THREE.Color("#f04406"));
const amberColor = uniform(new THREE.Color("#ff920d"));
const yellowColor = uniform(new THREE.Color("#ffd84d"));
const hotColor = uniform(new THREE.Color("#fff3a1"));

const orangeMix = heat.smoothstep(0.08, 0.38);
const amberMix = heat.smoothstep(0.32, 0.62);
const yellowMix = heat.smoothstep(0.58, 0.86);
const hotMix = heat.smoothstep(0.84, 1.0);

const emberToOrange = emberColor.mul(orangeMix.oneMinus())
  .add(orangeColor.mul(orangeMix));
const orangeToAmber = emberToOrange.mul(amberMix.oneMinus())
  .add(amberColor.mul(amberMix));
const amberToYellow = orangeToAmber.mul(yellowMix.oneMinus())
  .add(yellowColor.mul(yellowMix));
const surfaceColor = amberToYellow.mul(hotMix.oneMinus())
  .add(hotColor.mul(hotMix))
  .mul(surfaceBrightness)
  .mul(surfaceColorTint);

const surfaceMaterial = new THREE.MeshBasicNodeMaterial();
surfaceMaterial.outputNode = vec4(surfaceColor, 1);

const sphereGeometry = new THREE.SphereGeometry(SUN_RADIUS, 96, 64);
const surfaceMesh = new THREE.Mesh(sphereGeometry, surfaceMaterial);
scene.add(surfaceMesh);

// ---------- Edge glow ----------
// Logic copied from sun original grow.js. The names are more explicit,
// but the silhouette band, falloff curve and alpha calculation are unchanged.

const edgeLightIntensity = uniform(settings.edgeLightIntensity);
const edgeOpacity = uniform(settings.edgeOpacity);
const edgeGlowColor = uniform(new THREE.Color("#ffac1c"));

// 0 when facing the camera, 1 at the silhouette edge.
const silhouetteCloseness = normalWorldGeometry
  .dot(viewDirection)
  .abs()
  .oneMinus();

// Faint -> bright -> faint, matching the original edge band exactly.
const edgeFadeIn = silhouetteCloseness.smoothstep(0.10, 0.45);
const edgeFadeOut = silhouetteCloseness.oneMinus().smoothstep(0.10, 0.55);
const edgeBand = edgeFadeIn.mul(edgeFadeOut);
const edgeHaze = edgeBand.pow(1.4).mul(edgeLightIntensity);

const edgeGlowMaterial = new THREE.MeshBasicNodeMaterial({
  side: THREE.BackSide,
  transparent: true,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});
edgeGlowMaterial.outputNode = vec4(
  edgeGlowColor.mul(edgeHaze),
  edgeHaze.mul(1.0).mul(edgeOpacity)
);

const edgeGlowMesh = new THREE.Mesh(
  new THREE.SphereGeometry(SUN_RADIUS, 96, 48),
  edgeGlowMaterial
);
edgeGlowMesh.scale.setScalar(settings.edgeRadius);
scene.add(edgeGlowMesh);

// ---------- Close golden glow ----------
// A narrow yellow-gold shell keeps the limb hot without washing the orange
// surface out to white.

const WHITE_GLOW_RADIUS = 1.025;
const WHITE_GLOW_INTENSITY = 0.65;
const whiteGlowColor = uniform(new THREE.Color("#ffd95a"));

const whiteEdgeCloseness = normalWorldGeometry
  .dot(viewDirection)
  .abs()
  .oneMinus();
const whiteFadeIn = whiteEdgeCloseness.smoothstep(0.10, 0.45);
const whiteFadeOut = whiteEdgeCloseness.oneMinus().smoothstep(0.10, 0.55);
const whiteBand = whiteFadeIn.mul(whiteFadeOut);
const whiteHaze = whiteBand.pow(1.4).mul(WHITE_GLOW_INTENSITY);

const whiteGlowMaterial = new THREE.MeshBasicNodeMaterial({
  side: THREE.BackSide,
  transparent: true,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});
whiteGlowMaterial.outputNode = vec4(
  whiteGlowColor.mul(whiteHaze),
  whiteHaze.mul(0.55)
);

const whiteGlowMesh = new THREE.Mesh(sphereGeometry, whiteGlowMaterial);
whiteGlowMesh.scale.setScalar(WHITE_GLOW_RADIUS);
scene.add(whiteGlowMesh);

// ---------- Billboard particle helper ----------
// SpriteNodeMaterial lets every particle have its own position, scale,
// rotation and color while Corona and Flare each remain one draw call.

function createBillboardCloud(map, count) {
  const offsets = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
  const scales = new THREE.InstancedBufferAttribute(new Float32Array(count * 2), 2);
  const rotations = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
  const tints = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);

  for (const attribute of [offsets, scales, rotations, tints]) {
    attribute.setUsage(THREE.DynamicDrawUsage);
  }

  const material = new THREE.SpriteNodeMaterial({
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthTest: true,
    depthWrite: false,
  });

  material.positionNode = instancedBufferAttribute(offsets);
  material.scaleNode = instancedBufferAttribute(scales);
  material.rotationNode = instancedBufferAttribute(rotations);

  const mapColor = texture(map);
  const tint = instancedBufferAttribute(tints);
  material.colorNode = mapColor.rgb.mul(tint.rgb);
  material.opacityNode = mapColor.a.mul(tint.a);

  const sprite = new THREE.Sprite(material);
  sprite.count = count;
  sprite.frustumCulled = false;

  return { sprite, offsets, scales, rotations, tints };
}

function markCloudUpdated(cloud) {
  cloud.offsets.needsUpdate = true;
  cloud.scales.needsUpdate = true;
  cloud.rotations.needsUpdate = true;
  cloud.tints.needsUpdate = true;
}

function createCoronaTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;

  const context = canvas.getContext("2d");
  const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, "rgba(255, 255, 255, 1)");
  gradient.addColorStop(0.18, "rgba(255, 255, 255, 0.75)");
  gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);

  const coronaTexture = new THREE.CanvasTexture(canvas);
  coronaTexture.colorSpace = THREE.SRGBColorSpace;
  return coronaTexture;
}

function sampleThreeColorGradient(from, middle, to, t, middleTime, target) {
  if (t <= middleTime) {
    target.lerpColors(from, middle, t / middleTime);
  } else {
    target.lerpColors(middle, to, (t - middleTime) / (1 - middleTime));
  }
  return target;
}

// ---------- Corona ----------
// Adapted from the Babylon example: 600 short-lived stretched
// billboards, no outward motion, random rotation and low peak alpha.

const MAX_CORONA = 600;
const coronaCloud = createBillboardCloud(createCoronaTexture(), MAX_CORONA);
coronaCloud.sprite.renderOrder = 1;
scene.add(coronaCloud.sprite);

const coronaColors = [
  new THREE.Color("#ffd24a"),
  new THREE.Color("#ff8510"),
  new THREE.Color("#8f2400"),
];
const coronaColor = new THREE.Color();
const coronaParticles = [];

function respawnCorona(particle, prewarm = false) {
  particle.position.randomDirection().multiplyScalar(SUN_RADIUS * 1.01);
  particle.scaleX = THREE.MathUtils.randFloat(0.5, 1.2);
  particle.scaleY = THREE.MathUtils.randFloat(0.75, 3.0);
  particle.rotation = THREE.MathUtils.randFloat(-Math.PI * 2, Math.PI * 2);
  particle.age = prewarm ? Math.random() * settings.coronaLifetime : 0;
}

for (let i = 0; i < MAX_CORONA; i++) {
  const particle = { position: new THREE.Vector3(), age: 0 };
  respawnCorona(particle, true);
  coronaParticles.push(particle);
}

function updateCorona(deltaTime) {
  coronaCloud.sprite.visible = settings.coronaVisible;

  for (let i = 0; i < MAX_CORONA; i++) {
    const particle = coronaParticles[i];

    if (i >= settings.coronaCount) {
      coronaCloud.scales.setXY(i, 0, 0);
      coronaCloud.tints.setXYZW(i, 0, 0, 0, 0);
      continue;
    }

    particle.age += deltaTime;
    if (particle.age >= settings.coronaLifetime) {
      respawnCorona(particle);
    }

    const life = particle.age / settings.coronaLifetime;
    const alpha = life <= 0.5
      ? THREE.MathUtils.lerp(0, 0.12, life / 0.5)
      : THREE.MathUtils.lerp(0.12, 0, (life - 0.5) / 0.5);

    sampleThreeColorGradient(
      coronaColors[0],
      coronaColors[1],
      coronaColors[2],
      life,
      0.5,
      coronaColor
    );

    coronaCloud.offsets.setXYZ(
      i,
      particle.position.x,
      particle.position.y,
      particle.position.z
    );
    coronaCloud.scales.setXY(
      i,
      particle.scaleX * settings.coronaSize,
      particle.scaleY * settings.coronaSize * settings.coronaStretch
    );
    coronaCloud.rotations.setX(i, particle.rotation);
    coronaCloud.tints.setXYZW(
      i,
      coronaColor.r,
      coronaColor.g,
      coronaColor.b,
      alpha * settings.coronaBrightness
    );
  }

  markCloudUpdated(coronaCloud);
}

// ---------- Flares ----------
// Adapted from the Babylon example: a slow emit rate, ten-second
// lifetime, linear growth, slight outward drift and a 3-stop color fade.

const MAX_FLARES = 20;
const flareTexture = await loadTexture("./texture/sun_flare.png");
const flareCloud = createBillboardCloud(flareTexture, MAX_FLARES);
flareCloud.sprite.renderOrder = 2;
scene.add(flareCloud.sprite);

const flareColors = [
  new THREE.Color(settings.flareStartColor),
  new THREE.Color(settings.flarePeakColor),
  new THREE.Color(settings.flareEndColor),
];
const flareColor = new THREE.Color();
const flareParticles = [];
let flareSpawnAccumulator = 0;
let nextFlareIndex = 0;

for (let i = 0; i < MAX_FLARES; i++) {
  flareParticles.push({
    active: false,
    direction: new THREE.Vector3(),
    age: 0,
    scale: 1,
    drift: 0,
    rotation: 0,
  });
  flareCloud.scales.setXY(i, 0, 0);
  flareCloud.tints.setXYZW(i, 0, 0, 0, 0);
}
markCloudUpdated(flareCloud);

function spawnFlare() {
  for (let offset = 0; offset < settings.flareCount; offset++) {
    const index = (nextFlareIndex + offset) % settings.flareCount;
    const particle = flareParticles[index];

    if (particle.active) continue;

    particle.active = true;
    particle.age = 0;
    particle.direction.randomDirection();
    particle.scale = THREE.MathUtils.randFloat(0.5, 1.0);
    particle.drift = THREE.MathUtils.randFloat(0.001, 0.01);
    particle.rotation = THREE.MathUtils.randFloat(-Math.PI * 2, Math.PI * 2);
    nextFlareIndex = (index + 1) % settings.flareCount;
    return;
  }
}

function updateFlares(deltaTime) {
  flareCloud.sprite.visible = settings.flaresVisible;
  flareSpawnAccumulator += deltaTime * settings.flareEmitRate;

  while (flareSpawnAccumulator >= 1) {
    spawnFlare();
    flareSpawnAccumulator -= 1;
  }

  for (let i = 0; i < MAX_FLARES; i++) {
    const particle = flareParticles[i];

    if (i >= settings.flareCount || !particle.active) {
      particle.active = i < settings.flareCount && particle.active;
      flareCloud.scales.setXY(i, 0, 0);
      flareCloud.tints.setXYZW(i, 0, 0, 0, 0);
      continue;
    }

    particle.age += deltaTime;
    const life = Math.min(particle.age / settings.flareLifetime, 1);
    const alpha = life <= 0.25
      ? life / 0.25
      : 1 - (life - 0.25) / 0.75;

    sampleThreeColorGradient(
      flareColors[0],
      flareColors[1],
      flareColors[2],
      life,
      0.25,
      flareColor
    );

    const distance = SUN_RADIUS * 1.01
      + particle.drift * settings.flareDrift * particle.age;
    const size = particle.scale * settings.flareSize * life;

    flareCloud.offsets.setXYZ(
      i,
      particle.direction.x * distance,
      particle.direction.y * distance,
      particle.direction.z * distance
    );
    flareCloud.scales.setXY(i, size, size);
    flareCloud.rotations.setX(i, particle.rotation);
    flareCloud.tints.setXYZW(
      i,
      flareColor.r * settings.flareBrightness,
      flareColor.g * settings.flareBrightness,
      flareColor.b * settings.flareBrightness,
      alpha
    );

    if (life >= 1) particle.active = false;
  }

  markCloudUpdated(flareCloud);
}

// Reparent every visual layer after creation so the original surface block
// stays untouched while the whole Sun shares one tilt and rotation.
sunSpinGroup.add(
  surfaceMesh,
  whiteGlowMesh,
  edgeGlowMesh,
  coronaCloud.sprite,
  flareCloud.sprite
);

// ---------- lil-gui ----------

function applyAxialTilt() {
  sunGroup.rotation.z = THREE.MathUtils.degToRad(
    controlsConfig.axialTiltDegrees
  );
}

function applyFpsVisibility() {
  fpsMeter.classList.toggle("hidden", !controlsConfig.showFps);
}

const gui = new GUI({ title: "Sun" });

const motionFolder = gui.addFolder("Motion");
motionFolder.add(controlsConfig, "rotationSpeed", 0, 2, 0.01)
  .name("Rotation speed");
motionFolder.add(controlsConfig, "axialTiltDegrees", -180, 180, 0.1)
  .name("Axial tilt (deg)")
  .onChange(applyAxialTilt);

const surfaceFolder = gui.addFolder("Surface");
surfaceFolder.add(settings, "surfaceVisible").name("Visible")
  .onChange(value => { surfaceMesh.visible = value; });
surfaceFolder.add(settings, "animationSpeed", 0, 0.3, 0.001).name("Speed")
  .onChange(value => { animationSpeed.value = value; });
surfaceFolder.add(settings, "noiseScale", 0.5, 10, 0.01).name("Noise scale")
  .onChange(value => { noiseScale.value = value; });
surfaceFolder.add(settings, "noiseContrast", 0, 3, 0.01).name("Noise contrast")
  .onChange(value => { noiseContrast.value = value; });
surfaceFolder.add(settings, "noiseStrength", 0, 3, 0.01).name("Noise strength")
  .onChange(value => { noiseStrength.value = value; });
surfaceFolder.add(settings, "baseBrightness", 0, 1.5, 0.01)
  .name("Base brightness")
  .onChange(value => { baseBrightness.value = value; });
surfaceFolder.add(settings, "fresnelStrength", 0, 2, 0.01).name("Fresnel")
  .onChange(value => { fresnelStrength.value = value; });
surfaceFolder.add(settings, "surfaceBrightness", 0, 3, 0.01)
  .name("Brightness")
  .onChange(value => { surfaceBrightness.value = value; });
surfaceFolder.addColor(settings, "surfaceColor").name("Color")
  .onChange(value => { surfaceColorTint.value.set(value); });

const edgeGlowFolder = gui.addFolder("Edge Glow");
edgeGlowFolder.add(settings, "edgeGlowVisible").name("Visible")
  .onChange(value => { edgeGlowMesh.visible = value; });
edgeGlowFolder.add(settings, "edgeLightIntensity", 0, 5, 0.01)
  .name("Intensity")
  .onChange(value => { edgeLightIntensity.value = value; });
edgeGlowFolder.add(settings, "edgeOpacity", 0, 1, 0.01)
  .name("Opacity")
  .onChange(value => { edgeOpacity.value = value; });
edgeGlowFolder.add(settings, "edgeRadius", 1.001, 1.2, 0.001)
  .name("Scale")
  .onChange(value => { edgeGlowMesh.scale.setScalar(value); });

const coronaFolder = gui.addFolder("Corona");
coronaFolder.add(settings, "coronaVisible").name("Visible")
  .onChange(value => { coronaCloud.sprite.visible = value; });
coronaFolder.add(settings, "coronaCount", 50, MAX_CORONA, 10).name("Count");
coronaFolder.add(settings, "coronaSize", 0.1, 1.5, 0.01).name("Size");
coronaFolder.add(settings, "coronaStretch", 0.2, 3, 0.01).name("Stretch");
coronaFolder.add(settings, "coronaBrightness", 0, 3, 0.01)
  .name("Brightness");
coronaFolder.add(settings, "coronaLifetime", 0.5, 6, 0.1).name("Lifetime");

const flaresFolder = gui.addFolder("Flares");
flaresFolder.add(settings, "flaresVisible").name("Visible")
  .onChange(value => { flareCloud.sprite.visible = value; });
flaresFolder.add(settings, "flareCount", 1, MAX_FLARES, 1).name("Count");
flaresFolder.add(settings, "flareEmitRate", 0.1, 5, 0.1).name("Emit rate");
flaresFolder.add(settings, "flareSize", 0.2, 2, 0.01).name("Size");
flaresFolder.add(settings, "flareBrightness", 0, 3, 0.01)
  .name("Brightness");
flaresFolder.add(settings, "flareLifetime", 1, 10, 0.1).name("Lifetime");
flaresFolder.add(settings, "flareDrift", 0, 5, 0.01).name("Outward drift");
flaresFolder.addColor(settings, "flareStartColor").name("Start color")
  .onChange(value => { flareColors[0].set(value); });
flaresFolder.addColor(settings, "flarePeakColor").name("Peak color")
  .onChange(value => { flareColors[1].set(value); });
flaresFolder.addColor(settings, "flareEndColor").name("End color")
  .onChange(value => { flareColors[2].set(value); });

let applyingCameraDistance = false;

function applyCameraDistance() {
  applyingCameraDistance = true;
  const direction = camera.position.clone().sub(controls.target).normalize();
  camera.position.copy(controls.target)
    .addScaledVector(direction, settings.cameraDistance);
  controls.update();
  applyingCameraDistance = false;
}

const viewFolder = gui.addFolder("View");
const distanceController = viewFolder
  .add(settings, "cameraDistance", controls.minDistance, controls.maxDistance, 0.1)
  .name("Camera distance")
  .onChange(applyCameraDistance);
viewFolder.add(settings, "exposure", 0.2, 2.5, 0.01).name("Exposure")
  .onChange(value => { renderer.toneMappingExposure = value; });

gui.add(controlsConfig, "showFps")
  .name("Show FPS")
  .onChange(applyFpsVisibility);
gui.add({ reset: () => gui.reset() }, "reset").name("Reset defaults");

applyAxialTilt();
applyFpsVisibility();

controls.addEventListener("change", () => {
  if (applyingCameraDistance) return;
  settings.cameraDistance = camera.position.distanceTo(controls.target);
  distanceController.updateDisplay();
});

// ---------- Render loop ----------

loadingOverlay.classList.add("hidden");

const clock = new THREE.Clock();
let spinAngle = 0;
let fpsFrames = 0;
let fpsElapsed = 0;

renderer.setAnimationLoop(() => {
  const frameTime = clock.getDelta();
  const deltaTime = Math.min(frameTime, 0.1);

  fpsFrames++;
  fpsElapsed += frameTime;
  if (fpsElapsed >= 0.5) {
    if (controlsConfig.showFps) {
      fpsMeter.textContent = `${Math.round(fpsFrames / fpsElapsed)} fps`;
    }
    fpsFrames = 0;
    fpsElapsed = 0;
  }

  spinAngle += deltaTime * BASE_SPIN_SPEED * controlsConfig.rotationSpeed;
  sunSpinGroup.rotation.y = spinAngle;

  updateCorona(deltaTime);
  updateFlares(deltaTime);
  controls.update();
  renderer.render(scene, camera);
});

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
