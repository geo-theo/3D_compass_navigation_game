import "./styles.css";
import { createIcons, Eye, EyeOff, Flag, LocateFixed, RotateCcw } from "lucide";
import * as THREE from "three";

type Point2 = {
  x: number;
  z: number;
};

type ContourSegment = {
  a: Point2;
  b: Point2;
  level: number;
};

type ScoreState = {
  currentDrift: number;
  rmsDrift: number;
  score: number;
  range: number;
  elevation: number;
};

const worldCanvas = mustCanvas("#world");
const mapCanvas = mustCanvas("#mapCanvas");
const profileCanvas = mustCanvas("#profileCanvas");
const compassCanvas = mustCanvas("#compassCanvas");

const mapContext = get2dContext(mapCanvas);
const profileContext = get2dContext(profileCanvas);
const compassContext = get2dContext(compassCanvas);

const headingReadout = mustElement("#headingReadout");
const bearingReadout = mustElement("#bearingReadout");
const driftReadout = mustElement("#driftReadout");
const scoreReadout = mustElement("#scoreReadout");
const rangeReadout = mustElement("#rangeReadout");
const elevationReadout = mustElement("#elevationReadout");
const paceReadout = mustElement("#paceReadout");
const challengeState = mustElement("#challengeState");
const bearingInput = document.querySelector<HTMLInputElement>("#bearingInput");
const plotBearingButton = document.querySelector<HTMLButtonElement>("#plotBearingButton");
const startButton = document.querySelector<HTMLButtonElement>("#startButton");
const resetButton = document.querySelector<HTMLButtonElement>("#resetButton");
const lineButton = document.querySelector<HTMLButtonElement>("#lineButton");
const toast = mustElement("#toast");

if (!bearingInput || !plotBearingButton || !startButton || !resetButton || !lineButton) {
  throw new Error("Missing navigation controls.");
}

const WORLD_SIZE = 220;
const HALF_WORLD = WORLD_SIZE / 2;
const TERRAIN_SEGMENTS = 168;
const CONTOUR_INTERVAL = 5;
const MAJOR_CONTOUR_INTERVAL = 25;
const START: Point2 = { x: -78, z: -72 };
const CONTROL: Point2 = { x: 72, z: 70 };
const MAP_BEARING = Math.round(bearingBetween(START, CONTROL));
const PLAYER_EYE_HEIGHT = 2.1;
const FINISH_RADIUS = 6.5;

let plannedBearing = MAP_BEARING;
let challengeActive = false;
let challengeFinished = false;
let showBearingLine = true;
let lastToastTimeout = 0;

const player = {
  x: START.x,
  z: START.z,
  heading: toRadians(MAP_BEARING),
  speed: 0,
};

const keys = new Set<string>();
const track: Point2[] = [{ ...START }];
const driftSamples: number[] = [];

const renderer = new THREE.WebGLRenderer({
  canvas: worldCanvas,
  antialias: true,
  powerPreference: "high-performance",
  preserveDrawingBuffer: true,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setClearColor(0x9ec7d7, 1);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9ec7d7);
scene.fog = new THREE.Fog(0x9ec7d7, 130, 355);

const camera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.1, 650);

const ambient = new THREE.HemisphereLight(0xdcefff, 0x4e4634, 2.5);
scene.add(ambient);

const sun = new THREE.DirectionalLight(0xfff0c4, 3.2);
sun.position.set(-65, 130, 42);
sun.castShadow = true;
sun.shadow.camera.left = -130;
sun.shadow.camera.right = 130;
sun.shadow.camera.top = 130;
sun.shadow.camera.bottom = -130;
sun.shadow.mapSize.set(2048, 2048);
scene.add(sun);

const terrain = createTerrain();
scene.add(terrain);

const contours = generateContours(CONTOUR_INTERVAL, 1.7);
const contourLines = createContourLineObjects(contours);
scene.add(contourLines.minor, contourLines.major);

const bearingLine = createBearingLine();
scene.add(bearingLine);

const landmarks = createLandmarks();
scene.add(landmarks);

const vegetation = createVegetation();
scene.add(vegetation);

const rocks = createRocks();
scene.add(rocks);

const mapBase = document.createElement("canvas");
mapBase.width = mapCanvas.width;
mapBase.height = mapCanvas.height;
drawMapBase(get2dContext(mapBase), contours);
drawElevationProfile(profileContext);

bearingInput.value = String(plannedBearing);
createIcons({
  icons: {
    Eye,
    EyeOff,
    Flag,
    LocateFixed,
    RotateCcw,
  },
});

let previousTime = performance.now();
let pointerDragging = false;
let lastPointerX = 0;

resetToStart(false);
showToast(`Map bearing ${formatBearing(MAP_BEARING)}`);

window.addEventListener("resize", onResize);
window.addEventListener("keydown", (event) => {
  keys.add(event.key.toLowerCase());
});
window.addEventListener("keyup", (event) => {
  keys.delete(event.key.toLowerCase());
});

