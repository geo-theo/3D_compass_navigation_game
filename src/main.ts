import "./styles.css";
import { ChevronDown, Compass, createIcons, Eye, EyeOff, Flag, Home, LocateFixed, RotateCcw } from "lucide";
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
  pathDistance: number;
  pathCost: number;
  idealCost: number;
  steepPenalty: number;
};

type LevelId =
  | "tutorial-1"
  | "tutorial-2"
  | "tutorial-3"
  | "challenge-grasslands"
  | "challenge-desert"
  | "challenge-mountain";

type GameMode = "tutorial" | "challenge";
type TerrainKind = "tutorial-1" | "tutorial-2" | "grasslands" | "desert" | "mountain";
type ThemeKind = "grass" | "desert" | "snow";
type SculptMode = "raise" | "lower" | "flatten";

type LevelConfig = {
  id: LevelId;
  mode: GameMode;
  title: string;
  subtitle: string;
  terrain: TerrainKind;
  theme: ThemeKind;
  start: Point2;
  control?: Point2;
  clues?: Point2[];
  treasure?: Point2;
  tutorialHtml?: string;
  allowSculpt?: boolean;
  bearingLesson?: boolean;
};

type RuntimeObjective = {
  kind: "clue" | "treasure";
  point: Point2;
  collected: boolean;
  mesh: THREE.Object3D;
};

type SculptEdit = {
  x: number;
  z: number;
  mode: SculptMode;
  amount: number;
  radius: number;
  target?: number;
};

const worldCanvas = mustCanvas("#world");
const mapCanvas = mustCanvas("#mapCanvas");
const profileCanvas = mustCanvas("#profileCanvas");
const compassCanvas = mustCanvas("#compassCanvas");
const handheldCompassCanvas = mustCanvas("#handheldCompassCanvas");

const mapContext = get2dContext(mapCanvas);
const profileContext = get2dContext(profileCanvas);
const compassContext = get2dContext(compassCanvas);
const handheldCompassContext = get2dContext(handheldCompassCanvas);

const headingReadout = mustElement("#headingReadout");
const bearingReadout = mustElement("#bearingReadout");
const metricLabel = mustElement("#metricLabel");
const driftReadout = mustElement("#driftReadout");
const scoreReadout = mustElement("#scoreReadout");
const rangeReadout = mustElement("#rangeReadout");
const elevationReadout = mustElement("#elevationReadout");
const paceReadout = mustElement("#paceReadout");
const challengeState = mustElement("#challengeState");
const handheldCompass = mustElement("#handheldCompass");
const handheldHeadingReadout = mustElement("#handheldHeadingReadout");
const handheldBearingReadout = mustElement("#handheldBearingReadout");
const homeMenu = mustElement("#homeMenu");
const homeButton = mustButton("#homeButton");
const lessonPanel = mustElement("#lessonPanel");
const lessonTitle = mustElement("#lessonTitle");
const lessonBody = mustElement("#lessonBody");
const lessonToggleButton = mustButton("#lessonToggleButton");
const sculptPanel = mustElement("#sculptPanel");
const bearingInput = mustInput("#bearingInput");
const handheldToggleButton = mustButton("#handheldToggleButton");
const plotBearingButton = mustButton("#plotBearingButton");
const startButton = mustButton("#startButton");
const resetButton = mustButton("#resetButton");
const lineButton = mustButton("#lineButton");
const toast = mustElement("#toast");

const WORLD_SIZE = 220;
const HALF_WORLD = WORLD_SIZE / 2;
const TERRAIN_SEGMENTS = 168;
const CONTOUR_INTERVAL = 5;
const MAJOR_CONTOUR_INTERVAL = 25;
const PLAYER_EYE_HEIGHT = 2.1;
const DEFAULT_PITCH = toRadians(-2);
const MIN_PITCH = toRadians(-58);
const MAX_PITCH = toRadians(68);
const FINISH_RADIUS = 6.5;
const COLLECT_RADIUS = 5.8;
const LEVELS: LevelConfig[] = [
  {
    id: "tutorial-1",
    mode: "tutorial",
    title: "Tutorial 1",
    subtitle: "Move and look",
    terrain: "tutorial-1",
    theme: "grass",
    start: { x: -42, z: 40 },
    tutorialHtml: `
      <p>Walk around this small tile until the controls feel easy.</p>
      <p><strong>Move:</strong> W/S move forward and back. A/D strafe left and right. Arrow keys or Q/E turn.</p>
      <p><strong>Look:</strong> drag on the 3D view. On a laptop trackpad, click-drag with one finger; on a desktop mouse, hold left-click and drag.</p>
      <p><strong>Tools:</strong> the topo map shows contour lines, Plot sets a bearing, and Hold opens the handheld compass.</p>
    `,
  },
  {
    id: "tutorial-2",
    mode: "tutorial",
    title: "Tutorial 2",
    subtitle: "Contour playground",
    terrain: "tutorial-2",
    theme: "grass",
    start: { x: -74, z: 66 },
    allowSculpt: true,
    tutorialHtml: `
      <p>Contour lines connect places with the same elevation. Tight lines mean steep ground; wide lines mean gentle ground.</p>
      <p>Walk between the hills and depressions, then compare their shape to the topo map.</p>
      <p>Use the topo tools and drag on the map to raise, lower, or flatten terrain. The 3D world rebuilds from the edited map.</p>
    `,
  },
  {
    id: "tutorial-3",
    mode: "tutorial",
    title: "Tutorial 3",
    subtitle: "Bearing walk",
    terrain: "grasslands",
    theme: "grass",
    start: { x: -78, z: -72 },
    control: { x: 72, z: 70 },
    bearingLesson: true,
    tutorialHtml: `
      <p>This is the original bearing challenge. Plot the bearing, hold the compass, then walk the line toward the control.</p>
      <p>Your drift score rewards staying close to the planned bearing line.</p>
    `,
  },
  {
    id: "challenge-grasslands",
    mode: "challenge",
    title: "Grasslands",
    subtitle: "Rolling green hills",
    terrain: "grasslands",
    theme: "grass",
    start: { x: -86, z: -76 },
    clues: [
      { x: -42, z: 18 },
      { x: 36, z: -58 },
      { x: 66, z: 44 },
    ],
    treasure: { x: -4, z: 82 },
  },
  {
    id: "challenge-desert",
    mode: "challenge",
    title: "Desert",
    subtitle: "Sand and cactus",
    terrain: "desert",
    theme: "desert",
    start: { x: -82, z: 70 },
    clues: [
      { x: -34, z: -32 },
      { x: 50, z: 56 },
      { x: 78, z: -50 },
    ],
    treasure: { x: -6, z: -82 },
  },
  {
    id: "challenge-mountain",
    mode: "challenge",
    title: "Mountain",
    subtitle: "Snowy ridges",
    terrain: "mountain",
    theme: "snow",
    start: { x: -84, z: 76 },
    clues: [
      { x: -48, z: -16 },
      { x: 10, z: -72 },
      { x: 72, z: 16 },
    ],
    treasure: { x: 50, z: -58 },
  },
];

