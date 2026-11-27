// three.js scene of the simulated piece: instanced stitch posts (anchor → top), course yarn
// segments through the tops (chain-space loops as thin arcs of chain segments), stitch-top beads.
// Lazy-loaded by SimView so three.js stays in its own chunk.
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { OrbitControls as OrbitControlsImpl } from 'three/examples/jsm/controls/OrbitControls.js';
import { boundsOf, nodeColor, segmentColor, type ColorInputs, type Segments, type Topology } from './topology';

export interface Scene3DProps {
  topology: Topology;
  positions: Float32Array | null;
  /** Row-major rotation applied to all positions (axis → +Y). */
  rotation: number[];
  colors: ColorInputs;
  highlightNode?: number;
  /** Change to re-fit the camera (reset view, new piece, solve finished). */
  fitKey: string;
  /** Re-fit automatically while the piece grows until the user moves the camera. */
  autoFit: boolean;
  /** Camera elevation above the piece's plane, degrees. */
  elevation?: number;
  onContextLost?: () => void;
}

const UP = new THREE.Vector3(0, 1, 0);

function writeSegments(mesh: THREE.InstancedMesh, s: Segments, pos: Float32Array, R: number[]) {
  const arr = mesh.instanceMatrix.array as Float32Array;
  const tr = (p: number, out: number[]) => {
    const x = pos[3 * p], y = pos[3 * p + 1], z = pos[3 * p + 2];
    out[0] = R[0] * x + R[1] * y + R[2] * z; out[1] = R[3] * x + R[4] * y + R[5] * z; out[2] = R[6] * x + R[7] * y + R[8] * z;
  };
  const A = [0, 0, 0], B = [0, 0, 0];
  for (let k = 0; k < s.count; k++) {
    const o = 16 * k;
    tr(s.a[k], A); tr(s.b[k], B);
    const dx = B[0] - A[0], dy = B[1] - A[1], dz = B[2] - A[2];
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (!Number.isFinite(len) || len < 1e-9) { arr.fill(0, o, o + 16); continue; }
    const r = s.radius[k];
    // columns: X = e1 * r, Y = d * len, Z = e2 * r, T = midpoint (cylinder spans y ∈ [-0.5, 0.5])
    const ux = dx / len, uy = dy / len, uz = dz / len;
    // e1 ⟂ d
    let ex: number, ey: number, ez: number;
    if (Math.abs(uy) < 0.9) { ex = uz; ey = 0; ez = -ux; } else { ex = 0; ey = -uz; ez = uy; }
    const en = Math.hypot(ex, ey, ez); ex /= en; ey /= en; ez /= en;
    const fx = ey * uz - ez * uy, fy = ez * ux - ex * uz, fz = ex * uy - ey * ux;   // e × d: right-handed
    arr[o] = ex * r; arr[o + 1] = ey * r; arr[o + 2] = ez * r; arr[o + 3] = 0;
    arr[o + 4] = dx; arr[o + 5] = dy; arr[o + 6] = dz; arr[o + 7] = 0;
    arr[o + 8] = fx * r; arr[o + 9] = fy * r; arr[o + 10] = fz * r; arr[o + 11] = 0;
    arr[o + 12] = (A[0] + B[0]) / 2; arr[o + 13] = (A[1] + B[1]) / 2; arr[o + 14] = (A[2] + B[2]) / 2; arr[o + 15] = 1;
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
}

function writeNodes(mesh: THREE.InstancedMesh, t: Topology, pos: Float32Array, R: number[]) {
  const arr = mesh.instanceMatrix.array as Float32Array;
  for (let i = 0; i < t.nNodes; i++) {
    const o = 16 * i;
    const x = pos[3 * i], y = pos[3 * i + 1], z = pos[3 * i + 2];
    if (!Number.isFinite(x)) { arr.fill(0, o, o + 16); continue; }
    const r = t.nodeRadius[i];
    arr.fill(0, o, o + 16);
    arr[o] = r; arr[o + 5] = r; arr[o + 10] = r; arr[o + 15] = 1;
    arr[o + 12] = R[0] * x + R[1] * y + R[2] * z; arr[o + 13] = R[3] * x + R[4] * y + R[5] * z; arr[o + 14] = R[6] * x + R[7] * y + R[8] * z;
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
}

function colorSegments(mesh: THREE.InstancedMesh, s: Segments, nRounds: number, c: ColorInputs, yarn: boolean) {
  const col = new THREE.Color();
  for (let k = 0; k < s.count; k++) {
    const rgb = segmentColor(s, k, nRounds, c, yarn);
    mesh.setColorAt(k, col.setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace));
  }
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

function Piece({ topology: t, positions, rotation, colors, highlightNode }: Omit<Scene3DProps, 'fitKey' | 'autoFit'>) {
  const stitchRef = useRef<THREE.InstancedMesh>(null);
  const yarnRef = useRef<THREE.InstancedMesh>(null);
  const nodeRef = useRef<THREE.InstancedMesh>(null);
  const hlRef = useRef<THREE.Mesh>(null);
  const invalidate = useThree((s) => s.invalidate);
  const geo = useMemo(() => ({
    cyl: new THREE.CylinderGeometry(1, 1, 1, 7, 1, true),
    sphere: new THREE.IcosahedronGeometry(1, 1),
    hl: new THREE.SphereGeometry(1, 20, 14),
  }), []);
  useEffect(() => () => { geo.cyl.dispose(); geo.sphere.dispose(); geo.hl.dispose(); }, [geo]);
  const mat = useMemo(() => ({
    stitch: new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 }),
    yarn: new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0 }),
    node: new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0 }),
  }), []);
  useEffect(() => () => { mat.stitch.dispose(); mat.yarn.dispose(); mat.node.dispose(); }, [mat]);

  useLayoutEffect(() => {
    if (!positions) return;
    if (stitchRef.current) writeSegments(stitchRef.current, t.stitches, positions, rotation);
    if (yarnRef.current) writeSegments(yarnRef.current, t.yarn, positions, rotation);
    if (nodeRef.current) writeNodes(nodeRef.current, t, positions, rotation);
    if (hlRef.current) {
      const i = highlightNode ?? -1;
      const ok = i >= 0 && i < t.nNodes && Number.isFinite(positions[3 * i]);
      hlRef.current.visible = ok;
      if (ok) {
        const R = rotation, x = positions[3 * i], y = positions[3 * i + 1], z = positions[3 * i + 2];
        hlRef.current.position.set(R[0] * x + R[1] * y + R[2] * z, R[3] * x + R[4] * y + R[5] * z, R[6] * x + R[7] * y + R[8] * z);
        hlRef.current.scale.setScalar(t.wbar * 0.55);
      }
    }
    invalidate();
  }, [positions, rotation, t, highlightNode, invalidate]);

  useLayoutEffect(() => {
    if (stitchRef.current) colorSegments(stitchRef.current, t.stitches, t.nRounds, colors, false);
    if (yarnRef.current) colorSegments(yarnRef.current, t.yarn, t.nRounds, colors, true);
    if (nodeRef.current) {
      const col = new THREE.Color();
      for (let i = 0; i < t.nNodes; i++) {
        const rgb = nodeColor(t, i, colors);
        nodeRef.current.setColorAt(i, col.setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace));
      }
      if (nodeRef.current.instanceColor) nodeRef.current.instanceColor.needsUpdate = true;
    }
    invalidate();
  }, [colors, t, invalidate]);

  const hl = colors.palette.highlight;
  return (
    <group>
      <instancedMesh key={`s${t.stitches.count}`} ref={stitchRef} args={[geo.cyl, mat.stitch, Math.max(1, t.stitches.count)]} frustumCulled={false} />
      <instancedMesh key={`y${t.yarn.count}`} ref={yarnRef} args={[geo.cyl, mat.yarn, Math.max(1, t.yarn.count)]} frustumCulled={false} />
      <instancedMesh key={`n${t.nNodes}`} ref={nodeRef} args={[geo.sphere, mat.node, Math.max(1, t.nNodes)]} frustumCulled={false} />
      <mesh ref={hlRef} geometry={geo.hl} visible={false}>
        <meshStandardMaterial color={new THREE.Color().setRGB(hl[0], hl[1], hl[2], THREE.SRGBColorSpace)} transparent opacity={0.55} emissive={new THREE.Color().setRGB(hl[0], hl[1], hl[2], THREE.SRGBColorSpace)} emissiveIntensity={0.4} depthWrite={false} />
      </mesh>
    </group>
  );
}