worldCanvas.addEventListener("pointerdown", (event) => {
  pointerDragging = true;
  lastPointerX = event.clientX;
  worldCanvas.setPointerCapture(event.pointerId);
});

worldCanvas.addEventListener("pointermove", (event) => {
  if (!pointerDragging) {
    return;
  }
  const dx = event.clientX - lastPointerX;
  lastPointerX = event.clientX;
  player.heading = normalizeRadians(player.heading - dx * 0.006);
});

worldCanvas.addEventListener("pointerup", (event) => {
  pointerDragging = false;
  worldCanvas.releasePointerCapture(event.pointerId);
});

bearingInput.addEventListener("change", () => {
  plannedBearing = normalizeDegrees(Number(bearingInput.value) || 0);
  bearingInput.value = String(Math.round(plannedBearing));
  updateBearingLine();
});

plotBearingButton.addEventListener("click", () => {
  plannedBearing = MAP_BEARING;
  bearingInput.value = String(plannedBearing);
  updateBearingLine();
  showToast(`Plotted ${formatBearing(plannedBearing)}`);
});

startButton.addEventListener("click", () => {
  resetToStart(true);
  showToast("Challenge started");
});

resetButton.addEventListener("click", () => {
  resetToStart(false);
  showToast("Reset to start");
});

lineButton.addEventListener("click", () => {
  showBearingLine = !showBearingLine;
  lineButton.setAttribute("aria-pressed", String(showBearingLine));
  lineButton.innerHTML = showBearingLine
    ? '<i data-lucide="eye"></i><span>Line</span>'
    : '<i data-lucide="eye-off"></i><span>Line</span>';
  createIcons({ icons: { Eye, EyeOff } });
  updateBearingLine();
});

requestAnimationFrame(tick);

