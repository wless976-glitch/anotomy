// Builds public/models/anatomy.glb: one mesh per anatomical layer, ready for the landing page.
//
// Source: BodyParts3D 4.0, © The Database Center for Life Science, CC BY 4.0
// (https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html), as packed and simplified by
// github.com/ashemag/human-atlas (MIT code; data keeps its CC BY 4.0 license).
//
// Usage: node scripts/build-anatomy.mjs
// Downloads into .anatomy-cache/ on the first run, then works offline.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { Document, NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, '.anatomy-cache');
const OUT = path.join(ROOT, 'public/models/anatomy.glb');
const SOURCE = 'https://raw.githubusercontent.com/ashemag/human-atlas/1c38bf35c254a891200d3cedecfd57abebe83d8d/public/models';

// Layers from outside in. `error` is the absolute simplification error in meters
// (the body is 1.73 m tall), `ratio` the triangle budget kept per structure.
const LAYERS = {
    skin:     { error: 0.002,  ratio: 0.5 },
    muscles:  { error: 0.004,  ratio: 0.16 },
    skeleton: { error: 0.0025, ratio: 0.3 },
    organs:   { error: 0.002,  ratio: 0.35 },
    vessels:  { error: 0.002,  ratio: 0.25 },
    nerves:   { error: 0.002,  ratio: 0.3 }
};

// Which layer a structure belongs to; null leaves it out of the landing-page model.
function layerOf(part) {
    const name = part.name.toLowerCase();
    if (/flexor retinaculum/.test(name)) return 'muscles';
    if (/lacrimal bone/.test(name)) return 'skeleton';
    // the liver is present as its Couinaud segments, filed under the hepatic veins
    if (/hepatovenous segment/.test(name)) return 'organs';
    switch (part.system) {
        case 'integumentary': return name === 'skin' || name === 'lip' ? 'skin' : null;
        case 'reproductive': return null;
        case 'muscular':
            // the deeper intercostal sheets are fully covered by the external ones
            return /internal intercostal|innermost intercostal/.test(name) ? null : 'muscles';
        case 'connective': return 'muscles';
        case 'skeletal': return 'skeleton';
        case 'arterial':
        case 'venous': return 'vessels';
        case 'nervous': return 'nerves';
        case 'cardiac':
            // brain ventricles are filed under "cardiac"; heart cavities sit hidden inside the walls
            if (/cavity|third ventricle|fourth ventricle|lateral ventricle|foramen/.test(name)) return null;
            return 'organs';
        case 'sensory':
            return /sclera|cornea|iris|external ear/.test(name) ? 'organs' : null;
        case 'digestive':
            // sheets that would hide the gut they hold
            return /mesentery|mesocolon|mesoappendix|taenia/.test(name) ? null : 'organs';
        default: return 'organs';
    }
}

// Display colors (sRGB), loosely following anatomy-atlas conventions.
const COLOR_RULES = [
    [/tendon|ligament|aponeuros|membrane|raphe|retinaculum|linea alba|tendinous|trochlea|fascia/, '#e3d2b4'],
    [/tooth|incisor|canine|molar/, '#f4efe3'],
    [/gingiva/, '#d58b8b'],
    [/valve|leaflet|cusp/, '#ecd2a8'],
    [/wall of|atrium/, '#a92f38'],
    [/caudate lobe of liver|hepatovenous/, '#8b3a2f'],
    [/gallbladder|biliary|hepatic duct|cystic duct|bile/, '#5f8a3f'],
    [/stomach|esophagus/, '#d98877'],
    [/duodenum|jejunum|ileum|ileocecal/, '#e7a283'],
    [/colon|rectum|appendix|cecum/, '#c9866a'],
    [/pancrea/, '#e6c27c'],
    [/spleen/, '#7c2f3d'],
    [/thymus/, '#e8c3a6'],
    [/kidney/, '#9c3b36'],
    [/ureter|urethra|bladder/, '#e0b07c'],
    [/adrenal|pituitary|pineal/, '#e2b24c'],
    [/salivary|sublingual|submandibular|lacrimal gland/, '#e8c98f'],
    [/tongue/, '#c86a6a'],
    [/bronch|trachea|epiglottis|cartilage|concha/, '#dcc8b8'],
    [/pharyn|palatopharyngeus|salpingopharyngeus|stylopharyngeus/, '#bd4a4c'],
    [/sclera/, '#f0eee8'],
    [/cornea/, '#cfe0ea'],
    [/iris/, '#4b6d8f'],
    [/external ear/, '#e2aa90'],
    [/white matter|fornix|commissure/, '#f1e2d8'],
    [/gyrus|lobe|cerebellum|pons|midbrain|medulla|thalam|hypothalamus|choroid plexus|insula|cortex|cuneus|precuneus|operculum/, '#e5b2ad'],
    [/spinal cord|central canal/, '#f0d9a6']
];
const LAYER_COLORS = {
    skin: '#d9a88c',
    muscles: '#a3313a',
    skeleton: '#e8dcc2',
    organs: '#d98a80',
    nerves: '#f2cf52'
};

function colorOf(part, layer) {
    const name = part.name.toLowerCase();
    if (layer === 'vessels') return part.system === 'arterial' ? '#d42a33' : '#2f5ec4';
    for (const [pattern, color] of COLOR_RULES) {
        if (layer !== 'skin' && pattern.test(name)) return color;
    }
    return LAYER_COLORS[layer];
}

// Stable per-structure shade variation, so neighboring muscles and bones read as separate pieces.
function hash(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
    return ((h >>> 0) % 10000) / 10000;
}

