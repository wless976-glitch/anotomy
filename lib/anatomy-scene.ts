// The WebGL stage: layered anatomy model, scroll-driven camera orbit, floating cells and the
// liquid wave backdrop. The page owns the animation loop and feeds `update()` every frame.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';

export const LAYER_NAMES = ['skin', 'muscles', 'skeleton', 'organs', 'vessels', 'nerves'] as const;
export type LayerName = (typeof LAYER_NAMES)[number];

export interface FrameState {
    scroll: number;        // smoothed scroll progress [0..1]
    targetScroll: number;  // raw scroll progress [0..1]
    mouseX: number;        // smoothed pointer [-1..1]
    mouseY: number;
    delta: number;         // seconds since last frame
    elapsed: number;       // seconds since start
}

export interface PickResult {
    layer: LayerName;
    name: string;
}

interface SceneOptions {
    modelUrl: string;
    onProgress?: (fraction: number) => void;
    onLoaded?: () => void;
    onError?: (error: unknown) => void;
}

interface Layer {
    name: LayerName;
    mesh: THREE.Mesh;
    material: THREE.MeshStandardMaterial;
    parts: string[];
    opacity: number;
    bvhReady: boolean;
}

const BODY_SIZE = 3.0;        // largest dimension of the body, in world units
const REVEAL_SECONDS = 1.6;   // fade-in once the model arrives
const SPARK_COUNT = 450;

// Draw order from the inside out, so translucent outer layers blend over what they cover.
const RENDER_ORDER: Record<LayerName, number> = { organs: 0, vessels: 0, nerves: 0, skeleton: 1, muscles: 2, skin: 3 };

const MATERIALS: Record<Exclude<LayerName, 'skin'>, THREE.MeshStandardMaterialParameters> = {
    muscles: { roughness: 0.48, metalness: 0.0 },
    skeleton: { roughness: 0.72, metalness: 0.0 },
    organs: { roughness: 0.42, metalness: 0.0 },
    vessels: { roughness: 0.38, metalness: 0.0 },
    nerves: { roughness: 0.5, metalness: 0.0, emissive: new THREE.Color('#3a2a00') }
};

function ramp(value: number, start: number, end: number) {
    const t = Math.min(1, Math.max(0, (value - start) / (end - start)));
    return t * t * (3 - 2 * t);
}

// How visible each layer is at a given scroll position: skin → muscles → skeleton → organs.
export function layerOpacity(layer: LayerName, scroll: number) {
    switch (layer) {
        case 'skin': return 1 - ramp(scroll, 0.12, 0.26);
        case 'muscles': return 1 - ramp(scroll, 0.42, 0.54);
        // bones stay under the muscles from the start, then ghost out around the organs
        case 'skeleton': return 1 - 0.84 * ramp(scroll, 0.70, 0.84);
        default: return ramp(scroll, 0.68, 0.84);
    }
}

export class AnatomyScene {
    private renderer: THREE.WebGLRenderer;
    private scene = new THREE.Scene();
    private camera: THREE.PerspectiveCamera;
    private pivot = new THREE.Group();
    private layers: Layer[] = [];
    private skinMaterial?: THREE.MeshStandardMaterial;
    private skinRim?: THREE.ShaderMaterial;
    private sparks!: THREE.Points;
    private sparkData: { speedX: number; speedY: number; speedZ: number; swaySpeed: number; swayRadius: number; phase: number }[] = [];
    private uniforms = {
        uTime: { value: 0 },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uMouse: { value: new THREE.Vector2(0, 0) },
        uScroll: { value: 0 }
    };
    private raycaster = new THREE.Raycaster();
    // camera eases along the orbit itself (angle, radius, height), so a long jump circles the
    // body instead of cutting a straight line through it; starts at the intro position (0, 0.2, 3.0)
    private orbit = { phi: 0, radius: 3.0, y: 0.2 };
    private lookAt = new THREE.Vector3();
    private revealPending = false;
    private revealStart = -1;
    private reveal = 0;
    private disposed = false;
    private idleHandle = 0;

    constructor(private canvas: HTMLCanvasElement, private options: SceneOptions) {
        this.scene.background = new THREE.Color('#000000');
        this.scene.fog = new THREE.FogExp2('#000000', 0.01);

        this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
        this.camera.position.set(0, this.orbit.y, this.orbit.radius);
        this.scene.add(this.camera);

        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.15;

        this.raycaster.firstHitOnly = true;

        this.createBackground();
        this.createLights();
        this.createSparks();
        this.scene.add(this.pivot);
        this.loadModel();
    }