function tick(time: number) {
  const dt = Math.min((time - previousTime) / 1000, 0.05);
  previousTime = time;

  updatePlayer(dt);
  updateCamera();
  updateBearingLine();

  const score = updateScore();
  drawDynamicMap(score);
  drawCompass();
  updateReadouts(score);

  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

function updatePlayer(dt: number) {
  const turnSpeed = 1.8;
  if (keys.has("arrowleft") || keys.has("q")) {
    player.heading = normalizeRadians(player.heading + turnSpeed * dt);
  }
  if (keys.has("arrowright") || keys.has("e")) {
    player.heading = normalizeRadians(player.heading - turnSpeed * dt);
  }

  const forwardIntent = (keys.has("w") || keys.has("arrowup") ? 1 : 0) - (keys.has("s") || keys.has("arrowdown") ? 1 : 0);
  const strafeIntent = (keys.has("d") ? 1 : 0) - (keys.has("a") ? 1 : 0);
  const sprint = keys.has("shift");
  const baseSpeed = sprint ? 16.5 : 9.2;
  const dir = bearingVector(radiansToBearing(player.heading));
  const right = { x: dir.z, z: -dir.x };

  let moveX = dir.x * forwardIntent + right.x * strafeIntent;
  let moveZ = dir.z * forwardIntent + right.z * strafeIntent;
  const length = Math.hypot(moveX, moveZ);
  if (length > 0) {
    moveX /= length;
    moveZ /= length;
  }

  const nextX = clamp(player.x + moveX * baseSpeed * dt, -HALF_WORLD + 2, HALF_WORLD - 2);
  const nextZ = clamp(player.z + moveZ * baseSpeed * dt, -HALF_WORLD + 2, HALF_WORLD - 2);
  player.speed = Math.hypot(nextX - player.x, nextZ - player.z) / Math.max(dt, 0.001);
  player.x = nextX;
  player.z = nextZ;

  const lastPoint = track[track.length - 1];
  if (Math.hypot(player.x - lastPoint.x, player.z - lastPoint.z) >= 1.3) {
    track.push({ x: player.x, z: player.z });
    if (challengeActive) {
      driftSamples.push(crossTrackDistance({ x: player.x, z: player.z }, START, plannedBearing));
    }
  }
}

function updateCamera() {
  const elevation = terrainHeight(player.x, player.z);
  const eye = new THREE.Vector3(player.x, elevation + PLAYER_EYE_HEIGHT, player.z);
  const look = bearingVector(radiansToBearing(player.heading));
  camera.position.copy(eye);
  camera.lookAt(eye.x + look.x * 10, eye.y - 0.35, eye.z + look.z * 10);
}

function updateScore(): ScoreState {
  const currentDrift = crossTrackDistance({ x: player.x, z: player.z }, START, plannedBearing);
  const range = Math.hypot(player.x - CONTROL.x, player.z - CONTROL.z);
  const elevation = terrainHeight(player.x, player.z);
  const rmsDrift = driftSamples.length
    ? Math.sqrt(driftSamples.reduce((sum, sample) => sum + sample * sample, 0) / driftSamples.length)
    : currentDrift;
  const score = Math.max(0, Math.round(100 - rmsDrift * 6.5 - Math.max(0, currentDrift - 2) * 1.5));

  if (challengeActive && range <= FINISH_RADIUS) {
    challengeActive = false;
    challengeFinished = true;
    showToast(`Finished: ${score}`);
  }

  return { currentDrift, rmsDrift, score, range, elevation };
}

function updateReadouts(score: ScoreState) {
  headingReadout.textContent = formatBearing(radiansToBearing(player.heading));
  bearingReadout.textContent = formatBearing(plannedBearing);
  driftReadout.textContent = `${score.currentDrift.toFixed(1)} m`;
  scoreReadout.textContent = String(score.score);
  rangeReadout.textContent = `${Math.round(score.range)} m to control`;
  elevationReadout.textContent = `${Math.round(score.elevation)} m elev`;
  paceReadout.textContent = player.speed > 12 ? "Run" : player.speed > 0.8 ? "Walk" : "Still";
  challengeState.textContent = challengeFinished ? "Complete" : challengeActive ? "Scoring" : "Ready";
}

function resetToStart(scoring: boolean) {
  player.x = START.x;
  player.z = START.z;
  player.heading = toRadians(plannedBearing);
  player.speed = 0;
  track.splice(0, track.length, { ...START });
  driftSamples.splice(0, driftSamples.length);
  challengeActive = scoring;
  challengeFinished = false;
  updateCamera();
  updateBearingLine();
}

function createTerrain() {
  const vertices: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const color = new THREE.Color();

  for (let zIndex = 0; zIndex <= TERRAIN_SEGMENTS; zIndex += 1) {
    const z = -HALF_WORLD + (zIndex / TERRAIN_SEGMENTS) * WORLD_SIZE;
    for (let xIndex = 0; xIndex <= TERRAIN_SEGMENTS; xIndex += 1) {
      const x = -HALF_WORLD + (xIndex / TERRAIN_SEGMENTS) * WORLD_SIZE;
      const y = terrainHeight(x, z);
      vertices.push(x, y, z);

      const slope = localSlope(x, z);
      const t = clamp(y / 75, 0, 1);
      if (y > 61) {
        color.setRGB(0.9, 0.88, 0.8);
      } else if (t > 0.7) {
        color.setRGB(0.57, 0.58, 0.42);
      } else if (slope > 0.38) {
        color.setRGB(0.48, 0.45, 0.32);
      } else if (t < 0.18) {
        color.setRGB(0.37, 0.58, 0.33);
      } else {
        color.setRGB(0.43 + t * 0.16, 0.61 - t * 0.1, 0.35 - t * 0.02);
      }
      colors.push(color.r, color.g, color.b);
    }
  }

  const row = TERRAIN_SEGMENTS + 1;
  for (let zIndex = 0; zIndex < TERRAIN_SEGMENTS; zIndex += 1) {
    for (let xIndex = 0; xIndex < TERRAIN_SEGMENTS; xIndex += 1) {
      const a = zIndex * row + xIndex;
      const b = a + 1;
      const c = a + row;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.86,
    metalness: 0,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  return mesh;
}

function createContourLineObjects(segments: ContourSegment[]) {
  const minorPositions: number[] = [];
  const majorPositions: number[] = [];

  for (const segment of segments) {
    const positions = segment.level % MAJOR_CONTOUR_INTERVAL === 0 ? majorPositions : minorPositions;
    pushContourSegment(positions, segment);
  }

  const minor = new THREE.LineSegments(
    new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(minorPositions, 3)),
    new THREE.LineBasicMaterial({ color: 0x715638, transparent: true, opacity: 0.78 }),
  );
  const major = new THREE.LineSegments(
    new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(majorPositions, 3)),
    new THREE.LineBasicMaterial({ color: 0x3f2e1f, transparent: true, opacity: 0.92 }),
  );
  return { minor, major };
}

function pushContourSegment(positions: number[], segment: ContourSegment) {
  positions.push(segment.a.x, terrainHeight(segment.a.x, segment.a.z) + 0.16, segment.a.z);
  positions.push(segment.b.x, terrainHeight(segment.b.x, segment.b.z) + 0.16, segment.b.z);
}

function createBearingLine() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
  const material = new THREE.LineBasicMaterial({
    color: 0xff9d36,
    transparent: true,
    opacity: 0.95,
  });
  return new THREE.Line(geometry, material);
}

function updateBearingLine() {
  bearingLine.visible = showBearingLine;
  const end = projectBearingToEdge(START, plannedBearing);
  const position = bearingLine.geometry.getAttribute("position");
  position.setXYZ(0, START.x, terrainHeight(START.x, START.z) + 0.55, START.z);
  position.setXYZ(1, end.x, terrainHeight(end.x, end.z) + 0.55, end.z);
  position.needsUpdate = true;
}