let activeLevel = LEVELS[3];
let START: Point2 = { ...activeLevel.start };
let CONTROL: Point2 = activeLevel.control ?? activeLevel.treasure ?? { x: 72, z: 70 };
let MAP_BEARING = Math.round(bearingBetween(START, CONTROL));

let plannedBearing = MAP_BEARING;
let challengeActive = false;
let challengeFinished = false;
let showBearingLine = true;
let handheldCompassOpen = false;
let handheldBearingDragging = false;
let gameRunning = false;
let lessonCollapsed = false;
let sculptMode: SculptMode = "raise";
let sculptDragging = false;
let lastSculptTime = 0;
let pathDistance = 0;
let pathCost = 0;
let steepPenalty = 0;
let idealPathCost = 1;
let lastToastTimeout = 0;
const sculptEdits: SculptEdit[] = [];
const objectives: RuntimeObjective[] = [];

const player = {
  x: START.x,
  z: START.z,
  heading: toRadians(MAP_BEARING),
  pitch: DEFAULT_PITCH,
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

let terrain = createTerrain();
scene.add(terrain);

let contours = generateContours(CONTOUR_INTERVAL, 1.7);
let contourLines = createContourLineObjects(contours);
scene.add(contourLines.minor, contourLines.major);

const bearingLine = createBearingLine();
scene.add(bearingLine);

let landmarks = createLandmarks();
scene.add(landmarks);

let vegetation = createVegetation();
scene.add(vegetation);

let rocks = createRocks();
scene.add(rocks);

let objectiveGroup = createObjectiveObjects();
scene.add(objectiveGroup);

const mapBase = document.createElement("canvas");
mapBase.width = mapCanvas.width;
mapBase.height = mapCanvas.height;
drawMapBase(get2dContext(mapBase), contours);
drawElevationProfile(profileContext);

bearingInput.value = String(plannedBearing);
renderIcons();

let previousTime = performance.now();
let pointerDragging = false;
let lastPointerX = 0;
let lastPointerY = 0;

resetToStart(false);
showHomeMenu();

window.addEventListener("resize", onResize);
window.addEventListener("keydown", (event) => {
  keys.add(event.key.toLowerCase());
});
window.addEventListener("keyup", (event) => {
  keys.delete(event.key.toLowerCase());
});

document.querySelectorAll<HTMLButtonElement>("[data-level]").forEach((button) => {
  button.addEventListener("click", () => {
    const level = LEVELS.find((candidate) => candidate.id === button.dataset.level);
    if (level) {
      startLevel(level);
    }
  });
});

document.querySelectorAll<HTMLButtonElement>("[data-sculpt]").forEach((button) => {
  button.addEventListener("click", () => {
    sculptMode = (button.dataset.sculpt as SculptMode | undefined) ?? "raise";
    document.querySelectorAll<HTMLButtonElement>("[data-sculpt]").forEach((candidate) => {
      candidate.classList.toggle("is-active", candidate === button);
    });
  });
});

homeButton.addEventListener("click", () => {
  showHomeMenu();
});

lessonToggleButton.addEventListener("click", () => {
  lessonCollapsed = !lessonCollapsed;
  lessonPanel.classList.toggle("is-collapsed", lessonCollapsed);
  lessonToggleButton.title = lessonCollapsed ? "Show lesson guide" : "Hide lesson guide";
});

worldCanvas.addEventListener("pointerdown", (event) => {
  pointerDragging = true;
  lastPointerX = event.clientX;
  lastPointerY = event.clientY;
  worldCanvas.setPointerCapture(event.pointerId);
});

worldCanvas.addEventListener("pointermove", (event) => {
  if (!pointerDragging) {
    return;
  }
  const dx = event.clientX - lastPointerX;
  const dy = event.clientY - lastPointerY;
  lastPointerX = event.clientX;
  lastPointerY = event.clientY;
  player.heading = normalizeRadians(player.heading + dx * 0.006);
  player.pitch = clamp(player.pitch - dy * 0.0045, MIN_PITCH, MAX_PITCH);
});

worldCanvas.addEventListener("pointerup", (event) => {
  pointerDragging = false;
  worldCanvas.releasePointerCapture(event.pointerId);
});

bearingInput.addEventListener("change", () => {
  setPlannedBearing(Number(bearingInput.value) || 0);
});

plotBearingButton.addEventListener("click", () => {
  const target = getCurrentObjectivePoint();
  if (!target) {
    showToast("No target in this practice level");
    return;
  }
  setPlannedBearing(activeLevel.bearingLesson ? MAP_BEARING : bearingBetween({ x: player.x, z: player.z }, target));
  showToast(`Plotted ${formatBearing(plannedBearing)}`);
});

handheldToggleButton.addEventListener("click", () => {
  setHandheldCompassOpen(!handheldCompassOpen);
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
  renderIcons();
  updateBearingLine();
});

handheldCompassCanvas.addEventListener("pointerdown", (event) => {
  handheldBearingDragging = true;
  handheldCompass.classList.add("is-dragging");
  handheldCompassCanvas.setPointerCapture(event.pointerId);
  setBearingFromHandheldPointer(event);
});

handheldCompassCanvas.addEventListener("pointermove", (event) => {
  if (!handheldBearingDragging) {
    return;
  }
  setBearingFromHandheldPointer(event);
});

handheldCompassCanvas.addEventListener("pointerup", (event) => {
  handheldBearingDragging = false;
  handheldCompass.classList.remove("is-dragging");
  handheldCompassCanvas.releasePointerCapture(event.pointerId);
});

handheldCompassCanvas.addEventListener("pointercancel", () => {
  handheldBearingDragging = false;
  handheldCompass.classList.remove("is-dragging");
});

mapCanvas.addEventListener("pointerdown", (event) => {
  if (!activeLevel.allowSculpt) {
    return;
  }
  sculptDragging = true;
  mapCanvas.setPointerCapture(event.pointerId);
  applySculptFromMap(event, true);
});

mapCanvas.addEventListener("pointermove", (event) => {
  if (!sculptDragging || !activeLevel.allowSculpt) {
    return;
  }
  applySculptFromMap(event, false);
});

mapCanvas.addEventListener("pointerup", (event) => {
  sculptDragging = false;
  mapCanvas.releasePointerCapture(event.pointerId);
});

mapCanvas.addEventListener("pointercancel", () => {
  sculptDragging = false;
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
  drawHandheldCompass();
  updateReadouts(score);

  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

function updatePlayer(dt: number) {
  if (!gameRunning) {
    player.speed = 0;
    return;
  }

  const turnSpeed = 1.8;
  if (keys.has("arrowleft") || keys.has("q")) {
    player.heading = normalizeRadians(player.heading - turnSpeed * dt);
  }
  if (keys.has("arrowright") || keys.has("e")) {
    player.heading = normalizeRadians(player.heading + turnSpeed * dt);
  }

  const forwardIntent = (keys.has("w") || keys.has("arrowup") ? 1 : 0) - (keys.has("s") || keys.has("arrowdown") ? 1 : 0);
  const strafeIntent = (keys.has("d") ? 1 : 0) - (keys.has("a") ? 1 : 0);
  const sprint = keys.has("shift");
  const baseSpeed = sprint ? 16.5 : 9.2;
  const dir = bearingVector(radiansToBearing(player.heading));
  const right = { x: -dir.z, z: dir.x };

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
  const stepDistance = Math.hypot(nextX - player.x, nextZ - player.z);
  player.x = nextX;
  player.z = nextZ;

  if (activeLevel.mode === "challenge" && stepDistance > 0) {
    const slope = localSlope(player.x, player.z);
    const extraSlope = Math.max(0, slope - 0.42);
    pathDistance += stepDistance;
    pathCost += stepDistance * (1 + slope * 0.22 + extraSlope * extraSlope * 22);
    steepPenalty += extraSlope * extraSlope * stepDistance * 4.5;
    collectNearbyObjective();
  }

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
  const lookDistance = 10;
  const horizontalDistance = Math.cos(player.pitch) * lookDistance;
  const verticalDistance = Math.sin(player.pitch) * lookDistance;
  camera.position.copy(eye);
  camera.lookAt(
    eye.x + look.x * horizontalDistance,
    eye.y + verticalDistance,
    eye.z + look.z * horizontalDistance,
  );
}

function updateScore(): ScoreState {
  const currentDrift = crossTrackDistance({ x: player.x, z: player.z }, START, plannedBearing);
  const currentTarget = getCurrentObjectivePoint();
  const range = currentTarget ? Math.hypot(player.x - currentTarget.x, player.z - currentTarget.z) : 0;
  const elevation = terrainHeight(player.x, player.z);
  const rmsDrift = driftSamples.length
    ? Math.sqrt(driftSamples.reduce((sum, sample) => sum + sample * sample, 0) / driftSamples.length)
    : currentDrift;
  const challengeRatio = pathCost / Math.max(idealPathCost, 1);
  const challengeScore = Math.max(
    0,
    Math.round(100 - Math.max(0, challengeRatio - 1) * 24 - Math.min(88, steepPenalty * 2.2)),
  );
  const bearingScore = Math.max(0, Math.round(100 - rmsDrift * 6.5 - Math.max(0, currentDrift - 2) * 1.5));
  const score = activeLevel.mode === "challenge" ? challengeScore : bearingScore;

  if (activeLevel.bearingLesson && challengeActive && range <= FINISH_RADIUS) {
    challengeActive = false;
    challengeFinished = true;
    showToast(`Finished: ${score}`);
  }

  return {
    currentDrift,
    rmsDrift,
    score,
    range,
    elevation,
    pathDistance,
    pathCost,
    idealCost: idealPathCost,
    steepPenalty,
  };
}

function updateReadouts(score: ScoreState) {
  headingReadout.textContent = formatBearing(radiansToBearing(player.heading));
  bearingReadout.textContent = formatBearing(plannedBearing);
  metricLabel.textContent = activeLevel.mode === "challenge" ? "Clues" : "Drift";
  handheldHeadingReadout.textContent = formatBearing(radiansToBearing(player.heading));
  handheldBearingReadout.textContent = formatBearing(plannedBearing);
  driftReadout.textContent = activeLevel.mode === "challenge"
    ? `${getCollectedClueCount()}/3`
    : `${score.currentDrift.toFixed(1)} m`;
  scoreReadout.textContent = String(score.score);
  rangeReadout.textContent = activeLevel.mode === "challenge"
    ? `${Math.round(score.range)} m to ${getObjectiveName()}`
    : activeLevel.bearingLesson
      ? `${Math.round(score.range)} m to control`
      : activeLevel.allowSculpt
        ? "Map sculpting"
        : "Free practice";
  elevationReadout.textContent = `${Math.round(score.elevation)} m elev`;
  paceReadout.textContent = player.speed > 12 ? "Run" : player.speed > 0.8 ? "Walk" : "Still";
  challengeState.textContent = getLevelStateText();
}

function resetToStart(scoring: boolean) {
  player.x = START.x;
  player.z = START.z;
  player.heading = toRadians(plannedBearing);
  player.pitch = DEFAULT_PITCH;
  player.speed = 0;
  track.splice(0, track.length, { ...START });
  driftSamples.splice(0, driftSamples.length);
  pathDistance = 0;
  pathCost = 0;
  steepPenalty = 0;
  objectives.forEach((objective) => {
    objective.collected = false;
    objective.mesh.visible = objective.kind === "clue";
  });
  challengeActive = scoring && (activeLevel.bearingLesson || activeLevel.mode === "challenge");
  challengeFinished = false;
  updateCamera();
  updateBearingLine();
}

function setPlannedBearing(bearing: number) {
  plannedBearing = Math.round(normalizeDegrees(bearing));
  bearingInput.value = String(plannedBearing);
  updateBearingLine();
}

function setHandheldCompassOpen(open: boolean) {
  handheldCompassOpen = open;
  handheldCompass.hidden = !open;
  document.body.classList.toggle("handheld-open", open);
  handheldToggleButton.setAttribute("aria-pressed", String(open));
  handheldToggleButton.title = open ? "Stow compass" : "Hold compass";
  handheldToggleButton.innerHTML = open
    ? '<i data-lucide="compass"></i><span>Stow</span>'
    : '<i data-lucide="compass"></i><span>Hold</span>';
  renderIcons();
  if (open) {
    drawHandheldCompass();
  }
}

function setBearingFromHandheldPointer(event: PointerEvent) {
  const rect = handheldCompassCanvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const relativeBearing = normalizeDegrees((Math.atan2(x - rect.width / 2, -(y - rect.height / 2)) * 180) / Math.PI);
  setPlannedBearing(radiansToBearing(player.heading) + relativeBearing);
}

function startLevel(level: LevelConfig) {
  activeLevel = level;
  gameRunning = true;
  START = { ...level.start };
  CONTROL = level.control ?? level.treasure ?? level.start;
  MAP_BEARING = Math.round(bearingBetween(START, CONTROL));
  plannedBearing = MAP_BEARING;
  sculptEdits.splice(0, sculptEdits.length);
  applyLevelAtmosphere();
  rebuildWorld();
  idealPathCost = computeIdealChallengeCost();
  resetToStart(level.mode === "challenge" || Boolean(level.bearingLesson));
  setPlannedBearing(level.bearingLesson ? MAP_BEARING : bearingBetween(START, getCurrentObjectivePoint() ?? CONTROL));
  setMenuOpen(false);
  setHandheldCompassOpen(false);
  lessonCollapsed = false;
  lessonPanel.classList.remove("is-collapsed");
  lessonPanel.hidden = !level.tutorialHtml;
  lessonTitle.textContent = `${level.title}: ${level.subtitle}`;
  lessonBody.innerHTML = level.tutorialHtml ?? "";
  sculptPanel.hidden = !level.allowSculpt;
  showToast(level.mode === "challenge" ? "Collect 3 clues, then find the chest" : level.subtitle);
}

function applyLevelAtmosphere() {
  const sky = activeLevel.theme === "desert" ? 0xf4c98d : activeLevel.theme === "snow" ? 0xcfe4ee : 0x9ec7d7;
  scene.background = new THREE.Color(sky);
  scene.fog = new THREE.Fog(sky, activeLevel.theme === "snow" ? 115 : 130, activeLevel.theme === "snow" ? 330 : 355);
  ambient.groundColor.set(activeLevel.theme === "desert" ? 0x8a6844 : activeLevel.theme === "snow" ? 0xd7ded6 : 0x4e4634);
  sun.intensity = activeLevel.theme === "desert" ? 3.7 : activeLevel.theme === "snow" ? 2.9 : 3.2;
}

function showHomeMenu() {
  gameRunning = false;
  keys.clear();
  setMenuOpen(true);
  lessonPanel.hidden = true;
  sculptPanel.hidden = true;
  setHandheldCompassOpen(false);
}

function setMenuOpen(open: boolean) {
  homeMenu.hidden = !open;
  homeButton.hidden = open;
  document.body.classList.toggle("menu-open", open);
}

function rebuildWorld() {
  scene.remove(terrain, contourLines.minor, contourLines.major, landmarks, vegetation, rocks, objectiveGroup);
  terrain = createTerrain();
  contours = generateContours(CONTOUR_INTERVAL, 1.7);
  contourLines = createContourLineObjects(contours);
  landmarks = createLandmarks();
  vegetation = createVegetation();
  rocks = createRocks();
  objectiveGroup = createObjectiveObjects();
  scene.add(terrain, contourLines.minor, contourLines.major, landmarks, vegetation, rocks, objectiveGroup);
  redrawStaticMap();
}

function redrawStaticMap() {
  drawMapBase(get2dContext(mapBase), contours);
  drawElevationProfile(profileContext);
}

function refreshTerrainAfterSculpt() {
  scene.remove(terrain, contourLines.minor, contourLines.major, landmarks, vegetation, rocks);
  terrain = createTerrain();
  contours = generateContours(CONTOUR_INTERVAL, 1.7);
  contourLines = createContourLineObjects(contours);
  landmarks = createLandmarks();
  vegetation = createVegetation();
  rocks = createRocks();
  scene.add(terrain, contourLines.minor, contourLines.major, landmarks, vegetation, rocks);
  redrawStaticMap();
}

function applySculptFromMap(event: PointerEvent, force: boolean) {
  const now = performance.now();
  if (!force && now - lastSculptTime < 140) {
    return;
  }
  lastSculptTime = now;
  const rect = mapCanvas.getBoundingClientRect();
  const world = mapToWorld(
    ((event.clientX - rect.left) / rect.width) * mapCanvas.width,
    ((event.clientY - rect.top) / rect.height) * mapCanvas.height,
    mapCanvas.width,
    mapCanvas.height,
  );
  sculptEdits.push({
    x: world.x,
    z: world.z,
    mode: sculptMode,
    amount: sculptMode === "flatten" ? 0 : sculptMode === "raise" ? 8 : -8,
    radius: sculptMode === "flatten" ? 17 : 14,
    target: sculptMode === "flatten" ? terrainHeight(world.x, world.z) : undefined,
  });
  if (sculptEdits.length > 60) {
    sculptEdits.shift();
  }
  refreshTerrainAfterSculpt();
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
      const rgb = terrainRgb(y, slope);
      color.setRGB(rgb.r, rgb.g, rgb.b);
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
  const origin = getBearingLineOrigin();
  const end = projectBearingToEdge(origin, plannedBearing);
  const position = bearingLine.geometry.getAttribute("position");
  position.setXYZ(0, origin.x, terrainHeight(origin.x, origin.z) + 0.55, origin.z);
  position.setXYZ(1, end.x, terrainHeight(end.x, end.z) + 0.55, end.z);
  position.needsUpdate = true;
}

function createLandmarks() {
  const group = new THREE.Group();
  group.add(createFlagMarker(START, 0x4fb4ca, 0xffffff));
  if (activeLevel.bearingLesson && activeLevel.control) {
    group.add(createFlagMarker(CONTROL, 0xf28c38, 0xffffff));
  }
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

function createObjectiveObjects() {
  const group = new THREE.Group();
  objectives.splice(0, objectives.length);

  if (activeLevel.mode !== "challenge") {
    return group;
  }

  activeLevel.clues?.forEach((point, index) => {
    const mesh = createClueMarker(point, index + 1);
    group.add(mesh);
    objectives.push({ kind: "clue", point, collected: false, mesh });
  });

  if (activeLevel.treasure) {
    const mesh = createTreasureChest(activeLevel.treasure);
    mesh.visible = false;
    group.add(mesh);
    objectives.push({ kind: "treasure", point: activeLevel.treasure, collected: false, mesh });
  }

  return group;
}

function createClueMarker(point: Point2, clueNumber: number) {
  const group = new THREE.Group();
  group.position.set(point.x, terrainHeight(point.x, point.z) + 1.2, point.z);

  const gem = new THREE.Mesh(
    new THREE.OctahedronGeometry(1.6, 0),
    new THREE.MeshStandardMaterial({
      color: 0x45c4ff,
      emissive: 0x0c4f6f,
      emissiveIntensity: 0.55,
      roughness: 0.34,
    }),
  );
  gem.castShadow = true;
  group.add(gem);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(3.7, 0.06, 8, 52),
    new THREE.MeshBasicMaterial({ color: 0x45c4ff, transparent: true, opacity: 0.72 }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = -1;
  group.add(ring);

  const label = createFloatingLabel(String(clueNumber), "#123746");
  label.position.y = 2.6;
  group.add(label);

  return group;
}

function createTreasureChest(point: Point2) {
  const group = new THREE.Group();
  group.position.set(point.x, terrainHeight(point.x, point.z) + 0.65, point.z);

  const base = new THREE.Mesh(
    new THREE.BoxGeometry(4.8, 1.8, 3.3),
    new THREE.MeshStandardMaterial({ color: 0x8b4a25, roughness: 0.62 }),
  );
  base.castShadow = true;
  group.add(base);

  const lid = new THREE.Mesh(
    new THREE.BoxGeometry(5.1, 0.8, 3.5),
    new THREE.MeshStandardMaterial({ color: 0xc8792b, roughness: 0.5 }),
  );
  lid.position.y = 1.25;
  lid.castShadow = true;
  group.add(lid);

  const bandMaterial = new THREE.MeshStandardMaterial({ color: 0xffcf4d, metalness: 0.15, roughness: 0.35 });
  [-1.65, 1.65].forEach((x) => {
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.32, 2.12, 3.7), bandMaterial);
    band.position.set(x, 0.35, 0);
    band.castShadow = true;
    group.add(band);
  });

  const lock = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.72, 0.18), bandMaterial);
  lock.position.set(0, 0.55, -1.76);
  group.add(lock);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(FINISH_RADIUS, 0.08, 8, 72),
    new THREE.MeshBasicMaterial({ color: 0xffcf4d, transparent: true, opacity: 0.8 }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = -0.45;
  group.add(ring);

  return group;
}

function createFloatingLabel(text: string, color: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 96;
  canvas.height = 96;
  const context = get2dContext(canvas);
  context.fillStyle = "rgba(255, 255, 255, 0.92)";
  context.beginPath();
  context.arc(48, 48, 34, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = color;
  context.font = "800 44px Inter, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, 48, 50);
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true }));
  sprite.scale.set(5.2, 5.2, 1);
  return sprite;
}

