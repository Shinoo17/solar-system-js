import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import GUI from 'lil-gui';

// ---------------------------------------------------------------------------
// Config (defaults)
// ---------------------------------------------------------------------------
const params = {
  // surface
  rotationSpeed: 0.03,
  flowSpeed: 1.0,
  granulation: 1.0,
  brightness: 1.0,
  limb: 1.0,
  activity: 1.0,
  colorDeep:  '#992b07',
  colorMid:   '#ff730f',
  colorHot:   '#ffb33f',
  colorWhite: '#fff2cf',
  colorLimb:  '#ffbc4f',
  // aura
  glow: 0.45,
  glowSize: 0.8,
  fringe: 0.3,
  glowColor: '#ff7c26',
  // prominences
  promEnabled: true,
  promCount: 5,
  promIntensity: 1.0,
  promHeight: 1.0,
  promSpeed: 1.0,
  promColor: '#ff5e26',
  lifeMin: 12,
  lifeMax: 32,
  respawnDelay: 3,
  limbBias: 0.7,
  eruptChance: 0.3,
  lifeSpeed: 1.0,
  // post / camera
  exposure: 0.9,
  bloomStrength: 0.3,
  bloomRadius: 0.45,
  bloomThreshold: 0.9,
  autoRotate: false,
  // stars
  starBrightness: 1.0,
  // diagnostics
  showFps: true,
};

// ---------------------------------------------------------------------------
// Loading / error overlays + FPS meter
// ---------------------------------------------------------------------------
const loadingOverlay = document.getElementById('loading');
const errorOverlay = document.getElementById('error');
const errorText = document.getElementById('errorText');
const fpsMeter = document.getElementById('fpsMeter');

function showError(error){
  console.error(error);
  loadingOverlay.classList.add('hidden');
  errorOverlay.classList.remove('hidden');
  errorText.textContent = error?.message || String(error);
}

window.addEventListener('error', (event) => {
  showError(event.error || new Error(event.message));
});

window.addEventListener('unhandledrejection', (event) => {
  event.preventDefault();
  showError(event.reason || new Error('Unhandled promise rejection'));
});

// ---------------------------------------------------------------------------
// Renderer / scene / camera
// ---------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({
  canvas: document.getElementById('planetCanvas'),
  antialias: true,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = params.exposure;
// surface GLSL compile errors through the error overlay instead of only the console
renderer.debug.onShaderError = (gl, program, vs, fs) => {
  const log = (gl.getProgramInfoLog(program) || '') + (gl.getShaderInfoLog(vs) || '') + (gl.getShaderInfoLog(fs) || '');
  showError(new Error('Shader compile failed\n' + log.trim()));
};

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x070302);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 0, 5.2);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.enablePan = false;
controls.minDistance = 2.2;
controls.maxDistance = 20;
controls.rotateSpeed = 0.5;
controls.autoRotateSpeed = 0.6;

// ---------------------------------------------------------------------------
// Shared GLSL: 3D simplex noise + fbm
// ---------------------------------------------------------------------------
const NOISE = /* glsl */`
vec3 mod289(vec3 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 mod289(vec4 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 permute(vec4 x){ return mod289(((x*34.0)+1.0)*x); }
vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g  = step(x0.yzx, x0.xyz);
  vec3 l  = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
             i.z + vec4(0.0, i1.z, i2.z, 1.0))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j  = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x  = x_ * ns.x + ns.yyyy;
  vec4 y  = y_ * ns.x + ns.yyyy;
  vec4 h  = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}

float fbm(vec3 p){
  float f = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++){
    f += a * snoise(p);
    p = p * 2.02 + vec3(1.7, 9.2, 3.1);
    a *= 0.5;
  }
  return f;
}

float fbm3(vec3 p){
  float f = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++){
    f += a * snoise(p);
    p = p * 2.03 + vec3(4.1, 1.3, 7.7);
    a *= 0.5;
  }
  return f;
}
`;

// ---------------------------------------------------------------------------
// Sun surface (photosphere) — the mesh itself rotates
// ---------------------------------------------------------------------------
const col = (hex) => new THREE.Color(hex); // sRGB hex -> linear (ColorManagement)