function createLandmarks() {
  const group = new THREE.Group();
  group.add(createFlagMarker(START, 0x4fb4ca, 0xffffff));
  group.add(createFlagMarker(CONTROL, 0xf28c38, 0xffffff));
  return group;
}

function createFlagMarker(point: Point2, colorA: number, colorB: number) {
  const group = new THREE.Group();
  const y = terrainHeight(point.x, point.z);
  group.position.set(point.x, y, point.z);

  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.16, 4.8, 10),
    new THREE.MeshStandardMaterial({ color: 0x37322a, roughness: 0.6 }),
  );
  pole.position.y = 2.4;
  pole.castShadow = true;
  group.add(pole);

  const flagGeometry = new THREE.BufferGeometry();
  flagGeometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([0, 4.5, 0, 0, 3.25, 0, 2.2, 3.9, 0], 3),
  );
  flagGeometry.setAttribute("color", new THREE.Float32BufferAttribute(hexToRgbList([colorA, colorB, colorA]), 3));
  flagGeometry.computeVertexNormals();
  const flag = new THREE.Mesh(
    flagGeometry,
    new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }),
  );
  flag.castShadow = true;
  group.add(flag);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(FINISH_RADIUS, 0.06, 8, 72),
    new THREE.MeshBasicMaterial({ color: colorA, transparent: true, opacity: 0.85 }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.18;
  group.add(ring);

  return group;
}

function createVegetation() {
  const group = new THREE.Group();
  const rng = mulberry32(42);
  const trunkGeometry = new THREE.CylinderGeometry(0.16, 0.25, 2.7, 7);
  const crownGeometry = new THREE.ConeGeometry(1.25, 4, 8);
  const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x5b3f27, roughness: 0.9 });
  const crownMaterial = new THREE.MeshStandardMaterial({ color: 0x2f6543, roughness: 0.92 });
  const treeCount = 210;
  const trunks = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, treeCount);
  const crowns = new THREE.InstancedMesh(crownGeometry, crownMaterial, treeCount);
  const matrix = new THREE.Matrix4();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const position = new THREE.Vector3();
  let placed = 0;

  for (let i = 0; i < 600 && placed < treeCount; i += 1) {
    const x = rng() * WORLD_SIZE - HALF_WORLD;
    const z = rng() * WORLD_SIZE - HALF_WORLD;
    const elevation = terrainHeight(x, z);
    const slope = localSlope(x, z);
    const nearStartOrControl =
      Math.hypot(x - START.x, z - START.z) < 11 || Math.hypot(x - CONTROL.x, z - CONTROL.z) < 11;
    if (elevation > 56 || slope > 0.72 || nearStartOrControl) {
      continue;
    }

    const treeScale = 0.62 + rng() * 0.72;
    rotation.setFromEuler(new THREE.Euler(0, rng() * Math.PI * 2, 0));

    position.set(x, elevation + 1.35 * treeScale, z);
    scale.set(treeScale, treeScale, treeScale);
    matrix.compose(position, rotation, scale);
    trunks.setMatrixAt(placed, matrix);

    position.set(x, elevation + 3.55 * treeScale, z);
    matrix.compose(position, rotation, scale);
    crowns.setMatrixAt(placed, matrix);
    placed += 1;
  }

  trunks.count = placed;
  crowns.count = placed;
  trunks.castShadow = true;
  crowns.castShadow = true;
  group.add(trunks, crowns);
  return group;
}

function createRocks() {
  const rng = mulberry32(97);
  const rockCount = 55;
  const rocks = new THREE.InstancedMesh(
    new THREE.DodecahedronGeometry(1, 0),
    new THREE.MeshStandardMaterial({ color: 0x8b887c, roughness: 0.95 }),
    rockCount,
  );
  const matrix = new THREE.Matrix4();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const position = new THREE.Vector3();

  for (let i = 0; i < rockCount; i += 1) {
    const x = rng() * WORLD_SIZE - HALF_WORLD;
    const z = rng() * WORLD_SIZE - HALF_WORLD;
    const y = terrainHeight(x, z);
    rotation.setFromEuler(new THREE.Euler(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI));
    scale.set(0.6 + rng() * 1.2, 0.25 + rng() * 0.5, 0.55 + rng() * 1.4);
    position.set(x, y + 0.28, z);
    matrix.compose(position, rotation, scale);
    rocks.setMatrixAt(i, matrix);
  }

  rocks.castShadow = true;
  rocks.receiveShadow = true;
  return rocks;
}