function collectNearbyObjective() {
  if (challengeFinished) {
    return;
  }

  const playerPoint = { x: player.x, z: player.z };
  for (const objective of objectives) {
    if (objective.collected) {
      continue;
    }
    if (objective.kind === "treasure" && getCollectedClueCount() < 3) {
      continue;
    }
    if (Math.hypot(playerPoint.x - objective.point.x, playerPoint.z - objective.point.z) > COLLECT_RADIUS) {
      continue;
    }

    objective.collected = true;
    objective.mesh.visible = false;

    if (objective.kind === "clue") {
      const clues = getCollectedClueCount();
      showToast(clues === 3 ? "All clues found. Treasure revealed." : `Clue ${clues}/3 found`);
      revealTreasureIfReady();
    } else {
      challengeActive = false;
      challengeFinished = true;
      showToast(`Treasure found. Score ${updateScore().score}`);
    }
  }
}

function revealTreasureIfReady() {
  const treasure = objectives.find((objective) => objective.kind === "treasure");
  if (treasure && getCollectedClueCount() >= 3 && !treasure.collected) {
    treasure.mesh.visible = true;
  }
}

function getCollectedClueCount() {
  return objectives.filter((objective) => objective.kind === "clue" && objective.collected).length;
}

function getCurrentObjectivePoint() {
  if (activeLevel.mode === "challenge") {
    const nextClue = objectives.find((objective) => objective.kind === "clue" && !objective.collected);
    if (nextClue) {
      return nextClue.point;
    }
    const treasure = objectives.find((objective) => objective.kind === "treasure" && !objective.collected);
    return treasure?.point;
  }

  return activeLevel.control;
}

