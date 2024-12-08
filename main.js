import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader";
const canvas = document.getElementById("canvas");
console.log(canvas);

const renderer = new THREE.WebGLRenderer({ canvas });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x000000, 0);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;
renderer.alpha = true;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);
camera.position.z = 4;

// Create a canvas for text texture
const textCanvas = document.createElement("canvas");
const ctx = textCanvas.getContext("2d");
const dpr = Math.min(window.devicePixelRatio, 2); // Cap at 2 to match shader behavior
textCanvas.width = window.innerWidth * dpr;
textCanvas.height = window.innerHeight * dpr;

// Scale canvas context by DPR
ctx.scale(dpr, dpr);

// Fill black background
ctx.fillStyle = "black";
ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);

// Add white text
ctx.fillStyle = "white";
ctx.font = "120px Inter";
ctx.textAlign = "center";
ctx.textBaseline = "middle";
ctx.fillText("Hello World", window.innerWidth / 2, window.innerHeight / 2);

// Convert to texture
const texture = new THREE.CanvasTexture(textCanvas);
scene.background = texture;
const textureLoader = new RGBELoader();
textureLoader.load(
  "https://cdn.shopify.com/s/files/1/0817/9308/9592/files/overcast_soil_puresky_1k.hdr?v=1727295592",
  function (texture) {
    texture.mapping = THREE.EquirectangularReflectionMapping;
    texture.flipY = true;
    // scene.environment = texture;
    material.uniforms.uRefractionTexture.value = texture;
  }
);

const controls = new OrbitControls(camera, canvas);
// Cube
const geometry = new THREE.TorusGeometry(1, 0.5, 100, 100);
const vertexShader = `
  varying vec3 vNormal;
  varying vec3 vPosition;
  varying vec3 vViewPosition;
  varying vec3 eye;
  varying vec3 worldEye;
  varying vec2 vUv;
  void main() {
    // Get face normal direction using the sign of the determinant of the model matrix
    float frontFacing = sign(determinant(modelMatrix));
    
    // Flip normal if back facing
    vNormal = normalize(normalMatrix * (normal * frontFacing));
    
    vPosition = position;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vec4 mvPosition = viewMatrix * worldPos;
    eye = vec3(0.0, 0.0, -1.0); 
    worldEye = normalize(cameraPosition - mvPosition.xyz);
    vUv = uv;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const fragmentShader = `
uniform float uIorR;
uniform float uIorY;
uniform float uIorG;
uniform float uIorC;
uniform float uIorB;
uniform float uIorP;

uniform float uSaturation;
uniform float uChromaticAberration;
uniform float uRefractPower;
uniform float uReflectPower;
uniform float uFresnelPower;
uniform float uShininess;
uniform float uDiffuseness;
uniform vec3 uLight;
uniform float uTime;
uniform vec2 winResolution;
uniform sampler2D uTexture;
uniform sampler2D uRefractionTexture;
varying vec3 vNormal;
varying vec3 eye;
varying vec3 worldEye;
varying vec2 vUv;

#define PI ${Math.PI}
#define time uTime
const int LOOP = 16;
#define iorRatioRed 1.0/uIorR;
#define iorRatioGreen 1.0/uIorG;
#define iorRatioBlue 1.0/uIorB;

float hash13(vec3 p3)
{
	p3  = fract(p3 * .1031);
    p3 += dot(p3, p3.zyx + 31.32);
    return fract((p3.x + p3.y) * p3.z);
}

vec3 swizzle(vec3 channel, ivec3 rule) {
    return vec3(
        channel[rule.x],
        channel[rule.y],
        channel[rule.z]
    );
}

vec3 getSaturation(vec3 rgb, float adjustment) {
  const vec3 W = vec3(0.2125, 0.7154, 0.0721);
  vec3 intensity = vec3(dot(rgb, W));
  return mix(intensity, rgb, adjustment);
}

float getFresnel(vec3 eye, vec3 vNormal, float power) {
  float fresnelFactor = abs(dot(eye, vNormal));
  float inversefresnelFactor = 1.0 - fresnelFactor;
  
  return pow(inversefresnelFactor, power);
}

vec2 getSpherical(vec3 normal) {
  float phi = acos(normal.y);
  float sinPhi = sin(phi);
  float theta =
    abs(sinPhi) > 0.0001
      ? acos(normal.x / sinPhi)
      : 0.;
  return vec2(theta/PI, phi/PI);
}

vec4 getBackground(vec3 normal, sampler2D bg, bool flip) {
  vec2 coord = getSpherical(normal);
  return texture2D(bg, flip ? coord : coord);
}