    resize(width: number, height: number) {
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setSize(width, height, false);
        this.uniforms.uResolution.value.set(width, height);
    }

    update(state: FrameState) {
        const { scroll, targetScroll, mouseX, mouseY, delta, elapsed } = state;

        // gentle interactive tilt from the pointer
        this.pivot.rotation.y = mouseX * 0.25;
        this.pivot.rotation.x = mouseY * 0.15;

        if (this.revealPending) {
            this.revealPending = false;
            this.revealStart = elapsed;
        }
        if (this.revealStart >= 0) {
            this.reveal = ramp(elapsed - this.revealStart, 0, REVEAL_SECONDS);
        }
        for (const layer of this.layers) {
            this.applyOpacity(layer, layerOpacity(layer.name, scroll) * this.reveal);
        }
        const skin = layerOpacity('skin', scroll) * this.reveal;
        if (this.skinMaterial) this.skinMaterial.opacity = 0.3 * skin;
        if (this.skinRim) this.skinRim.uniforms.uOpacity.value = skin;

        this.updateSparks(delta, elapsed, Math.abs(targetScroll - scroll));

        // camera orbits the body 360° driven by scroll
        const follow = 1 - Math.pow(1 - 0.025, delta * 60);
        this.orbit.phi += (scroll * Math.PI * 2.0 - this.orbit.phi) * follow;
        this.orbit.y += (0.35 + Math.sin(scroll * Math.PI) * 0.8 - this.orbit.y) * follow;
        this.orbit.radius += (4.2 - Math.sin(scroll * Math.PI) * 0.6 - this.orbit.radius) * follow;
        this.camera.position.set(
            this.orbit.radius * Math.sin(this.orbit.phi),
            this.orbit.y,
            this.orbit.radius * Math.cos(this.orbit.phi)
        );

        // shift the framing on the first screen to clear room for the text columns (wide screens only)
        const transitionProgress = Math.min(1.0, scroll / 0.28);
        const easeFactor = (Math.cos(transitionProgress * Math.PI) + 1.0) * 0.5;
        const wideness = Math.min(1, Math.max(0, (this.camera.aspect - 0.8) / 0.8));
        this.camera.lookAt(this.lookAt.set(-0.9 * easeFactor * wideness, -0.15, 0));

        this.uniforms.uTime.value = elapsed;
        this.uniforms.uMouse.value.set(mouseX, -mouseY);
        this.uniforms.uScroll.value = scroll;

        this.renderer.render(this.scene, this.camera);
    }

    // Name of the structure under a point in normalized device coordinates, on the layer in focus.
    pick(ndcX: number, ndcY: number): PickResult | null {
        const targets = this.layers.filter((l) => l.name !== 'skin' && l.bvhReady && l.opacity > 0.85);
        if (targets.length === 0) return null;
        this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
        const hit = this.raycaster.intersectObjects(targets.map((l) => l.mesh), false)[0];
        if (!hit?.face) return null;
        const layer = targets.find((l) => l.mesh === hit.object)!;
        const partId = (hit.object as THREE.Mesh).geometry.getAttribute('_part').getX(hit.face.a);
        const name = layer.parts[partId];
        return name ? { layer: layer.name, name } : null;
    }

    dispose() {
        this.disposed = true;
        cancelIdle(this.idleHandle);
        this.scene.traverse((object) => {
            const mesh = object as THREE.Mesh;
            mesh.geometry?.dispose();
            const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
            if (Array.isArray(material)) material.forEach((m) => m.dispose());
            else material?.dispose();
        });
        this.renderer.dispose();
    }

    private applyOpacity(layer: Layer, value: number) {
        layer.opacity = value;
        const visible = value > 0.003;
        layer.mesh.visible = visible;
        if (!visible) return;
        const transparent = value < 0.995;
        if (layer.material.transparent !== transparent) {
            layer.material.transparent = transparent;
            layer.material.needsUpdate = true;
        }
        layer.material.opacity = value;
        layer.mesh.castShadow = value > 0.6;
    }