const sunMat = new THREE.ShaderMaterial({
  uniforms: {
    uTime:      { value: 0 },
    uGranScale: { value: params.granulation },
    uBright:    { value: params.brightness },
    uLimbBoost: { value: params.limb },
    uActive:    { value: params.activity },
    uC1:        { value: col(params.colorDeep) },
    uC2:        { value: col(params.colorMid) },
    uC3:        { value: col(params.colorHot) },
    uC4:        { value: col(params.colorWhite) },
    uLimbColor: { value: col(params.colorLimb) },
  },
  vertexShader: /* glsl */`
    varying vec3 vPos;
    varying vec3 vNormal;
    varying vec3 vView;
    void main(){
      vPos = position;
      vNormal = normalize(normalMatrix * normal);
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vView = -mv.xyz;
      gl_Position = projectionMatrix * mv;
    }
  `,
  fragmentShader: /* glsl */`
    uniform float uTime;
    uniform float uGranScale;
    uniform float uBright;
    uniform float uLimbBoost;
    uniform float uActive;
    uniform vec3 uC1, uC2, uC3, uC4, uLimbColor;
    varying vec3 vPos;
    varying vec3 vNormal;
    varying vec3 vView;
    ${NOISE}

    void main(){
      float t = uTime;
      vec3 p = normalize(vPos);

      // domain warp → swirly, plasma-like flow
      vec3 warp = vec3(
        fbm3(p*1.5 + vec3(0.0, 0.0, t*0.020)),
        fbm3(p*1.5 + vec3(5.2, 1.3, -t*0.015)),
        fbm3(p*1.5 + vec3(9.7, 4.4, t*0.010))
      );

      float large = fbm(p*2.2 + warp*1.2);
      float gran  = snoise(p*28.0*uGranScale + warp*0.5 + vec3(0.0, t*0.08, 0.0));
      float gran2 = snoise(p*58.0*uGranScale - vec3(t*0.10));
      float actv  = smoothstep(0.12, 0.55, fbm(p*1.3 + warp*0.9 + 11.0)) * uActive;

      float ridge     = pow(1.0 - abs(snoise(p*7.0 + warp*2.0 + t*0.03)), 6.0);
      float ridgeDark = pow(1.0 - abs(snoise(p*5.0 + warp*2.5 - t*0.02 + 4.0)), 10.0);

      float heat = 0.45 + 0.33*large + 0.12*gran + 0.06*gran2;
      heat += actv * (0.45*ridge + 0.12);
      heat -= actv * 0.22 * ridgeDark;
      heat = clamp(heat, 0.0, 1.4);

      vec3 c = mix(uC1, uC2, smoothstep(0.05, 0.45, heat));
      c = mix(c, uC3, smoothstep(0.40, 0.80, heat));
      c = mix(c, uC4, smoothstep(0.82, 1.20, heat));

      vec3 N = normalize(vNormal);
      vec3 V = normalize(vView);
      float fres = 1.0 - clamp(dot(N, V), 0.0, 1.0);
      c = mix(c, uLimbColor, smoothstep(0.50, 1.0, fres) * 0.65 * clamp(uLimbBoost, 0.0, 1.0));

      float intensity = uBright * (1.55 + 0.9 * smoothstep(0.85, 1.2, heat))
                      + 1.3 * uLimbBoost * pow(fres, 4.0);

      gl_FragColor = vec4(c * intensity, 1.0);
    }
  `
});

const sun = new THREE.Mesh(new THREE.SphereGeometry(1, 160, 160), sunMat);
scene.add(sun);

// ---------------------------------------------------------------------------
// Prominence slots — each lives on the sun's surface (sun-local space),
// is born, rises, (maybe erupts), fades, then respawns somewhere else.
// ---------------------------------------------------------------------------
const MAX_PROM = 8;
const slots = Array.from({ length: MAX_PROM }, () => ({
  n: new THREE.Vector3(1, 0, 0), w: 0.1, h: 0.3,
  birth: 0, life: 1, erupt: false, seed: 0, alive: false, respawnAt: 0
}));
const _invSunQ = new THREE.Quaternion();

function spawn(s, now, stagger = false){
  if (Math.random() < params.limbBias){
    // pick a point near the limb *as currently seen*, then store it in sun-local space
    const a = Math.random() * Math.PI * 2;
    const z = (Math.random() * 2 - 1) * 0.3;
    const r = Math.sqrt(1 - z * z);
    s.n.set(Math.cos(a) * r, Math.sin(a) * r, z)
       .applyQuaternion(camera.quaternion)                       // view → world
       .applyQuaternion(_invSunQ.copy(sun.quaternion).invert()); // world → sun-local
  } else {
    s.n.set(gauss(), gauss(), gauss()).normalize();               // anywhere on the sphere
  }
  s.w = 0.07 + Math.random() * 0.12;
  s.h = 0.14 + Math.random() * 0.30;
  s.life = params.lifeMin + Math.random() * Math.max(params.lifeMax - params.lifeMin, 0);
  s.birth = stagger ? now - Math.random() * s.life * 0.8 : now;
  s.erupt = Math.random() < params.eruptChance;
  s.seed = Math.random() * 100.0;
  s.alive = true;
}