function getObjectiveName() {
  if (activeLevel.mode !== "challenge") {
    return "control";
  }
  return getCollectedClueCount() >= 3 ? "chest" : "clue";
}

function getLevelStateText() {
  if (activeLevel.mode === "challenge") {
    if (challengeFinished) {
      return "Treasure found";
    }
    return getCollectedClueCount() >= 3 ? "Chest revealed" : `${getCollectedClueCount()}/3 clues`;
  }
  if (activeLevel.allowSculpt) {
    return "Sculpt";
  }
  return challengeFinished ? "Complete" : challengeActive ? "Scoring" : "Practice";
}

function getBearingLineOrigin(): Point2 {
  return activeLevel.bearingLesson ? START : { x: player.x, z: player.z };
}

function computeIdealChallengeCost() {
  if (activeLevel.mode !== "challenge" || !activeLevel.clues || !activeLevel.treasure) {
    return 1;
  }

  const clueOrders = permutations(activeLevel.clues);
  let best = Number.POSITIVE_INFINITY;
  for (const order of clueOrders) {
    const route = [START, ...order, activeLevel.treasure];
    let cost = 0;
    for (let i = 0; i < route.length - 1; i += 1) {
      cost += pathCostBetween(route[i], route[i + 1]);
    }
    best = Math.min(best, cost);
  }
  return Number.isFinite(best) ? best : 1;
}