vec3 getSpectrumPoly(float x) {
    // https://www.shadertoy.com/view/wlSBzD
    return (vec3( 1.220023e0,-1.933277e0, 1.623776e0)
          +(vec3(-2.965000e1, 6.806567e1,-3.606269e1)
          +(vec3( 5.451365e2,-7.921759e2, 6.966892e2)
          +(vec3(-4.121053e3, 4.432167e3,-4.463157e3)
          +(vec3( 1.501655e4,-1.264621e4, 1.375260e4)
          +(vec3(-2.904744e4, 1.969591e4,-2.330431e4)
          +(vec3( 3.068214e4,-1.698411e4, 2.229810e4)
          +(vec3(-1.675434e4, 7.594470e3,-1.131826e4)
          + vec3( 3.707437e3,-1.366175e3, 2.372779e3)
            *x)*x)*x)*x)*x)*x)*x)*x)*x;
}

vec3 getSpectrum(float x) {
   vec3 a = vec3(0.8, 0.8, 0.9);
    vec3 b = vec3(0.2, 0.1, 0.1);
    vec3 c = vec3(1.0, 1.0, 1.0);
    vec3 d = vec3(0.0+0.18*cos(0.1*uTime), 0.33+0.18*sin(0.2*uTime), 0.67);

    return a + b*cos(PI*2.*(c*x + d));
}


vec4 remapShadows(vec4 color) {
  float factor = 8.;
  return vec4(
    pow(color.x, factor),
    pow(color.y, factor),
    pow(color.z, factor),
    color.w
  );
}

float getSpecular(vec3 light, float shininess, float diffuseness) {
  vec3 normal = vNormal;
  vec3 lightVector = normalize(-light);
  vec3 halfVector = normalize(eye + lightVector);
  float NdotL = dot(normal, lightVector);
  float NdotH =  dot(normal, halfVector);
  float kDiffuse = max(0.0, NdotL);
  float NdotH2 = NdotH * NdotH;
  float kSpecular = pow(NdotH2, shininess);
  return  kSpecular + kDiffuse * diffuseness;
}

vec4 getReflections(vec3 eye, vec3 normal, sampler2D texture){
 vec3 reflectedDir = normalize(reflect(eye, normal));
 return remapShadows(getBackground(reflectedDir, texture, false));
}

vec4 getRefractions(vec3 eye, vec3 normal, sampler2D texture, float ior){
 vec3 refractedDir = normalize(refract(eye, normal, ior));
 return remapShadows(getBackground(refractedDir, texture, true));
}


vec3 getChannel(sampler2D tex, vec2 pos, vec2 offset, float slide) {
    return texture2D(tex, pos + (offset.xy * slide) * uChromaticAberration).rgb * 0.5;
}



float getCompositeChannel(sampler2D tex, vec2 pos, vec2 offset, float slide, ivec3 components) {
    vec3 sampled = getChannel(tex, pos, offset, slide);
    vec3 swizzled = swizzle(sampled, components);
    return (swizzled.r * 4.0 + swizzled.g * 4.0 - swizzled.b * 2.0) / 6.0;
}




vec3 getInternalDispersion(sampler2D tex, vec2 uv, vec3 eye ) {
    vec3 color = vec3(0.0);
    for (int i = 0; i < LOOP; i++) {
        float slide = float(i) / float(LOOP) * 0.1 + hash13(vec3(gl_FragCoord.xy,time)) * 0.05;
        vec2 refractRed = refract(eye, vNormal, 1.0/uIorR).xy;
        vec2 refractYellow = refract(eye, vNormal, 1.0/uIorY).xy;
        vec2 refractGreen = refract(eye, vNormal, 1.0/uIorG).xy;
        vec2 refractCyan = refract(eye, vNormal, 1.0/uIorC).xy;
        vec2 refractBlue = refract(eye, vNormal, 1.0/uIorB).xy;
        vec2 refractPurple = refract(eye, vNormal, 1.0/uIorP).xy;

        float r = getChannel(tex, uv, refractRed, uRefractPower + slide * 1.0).r;
        float y = getCompositeChannel(tex, uv, refractYellow, uRefractPower + slide * 2.5, ivec3(0, 1, 2));
        float g = getChannel(tex, uv, refractGreen, uRefractPower + slide * 2.0).g;
        float c = getCompositeChannel(tex, uv, refractCyan, uRefractPower + slide * 2.5, ivec3(1, 2, 0));
        float b = getChannel(tex, uv, refractBlue, uRefractPower + slide * 3.0).b;
        float p = getCompositeChannel(tex, uv, refractPurple, uRefractPower + slide * 3.0, ivec3(2, 0, 1));

        color.r += clamp(r + (2.0*p + 2.0*y - c)/3.0, 0.0, 1.0);
        color.g += clamp(g + (2.0*y + 2.0*c - p)/3.0, 0.0, 1.0);
        color.b += clamp(b + (2.0*c + 2.0*p - y)/3.0, 0.0, 1.0);

        color.rgb = getSaturation(color.rgb, uSaturation);
    }
    color /= float(LOOP);
    return color;
}