// ---------------------------------------------------------------------------
// Halo + fringe + prominences (camera-facing billboard)
// ---------------------------------------------------------------------------
const HALO_SIZE = 8.0;
const haloMat = new THREE.ShaderMaterial({
  uniforms: {
    uTime:        { value: 0 },
    uPromTime:    { value: 0 },
    uLimb:        { value: 1.0 },
    uSize:        { value: HALO_SIZE },
    uViewToLocal: { value: new THREE.Matrix3() },
    uGlow:        { value: params.glow },
    uGlowSize:    { value: params.glowSize },
    uFringe:      { value: params.fringe },
    uGlowColor:   { value: col(params.glowColor) },
    uPromColor:   { value: col(params.promColor) },
    uPromIntensity: { value: params.promIntensity },
    uProm:        { value: Array.from({ length: MAX_PROM }, () => new THREE.Vector4()) },
    uPromSeed:    { value: new Array(MAX_PROM).fill(0) },
    uPromCount:   { value: params.promCount },
  },
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main(){
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    #define MAX_PROM ${MAX_PROM}
    uniform float uTime;
    uniform float uPromTime;
    uniform float uLimb;
    uniform float uSize;
    uniform mat3  uViewToLocal;
    uniform float uGlow;
    uniform float uGlowSize;
    uniform float uFringe;
    uniform vec3  uGlowColor;
    uniform vec3  uPromColor;
    uniform float uPromIntensity;
    uniform vec4  uProm[MAX_PROM];   // (screenAngle, width, apparentHeight, visibility)
    uniform float uPromSeed[MAX_PROM];
    uniform int   uPromCount;
    varying vec2 vUv;
    ${NOISE}

    float loopStrand(vec2 lp, float w, float h, float seed, float t){
      float cx = sqrt(max(1.0 - w*w, 0.0));
      vec2 q = vec2(lp.x - cx, lp.y);
      q += 0.03 * vec2(
        snoise(vec3(lp*5.0, t + seed)),
        snoise(vec3(lp*5.0 + 7.3, t + seed))
      );
      vec2 qq = vec2(q.x / h, q.y / w);
      float e = length(qq);
      vec2 grad = vec2(qq.x / h, qq.y / w) / max(e, 1e-4);
      float d = abs(e - 1.0) / max(length(grad), 1e-4);

      float thick = 0.016 + 0.012 * snoise(vec3(lp*9.0, t*1.3 + seed));
      float strand = smoothstep(max(thick, 0.004), 0.0, d);
      float haze = exp(-d * 28.0) * 0.35;
      float flick = 0.55 + 0.45 * fbm3(vec3(lp*7.0, t + seed*3.0));
      float foot = smoothstep(-0.02, 0.06, q.x);
      return (strand * 0.85 + haze) * flick * mix(0.6, 1.0, foot);
    }

    float prominence(vec2 p, float ang, float w, float h, float seed){
      float c = cos(-ang), s = sin(-ang);
      vec2 lp = vec2(c*p.x - s*p.y, s*p.x + c*p.y);
      // cheap early-out: skip pixels far from this loop
      if (lp.x < 0.75 || lp.x > 1.0 + h*1.35 + 0.12 || abs(lp.y) > w*1.5 + 0.12) return 0.0;
      float t = uPromTime * 0.12;
      float v = loopStrand(lp, w, h, seed, t);
      v += 0.6  * loopStrand(lp, w*0.72, h*0.78, seed + 13.0, t);
      v += 0.35 * loopStrand(lp, w*1.15, h*1.12, seed + 27.0, t);
      return v;
    }

    void main(){
      vec2 p = (vUv - 0.5) * uSize / uLimb;   // units of sun radius (screen plane)
      float r = length(p);
      vec2 dir = p / max(r, 1e-4);
      float e = max(r - 1.0, 0.0);

      // soft, restrained glow
      float gs = max(uGlowSize, 0.05);
      float glow = 0.75*exp(-e*10.0/gs) + 0.22*exp(-e*3.2/gs) + 0.05*exp(-e*0.9/gs);

      // fringe noise sampled in the sun's own frame → it turns with the sun.
      // Sampling along ld (radially) keeps the angular pattern fixed while it
      // changes slowly outward → straight radial rays, like real streamers/plumes.
      vec3 ld = uViewToLocal * vec3(dir, 0.0);
      float fn = fbm3(ld * (5.0 + e * 1.5) + vec3(0.0, uTime*0.04, 0.0));
      float fringe = exp(-e*8.0) * smoothstep(-0.2, 0.6, fn);

      vec3 c = uGlowColor * glow * uGlow + uGlowColor * fringe * 0.45 * uFringe;

      float pr = 0.0;
      for (int i = 0; i < MAX_PROM; i++){
        if (i >= uPromCount) break;
        vec4 P = uProm[i];
        if (P.w <= 0.001) continue;
        pr += prominence(p, P.x, P.y, P.z, uPromSeed[i]) * P.w;
      }
      c += uPromColor * pr * 1.3 * uPromIntensity;

      c *= smoothstep(uSize*0.5/uLimb, uSize*0.36/uLimb, r);
      gl_FragColor = vec4(c, 1.0);
    }
  `
});

const halo = new THREE.Mesh(new THREE.PlaneGeometry(HALO_SIZE, HALO_SIZE), haloMat);
halo.renderOrder = 1;
scene.add(halo);

// ---------------------------------------------------------------------------
// Starfield
// ---------------------------------------------------------------------------
function gauss(){
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}
function makeStars(count = 4500, radius = 420){
  const pos = new Float32Array(count * 3);
  const colr = new Float32Array(count * 3);
  const size = new Float32Array(count);
  const phase = new Float32Array(count);
  const tints = [
    new THREE.Color(1.0, 0.95, 0.88),
    new THREE.Color(1.0, 0.78, 0.55),
    new THREE.Color(0.80, 0.86, 1.0),
    new THREE.Color(1.0, 0.88, 0.70)
  ];
  const v = new THREE.Vector3();
  for (let i = 0; i < count; i++){
    v.set(gauss(), gauss(), gauss()).normalize().multiplyScalar(radius);
    pos.set([v.x, v.y, v.z], i * 3);
    const tint = tints[(Math.random() * tints.length) | 0];
    const b = 0.08 + Math.pow(Math.random(), 3.0) * 0.55;
    colr.set([tint.r * b, tint.g * b, tint.b * b], i * 3);
    size[i] = 1.0 + Math.pow(Math.random(), 4.0) * 3.0;
    phase[i] = Math.random();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(colr, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uPR: { value: renderer.getPixelRatio() },
      uBright: { value: params.starBrightness }
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      attribute vec3 aColor;
      attribute float aSize;
      attribute float aPhase;
      uniform float uTime;
      uniform float uPR;
      varying vec3 vColor;
      varying float vTw;
      void main(){
        vColor = aColor;
        vTw = 0.75 + 0.25 * sin(uTime * (0.6 + aPhase * 1.5) + aPhase * 40.0);
        gl_PointSize = aSize * uPR;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      uniform float uBright;
      varying vec3 vColor;
      varying float vTw;
      void main(){
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(vColor * a * a * vTw * uBright, 1.0);
      }
    `
  });
  return new THREE.Points(geo, mat);
}
const stars = makeStars();
scene.add(stars);