    private createLights() {
        this.scene.add(new THREE.AmbientLight('#ffffff', 0.35));
        this.scene.add(new THREE.HemisphereLight('#cfeeff', '#2a0e10', 0.6));

        // key light: bright white from upper-right, casts shadows
        const keyLight = new THREE.SpotLight('#ffffff', 60.0);
        keyLight.position.set(4, 6, 3);
        keyLight.angle = Math.PI / 4;
        keyLight.penumbra = 0.9;
        keyLight.castShadow = true;
        keyLight.shadow.mapSize.set(2048, 2048);
        keyLight.shadow.camera.near = 1.0;
        keyLight.shadow.camera.far = 15;
        keyLight.shadow.bias = -0.0005;
        keyLight.shadow.normalBias = 0.02;
        this.scene.add(keyLight);

        // rim light: cool cyan from behind-left, defines the silhouette
        const rimLight = new THREE.DirectionalLight('#bfeaff', 2.4);
        rimLight.position.set(-5, 3, -4);
        this.scene.add(rimLight);

        // fill light: soft warm from below-front
        const fillLight = new THREE.DirectionalLight('#fff3e6', 0.9);
        fillLight.position.set(-2, -4, 2);
        this.scene.add(fillLight);

        // front light that rides with the camera so the far side of the orbit is never black
        const cameraLight = new THREE.DirectionalLight('#ffffff', 0.7);
        cameraLight.position.set(0.5, 0.6, 1);
        this.camera.add(cameraLight);
        this.camera.add(cameraLight.target);
    }

    private createSparks() {
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(SPARK_COUNT * 3);
        const colors = new Float32Array(SPARK_COUNT * 3);

        for (let i = 0; i < SPARK_COUNT; i++) {
            positions[i * 3] = (Math.random() - 0.5) * 6.5;
            positions[i * 3 + 1] = (Math.random() - 0.5) * 5.0 - 0.5;
            positions[i * 3 + 2] = (Math.random() - 0.5) * 6.5;

            if (Math.random() < 0.6) {
                // clinical cyan
                colors[i * 3] = 0.35 + Math.random() * 0.15;
                colors[i * 3 + 1] = 0.85 + Math.random() * 0.12;
                colors[i * 3 + 2] = 1.0;
            } else {
                // blood-cell red
                colors[i * 3] = 1.0;
                colors[i * 3 + 1] = 0.25 + Math.random() * 0.15;
                colors[i * 3 + 2] = 0.3 + Math.random() * 0.1;
            }

            this.sparkData.push({
                speedX: (Math.random() - 0.5) * 0.4,
                speedY: 0.15 + Math.random() * 0.3,
                speedZ: (Math.random() - 0.5) * 0.4,
                swaySpeed: 0.5 + Math.random() * 1.5,
                swayRadius: 0.05 + Math.random() * 0.15,
                phase: Math.random() * Math.PI * 2
            });
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        const material = new THREE.PointsMaterial({
            size: 0.025,
            vertexColors: true,
            transparent: true,
            opacity: 0.85,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            map: createSparkTexture()
        });

        this.sparks = new THREE.Points(geometry, material);
        this.scene.add(this.sparks);
    }

    // drift upward, accelerated and turbulent on fast scroll
    private updateSparks(delta: number, time: number, scrollVelocity: number) {
        const positions = this.sparks.geometry.attributes.position.array as Float32Array;
        const speedMultiplier = 1.0 + scrollVelocity * 9.0;
        const turbulence = scrollVelocity * 0.8;

        for (let i = 0; i < SPARK_COUNT; i++) {
            const idx = i * 3;
            const data = this.sparkData[i];
            positions[idx] += data.speedX * delta * speedMultiplier;
            positions[idx + 1] += data.speedY * delta * speedMultiplier;
            positions[idx + 2] += data.speedZ * delta * speedMultiplier;

            const sway = data.swayRadius * (1.0 + turbulence * 4.0);
            positions[idx] += Math.sin(time * data.swaySpeed + data.phase) * sway * delta;
            positions[idx + 2] += Math.cos(time * data.swaySpeed + data.phase) * sway * delta;

            if (positions[idx + 1] > 3.0 || Math.abs(positions[idx]) > 3.5 || Math.abs(positions[idx + 2]) > 3.5) {
                positions[idx + 1] = -2.5;
                positions[idx] = (Math.random() - 0.5) * 3.0;
                positions[idx + 2] = (Math.random() - 0.5) * 3.0;
            }
        }
        this.sparks.geometry.attributes.position.needsUpdate = true;
    }

    private loadModel() {
        const loader = new GLTFLoader();
        loader.setMeshoptDecoder(MeshoptDecoder);
        loader.load(
            this.options.modelUrl,
            (gltf) => {
                if (this.disposed) return;
                const body = gltf.scene;
                this.pivot.add(body);

                const meshes: THREE.Mesh[] = [];
                body.traverse((object) => {
                    if ((object as THREE.Mesh).isMesh) meshes.push(object as THREE.Mesh);
                });
                meshes.forEach((mesh) => {
                    const name = mesh.name as LayerName;
                    (mesh.material as THREE.Material).dispose();
                    mesh.receiveShadow = true;
                    mesh.renderOrder = RENDER_ORDER[name] ?? 0;

                    if (name === 'skin') {
                        // the skin is a frosted shell with a glowing rim; the muscles read through it
                        this.skinMaterial = new THREE.MeshStandardMaterial({
                            color: '#f2c9b0', roughness: 0.35, transparent: true, opacity: 0.3, depthWrite: false
                        });
                        mesh.material = this.skinMaterial;
                        this.skinRim = createRimMaterial('#9fe7ff');
                        const rim = new THREE.Mesh(mesh.geometry, this.skinRim);
                        rim.renderOrder = RENDER_ORDER.skin + 1;
                        mesh.add(rim);
                        return;
                    }

                    const material = new THREE.MeshStandardMaterial({ vertexColors: true, ...MATERIALS[name] });
                    mesh.material = material;
                    mesh.raycast = acceleratedRaycast;
                    this.layers.push({ name, mesh, material, parts: mesh.userData.parts ?? [], opacity: 0, bvhReady: false });
                });

                // 1. scale so the body's largest dimension is BODY_SIZE
                const sizeInitial = new THREE.Box3().setFromObject(body).getSize(new THREE.Vector3());
                const maxDim = Math.max(sizeInitial.x, sizeInitial.y, sizeInitial.z);
                body.scale.setScalar(BODY_SIZE / (maxDim > 0.0001 ? maxDim : 1));

                // 2. recenter on the scaled bounding box, 3. lower the pivot for a grounded stance
                body.updateMatrixWorld(true);
                body.position.sub(new THREE.Box3().setFromObject(body).getCenter(new THREE.Vector3()));
                this.pivot.position.y = -0.4;

                this.revealPending = true;
                this.options.onLoaded?.();
                this.buildPickingTrees();
            },
            (event) => {
                if (event.lengthComputable && event.total > 0) this.options.onProgress?.(event.loaded / event.total);
            },
            (error) => this.options.onError?.(error)
        );
    }

    // BVHs make hover picking cheap; build them one layer at a time when the browser is idle.
    private buildPickingTrees() {
        const queue = ['muscles', 'skeleton', 'organs', 'vessels', 'nerves']
            .map((name) => this.layers.find((l) => l.name === name))
            .filter((l): l is Layer => Boolean(l));
        const next = () => {
            const layer = queue.shift();
            if (!layer || this.disposed) return;
            layer.mesh.geometry.boundsTree = new MeshBVH(layer.mesh.geometry);
            layer.bvhReady = true;
            this.idleHandle = requestIdle(next);
        };
        this.idleHandle = requestIdle(next);
    }

    // full-screen liquid wave plane, a child of the camera so it always fills the view
    private createBackground() {
        const material = new THREE.ShaderMaterial({
            vertexShader: BACKGROUND_VERTEX,
            fragmentShader: BACKGROUND_FRAGMENT,
            uniforms: this.uniforms,
            depthWrite: false,
            depthTest: false
        });
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), material);
        mesh.position.set(0.0, 0.0, -8.0);
        mesh.renderOrder = -10;
        this.camera.add(mesh);
    }
}

function createSparkTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 16;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createRadialGradient(8, 8, 0, 8, 8, 8);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
    gradient.addColorStop(0.25, 'rgba(255, 255, 255, 0.85)');
    gradient.addColorStop(0.6, 'rgba(255, 255, 255, 0.3)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 16, 16);
    return new THREE.CanvasTexture(canvas);
}

function createRimMaterial(color: string) {
    return new THREE.ShaderMaterial({
        uniforms: {
            uColor: { value: new THREE.Color(color) },
            uOpacity: { value: 1 },
            uPower: { value: 2.2 }
        },
        vertexShader: `
            varying vec3 vNormalView;
            varying vec3 vPositionView;
            void main() {
                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                vPositionView = mvPosition.xyz;
                vNormalView = normalize(normalMatrix * normal);
                gl_Position = projectionMatrix * mvPosition;
            }
        `,
        fragmentShader: `
            uniform vec3 uColor;
            uniform float uOpacity;
            uniform float uPower;
            varying vec3 vNormalView;
            varying vec3 vPositionView;
            void main() {
                float facing = abs(dot(normalize(vNormalView), normalize(-vPositionView)));
                float rim = pow(1.0 - facing, uPower);
                gl_FragColor = vec4(uColor * rim, uOpacity);
            }
        `,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });
}

