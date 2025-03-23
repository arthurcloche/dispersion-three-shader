import * as THREE from "three";
import { gsap } from "gsap";
import { createNoise3D } from "simplex-noise";

const canvas = document.getElementById("canvas");
let width = canvas.offsetWidth,
  height = canvas.offsetHeight;
const renderer = new THREE.WebGLRenderer({
  canvas: canvas,
  antialias: true,
  alpha: true,
});
renderer.setPixelRatio(window.devicePixelRatio);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

// Required for proper translucency/transparency
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;

const scene = new THREE.Scene();
let camera;
// scene.background = "#FF0000";
const setup = () => {
  renderer.setSize(width, height);
  renderer.setClearColor(0xebebeb, 0);

  // scene.fog = new THREE.Fog(0x000000, 10, 950);

  const aspectRatio = width / height;
  const fieldOfView = 75;
  const nearPlane = 0.001;
  const farPlane = 100000;
  camera = new THREE.PerspectiveCamera(
    fieldOfView,
    aspectRatio,
    nearPlane,
    farPlane
  );
  camera.position.x = 0;
  camera.position.y = 0;
  camera.position.z = 300;
};

let hemisphereLight, shadowLight, light2, light3;
const createLights = () => {
  hemisphereLight = new THREE.HemisphereLight(0xffffff, 0x000000, 0.5);

  shadowLight = new THREE.DirectionalLight(0xff8f16, 0.4);
  shadowLight.position.set(0, 450, 350);
  shadowLight.castShadow = true;

  shadowLight.shadow.camera.left = -650;
  shadowLight.shadow.camera.right = 650;
  shadowLight.shadow.camera.top = 650;
  shadowLight.shadow.camera.bottom = -650;
  shadowLight.shadow.camera.near = 1;
  shadowLight.shadow.camera.far = 1000;

  shadowLight.shadow.mapSize.width = 4096;
  shadowLight.shadow.mapSize.height = 4096;

  light2 = new THREE.DirectionalLight(0xfff150, 0.25);
  light2.position.set(-600, 350, 350);

  light3 = new THREE.DirectionalLight(0xfff150, 0.15);
  light3.position.set(0, -250, 300);

  scene.add(hemisphereLight);
  scene.add(shadowLight);
  scene.add(light2);
  scene.add(light3);
};
createLights();

const vertex = 128;
const bubbleGeometry = new THREE.SphereGeometry(200, vertex, vertex);
let bubble;
const positionAttribute = bubbleGeometry.getAttribute("position");
const originalPositions = new Float32Array(positionAttribute.array.length);
originalPositions.set(positionAttribute.array);

// Create a simple lambert material with transparency for debug
const debugMaterial = new THREE.MeshLambertMaterial({
  color: 0x00ff00, // Green color for visibility
  transparent: true,
  opacity: 0.2,
  side: THREE.DoubleSide,
});

// Function to toggle between debug material and shader material
const toggleDebugMaterial = (useDebug = false) => {
  if (bubble) {
    bubble.material = useDebug ? debugMaterial : transluscentMaterial;
  }
};

// Uncomment to use debug material instead of shader
// const useMaterial = debugMaterial;

// Load cubemap for reflection/refraction
const path = "./cube/";
const format = ".jpg";
const order = ["posx", "negx", "posy", "negy", "posz", "negz"];
const urls = [];
order.forEach((side) => {
  urls.push(`${path}${side}${format}`);
});

// Create loading manager to track loading progress
const loadingManager = new THREE.LoadingManager();
loadingManager.onProgress = function (url, itemsLoaded, itemsTotal) {
  console.log(`Loading texture: ${itemsLoaded}/${itemsTotal} - ${url}`);
};

loadingManager.onError = function (url) {
  console.error("Error loading texture:", url);
};

loadingManager.onLoad = function () {
  console.log("All textures loaded successfully");
  console.log("Cubemap:", textureCube);
};

// Log the URLs we're trying to load
console.log("Loading cubemap from these URLs:", urls);

const textureCube = new THREE.CubeTextureLoader(loadingManager).load(urls);
textureCube.colorSpace = THREE.SRGBColorSpace;

// Uniforms for the shader
const uniforms = {
  time: { value: 0 },
  cubemap: { value: textureCube },
  tint: { value: new THREE.Color(0xbd4be3) }, // Purple tint
  opacity: { value: 0.85 },
  iridescenceIntensity: { value: 0.15 },
  uChromaticSalt: { value: 0.1 },
  uSaturation: { value: 1.0 },
  uDispersionStrength: { value: 0.5 },
};
const vertexShader = `
  varying vec3 vNormal;
  varying vec3 vPosition;
  varying vec3 vViewPosition;
  varying vec3 eye;
  varying vec3 worldEye;
  varying vec3 worldNormal;
  varying vec2 vUv;
  varying mat3 nMatrix;

  void main() {
    vNormal = normalize(normalMatrix * normal);
    nMatrix = normalMatrix;
    vPosition = position;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vec4 mvPosition = viewMatrix * worldPos;
    vec3 worldNormal = normalize( mat3( modelMatrix[0].xyz, modelMatrix[1].xyz, modelMatrix[2].xyz ) * normal );
    worldEye = normalize(worldPos.xyz - cameraPosition);
    vUv = uv;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const fragmentShader = `