// ---------------------------------------------------------------------------
// Post-processing (bloom)
// ---------------------------------------------------------------------------
const composer = new EffectComposer(renderer);
composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
composer.setSize(window.innerWidth, window.innerHeight);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  params.bloomStrength, params.bloomRadius, params.bloomThreshold
);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// ---------------------------------------------------------------------------
// Config panel
// ---------------------------------------------------------------------------
const gui = new GUI({ title: '☀ Sun Config' });
const su = sunMat.uniforms, hu = haloMat.uniforms;

const fSurf = gui.addFolder('Surface');
fSurf.add(params, 'rotationSpeed', -0.5, 0.5, 0.005).name('หมุนรอบตัวเอง');
fSurf.add(params, 'flowSpeed', 0, 5, 0.05).name('ความเร็วพลาสมา');
fSurf.add(params, 'granulation', 0.3, 3, 0.05).name('ขนาด granulation').onChange(v => su.uGranScale.value = v);
fSurf.add(params, 'activity', 0, 2, 0.05).name('Active regions').onChange(v => su.uActive.value = v);
fSurf.add(params, 'brightness', 0.3, 2.5, 0.05).name('ความสว่าง').onChange(v => su.uBright.value = v);
fSurf.add(params, 'limb', 0, 2, 0.05).name('ขอบสว่าง (limb)').onChange(v => su.uLimbBoost.value = v);
const fCol = fSurf.addFolder('Colors').close();
fCol.addColor(params, 'colorDeep').name('Deep').onChange(v => su.uC1.value.set(v));
fCol.addColor(params, 'colorMid').name('Mid').onChange(v => su.uC2.value.set(v));
fCol.addColor(params, 'colorHot').name('Hot').onChange(v => su.uC3.value.set(v));
fCol.addColor(params, 'colorWhite').name('White').onChange(v => su.uC4.value.set(v));
fCol.addColor(params, 'colorLimb').name('Limb').onChange(v => su.uLimbColor.value.set(v));