// Safari has no requestIdleCallback
const hasIdleCallback = () => typeof window.requestIdleCallback === 'function';

function requestIdle(callback: () => void): number {
    return hasIdleCallback() ? window.requestIdleCallback(callback, { timeout: 1500 }) : window.setTimeout(callback, 200);
}

function cancelIdle(handle: number) {
    if (hasIdleCallback()) window.cancelIdleCallback(handle);
    else window.clearTimeout(handle);
}

const BACKGROUND_VERTEX = `
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

const BACKGROUND_FRAGMENT = `
    varying vec2 vUv;
    uniform float uTime;
    uniform vec2 uResolution;
    uniform vec2 uMouse;
    uniform float uScroll;

    void main() {
        vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution.xy) / uResolution.y;
        float aspect = uResolution.x / uResolution.y;

        float time = uTime * 0.08; // extremely slow, calm breathing speed
        float scroll = uScroll;

        // constant wave parameters keep the lines stable while scrolling
        float angle1 = 0.6;
        float angle2 = -0.7;
        float angle3 = 1.2;

        float freq1 = 2.4;
        float freq2 = 3.2;
        float freq3 = 4.0;

        // scroll drives the deformation of the rounded arcs
        vec2 warpedUv = uv;
        float scrollDeform = scroll * 5.0;

        warpedUv.x += sin(uv.y * 2.5 + time * 0.2 + scrollDeform) * 0.35;
        warpedUv.y += cos(uv.x * 2.5 - time * 0.15 - scrollDeform * 0.8) * 0.35;

        warpedUv.x += sin(uv.y * 1.2 - time * 0.1 - scrollDeform * 1.5) * 0.25;
        warpedUv.y += cos(uv.x * 1.2 + time * 0.18 + scrollDeform * 1.2) * 0.25;

        vec2 scrollDrift = vec2(scroll * 0.04, -scroll * 0.02);
        vec2 mouseShift = vec2(uMouse.x * aspect * 0.05, uMouse.y * 0.05);
        warpedUv += scrollDrift + mouseShift;

        vec2 dir1 = vec2(cos(angle1), sin(angle1));
        vec2 dir2 = vec2(cos(angle2), sin(angle2));
        vec2 dir3 = vec2(cos(angle3), sin(angle3));

        float w1 = sin(dot(warpedUv, dir1) * freq1 + time * 1.0);
        float w2 = cos(dot(warpedUv, dir2) * freq2 - time * 1.4 + w1 * 0.4);
        float w3 = sin(dot(warpedUv, dir3) * freq3 + time * 1.8 + w2 * 0.5);

        float waveField = w1 * 0.50 + w2 * 0.35 + w3 * 0.15;

        float wideSheen = pow(max(0.0, 1.0 - abs(waveField - 0.1)), 2.5);
        float crispSpecular = pow(max(0.0, 1.0 - abs(waveField - 0.15)), 8.0);
        float crest = wideSheen * 0.5 + crispSpecular * 0.9;

        // top palette (scroll = 0): deep clinical teal
        vec3 c0_shadow = vec3(0.0004, 0.0010, 0.0012);
        vec3 c0_wave1  = vec3(0.010, 0.055, 0.065);
        vec3 c0_wave2  = vec3(0.006, 0.030, 0.038);
        vec3 c0_crest  = vec3(0.12, 0.42, 0.46);

        // bottom palette (scroll = 1): deep indigo
        vec3 c1_shadow = vec3(0.0008, 0.0006, 0.0014);
        vec3 c1_wave1  = vec3(0.035, 0.022, 0.075);
        vec3 c1_wave2  = vec3(0.020, 0.012, 0.048);
        vec3 c1_crest  = vec3(0.32, 0.24, 0.62);

        float t = smoothstep(0.0, 1.0, scroll);
        vec3 colShadow = mix(c0_shadow, c1_shadow, t);
        vec3 colWave1  = mix(c0_wave1, c1_wave1, t);
        vec3 colWave2  = mix(c0_wave2, c1_wave2, t);
        vec3 colCrest  = mix(c0_crest, c1_crest, t);

        vec3 color = colShadow;
        color = mix(color, colWave2, smoothstep(-0.6, 0.2, waveField));
        color = mix(color, colWave1, smoothstep(0.0, 0.8, waveField));
        color += colCrest * crest * 1.4;

        float vignette = 1.0 - dot(uv, uv) * 0.12;
        color *= vignette;

        gl_FragColor = vec4(color, 1.0);
    }
`;