function pathCostBetween(a: Point2, b: Point2) {
  const distance = Math.hypot(b.x - a.x, b.z - a.z);
  const samples = Math.max(12, Math.ceil(distance / 4));
  let cost = 0;
  for (let i = 1; i <= samples; i += 1) {
    const t = i / samples;
    const x = lerp(a.x, b.x, t);
    const z = lerp(a.z, b.z, t);
    const slope = localSlope(x, z);
    const extraSlope = Math.max(0, slope - 0.42);
    const step = distance / samples;
    cost += step * (1 + slope * 0.22 + extraSlope * extraSlope * 22);
  }
  return cost;
}

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) {
    return [items];
  }
  return items.flatMap((item, index) =>
    permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [item, ...rest]),
  );
}

function createVegetation() {
  const group = new THREE.Group();
  if (activeLevel.id === "tutorial-1") {
    group.add(createSingleTree({ x: 20, z: -16 }, false));
    return group;
  }

  if (activeLevel.theme === "desert") {
    return createCactuses();
  }

  const rng = mulberry32(42);
  const trunkGeometry = new THREE.CylinderGeometry(0.16, 0.25, 2.7, 7);
  const crownGeometry = new THREE.ConeGeometry(1.25, 4, 8);
  const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x5b3f27, roughness: 0.9 });
  const crownMaterial = new THREE.MeshStandardMaterial({ color: 0x2f6543, roughness: 0.92 });
  const snowMaterial = new THREE.MeshStandardMaterial({ color: 0xf2f5ed, roughness: 0.9 });
  const treeCount = 210;
  const trunks = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, treeCount);
  const crowns = new THREE.InstancedMesh(crownGeometry, crownMaterial, treeCount);
  const snowCaps = new THREE.InstancedMesh(new THREE.ConeGeometry(1.05, 1.1, 8), snowMaterial, treeCount);
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
    if (activeLevel.theme === "snow") {
      position.set(x, elevation + 4.9 * treeScale, z);
      matrix.compose(position, rotation, scale);
      snowCaps.setMatrixAt(placed, matrix);
    }
    placed += 1;
  }

  trunks.count = placed;
  crowns.count = placed;
  snowCaps.count = placed;
  trunks.castShadow = true;
  crowns.castShadow = true;
  snowCaps.castShadow = true;
  group.add(trunks, crowns);
  if (activeLevel.theme === "snow") {
    group.add(snowCaps);
  }
  return group;
}