const fAura = gui.addFolder('Aura / Corona');
fAura.add(params, 'glow', 0, 2, 0.01).name('ความเข้ม glow').onChange(v => hu.uGlow.value = v);
fAura.add(params, 'glowSize', 0.2, 3, 0.05).name('ขนาด glow').onChange(v => hu.uGlowSize.value = v);
fAura.add(params, 'fringe', 0, 2, 0.01).name('ขอบไฟ (fringe)').onChange(v => hu.uFringe.value = v);
fAura.addColor(params, 'glowColor').name('สี glow').onChange(v => hu.uGlowColor.value.set(v));

const fProm = gui.addFolder('Prominences');
fProm.add(params, 'promEnabled').name('แสดง');
fProm.add(params, 'promCount', 0, MAX_PROM, 1).name('จำนวนสูงสุด').onChange(v => hu.uPromCount.value = v);
fProm.add(params, 'promIntensity', 0, 3, 0.05).name('ความเข้ม').onChange(v => hu.uPromIntensity.value = v);
fProm.add(params, 'promHeight', 0.3, 2.5, 0.05).name('ความสูง');
fProm.add(params, 'promSpeed', 0, 5, 0.05).name('ความเร็วการไหว');
fProm.addColor(params, 'promColor').name('สี').onChange(v => hu.uPromColor.value.set(v));
const fLife = fProm.addFolder('วงจรชีวิต');
fLife.add(params, 'lifeMin', 2, 60, 1).name('อายุต่ำสุด (วิ)');
fLife.add(params, 'lifeMax', 2, 120, 1).name('อายุสูงสุด (วิ)');
fLife.add(params, 'respawnDelay', 0, 20, 0.5).name('รอเกิดใหม่ (วิ)');
fLife.add(params, 'lifeSpeed', 0, 5, 0.05).name('เร่งเวลา');
fLife.add(params, 'limbBias', 0, 1, 0.05).name('โอกาสเกิดใกล้ขอบ');
fLife.add(params, 'eruptChance', 0, 1, 0.05).name('โอกาสปะทุ');
fLife.add({ reseed: () => slots.forEach(s => spawn(s, lifeClock, true)) }, 'reseed').name('🎲 สุ่มใหม่ทั้งหมด');

const fPost = gui.addFolder('Bloom / Camera').close();
fPost.add(params, 'exposure', 0.3, 2, 0.01).name('Exposure').onChange(v => renderer.toneMappingExposure = v);
fPost.add(params, 'bloomStrength', 0, 2, 0.01).name('Bloom strength').onChange(v => bloom.strength = v);
fPost.add(params, 'bloomRadius', 0, 1, 0.01).name('Bloom radius').onChange(v => bloom.radius = v);
fPost.add(params, 'bloomThreshold', 0, 2, 0.01).name('Bloom threshold').onChange(v => bloom.threshold = v);
fPost.add(params, 'autoRotate').name('กล้องหมุนอัตโนมัติ').onChange(v => controls.autoRotate = v);

const fStars = gui.addFolder('Stars').close();
fStars.add(params, 'starBrightness', 0, 3, 0.05).name('ความสว่างดาว').onChange(v => stars.material.uniforms.uBright.value = v);

const applyFpsVisibility = () => fpsMeter.classList.toggle('hidden', !params.showFps);
gui.add(params, 'showFps').name('แสดง FPS').onChange(applyFpsVisibility);
applyFpsVisibility();

gui.add({ reset: () => gui.reset() }, 'reset').name('↺ Reset ทั้งหมด');