vec3 getExternalDispersion(sampler2D tex, vec2 uv, vec3 eye, vec3 normal ) {
    vec3 color = vec3(0.0);
    vec2 reflected = getSpherical(reflect(eye, -normal));
    for (int i = 0; i < LOOP; i++) {
        float slide = float(i) / float(LOOP) * 0.1 + hash13(vec3(gl_FragCoord.xy,time)) * 0.05;
        
        float r = getChannel(tex, uv, reflected, uReflectPower + slide * 1.0).r;
        float y = getCompositeChannel(tex, uv, reflected, uReflectPower + slide * 2.5, ivec3(0, 1, 2));
        float g = getChannel(tex, uv, reflected, uReflectPower + slide * 2.0).g;
        float c = getCompositeChannel(tex, uv, reflected, uReflectPower + slide * 2.5, ivec3(1, 2, 0));
        float b = getChannel(tex, uv, reflected, uReflectPower + slide * 3.0).b;
        float p = getCompositeChannel(tex, uv, reflected, uReflectPower + slide * 3.0, ivec3(2, 0, 1));

        color.r += clamp(r + (2.0*p + 2.0*y - c)/3.0, 0.0, 1.0);
        color.g += clamp(g + (2.0*y + 2.0*c - p)/3.0, 0.0, 1.0);
        color.b += clamp(b + (2.0*c + 2.0*p - y)/3.0, 0.0, 1.0);

        color.rgb = getSaturation(color.rgb, uSaturation);
    }
    color /= float(LOOP);
    return color;
}




void main() {
  vec2 uv = gl_FragCoord.xy / winResolution.xy;
  vec3 normal = vNormal;
  //vec2 reflectionVec = getSpherical(reflect(worldEye, -normal));
  float f = getFresnel(eye, normal, uFresnelPower);
  vec4 refls = getReflections(eye,normal,uRefractionTexture);
  vec4 refrs = getRefractions(eye,normal,uTexture, 1./1.444);
  
  float specularLight = getSpecular(uLight, uShininess, uDiffuseness);
  vec3 dispersion = getInternalDispersion(uTexture, uv,  worldEye);
  vec3 reflections = getExternalDispersion(uTexture, uv,  worldEye, normal);
  
  vec3 color = mix(refrs,refls,f).rgb;
  color += mix(dispersion,reflections,f).rgb;
  color += mix(vec3(0.), getSpectrum(specularLight), specularLight);
  color += mix(vec3(0.0),getSpectrum(f),f);
  color = clamp(color, 0.,1.);
  //color = SpectrumPoly(f);
 
  gl_FragColor = vec4(color, 1.0);
  
}
`;

const uniforms = {
  uIorR: { value: 1.0 },
  uIorY: { value: 1.0 },
  uIorG: { value: 1.0 },
  uIorC: { value: 1.0 },
  uIorB: { value: 1.0 },
  uIorP: { value: 1.0 },
  uSaturation: { value: 1.0 },
  uChromaticAberration: { value: 0.25 },
  uRefractPower: { value: 1.0 },
  uReflecttPower: { value: 1.0 },
  uFresnelPower: { value: 4.0 },
  uShininess: { value: 40.0 },
  uDiffuseness: { value: 0.2 },
  uLight: { value: new THREE.Vector3(-1, 0, 1) },
  winResolution: {
    value: new THREE.Vector2(
      window.innerWidth,
      window.innerHeight
    ).multiplyScalar(dpr), // if DPR is 3 the shader glitches 🤷‍♂️
  },
  uTexture: { value: texture },
  uRefractionTexture: { value: null },
  uTime: { value: 0.0 },
};

const material = new THREE.ShaderMaterial({
  vertexShader: vertexShader,
  fragmentShader: fragmentShader,
  uniforms,
  side: THREE.DoubleSide,
});

const cube = new THREE.Mesh(geometry, material);
scene.add(cube);

function updateTextTexture() {
  // Update canvas dimensions
  textCanvas.width = window.innerWidth * dpr;
  textCanvas.height = window.innerHeight * dpr;

  // Reset scale and set it again (needed because canvas clear resets transform)
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);

  // Fill black background
  ctx.fillStyle = "black";
  ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);

  // Add white text
  ctx.fillStyle = "white";
  ctx.font = "120px Inter";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("Hello World", window.innerWidth / 2, window.innerHeight / 2);

  // Update texture
  texture.needsUpdate = true;
}

// Initial call
updateTextTexture();

// Update resize handler
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  updateTextTexture();
});

// Animation loop
function animate() {
  requestAnimationFrame(animate);

  cube.rotation.x += 0.01;
  cube.rotation.y += 0.01;
  material.uniforms.uTime.value += 0.01;
  controls.update();
  renderer.render(scene, camera);
}

animate();