function createSingleTree(point: Point2, snowy: boolean) {
  const group = new THREE.Group();
  const y = terrainHeight(point.x, point.z);
  group.position.set(point.x, y, point.z);
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.34, 0.46, 3, 8),
    new THREE.MeshStandardMaterial({ color: 0x68472a, roughness: 0.9 }),
  );
  trunk.position.y = 1.5;
  trunk.castShadow = true;
  group.add(trunk);
  const crown = new THREE.Mesh(
    new THREE.ConeGeometry(2.2, 5.2, 9),
    new THREE.MeshStandardMaterial({ color: snowy ? 0x2f5f48 : 0x2f6543, roughness: 0.9 }),
  );
  crown.position.y = 4.5;
  crown.castShadow = true;
  group.add(crown);
  if (snowy) {
    const cap = new THREE.Mesh(
      new THREE.ConeGeometry(1.65, 1.7, 9),
      new THREE.MeshStandardMaterial({ color: 0xf2f5ed, roughness: 0.86 }),
    );
    cap.position.y = 6.3;
    cap.castShadow = true;
    group.add(cap);
  }
  return group;
}

function createCactuses() {
  const group = new THREE.Group();
  const rng = mulberry32(125);
  const cactusCount = 95;

  for (let i = 0; i < cactusCount; i += 1) {
    const x = rng() * WORLD_SIZE - HALF_WORLD;
    const z = rng() * WORLD_SIZE - HALF_WORLD;
    const nearStart = Math.hypot(x - START.x, z - START.z) < 12;
    if (nearStart || localSlope(x, z) > 0.85) {
      continue;
    }
    group.add(createCactus({ x, z }, 0.75 + rng() * 0.75));
  }

  return group;
}

function createCactus(point: Point2, cactusScale: number) {
  const group = new THREE.Group();
  const y = terrainHeight(point.x, point.z);
  const material = new THREE.MeshStandardMaterial({ color: 0x3d8b59, roughness: 0.86 });
  group.position.set(point.x, y, point.z);

  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 4.7, 10), material);
  trunk.position.y = 2.35 * cactusScale;
  trunk.scale.setScalar(cactusScale);
  trunk.castShadow = true;
  group.add(trunk);

  [-1, 1].forEach((side) => {
    const arm = new THREE.Group();
    const horizontal = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 1.7, 8), material);
    horizontal.rotation.z = Math.PI / 2;
    horizontal.position.set(side * 0.75 * cactusScale, 2.8 * cactusScale, 0);
    const vertical = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.22, 1.5, 8), material);
    vertical.position.set(side * 1.55 * cactusScale, 3.45 * cactusScale, 0);
    horizontal.castShadow = true;
    vertical.castShadow = true;
    arm.add(horizontal, vertical);
    group.add(arm);
  });

  return group;
}