if (window.innerWidth < 640) gui.close();
window.addEventListener('keydown', (e) => {
  if (e.key === 'h' || e.key === 'H') gui.show(gui._hidden);
});

// ---------------------------------------------------------------------------
// Per-frame: project surface anchors to the screen plane
// ---------------------------------------------------------------------------
const tmpV = new THREE.Vector3();
const invSun = new THREE.Quaternion();
const m4 = new THREE.Matrix4();
const m4b = new THREE.Matrix4();
const smooth = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };

function updateProminences(now){
  for (let i = 0; i < MAX_PROM; i++){
    const s = slots[i];
    const out = hu.uProm.value[i];
    if (!params.promEnabled || i >= params.promCount){ out.set(0, 0, 0, 0); continue; }

    // lifecycle: dead → wait → respawn somewhere new
    if (!s.alive){
      if (now >= s.respawnAt) spawn(s, now);
      else { out.w = 0; continue; }
    }
    const age = (now - s.birth) / s.life;
    if (age >= 1){
      s.alive = false;
      s.respawnAt = now + params.respawnDelay * (0.3 + Math.random() * 1.4);
      out.w = 0;
      continue;
    }

    const grow = smooth(0.0, 0.2, age);          // rises out of the surface
    const fade = 1.0 - smooth(0.7, 1.0, age);    // dissolves at the end
    let hMul = 0.15 + 0.85 * grow, wMul = 1.0;
    if (s.erupt){                                // eruptive: lifts off & swells while fading
      const er = smooth(0.5, 1.0, age);
      hMul *= 1.0 + 1.6 * er;
      wMul = 1.0 + 0.5 * er;
    }

    // sun-local → world → view
    tmpV.copy(s.n).applyQuaternion(sun.quaternion).transformDirection(camera.matrixWorldInverse);

    const lenXY = Math.hypot(tmpV.x, tmpV.y);
    const h = s.h * hMul * params.promHeight;
    // apparent height above the limb (top of loop projected onto screen plane)
    const hEff = (1.0 + h) * lenXY - 1.0;
    const vis = smooth(0.015, 0.08, hEff) * grow * fade;
    out.set(Math.atan2(tmpV.y, tmpV.x), s.w * wMul, Math.max(hEff, 0.02), vis);
    hu.uPromSeed.value[i] = s.seed;
  }
}

// ---------------------------------------------------------------------------
// Loop
// ---------------------------------------------------------------------------
const clock = new THREE.Clock();
let flowTime = 0, promTime = 0, elapsed = 0, lifeClock = 0;
let fpsFrames = 0, fpsElapsed = 0, firstFrame = true;
slots.forEach(s => spawn(s, 0, true));   // staggered start so they don't sync up

function tick(){
  const frameTime = clock.getDelta();
  const dt = Math.min(frameTime, 0.1);
  elapsed += dt;

  fpsFrames++;
  fpsElapsed += frameTime;
  if (fpsElapsed >= 0.5){
    if (params.showFps) fpsMeter.textContent = `${Math.round(fpsFrames / fpsElapsed)} fps`;
    fpsFrames = 0;
    fpsElapsed = 0;
  }
  flowTime += dt * params.flowSpeed;
  promTime += dt * params.promSpeed;
  lifeClock += dt * params.lifeSpeed;

  controls.update();
  camera.updateMatrixWorld();

  sun.rotation.y += dt * params.rotationSpeed;
  sun.updateMatrixWorld();

  su.uTime.value = flowTime;
  hu.uTime.value = flowTime;
  hu.uPromTime.value = promTime;
  stars.material.uniforms.uTime.value = elapsed;

  // billboard the halo and match the perspective silhouette radius
  halo.quaternion.copy(camera.quaternion);
  const D = camera.position.length();
  hu.uLimb.value = D / Math.sqrt(Math.max(D * D - 1.0, 1e-4));

  // view-space → sun-local rotation (for fringe noise)
  invSun.copy(sun.quaternion).invert();
  m4.makeRotationFromQuaternion(invSun).multiply(m4b.makeRotationFromQuaternion(camera.quaternion));
  hu.uViewToLocal.value.setFromMatrix4(m4);

  updateProminences(lifeClock);

  composer.render();
  if (firstFrame){
    firstFrame = false;
    loadingOverlay.classList.add('hidden');
  }
  requestAnimationFrame(tick);
}
tick();

window.addEventListener('resize', () => {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setSize(w, h);
  bloom.setSize(w, h);
});