function srgbToLinear(c) {
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function shade(hex, part, layer) {
    const spread = layer === 'muscles' ? 0.34 : layer === 'skeleton' ? 0.08 : 0.1;
    const k = 1 + (hash(part.id) - 0.5) * spread;
    return [1, 3, 5].map((i) => {
        const c = Math.min(1, (parseInt(hex.slice(i, i + 2), 16) / 255) * k);
        return Math.round(srgbToLinear(c) * 255);
    });
}

async function cached(file) {
    const local = path.join(CACHE, file);
    if (!fs.existsSync(local)) {
        fs.mkdirSync(CACHE, { recursive: true });
        console.log(`downloading ${file}`);
        const response = await fetch(`${SOURCE}/${file}`);
        if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
        fs.writeFileSync(local, Buffer.from(await response.arrayBuffer()));
    }
    return fs.readFileSync(local);
}

async function main() {
    await MeshoptSimplifier.ready;
    await MeshoptEncoder.ready;

    const manifest = JSON.parse((await cached('atlas.json')).toString('utf8'));
    const chunks = [];
    for (const chunk of manifest.chunks) {
        chunks.push(zlib.gunzipSync(await cached(path.basename(chunk.gzip))));
    }

    const layers = Object.fromEntries(Object.keys(LAYERS).map((key) => [key, {
        positions: [], normals: [], colors: [], partIds: [], indices: [], parts: [], vertexCount: 0, sourceTriangles: 0
    }]));

    for (const part of manifest.parts) {
        const layerName = layerOf(part);
        if (!layerName) continue;
        const [min, max] = part.bounds;
        if (Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) < 0.003) continue;

        const config = LAYERS[layerName];
        const layer = layers[layerName];
        const chunk = chunks[part.chunk];
        const positions = new Float32Array(chunk.buffer, chunk.byteOffset + part.positions, part.vertexCount * 3);
        const normals = new Int16Array(chunk.buffer, chunk.byteOffset + part.normals, part.vertexCount * 3);
        const sourceIndices = new Uint32Array(chunk.buffer, chunk.byteOffset + part.indices, part.indexCount);

        const target = Math.max(36, Math.floor((part.indexCount * config.ratio) / 3) * 3);
        let [indices] = MeshoptSimplifier.simplify(sourceIndices, positions, 3, Math.min(part.indexCount, target), config.error, ['ErrorAbsolute']);
        if (indices.length > target * 1.6) {
            // thin strips (intercostals, small vessels) stall the topology-preserving pass
            const scale = MeshoptSimplifier.getScale(positions, 3);
            [indices] = MeshoptSimplifier.simplifySloppy(sourceIndices, positions, 3, null, target, config.error / scale);
        }
        if (indices.length === 0) continue;
        const [remap, count] = MeshoptSimplifier.compactMesh(indices);

        const color = shade(colorOf(part, layerName), part, layerName);
        const outPositions = new Float32Array(count * 3);
        const outNormals = new Float32Array(count * 3);
        for (let old = 0; old < remap.length; old++) {
            const v = remap[old];
            if (v === 0xffffffff) continue;
            for (let a = 0; a < 3; a++) {
                outPositions[v * 3 + a] = positions[old * 3 + a];
                outNormals[v * 3 + a] = normals[old * 3 + a] / 32767;
            }
        }

        const partId = layer.parts.length;
        layer.parts.push(part.name);
        for (const i of indices) layer.indices.push(i + layer.vertexCount);
        layer.positions.push(outPositions);
        layer.normals.push(outNormals);
        for (let v = 0; v < count; v++) {
            layer.colors.push(color[0], color[1], color[2]);
            layer.partIds.push(partId);
        }
        layer.vertexCount += count;
        layer.sourceTriangles += part.indexCount / 3;
    }

    const doc = new Document();
    const buffer = doc.createBuffer();
    const scene = doc.createScene('anatomy');
    const concat = (arrays, length) => {
        const out = new Float32Array(length);
        let offset = 0;
        for (const a of arrays) { out.set(a, offset); offset += a.length; }
        return out;
    };

    for (const [name, layer] of Object.entries(layers)) {
        const vertexFloats = layer.vertexCount * 3;
        const primitive = doc.createPrimitive()
            .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setBuffer(buffer).setArray(concat(layer.positions, vertexFloats)))
            .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setBuffer(buffer).setArray(concat(layer.normals, vertexFloats)))
            .setAttribute('COLOR_0', doc.createAccessor().setType('VEC3').setBuffer(buffer).setNormalized(true).setArray(Uint8Array.from(layer.colors)))
            // per-vertex index into the node's `parts` names (survives meshopt's triangle reordering)
            .setAttribute('_PART', doc.createAccessor().setType('SCALAR').setBuffer(buffer).setArray(Uint16Array.from(layer.partIds)))
            .setIndices(doc.createAccessor().setType('SCALAR').setBuffer(buffer).setArray(Uint32Array.from(layer.indices)))
            .setMaterial(doc.createMaterial(name).setRoughnessFactor(0.6).setMetallicFactor(0));
        const mesh = doc.createMesh(name).addPrimitive(primitive);
        // structure names for hover labels, indexed by the _PART attribute
        scene.addChild(doc.createNode(name).setMesh(mesh).setExtras({ parts: layer.parts }));
        console.log(`${name.padEnd(9)} ${String(layer.parts.length).padStart(5)} structures  ${String(Math.round(layer.sourceTriangles)).padStart(7)} → ${String(layer.indices.length / 3).padStart(7)} triangles`);
    }

    doc.getRoot().getAsset().copyright = 'BodyParts3D, © The Database Center for Life Science, CC BY 4.0';
    await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));

    const io = new NodeIO()
        .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
        .registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    await io.write(OUT, doc);
    console.log(`wrote ${path.relative(ROOT, OUT)} (${(fs.statSync(OUT).size / 1e6).toFixed(2)} MB)`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