function CameraRig({ topology, positions, rotation, fitKey, autoFit, elevation = 35 }: Pick<Scene3DProps, 'topology' | 'positions' | 'rotation' | 'fitKey' | 'autoFit' | 'elevation'>) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const controls = useThree((s) => s.controls) as unknown as OrbitControlsImpl | null;
  const invalidate = useThree((s) => s.invalidate);
  const touched = useRef(false);
  const lastFit = useRef<{ key: string; r: number } | null>(null);

  useEffect(() => {
    if (!controls) return;
    const onStart = () => { touched.current = true; };
    controls.addEventListener('start', onStart);
    return () => controls.removeEventListener('start', onStart);
  }, [controls]);

  useEffect(() => {
    if (!positions) return;
    const b = boundsOf(positions, topology.nParticles, rotation);
    if (!b) return;
    const prev = lastFit.current;
    const keyChanged = !prev || prev.key !== fitKey;
    if (keyChanged) touched.current = false;
    const grew = prev && (b.r > prev.r * 1.12 || b.r < prev.r * 0.7);
    if (!keyChanged && !(autoFit && grew && !touched.current)) return;
    lastFit.current = { key: fitKey, r: b.r };
    const fov = (camera.fov * Math.PI) / 180;
    const aspect = Math.max(0.3, Math.min(1, camera.aspect || 1));
    const dist = (b.r / Math.sin(fov / 2)) / aspect * 0.95 + b.r * 0.2;
    const elev = (elevation * Math.PI) / 180;
    const target = new THREE.Vector3(...b.c);
    camera.position.set(b.c[0], b.c[1] + dist * Math.sin(elev), b.c[2] + dist * Math.cos(elev));
    camera.up.copy(UP);
    camera.near = Math.max(0.01, dist / 200);
    camera.far = dist * 20;
    camera.updateProjectionMatrix();
    if (controls) { controls.target.copy(target); controls.update(); } else camera.lookAt(target);
    invalidate();
  }, [positions, rotation, fitKey, autoFit, elevation, topology, camera, controls, invalidate]);
  return null;
}