function createRocks() {
  if (activeLevel.id === "tutorial-1") {
    const rock = new THREE.Mesh(
      new THREE.DodecahedronGeometry(1.4, 0),
      new THREE.MeshStandardMaterial({ color: 0x8b887c, roughness: 0.95 }),
    );
    rock.position.set(-18, terrainHeight(-18, 8) + 0.35, 8);
    rock.scale.set(1.4, 0.65, 1.1);
    rock.castShadow = true;
    rock.receiveShadow = true;
    return rock;
  }

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

  drawBearingOnMap(mapContext, getBearingLineOrigin(), plannedBearing, showBearingLine);
  drawTrack(mapContext, track, width, height);
  drawMapMarker(mapContext, START, "#1d7488", "S");
  if (activeLevel.bearingLesson && activeLevel.control) {
    drawMapMarker(mapContext, CONTROL, "#c35e18", "C");
  }
  drawObjectiveMarkers(mapContext);
  drawPlayerMarker(mapContext, player, width, height);

  mapContext.save();
  mapContext.fillStyle = "rgba(33, 39, 34, 0.82)";
  mapContext.fillRect(10, height - 38, 162, 26);
  mapContext.fillStyle = "#fff9e8";
  mapContext.font = "700 12px Inter, sans-serif";
  mapContext.fillText(
    activeLevel.mode === "challenge"
      ? `${getCollectedClueCount()}/3 clues | ${Math.round(score.pathDistance)} m`
      : `${score.currentDrift.toFixed(1)} m drift`,
    20,
    height - 21,
  );
  mapContext.restore();
}

function drawObjectiveMarkers(context: CanvasRenderingContext2D) {
  if (activeLevel.mode !== "challenge") {
    return;
  }

  for (const objective of objectives) {
    if (objective.kind === "clue" && !objective.collected) {
      const clueNumber = objectives.filter((candidate) => candidate.kind === "clue").indexOf(objective) + 1;
      drawMapMarker(context, objective.point, "#267fa3", String(clueNumber));
    }
    if (objective.kind === "treasure" && getCollectedClueCount() >= 3 && !objective.collected) {
      drawMapMarker(context, objective.point, "#bd7a13", "T");
    }
  }
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
  drawCompassFace(compassContext, compassCanvas, "panel");
}

function drawHandheldCompass() {
  if (!handheldCompassOpen) {
    return;
  }
  drawCompassFace(handheldCompassContext, handheldCompassCanvas, "handheld");
}

function drawCompassFace(
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  mode: "panel" | "handheld",
) {
  const { width, height } = canvas;
  const centerX = width / 2;
  const centerY = height / 2;
  const size = Math.min(width, height);
  const radius = size * 0.43;
  const scale = size / 230;
  const heading = radiansToBearing(player.heading);

  context.clearRect(0, 0, width, height);
  context.save();
  context.translate(centerX, centerY);

  context.fillStyle = "rgba(245, 240, 222, 0.95)";
  context.strokeStyle = "rgba(39, 42, 35, 0.7)";
  context.lineWidth = 3 * scale;
  context.beginPath();
  context.arc(0, 0, radius, 0, Math.PI * 2);
  context.fill();
  context.stroke();

  for (let bearing = 0; bearing < 360; bearing += 10) {
    const relative = toRadians(bearing - heading);
    const outer = radius - 10 * scale;
    const inner = bearing % 30 === 0 ? radius - 25 * scale : radius - 18 * scale;
    context.strokeStyle = bearing % 30 === 0 ? "#313229" : "#77705d";
    context.lineWidth = bearing % 30 === 0 ? 2 * scale : 1 * scale;
    context.beginPath();
    context.moveTo(Math.sin(relative) * outer, -Math.cos(relative) * outer);
    context.lineTo(Math.sin(relative) * inner, -Math.cos(relative) * inner);
    context.stroke();
  }

  drawCompassLabel(context, "N", 0, heading, radius, scale);
  drawCompassLabel(context, "E", 90, heading, radius, scale);
  drawCompassLabel(context, "S", 180, heading, radius, scale);
  drawCompassLabel(context, "W", 270, heading, radius, scale);

  if (mode === "handheld") {
    drawBearingArrow(context, plannedBearing - heading, radius, scale);
  }

  drawNeedle(context, -heading, radius * 0.68, "#c92e1f", scale);
  drawBearingBug(context, plannedBearing - heading, radius * 0.72, scale);

  context.fillStyle = "#20251f";
  context.font = `850 ${26 * scale}px Inter, sans-serif`;
  context.textAlign = "center";
  context.fillText(formatBearing(heading), 0, 12 * scale);
  context.font = `750 ${11 * scale}px Inter, sans-serif`;
  context.fillStyle = "#596051";
  context.fillText("heading", 0, 30 * scale);

  context.restore();
}

