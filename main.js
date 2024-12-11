import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader";
import GUI from "lil-gui";
(async () => {
  const canvas = document.getElementById("canvas");
  const renderer = new THREE.WebGLRenderer({ canvas });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.alpha = true;

  const scene = new THREE.Scene();
  const bufferScene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
  );
  camera.position.z = 4;
  const renderCamera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
  );
  renderCamera.position.z = 1;
  // Create a canvas for text texture
  const textCanvas = document.createElement("canvas");
  const ctx = textCanvas.getContext("2d", { antialias: true });
  const dpr = Math.min(window.devicePixelRatio, 2); // Cap at 2 to match shader behavior
  textCanvas.width = window.innerWidth * dpr;
  textCanvas.height = window.innerHeight * dpr;

  // Convert to texture
  const texture = new THREE.CanvasTexture(textCanvas);
  scene.background = texture;
  // renderScene.background = texture;
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
  // Add this after creating the geometry but before creating the mesh

  const vertexShader = `
  varying vec3 vNormal;
  varying vec3 vPosition;
  varying vec3 vViewPosition;
  varying vec3 eye;
  varying vec3 worldEye;
  varying vec2 vUv;
  varying float facing;
  void main() {
    // Get face normal direction using the sign of the determinant of the model matrix
    facing = sign(determinant(modelMatrix));
    
    // Flip normal if back facing
    vNormal = normalize(normalMatrix * (normal));
    
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
uniform float uLightStrength;
uniform float uSlide;
uniform float uChromaticSalt;
uniform float uNacre;
uniform vec3 uLight;
uniform float uTime;
uniform vec2 winResolution;
uniform sampler2D uTexture;
uniform sampler2D uFixedTexture;
uniform sampler2D uRefractionTexture;
uniform bool uFlipNormal;
varying vec3 vNormal;
varying vec3 eye;
varying vec3 worldEye;
varying vec2 vUv;
varying float facing;

#define PI ${Math.PI}
#define time uTime
const int LOOP = 8;

#define SALT hash13(vec3(gl_FragCoord.xy,time)) * uChromaticSalt

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
  return vec2(1.-theta/PI, 1.-phi/PI);
}

vec4 sampleSpherical(vec3 normal, sampler2D bg, bool flip) {
  vec2 coord = getSpherical(normal);
  return texture2D(bg, flip ? coord : (coord * vec2(1.,-1.) + vec2(0.,1.)));
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
 return remapShadows(sampleSpherical(reflectedDir, texture, true));
}

vec4 getRefractions(vec3 eye, vec3 normal, sampler2D texture, float ior){
 vec3 refractedDir = normalize(refract(eye, normal, ior));
 return remapShadows(sampleSpherical(refractedDir, texture, true));
}

vec3 getScreenChannel(sampler2D tex, vec2 uv, vec2 offset, float slide) {
    return texture2D(tex, uv + (offset.xy * slide) * uChromaticAberration).rgb * 0.5;
}

vec3 getSphericalChannel(sampler2D tex, vec3 normal, vec3 offset, float slide) {
    vec2 coord = getSpherical((normal + (offset * slide) * uChromaticAberration));
    return texture2D(tex, coord).rgb * 0.5;
}

float getScreenCompositeChannel(sampler2D tex, vec2 uv, vec2 offset, float slide, ivec3 components) {
    vec3 sampled = getScreenChannel(tex, uv, offset, slide);
    vec3 swizzled = swizzle(sampled, components);
    return (swizzled.r * 4.0 + swizzled.g * 4.0 - swizzled.b * 2.0) / 6.0;
}

float getSphericalCompositeChannel(sampler2D tex, vec3 normals, vec3 offset, float slide, ivec3 components) {
    vec3 sampled = getSphericalChannel(tex, normals, offset, slide);
    vec3 swizzled = swizzle(sampled, components);
    return (swizzled.r * 4.0 + swizzled.g * 4.0 - swizzled.b * 2.0) / 6.0;
}

// to do : add back alpha
vec3 getInternalDispersion(sampler2D tex, vec3 normals, vec3 eye ) {
    vec3 color = vec3(0.0);
    for (int i = 0; i < LOOP; i++) {
        float slide = float(i) / float(LOOP) * uSlide + SALT;
        vec3 refractRed = (refract(eye, normals, 1.0/uIorR));
        vec3 refractYellow = (refract(eye, normals, 1.0/uIorY));
        vec3 refractGreen = (refract(eye, normals, 1.0/uIorG));
        vec3 refractCyan = (refract(eye, normals, 1.0/uIorC));
        vec3 refractBlue = (refract(eye, normals, 1.0/uIorB));
        vec3 refractPurple = (refract(eye, normals, 1.0/uIorP));

        float r = getSphericalChannel(tex, normals, refractRed, uRefractPower + slide * 1.0).r;
        float y = getSphericalCompositeChannel(tex, normals, refractYellow, uRefractPower + slide * 2.5, ivec3(0, 1, 2));
        float g = getSphericalChannel(tex, normals, refractGreen, uRefractPower + slide * 2.0).g;
        float c = getSphericalCompositeChannel(tex, normals, refractCyan, uRefractPower + slide * 2.5, ivec3(1, 2, 0));
        float b = getSphericalChannel(tex, normals, refractBlue, uRefractPower + slide * 3.0).b;
        float p = getSphericalCompositeChannel(tex, normals, refractPurple, uRefractPower + slide * 3.0, ivec3(2, 0, 1));

        color.r += clamp(r + (2.0*p + 2.0*y - c)/3.0, 0.0, 1.0);
        color.g += clamp(g + (2.0*y + 2.0*c - p)/3.0, 0.0, 1.0);
        color.b += clamp(b + (2.0*c + 2.0*p - y)/3.0, 0.0, 1.0);

        color.rgb = getSaturation(color.rgb, uSaturation);
    }
    color /= float(LOOP);
    return color;
}

vec3 getScreenInternalDispersion(sampler2D tex, vec2 uv, vec3 worldEye ) {
    vec3 color = vec3(0.0);
    for (int i = 0; i < LOOP; i++) {
        float slide = float(i) / float(LOOP) * uSlide + SALT;
        vec2 refractRed = refract(worldEye, vNormal, 1.0/uIorR).xy;
        vec2 refractYellow = refract(worldEye, vNormal, 1.0/uIorY).xy;
        vec2 refractGreen = refract(worldEye, vNormal, 1.0/uIorG).xy;
        vec2 refractCyan = refract(worldEye, vNormal, 1.0/uIorC).xy;
        vec2 refractBlue = refract(worldEye, vNormal, 1.0/uIorB).xy;
        vec2 refractPurple = refract(worldEye, vNormal, 1.0/uIorP).xy;

        float r = getScreenChannel(tex, uv, refractRed, uRefractPower + slide * 1.0).r;
        float y = getScreenCompositeChannel(tex, uv, refractYellow, uRefractPower + slide * 2.5, ivec3(0, 1, 2));
        float g = getScreenChannel(tex, uv, refractGreen, uRefractPower + slide * 2.0).g;
        float c = getScreenCompositeChannel(tex, uv, refractCyan, uRefractPower + slide * 2.5, ivec3(1, 2, 0));
        float b = getScreenChannel(tex, uv, refractBlue, uRefractPower + slide * 3.0).b;
        float p = getScreenCompositeChannel(tex, uv, refractPurple, uRefractPower + slide * 3.0, ivec3(2, 0, 1));

        color.r += clamp(r + (2.0*p + 2.0*y - c)/3.0, 0.0, 1.0);
        color.g += clamp(g + (2.0*y + 2.0*c - p)/3.0, 0.0, 1.0);
        color.b += clamp(b + (2.0*c + 2.0*p - y)/3.0, 0.0, 1.0);

        color.rgb = getSaturation(color.rgb, uSaturation);
    }
    color /= float(LOOP);
    return color;
}
// to do : add back alpha
vec3 getExternalDispersion(sampler2D tex, vec3 normals, vec3 eye ) {
    vec3 color = vec3(0.0);
    vec3 reflected = reflect(eye, -normals);
    for (int i = 0; i < LOOP; i++) {
        float slide = float(i) / float(LOOP) * uSlide +SALT;
        
        float r = getSphericalChannel(tex, normals, reflected, uReflectPower + slide * 1.0).r;
        float y = getSphericalCompositeChannel(tex, normals, reflected, uReflectPower + slide * 2.5, ivec3(0, 1, 2));
        float g = getSphericalChannel(tex, normals, reflected, uReflectPower + slide * 2.0).g;
        float c = getSphericalCompositeChannel(tex, normals, reflected, uReflectPower + slide * 2.5, ivec3(1, 2, 0));
        float b = getSphericalChannel(tex, normals, reflected, uReflectPower + slide * 3.0).b;
        float p = getSphericalCompositeChannel(tex, normals, reflected, uReflectPower + slide * 3.0, ivec3(2, 0, 1));

        color.r += clamp(r + (2.0*p + 2.0*y - c)/3.0, 0.0, 1.0);
        color.g += clamp(g + (2.0*y + 2.0*c - p)/3.0, 0.0, 1.0);
        color.b += clamp(b + (2.0*c + 2.0*p - y)/3.0, 0.0, 1.0);

        color.rgb = getSaturation(color.rgb, uSaturation);
    }
    color /= float(LOOP);
    return color;
}

vec3 getScreenExternalDispersion(sampler2D tex, vec2 uv, vec3 worldEye, vec3 normal ) {
    vec3 color = vec3(0.0);
    vec2 reflected = getSpherical(reflect(worldEye, -normal));
    for (int i = 0; i < LOOP; i++) {
        float slide = float(i) / float(LOOP) * uSlide + SALT;
        
        float r = getScreenChannel(tex, uv, reflected, uReflectPower + slide * 1.0).r;
        float y = getScreenCompositeChannel(tex, uv, reflected, uReflectPower + slide * 2.5, ivec3(0, 1, 2));
        float g = getScreenChannel(tex, uv, reflected, uReflectPower + slide * 2.0).g;
        float c = getScreenCompositeChannel(tex, uv, reflected, uReflectPower + slide * 2.5, ivec3(1, 2, 0));
        float b = getScreenChannel(tex, uv, reflected, uReflectPower + slide * 3.0).b;
        float p = getScreenCompositeChannel(tex, uv, reflected, uReflectPower + slide * 3.0, ivec3(2, 0, 1));

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
  vec3 normal = uFlipNormal ? -vNormal : vNormal;
  //vec2 reflectionVec = getSpherical(reflect(worldEye, -normal));
  float f = getFresnel(eye, normal, uFresnelPower);
  vec2 spherical = getSpherical(normal);
  vec4 refls = getReflections(eye,normal,uRefractionTexture);
  float specularLight = getSpecular(uLight, uShininess, uDiffuseness);
  vec3 dispersion = getInternalDispersion(uTexture, normal,  worldEye);
  vec3 reflections = getExternalDispersion(uTexture, normal, worldEye);
  vec3 color = uFlipNormal ? vec3(0.) : dispersion * .25;
  color += dispersion + reflections * specularLight + refls.rgb * pow(f * uReflectPower,2.);
  color += mix(vec3(0.), getSpectrum(specularLight), specularLight * uLightStrength);
  color += mix(vec3(0.0),getSpectrum(f),((0.5 * f) + .5) * uNacre );
  color = clamp(color, 0.,1.);
  
  gl_FragColor = vec4(color, 1.0);
   #include <tonemapping_fragment>
  //  #include <colorspace_fragment>
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
    uChromaticAberration: { value: 0.5 },
    uRefractPower: { value: 1.0 },
    uReflectPower: { value: 1.0 },
    uFresnelPower: { value: 4.0 },
    uShininess: { value: 40.0 },
    uDiffuseness: { value: 0.2 },
    uSlide: { value: 0.1 },
    uChromaticSalt: { value: 0.05 },
    uNacre: { value: 0.05 },
    uLight: { value: new THREE.Vector3(-1, 0, 1) },
    uLightStrength: { value: 1 },
    winResolution: {
      value: new THREE.Vector2(
        window.innerWidth,
        window.innerHeight
      ).multiplyScalar(dpr), // if DPR is 3 the shader glitches 🤷‍♂️
    },
    uTexture: { value: texture },
    uFixedTexture: { value: texture },
    uBackTexture: { value: null },
    uRefractionTexture: { value: null },
    uTime: { value: 0.0 },
    uFlipNormal: { value: true },
  };

  const material = new THREE.ShaderMaterial({
    vertexShader: vertexShader,
    fragmentShader: fragmentShader,
    uniforms,
    side: THREE.FrontSide,
  });

  const geometries = {
    Torus: new THREE.TorusGeometry(1, 0.5, 100, 100),
    Cube: new THREE.BoxGeometry(2, 2, 2),
    Sphere: new THREE.SphereGeometry(1.5, 64, 64),
    Cylinder: new THREE.CylinderGeometry(1, 1, 2, 32),
    Dodecahedron: new THREE.DodecahedronGeometry(1.5),
  };

  const backTarget = new THREE.WebGLRenderTarget(
    window.innerWidth * dpr,
    window.innerHeight * dpr,
    {
      format: THREE.RGBAFormat,
      type: THREE.FloatType,
    }
  );

  const frontTarget = new THREE.WebGLRenderTarget(
    window.innerWidth * dpr,
    window.innerHeight * dpr,
    {
      format: THREE.RGBAFormat,
      type: THREE.FloatType,
    }
  );
  const renderMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
      uniforms: {
        uFrontTexture: { value: frontTarget.texture },
        uBackTexture: { value: backTarget.texture },
        uResolution: {
          value: new THREE.Vector2(
            window.innerWidth * dpr,
            window.innerHeight * dpr
          ),
        },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D uFrontTexture;
        uniform sampler2D uBackTexture; 
        uniform vec2 uResolution;
        varying vec2 vUv;
        
        vec4 add(vec4 src, vec4 dst, bool clamped) {
          if(!clamped) return src + dst;
          return clamp(src + dst, 0.0, 1.0);
        }

        vec4 blend(vec4 src, vec4 dst, float f) {
          return mix(src, dst, f);
        }

        vec4 screen(vec4 src, vec4 dst, bool clamped) {
          if(!clamped) return vec4(1.0) - (vec4(1.0) - src) * (vec4(1.0) - dst);
          return clamp(vec4(1.0) - (vec4(1.0) - src) * (vec4(1.0) - dst), 0.0, 1.0);
}

        void main() {
          vec2 uv = gl_FragCoord.xy / uResolution;
          vec4 frontColor = texture2D(uFrontTexture, uv);
          vec4 backColor = texture2D(uBackTexture, uv);
          
          // Blend front and back
          vec4 color =  blend(backColor, frontColor, 0.98);
          gl_FragColor = color;
        }
      `,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    })
  );

  scene.add(renderMesh);

  // Replace the cube creation with this:
  const mesh = new THREE.Mesh(geometries["Torus"], material);
  bufferScene.add(mesh);

  function updateTextTexture() {
    // Update canvas dimensions

    textCanvas.width = window.innerWidth * dpr;
    textCanvas.height = window.innerHeight * dpr;

    // Reset scale and set it again (needed because canvas clear resets transform)
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);

    // Fill black background
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);

    // Add white text
    ctx.fillStyle = "white";
    ctx.font = "160px Inter";
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
    renderCamera.aspect = window.innerWidth / window.innerHeight;
    renderCamera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    backTarget.setSize(window.innerWidth, window.innerHeight);
    frontTarget.setSize(window.innerWidth, window.innerHeight);

    updateTextTexture();

    // Update resolution uniform
    renderMesh.material.uniforms.uResolution.value.set(
      window.innerWidth * dpr,
      window.innerHeight * dpr
    );
  });

  // Animation loop
  function animate() {
    requestAnimationFrame(animate);
    mesh.rotation.x += 0.01;
    mesh.rotation.y += 0.01;
    material.uniforms.uTime.value += 0.01;
    controls.update();

    material.uniforms.uFlipNormal.value = true;
    material.uniforms.uTexture.value = texture;
    material.side = THREE.BackSide;
    renderer.setRenderTarget(backTarget);
    renderer.render(bufferScene, camera);

    material.uniforms.uFlipNormal.value = false;
    material.uniforms.uTexture.value = backTarget.texture;
    material.side = THREE.FrontSide;

    renderer.setRenderTarget(frontTarget);
    renderer.render(bufferScene, camera);

    renderMesh.material.uniforms.uFrontTexture.value = frontTarget.texture;
    renderMesh.material.uniforms.uBackTexture.value = backTarget.texture;
    renderer.setRenderTarget(null);
    renderer.render(scene, renderCamera);
  }

  const gui = new GUI({ closeFolders: true });
  // refractoive
  const iorFolder = gui.addFolder("Refractive Indices");
  iorFolder.add(material.uniforms.uIorR, "value", 1.0, 2.0, 0.01).name("Red");
  iorFolder
    .add(material.uniforms.uIorY, "value", 1.0, 2.0, 0.01)
    .name("Yellow");
  iorFolder.add(material.uniforms.uIorG, "value", 1.0, 2.0, 0.01).name("Green");
  iorFolder.add(material.uniforms.uIorC, "value", 1.0, 2.0, 0.01).name("Cyan");
  iorFolder.add(material.uniforms.uIorB, "value", 1.0, 2.0, 0.01).name("Blue");
  iorFolder
    .add(material.uniforms.uIorP, "value", 1.0, 2.0, 0.01)
    .name("Purple");
  // effect
  const effectsFolder = gui.addFolder("Effects");
  effectsFolder
    .add(material.uniforms.uSaturation, "value", 0, 2, 0.1)
    .name("Saturation");
  effectsFolder
    .add(material.uniforms.uChromaticAberration, "value", 0, 2, 0.1)
    .name("Chromatic Aberration");
  effectsFolder
    .add(material.uniforms.uSlide, "value", -1, 1, 0.01)
    .name("Chromatic Slide");
  effectsFolder
    .add(material.uniforms.uChromaticSalt, "value", 0, 0.25, 0.01)
    .name("Chromatic Salt");
  effectsFolder
    .add(material.uniforms.uRefractPower, "value", 0, 2, 0.01)
    .name("Refraction Strength");
  effectsFolder
    .add(material.uniforms.uReflectPower, "value", 0, 0.5, 0.01)
    .name("Reflection Strength");
  effectsFolder
    .add(material.uniforms.uFresnelPower, "value", 0, 10, 0.01)
    .name("Fresnel Power");

  // Lighting
  const lightFolder = gui.addFolder("Lighting");
  lightFolder
    .add(material.uniforms.uLightStrength, "value", 0, 1, 0.01)
    .name("Strength");
  lightFolder
    .add(material.uniforms.uShininess, "value", 0, 100, 1)
    .name("Shininess");
  lightFolder
    .add(material.uniforms.uDiffuseness, "value", 0, 1, 0.1)
    .name("Diffuseness");
  lightFolder.add(material.uniforms.uNacre, "value", 0, 1, 0.01).name("Nacre");
  lightFolder
    .add(material.uniforms.uLight.value, "x", -5, 5, 0.1)
    .name("Light X");
  lightFolder
    .add(material.uniforms.uLight.value, "y", -5, 5, 0.1)
    .name("Light Y");
  lightFolder
    .add(material.uniforms.uLight.value, "z", -5, 5, 0.1)
    .name("Light Z");

  // Add this new folder:
  const meshFolder = gui.addFolder("Mesh");
  const meshSettings = {
    geometry: "Torus",
  };

  meshFolder
    .add(meshSettings, "geometry", Object.keys(geometries))
    .onChange((value) => {
      mesh.geometry.dispose(); // Clean up old geometry
      mesh.geometry = geometries[value];
    });

  animate();
})();