function drawMapBase(context: CanvasRenderingContext2D, contourSegments: ContourSegment[]) {
  const { width, height } = context.canvas;
  const image = context.createImageData(width, height);

  for (let py = 0; py < height; py += 1) {
    for (let px = 0; px < width; px += 1) {
      const world = mapToWorld(px, py, width, height);
      const y = terrainHeight(world.x, world.z);
      const slope = localSlope(world.x, world.z);
      const color = topoColor(y, slope);
      const index = (py * width + px) * 4;
      image.data[index] = color.r;
      image.data[index + 1] = color.g;
      image.data[index + 2] = color.b;
      image.data[index + 3] = 255;
    }
  }

  context.putImageData(image, 0, 0);

  context.save();
  drawGrid(context, width, height);
  for (const segment of contourSegments) {
    const major = segment.level % MAJOR_CONTOUR_INTERVAL === 0;
    context.strokeStyle = major ? "rgba(60, 43, 25, 0.84)" : "rgba(114, 83, 45, 0.58)";
    context.lineWidth = major ? 1.45 : 0.62;
    context.beginPath();
    const a = worldToMap(segment.a.x, segment.a.z, width, height);
    const b = worldToMap(segment.b.x, segment.b.z, width, height);
    context.moveTo(a.x, a.y);
    context.lineTo(b.x, b.y);
    context.stroke();
  }
  context.restore();
}

function drawDynamicMap(score: ScoreState) {
  const { width, height } = mapCanvas;
  mapContext.clearRect(0, 0, width, height);
  mapContext.drawImage(mapBase, 0, 0);

  drawBearingOnMap(mapContext, START, plannedBearing, showBearingLine);
  drawTrack(mapContext, track, width, height);
  drawMapMarker(mapContext, START, "#1d7488", "S");
  drawMapMarker(mapContext, CONTROL, "#c35e18", "C");
  drawPlayerMarker(mapContext, player, width, height);

  mapContext.save();
  mapContext.fillStyle = "rgba(33, 39, 34, 0.82)";
  mapContext.fillRect(10, height - 38, 162, 26);
  mapContext.fillStyle = "#fff9e8";
  mapContext.font = "700 12px Inter, sans-serif";
  mapContext.fillText(`${score.currentDrift.toFixed(1)} m drift`, 20, height - 21);
  mapContext.restore();
}

function drawGrid(context: CanvasRenderingContext2D, width: number, height: number) {
  context.save();
  context.strokeStyle = "rgba(52, 78, 68, 0.2)";
  context.lineWidth = 1;
  for (let i = 0; i <= 4; i += 1) {
    const pos = (i / 4) * width;
    context.beginPath();
    context.moveTo(pos, 0);
    context.lineTo(pos, height);
    context.moveTo(0, pos);
    context.lineTo(width, pos);
    context.stroke();
  }

  context.fillStyle = "rgba(29, 44, 39, 0.86)";
  context.font = "800 16px Inter, sans-serif";
  context.fillText("N", width - 30, 30);
  context.beginPath();
  context.moveTo(width - 30, 38);
  context.lineTo(width - 36, 54);
  context.lineTo(width - 24, 54);
  context.closePath();
  context.fill();
  context.restore();
}

function drawTrack(context: CanvasRenderingContext2D, points: Point2[], width: number, height: number) {
  if (points.length < 2) {
    return;
  }
  context.save();
  context.strokeStyle = "rgba(35, 107, 170, 0.9)";
  context.lineWidth = 2.4;
  context.lineJoin = "round";
  context.lineCap = "round";
  context.beginPath();
  points.forEach((point, index) => {
    const mapped = worldToMap(point.x, point.z, width, height);
    if (index === 0) {
      context.moveTo(mapped.x, mapped.y);
    } else {
      context.lineTo(mapped.x, mapped.y);
    }
  });
  context.stroke();
  context.restore();
}

function drawBearingOnMap(
  context: CanvasRenderingContext2D,
  start: Point2,
  bearing: number,
  visible: boolean,
) {
  if (!visible) {
    return;
  }
  const end = projectBearingToEdge(start, bearing);
  const a = worldToMap(start.x, start.z, context.canvas.width, context.canvas.height);
  const b = worldToMap(end.x, end.z, context.canvas.width, context.canvas.height);

  context.save();
  context.strokeStyle = "rgba(225, 91, 22, 0.9)";
  context.lineWidth = 2;
  context.setLineDash([8, 6]);
  context.beginPath();
  context.moveTo(a.x, a.y);
  context.lineTo(b.x, b.y);
  context.stroke();
  context.restore();
}