/** Orbit controls (rotate / pinch-zoom / two-finger pan on touch), registered as the default controls. */
function Controls({ damping }: { damping: boolean }) {
  const camera = useThree((s) => s.camera);
  const dom = useThree((s) => s.gl.domElement);
  const set = useThree((s) => s.set);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    const c = new OrbitControlsImpl(camera, dom);
    c.enableDamping = damping;
    c.dampingFactor = 0.12;
    c.rotateSpeed = 0.8;
    c.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    const onChange = () => invalidate();
    c.addEventListener('change', onChange);
    set({ controls: c as unknown as THREE.EventDispatcher });
    return () => { c.removeEventListener('change', onChange); c.dispose(); set({ controls: null }); };
  }, [camera, dom, damping, set, invalidate]);
  const controls = useThree((s) => s.controls) as unknown as OrbitControlsImpl | null;
  useFrame(() => { if (controls?.enableDamping) controls.update(); });
  return null;
}

export default function Scene3D(props: Scene3DProps) {
  const { palette } = props.colors;
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  return (
    <Canvas
      className="sim-canvas"
      frameloop="demand"
      dpr={[1, 2]}
      camera={{ fov: 40, position: [0, 60, 80], near: 0.1, far: 5000 }}
      gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: 'default' }}
      onCreated={({ gl }) => {
        gl.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); props.onContextLost?.(); });
      }}
      style={{ touchAction: 'none' }}
    >
      <hemisphereLight args={[palette.dark ? 0xc8ccd8 : 0xffffff, palette.dark ? 0x3a3128 : 0xb8a58a, palette.dark ? 1.5 : 1.7]} />
      <directionalLight position={[40, 80, 60]} intensity={palette.dark ? 1.4 : 1.6} />
      <directionalLight position={[-60, -20, -40]} intensity={0.35} />
      <Piece topology={props.topology} positions={props.positions} rotation={props.rotation} colors={props.colors} highlightNode={props.highlightNode} />
      <CameraRig topology={props.topology} positions={props.positions} rotation={props.rotation} fitKey={props.fitKey} autoFit={props.autoFit} elevation={props.elevation} />
      <Controls damping={!reduced} />
    </Canvas>
  );
}