uniform samplerCube cubemap;
uniform vec3 tint;
uniform float time;
uniform float opacity;
uniform float iridescenceIntensity;
uniform float pulseSpeed;
uniform float uChromaticSalt;
uniform float uSaturation;
uniform float uDispersionStrength;

varying vec3 vReflect;
varying vec3 vRefract[3];
varying float vReflectionFactor;
varying vec3 vPosition;
varying vec3 vNormal;
varying vec3 worldNormal;
varying vec3 worldEye;

float getFresnel(vec3 eye, vec3 vNormal, float power) {
  float fresnelFactor = abs(dot(eye, vNormal));
  float inversefresnelFactor = 1.0 - fresnelFactor;
  return pow(inversefresnelFactor, power);
}

vec3 getSaturation(vec3 rgb, float adjustment) {
  const vec3 W = vec3(0.2125, 0.7154, 0.0721);
  vec3 intensity = vec3(dot(rgb, W));
  return mix(intensity, rgb, adjustment);
}

const float fresnelPower = 2.;
const float refractionRatio = 1./1.44;
const int LOOP = 8;
const float uSlide = 0.1;
const float uChromaticAberration = 0.05;
const float uIorR = 1.0/1.144;
const float uIorY = 1.0/1.47;
const float uIorG = 1.0/1.51;
const float uIorC = 1.0/1.52;
const float uIorB = 1.0/1.57;
const float uIorP = 1.0/1.62;

#define SALT hash13(vec3(gl_FragCoord.xy,time))

float hash13(vec3 p3)
{
	p3  = fract(p3 * .1031);
    p3 += dot(p3, p3.zyx + 31.32);
    return fract((p3.x + p3.y) * p3.z);
}   

vec3 getInternalDispersion(samplerCube cubemap, vec3 normals, vec3 eye) {
    vec3 color = vec3(0.0);
    float dispersionStrength = 0.;
    
    for (int i = 0; i < LOOP; i++) {
        float slide = float(i) / float(LOOP) * uSlide;
        vec3 refractRed = refract(eye, normals, uIorR);
        vec3 refractGreen = refract(eye, normals, uIorR + uChromaticAberration * slide * 2.);
        vec3 refractBlue = refract(eye, normals, uIorR + uChromaticAberration * slide * 3.);
        /*
        vec3 refractRed = refract(eye, normals, uIorR);
        vec3 refractYellow = refract(eye, normals, uIorY);
        vec3 refractGreen = refract(eye, normals, uIorG);
        vec3 refractCyan = refract(eye, normals, uIorC);
        vec3 refractBlue = refract(eye, normals, uIorB);
        vec3 refractPurple = refract(eye, normals, uIorP);
        
        vec3 dirRed = mix(refractRed, refractRed * (1.0 + slide * dispersionStrength), dispersionStrength);
        vec3 dirYellow = mix(refractYellow, refractYellow * (1.0 + slide * dispersionStrength * 1.5), dispersionStrength);
        vec3 dirGreen = mix(refractGreen, refractGreen * (1.0 + slide * dispersionStrength * 1.2), dispersionStrength);
        vec3 dirCyan = mix(refractCyan, refractCyan * (1.0 + slide * dispersionStrength * 1.3), dispersionStrength);
        vec3 dirBlue = mix(refractBlue, refractBlue * (1.0 + slide * dispersionStrength * 1.7), dispersionStrength);
        vec3 dirPurple = mix(refractPurple, refractPurple * (1.0 + slide * dispersionStrength * 1.8), dispersionStrength);
        
        float r = textureCube(cubemap, dirRed).r;
        float y = (textureCube(cubemap, dirYellow).r * 0.4 + textureCube(cubemap, dirYellow).g * 0.6);
        float g = textureCube(cubemap, dirGreen).g;
        float c = (textureCube(cubemap, dirCyan).g * 0.4 + textureCube(cubemap, dirCyan).b * 0.6);
        float b = textureCube(cubemap, dirBlue).b;
        float p = (textureCube(cubemap, dirPurple).b * 0.4 + textureCube(cubemap, dirPurple).r * 0.6);
        
        color.r += clamp(r + (2.0*p + 2.0*y - c)/3.0, 0.0, 1.0);
        color.g += clamp(g + (2.0*y + 2.0*c - p)/3.0, 0.0, 1.0);
        color.b += clamp(b + (2.0*c + 2.0*p - y)/3.0, 0.0, 1.0);
        
        color.rgb = getSaturation(color.rgb, uSaturation);
        */
        


        color.r += textureCube(cubemap,refractRed).r;
        color.g += textureCube(cubemap,refractGreen).g;
        color.b += textureCube(cubemap,refractBlue).g;
        // color.rgb = textureCube(cubemap, refract(worldEye, vNormal, uIorR));  


    }
    color /= float(LOOP);
    return color;
}