function drawMapMarker(context: CanvasRenderingContext2D, point: Point2, color: string, label: string) {
  const mapped = worldToMap(point.x, point.z, context.canvas.width, context.canvas.height);
  context.save();
  context.fillStyle = color;
  context.strokeStyle = "#fff8e8";
  context.lineWidth = 2;
  context.beginPath();
  context.arc(mapped.x, mapped.y, 8, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  context.fillStyle = "#fff8e8";
  context.font = "800 10px Inter, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(label, mapped.x, mapped.y + 0.5);
  context.restore();
}

function drawPlayerMarker(
  context: CanvasRenderingContext2D,
  currentPlayer: { x: number; z: number; heading: number },
  width: number,
  height: number,
) {
  const mapped = worldToMap(currentPlayer.x, currentPlayer.z, width, height);
  const bearing = radiansToBearing(currentPlayer.heading);
  const angle = toRadians(bearing);
  const front = { x: Math.sin(angle) * 14, y: -Math.cos(angle) * 14 };
  const left = { x: Math.sin(angle - 2.35) * 8, y: -Math.cos(angle - 2.35) * 8 };
  const right = { x: Math.sin(angle + 2.35) * 8, y: -Math.cos(angle + 2.35) * 8 };

  context.save();
  context.fillStyle = "#15202a";
  context.strokeStyle = "#f8f1da";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(mapped.x + front.x, mapped.y + front.y);
  context.lineTo(mapped.x + left.x, mapped.y + left.y);
  context.lineTo(mapped.x + right.x, mapped.y + right.y);
  context.closePath();
  context.fill();
  context.stroke();
  context.restore();
}

function drawElevationProfile(context: CanvasRenderingContext2D) {
  const { width, height } = context.canvas;
  const samples = 170;
  const heights: number[] = [];
  for (let i = 0; i < samples; i += 1) {
    const t = i / (samples - 1);
    heights.push(terrainHeight(lerp(START.x, CONTROL.x, t), lerp(START.z, CONTROL.z, t)));
  }
  const min = Math.min(...heights);
  const max = Math.max(...heights);
  context.clearRect(0, 0, width, height);

  const gradient = context.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, "#efe0b6");
  gradient.addColorStop(1, "#7aaa6b");
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);

  context.save();
  context.strokeStyle = "rgba(42, 40, 29, 0.22)";
  context.lineWidth = 1;
  for (let i = 1; i < 4; i += 1) {
    const y = (i / 4) * height;
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }

  context.fillStyle = "rgba(32, 38, 32, 0.86)";
  context.beginPath();
  context.moveTo(0, height);
  heights.forEach((sample, index) => {
    const x = (index / (samples - 1)) * width;
    const y = height - ((sample - min) / Math.max(max - min, 1)) * (height - 18) - 8;
    context.lineTo(x, y);
  });
  context.lineTo(width, height);
  context.closePath();
  context.fill();
  context.strokeStyle = "#f4efe0";
  context.lineWidth = 2;
  context.beginPath();
  heights.forEach((sample, index) => {
    const x = (index / (samples - 1)) * width;
    const y = height - ((sample - min) / Math.max(max - min, 1)) * (height - 18) - 8;
    if (index === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  });
  context.stroke();

  context.fillStyle = "#1e2928";
  context.font = "800 12px Inter, sans-serif";
  context.fillText(`${Math.round(max)} m`, 12, 20);
  context.fillText(`${Math.round(min)} m`, 12, height - 12);
  context.restore();
}

function drawCompass() {
  const { width, height } = compassCanvas;
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = width * 0.43;
  const heading = radiansToBearing(player.heading);

  compassContext.clearRect(0, 0, width, height);
  compassContext.save();
  compassContext.translate(centerX, centerY);

  compassContext.fillStyle = "rgba(245, 240, 222, 0.95)";
  compassContext.strokeStyle = "rgba(39, 42, 35, 0.7)";
  compassContext.lineWidth = 3;
  compassContext.beginPath();
  compassContext.arc(0, 0, radius, 0, Math.PI * 2);
  compassContext.fill();
  compassContext.stroke();

  for (let bearing = 0; bearing < 360; bearing += 10) {
    const relative = toRadians(bearing - heading);
    const outer = radius - 10;
    const inner = bearing % 30 === 0 ? radius - 25 : radius - 18;
    compassContext.strokeStyle = bearing % 30 === 0 ? "#313229" : "#77705d";
    compassContext.lineWidth = bearing % 30 === 0 ? 2 : 1;
    compassContext.beginPath();
    compassContext.moveTo(Math.sin(relative) * outer, -Math.cos(relative) * outer);
    compassContext.lineTo(Math.sin(relative) * inner, -Math.cos(relative) * inner);
    compassContext.stroke();
  }

  drawCompassLabel("N", 0, heading, radius);
  drawCompassLabel("E", 90, heading, radius);
  drawCompassLabel("S", 180, heading, radius);
  drawCompassLabel("W", 270, heading, radius);

  drawNeedle(-heading, radius * 0.68, "#c92e1f");
  drawBearingBug(plannedBearing - heading, radius * 0.72);

  compassContext.fillStyle = "#20251f";
  compassContext.font = "850 26px Inter, sans-serif";
  compassContext.textAlign = "center";
  compassContext.fillText(formatBearing(heading), 0, 12);
  compassContext.font = "750 11px Inter, sans-serif";
  compassContext.fillStyle = "#596051";
  compassContext.fillText("heading", 0, 30);

  compassContext.restore();
}