function drawCompassLabel(
  context: CanvasRenderingContext2D,
  label: string,
  bearing: number,
  heading: number,
  radius: number,
  scale: number,
) {
  const relative = toRadians(bearing - heading);
  const x = Math.sin(relative) * (radius - 43 * scale);
  const y = -Math.cos(relative) * (radius - 43 * scale);
  context.fillStyle = label === "N" ? "#bc2d21" : "#2c332b";
  context.font = `850 ${16 * scale}px Inter, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(label, x, y);
}

function drawNeedle(
  context: CanvasRenderingContext2D,
  relativeDegrees: number,
  length: number,
  color: string,
  scale: number,
) {
  const angle = toRadians(relativeDegrees);
  context.strokeStyle = color;
  context.lineWidth = 5 * scale;
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(0, 0);
  context.lineTo(Math.sin(angle) * length, -Math.cos(angle) * length);
  context.stroke();
  context.fillStyle = "#2d3028";
  context.beginPath();
  context.arc(0, 0, 5 * scale, 0, Math.PI * 2);
  context.fill();
}

function drawBearingArrow(
  context: CanvasRenderingContext2D,
  relativeDegrees: number,
  radius: number,
  scale: number,
) {
  const angle = toRadians(relativeDegrees);
  context.save();
  context.rotate(angle);
  context.strokeStyle = "rgba(230, 118, 34, 0.9)";
  context.lineWidth = 5 * scale;
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(0, radius * 0.48);
  context.lineTo(0, -radius * 0.7);
  context.stroke();
  context.fillStyle = "#e67622";
  context.beginPath();
  context.moveTo(0, -radius * 0.86);
  context.lineTo(12 * scale, -radius * 0.62);
  context.lineTo(-12 * scale, -radius * 0.62);
  context.closePath();
  context.fill();
  context.strokeStyle = "rgba(255, 248, 232, 0.85)";
  context.lineWidth = 2 * scale;
  context.stroke();
  context.restore();
}

function drawBearingBug(
  context: CanvasRenderingContext2D,
  relativeDegrees: number,
  radius: number,
  scale: number,
) {
  const angle = toRadians(relativeDegrees);
  const x = Math.sin(angle) * radius;
  const y = -Math.cos(angle) * radius;
  context.save();
  context.translate(x, y);
  context.rotate(angle);
  context.fillStyle = "#e67622";
  context.beginPath();
  context.moveTo(0, -12 * scale);
  context.lineTo(8 * scale, 8 * scale);
  context.lineTo(-8 * scale, 8 * scale);
  context.closePath();
  context.fill();
  context.restore();
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
  let height = baseTerrainHeight(x, z);
  for (const edit of sculptEdits) {
    const strength = gaussian(x, z, edit.x, edit.z, edit.radius, edit.radius);
    if (edit.mode === "flatten" && edit.target !== undefined) {
      height = lerp(height, edit.target, strength * 0.74);
    } else {
      height += edit.amount * strength;
    }
  }
  return clamp(height, 0.5, 96);
}

function baseTerrainHeight(x: number, z: number): number {
  if (activeLevel.terrain === "tutorial-1") {
    return clamp(
      8 +
        17 * gaussian(x, z, -6, -8, 24, 22) -
        7 * gaussian(x, z, 34, 24, 18, 18) +
        1.2 * Math.sin(x * 0.04),
      2,
      28,
    );
  }

  if (activeLevel.terrain === "tutorial-2") {
    return clamp(
      10 +
        25 * gaussian(x, z, -54, -34, 24, 22) +
        18 * gaussian(x, z, 28, -56, 38, 18) +
        33 * gaussian(x, z, 58, 34, 22, 36) +
        15 * gaussian(x, z, -18, 54, 42, 42) -
        11 * gaussian(x, z, -68, 46, 22, 22) -
        9 * gaussian(x, z, 6, 6, 20, 34) +
        3 * Math.sin((x + z) * 0.045),
      1,
      70,
    );
  }

  if (activeLevel.terrain === "desert") {
    const dunes =
      9 * Math.sin(x * 0.045 + z * 0.025) +
      7 * Math.sin(z * 0.065 - 1.3) +
      4 * Math.cos((x - z) * 0.035);
    return clamp(
      14 +
        dunes +
        26 * gaussian(x, z, -36, -26, 48, 32) +
        31 * gaussian(x, z, 52, 36, 36, 44) -
        7 * gaussian(x, z, -4, 68, 40, 30),
      3,
      64,
    );
  }

  if (activeLevel.terrain === "mountain") {
    return clamp(
      12 +
        58 * gaussian(x, z, 18, -28, 44, 54) +
        35 * gaussian(x, z, -46, 38, 36, 30) +
        24 * gaussian(x, z, 64, 48, 26, 34) -
        10 * gaussian(x, z, -8, 12, 22, 90) +
        5 * Math.sin(x * 0.06 + z * 0.018),
      3,
      92,
    );
  }

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

function terrainRgb(height: number, slope: number) {
  const t = clamp(height / 82, 0, 1);
  if (activeLevel.theme === "desert") {
    if (slope > 0.55) {
      return { r: 0.68, g: 0.51, b: 0.3 };
    }
    return { r: 0.79 + t * 0.1, g: 0.66 + t * 0.04, b: 0.39 - t * 0.08 };
  }

  if (activeLevel.theme === "snow") {
    if (height > 52) {
      return { r: 0.88, g: 0.93, b: 0.93 };
    }
    if (slope > 0.5) {
      return { r: 0.64, g: 0.68, b: 0.64 };
    }
    return { r: 0.64 + t * 0.2, g: 0.75 + t * 0.14, b: 0.68 + t * 0.16 };
  }

  if (height > 61) {
    return { r: 0.9, g: 0.88, b: 0.8 };
  }
  if (t > 0.7) {
    return { r: 0.57, g: 0.58, b: 0.42 };
  }
  if (slope > 0.38) {
    return { r: 0.48, g: 0.45, b: 0.32 };
  }
  if (t < 0.18) {
    return { r: 0.37, g: 0.58, b: 0.33 };
  }
  return { r: 0.43 + t * 0.16, g: 0.61 - t * 0.1, b: 0.35 - t * 0.02 };
}

function topoColor(height: number, slope: number) {
  if (activeLevel.theme === "desert") {
    if (slope > 0.64) {
      return { r: 193, g: 151, b: 91 };
    }
    if (height > 48) {
      return { r: 226, g: 185, b: 111 };
    }
    if (height < 14) {
      return { r: 238, g: 208, b: 137 };
    }
    return { r: 228, g: 195, b: 122 };
  }

  if (activeLevel.theme === "snow") {
    if (height > 54) {
      return { r: 237, g: 242, b: 238 };
    }
    if (slope > 0.64) {
      return { r: 181, g: 190, b: 182 };
    }
    if (height < 18) {
      return { r: 160, g: 193, b: 176 };
    }
    return { r: 211, g: 224, b: 210 };
  }

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
  return normalizeDegrees((Math.atan2(b.x - a.x, -(b.z - a.z)) * 180) / Math.PI);
}

function bearingVector(bearing: number): Point2 {
  const radians = toRadians(bearing);
  return {
    x: Math.sin(radians),
    z: -Math.cos(radians),
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
    y: ((z + HALF_WORLD) / WORLD_SIZE) * height,
  };
}

function mapToWorld(x: number, y: number, width: number, height: number) {
  return {
    x: (x / width) * WORLD_SIZE - HALF_WORLD,
    z: (y / height) * WORLD_SIZE - HALF_WORLD,
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

function renderIcons() {
  createIcons({
    icons: {
      ChevronDown,
      Compass,
      Eye,
      EyeOff,
      Flag,
      Home,
      LocateFixed,
      RotateCcw,
    },
  });
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

function mustInput(selector: string) {
  const input = document.querySelector<HTMLInputElement>(selector);
  if (!input) {
    throw new Error(`Missing input ${selector}.`);
  }
  return input;
}

function mustButton(selector: string) {
  const button = document.querySelector<HTMLButtonElement>(selector);
  if (!button) {
    throw new Error(`Missing button ${selector}.`);
  }
  return button;
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