void main() {
   
    vec3 refl = reflect(worldEye, vNormal);
    vec4 reflColor = textureCube(cubemap, refl);

    vec3 refr = refract(worldEye, vNormal, 1./2.41);
    vec4 refrColor = textureCube(cubemap, refr);

    float f = getFresnel(worldEye, vNormal, 2.);

    // Just output the raw cubemap reflection
    gl_FragColor = mix(reflColor, refrColor, f);
    gl_FragColor.a = f;
    
}
`;

const transluscentMaterial = new THREE.ShaderMaterial({
  uniforms,
  vertexShader,
  fragmentShader,
  transparent: true,
  side: THREE.DoubleSide,
  depthWrite: false,
  depthTest: true,
  blending: THREE.CustomBlending,
  blendSrc: THREE.SrcAlphaFactor,
  blendDst: THREE.OneMinusSrcAlphaFactor,
  blendEquation: THREE.AddEquation,
});

const createBubble = () => {
  // Use the shader material instead of MeshStandardMaterial
  bubble = new THREE.Mesh(bubbleGeometry, transluscentMaterial);
  bubble.castShadow = true;
  bubble.receiveShadow = false;
  scene.add(bubble);
};
createBubble();

const createPlane = () => {
  const planeGeometry = new THREE.PlaneGeometry(2000, 2000);
  const planeMaterial = new THREE.ShadowMaterial({
    opacity: 0.15,
  });
  const plane = new THREE.Mesh(planeGeometry, planeMaterial);
  plane.position.y = -240;
  plane.position.x = 0;
  plane.position.z = 0;
  plane.rotation.x = (Math.PI / 180) * -90;
  plane.receiveShadow = true;
  scene.add(plane);
};
createPlane();

const map = (num, in_min, in_max, out_min, out_max) => {
  return ((num - in_min) * (out_max - out_min)) / (in_max - in_min) + out_min;
};

const distance = (a, b) => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  return d;
};

let mouse = new THREE.Vector2(0, 0);
const onMouseMove = (e) => {
  gsap.to(mouse, {
    duration: 0.8,
    x: e.clientX || e.pageX || (e.touches ? e.touches[0].pageX : 0) || 0,
    y: e.clientY || e.pageY || (e.touches ? e.touches[0].pageY : 0) || 0,
    ease: "power2.out",
  });
};
["mousemove", "touchmove"].forEach((event) => {
  window.addEventListener(event, onMouseMove);
});

const onResize = () => {
  canvas.style.width = "";
  canvas.style.height = "";
  width = canvas.offsetWidth;
  height = canvas.offsetHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  maxDist = distance(mouse, { x: width / 2, y: height / 2 });
  renderer.setSize(width, height);
};
let resizeTm;
window.addEventListener("resize", function () {
  resizeTm = clearTimeout(resizeTm);
  resizeTm = setTimeout(onResize, 200);
});

const noise3D = createNoise3D();

let dist = new THREE.Vector2(0, 0);
let maxDist = distance(mouse, { x: width / 2, y: height / 2 });
const updateVertices = (time) => {
  dist = distance(mouse, { x: width / 2, y: height / 2 });
  dist /= maxDist;
  dist = map(dist, 1, 0, 0, 1);

  const rotationY = map(mouse.x, 0, width, 0, Math.PI * 2);
  const rotationZ = map(mouse.y, 0, height, 0, -Math.PI * 2);
  const rotMatrixY = new THREE.Matrix4().makeRotationY(rotationY);
  const rotMatrixZ = new THREE.Matrix4().makeRotationZ(rotationZ);
  const combinedRotMatrix = new THREE.Matrix4().multiplyMatrices(
    rotMatrixZ,
    rotMatrixY
  );

  const positions = positionAttribute.array;
  const vector = new THREE.Vector3();

  for (let i = 0; i < positions.length; i += 3) {
    const x = originalPositions[i];
    const y = originalPositions[i + 1];
    const z = originalPositions[i + 2];

    const perlin = noise3D(
      (x + 1) * 0.006 + time * 0.0005,
      (y + 1) * 0.006 + time * 0.0005,
      (z + 1) * 0.006
    );

    const ratio = perlin * 0.125 * (dist + 0.1) + 0.8;

    vector.set(x, y, z).multiplyScalar(ratio).applyMatrix4(combinedRotMatrix);

    positions[i] = vector.x;
    positions[i + 1] = vector.y;
    positions[i + 2] = vector.z;
  }

  positionAttribute.needsUpdate = true;
  bubbleGeometry.computeVertexNormals();
};

const render = (a) => {
  requestAnimationFrame(render);

  uniforms.time.value = a * 0.001;
  updateVertices(a);

  //   renderer.clear();
  renderer.render(scene, camera);
};
setup();
requestAnimationFrame(render);