function drawCompassLabel(label: string, bearing: number, heading: number, radius: number) {
  const relative = toRadians(bearing - heading);
  const x = Math.sin(relative) * (radius - 43);
  const y = -Math.cos(relative) * (radius - 43);
  compassContext.fillStyle = label === "N" ? "#bc2d21" : "#2c332b";
  compassContext.font = "850 16px Inter, sans-serif";
  compassContext.textAlign = "center";
  compassContext.textBaseline = "middle";
  compassContext.fillText(label, x, y);
}

function drawNeedle(relativeDegrees: number, length: number, color: string) {
  const angle = toRadians(relativeDegrees);
  compassContext.strokeStyle = color;
  compassContext.lineWidth = 5;
  compassContext.lineCap = "round";
  compassContext.beginPath();
  compassContext.moveTo(0, 0);
  compassContext.lineTo(Math.sin(angle) * length, -Math.cos(angle) * length);
  compassContext.stroke();
  compassContext.fillStyle = "#2d3028";
  compassContext.beginPath();
  compassContext.arc(0, 0, 5, 0, Math.PI * 2);
  compassContext.fill();
}

function drawBearingBug(relativeDegrees: number, radius: number) {
  const angle = toRadians(relativeDegrees);
  const x = Math.sin(angle) * radius;
  const y = -Math.cos(angle) * radius;
  compassContext.save();
  compassContext.translate(x, y);
  compassContext.rotate(angle);
  compassContext.fillStyle = "#e67622";
  compassContext.beginPath();
  compassContext.moveTo(0, -12);
  compassContext.lineTo(8, 8);
  compassContext.lineTo(-8, 8);
  compassContext.closePath();
  compassContext.fill();
  compassContext.restore();
}

function generateContours(interval: number, step: number): ContourSegment[] {
  const count = Math.round(WORLD_SIZE / step);
  const actualStep = WORLD_SIZE / count;
  const samples: number[][] = [];
  let minHeight = Number.POSITIVE_INFINITY;
  let maxHeight = Number.NEGATIVE_INFINITY;

  for (let zIndex = 0; zIndex <= count; zIndex += 1) {
    const row: number[] = [];
    const z = -HALF_WORLD + zIndex * actualStep;
    for (let xIndex = 0; xIndex <= count; xIndex += 1) {
      const x = -HALF_WORLD + xIndex * actualStep;
      const height = terrainHeight(x, z);
      minHeight = Math.min(minHeight, height);
      maxHeight = Math.max(maxHeight, height);
      row.push(height);
    }
    samples.push(row);
  }

  const segments: ContourSegment[] = [];
  const firstLevel = Math.ceil(minHeight / interval) * interval;
  for (let level = firstLevel; level <= maxHeight; level += interval) {
    for (let zIndex = 0; zIndex < count; zIndex += 1) {
      for (let xIndex = 0; xIndex < count; xIndex += 1) {
        const x0 = -HALF_WORLD + xIndex * actualStep;
        const z0 = -HALF_WORLD + zIndex * actualStep;
        const x1 = x0 + actualStep;
        const z1 = z0 + actualStep;
        const corners = [
          { x: x0, z: z0, h: samples[zIndex][xIndex] },
          { x: x1, z: z0, h: samples[zIndex][xIndex + 1] },
          { x: x1, z: z1, h: samples[zIndex + 1][xIndex + 1] },
          { x: x0, z: z1, h: samples[zIndex + 1][xIndex] },
        ];
        const intersections = contourIntersections(corners, level);
        if (intersections.length === 2) {
          segments.push({ a: intersections[0], b: intersections[1], level });
        } else if (intersections.length === 4) {
          segments.push({ a: intersections[0], b: intersections[1], level });
          segments.push({ a: intersections[2], b: intersections[3], level });
        }
      }
    }
  }

  return segments;
}

function contourIntersections(
  corners: Array<Point2 & { h: number }>,
  level: number,
): Point2[] {
  const intersections: Point2[] = [];
  for (let i = 0; i < 4; i += 1) {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    const da = a.h - level;
    const db = b.h - level;
    if ((da < 0 && db >= 0) || (da >= 0 && db < 0)) {
      const t = clamp((level - a.h) / (b.h - a.h), 0, 1);
      intersections.push({
        x: lerp(a.x, b.x, t),
        z: lerp(a.z, b.z, t),
      });
    }
  }
  return intersections;
}

function terrainHeight(x: number, z: number): number {
  const mainRidge =
    46 * gaussian(x, z, -22, 22, 54, 35) +
    34 * gaussian(x, z, 53, 58, 38, 46) +
    28 * gaussian(x, z, 38, -54, 42, 33);
  const basin = 12 * gaussian(x, z, -62, -40, 42, 34);
  const secondary =
    7 * Math.sin(x * 0.052 + z * 0.025) +
    4.5 * Math.sin(z * 0.082 - 1.4) +
    3.5 * Math.cos((x - z) * 0.055);
  const valley = 7 * gaussian(x, z, 0, -6, 24, 98);
  return clamp(12 + mainRidge + secondary - basin - valley, 1.5, 78);
}

function localSlope(x: number, z: number): number {
  const step = 1.4;
  const dx = terrainHeight(x + step, z) - terrainHeight(x - step, z);
  const dz = terrainHeight(x, z + step) - terrainHeight(x, z - step);
  return Math.hypot(dx, dz) / (step * 2);
}

function topoColor(height: number, slope: number) {
  if (height > 62) {
    return { r: 234, g: 231, b: 212 };
  }
  if (slope > 0.62) {
    return { r: 172, g: 158, b: 122 };
  }
  if (height < 14) {
    return { r: 160, g: 192, b: 126 };
  }
  if (height < 31) {
    return { r: 190, g: 207, b: 138 };
  }
  if (height < 49) {
    return { r: 211, g: 196, b: 128 };
  }
  return { r: 201, g: 174, b: 118 };
}

function gaussian(x: number, z: number, centerX: number, centerZ: number, radiusX: number, radiusZ: number) {
  const dx = (x - centerX) / radiusX;
  const dz = (z - centerZ) / radiusZ;
  return Math.exp(-(dx * dx + dz * dz));
}

function crossTrackDistance(point: Point2, start: Point2, bearing: number) {
  const vector = bearingVector(bearing);
  const dx = point.x - start.x;
  const dz = point.z - start.z;
  return Math.abs(dx * vector.z - dz * vector.x);
}

function projectBearingToEdge(start: Point2, bearing: number): Point2 {
  const vector = bearingVector(bearing);
  const candidates: number[] = [];
  if (Math.abs(vector.x) > 0.0001) {
    candidates.push((HALF_WORLD - start.x) / vector.x, (-HALF_WORLD - start.x) / vector.x);
  }
  if (Math.abs(vector.z) > 0.0001) {
    candidates.push((HALF_WORLD - start.z) / vector.z, (-HALF_WORLD - start.z) / vector.z);
  }
  const distance = candidates.filter((candidate) => candidate > 0).sort((a, b) => a - b)[0] ?? WORLD_SIZE;
  return {
    x: clamp(start.x + vector.x * distance, -HALF_WORLD, HALF_WORLD),
    z: clamp(start.z + vector.z * distance, -HALF_WORLD, HALF_WORLD),
  };
}

function bearingBetween(a: Point2, b: Point2): number {
  return normalizeDegrees((Math.atan2(b.x - a.x, b.z - a.z) * 180) / Math.PI);
}

function bearingVector(bearing: number): Point2 {
  const radians = toRadians(bearing);
  return {
    x: Math.sin(radians),
    z: Math.cos(radians),
  };
}

function radiansToBearing(radians: number) {
  return normalizeDegrees((radians * 180) / Math.PI);
}

function normalizeRadians(radians: number) {
  const tau = Math.PI * 2;
  return ((radians % tau) + tau) % tau;
}

function normalizeDegrees(degrees: number) {
  return ((degrees % 360) + 360) % 360;
}

function formatBearing(bearing: number) {
  return String(Math.round(normalizeDegrees(bearing))).padStart(3, "0");
}

function toRadians(degrees: number) {
  return (degrees * Math.PI) / 180;
}

function worldToMap(x: number, z: number, width: number, height: number) {
  return {
    x: ((x + HALF_WORLD) / WORLD_SIZE) * width,
    y: height - ((z + HALF_WORLD) / WORLD_SIZE) * height,
  };
}

function mapToWorld(x: number, y: number, width: number, height: number) {
  return {
    x: (x / width) * WORLD_SIZE - HALF_WORLD,
    z: ((height - y) / height) * WORLD_SIZE - HALF_WORLD,
  };
}

function onResize() {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}

function showToast(message: string) {
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(lastToastTimeout);
  lastToastTimeout = window.setTimeout(() => {
    toast.classList.remove("is-visible");
  }, 2400);
}

function mustElement(selector: string) {
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) {
    throw new Error(`Missing element ${selector}.`);
  }
  return element;
}

function mustCanvas(selector: string) {
  const canvas = document.querySelector<HTMLCanvasElement>(selector);
  if (!canvas) {
    throw new Error(`Missing canvas ${selector}.`);
  }
  return canvas;
}

function get2dContext(canvas: HTMLCanvasElement) {
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas 2D context unavailable.");
  }
  return context;
}

function hexToRgbList(colors: number[]) {
  return colors.flatMap((hex) => {
    const color = new THREE.Color(hex);
    return [color.r, color.g, color.b];
  });
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function mulberry32(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
