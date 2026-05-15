/* ===== たっくんとGOLF - game.js ===== */
/* キャッシュ回避の ?v= は index.php が game.js の更新時刻で自動付与する（手動の fixspec 更新は不要） */

// ホール定義
const HOLES = [
  { par: 3, ballStart: { x: 0, z: 40 },   holePos: { x: 0, z: -40 },  terrain: 'flat',  name: 'HOLE 1' },
  { par: 4, ballStart: { x: -10, z: 55 },  holePos: { x: 10, z: -55 }, terrain: 'slope', name: 'HOLE 2' },
  { par: 5, ballStart: { x: 0, z: 70 },    holePos: { x: 0, z: -70 },  terrain: 'hill',  name: 'HOLE 3' },
];

// ===== クラブ定義 =====
// speed は √(lockedPower/100) スケーリング前提で maxYard と整合させた値
// dist(yd) = 2 * speed² * loft / GRAVITY_ABS * 2.5  → 100% 時に maxYard と一致
// maxYard = バウンス・ロール込みの実際の総飛距離（1.3yd/unit換算）
const CLUBS = [
  { name: 'W1', label: 'ドライバー', maxYard: 200, speed: 1.27, loft: 0.45 },
  { name: '3W', label: '3ウッド',   maxYard: 163, speed: 1.07, loft: 0.50 },
  { name: '5I', label: '5アイアン', maxYard: 130, speed: 0.88, loft: 0.58 },
  { name: '7I', label: '7アイアン', maxYard: 110, speed: 0.76, loft: 0.65 },
  { name: '9I', label: '9アイアン', maxYard:  85, speed: 0.63, loft: 0.72 },
  { name: 'PW', label: 'PW',        maxYard:  60, speed: 0.50, loft: 0.80 },
  { name: 'PT', label: 'パター',    maxYard:   8, speed: 0.24, loft: 0.02 },
];
let currentClub = 0;

// ===== ショット状態 =====
const SHOT_IDLE   = 0; // 待機
const SHOT_POWER  = 1; // ① バー往復中（パワー選択）
const SHOT_SWING  = 2; // ② パワー確定後、100%まで振り切る
const SHOT_RETURN = 3; // ③ バー戻り中（インパクト待ち）

// インパクトゾーン（中心 ± IMPACT_HALF がエリア）
const IMPACT_ZONE   = 15;  // 中心線の CSS 位置 (%)
const IMPACT_HALF   = 10;  // エリア幅の半分 (%)  → エリア: 5%〜25%
const POWER_SPEED   = 1.5; // フレームごとのバー増減幅（往復）
const RETURN_SPEED  = 1.35; // ③ フェーズでの戻り速度（インパクト猶予を確保）

// コース単位 ≒ m（状態変数より前に定義すること）
const BALL_RADIUS          = 0.084;  // ミニゲーム用（実寸の約4倍・視認性確保）
const CUP_TO_BALL_RATIO    = 2.53;   // カップ半径 / ボール半径（実物比 ≒ 2.53）
const CUP_RADIUS           = BALL_RADIUS * CUP_TO_BALL_RATIO;
const CUP_SOIL_DEPTH       = 0.048;
const CUP_LINER_DEPTH      = BALL_RADIUS * 4.2;
const CUP_LINER_RADIUS     = CUP_RADIUS * 0.86;
const CUP_TOTAL_DEPTH      = CUP_SOIL_DEPTH + CUP_LINER_DEPTH;
const CUP_CAPTURE_RADIUS   = CUP_RADIUS * 0.92;
const GREEN_INNER_RADIUS   = CUP_RADIUS * 1.35; // カップ穴の外縁（グリーンリング内径）
const GREEN_OUTER_RADIUS   = 7;                 // パッティンググリーン外周
const PLAYER_HEIGHT       = 1.65;
const PLAYER_HEADS        = 5;
const PLAYER_MODEL_HEAD_R = 0.21;

// ===== 状態変数 =====
let scene, camera, renderer;
/** 影用（方向光）。initThree で生成 */
let sunLight = null;
let ball, holeMesh, flagMesh, flagPolePart, flagClothPart, arrowMesh;
let ballPos    = { x: 0, y: BALL_RADIUS, z: 0 };
let ballVel    = { x: 0, y: 0, z: 0 };
let ballInFlight   = false;
let shotDirection  = 0;
let strokeCount    = 0;
let currentHoleIndex = 0;
let animId         = null;
let lastFrameMs    = 0;
let threeReady     = false;
let hudTick        = 0;

// 共有マテリアル（ホール切替のたびに new しない）
const MAT = {};
function initSharedMaterials() {
  if (MAT.fairway) return;
  MAT.fairway = new THREE.MeshLambertMaterial({ color: 0x3a9a4a });
  MAT.green   = new THREE.MeshLambertMaterial({ color: 0x55dd55 });
  MAT.rough   = new THREE.MeshLambertMaterial({ color: 0x2d7a35 });
  MAT.bunker  = new THREE.MeshLambertMaterial({ color: 0xe8d5a3 });
  MAT.trunk   = new THREE.MeshLambertMaterial({ color: 0x7b4f2e });
  MAT.leaves  = new THREE.MeshLambertMaterial({ color: 0x1e6e2e });
  MAT.ball    = new THREE.MeshLambertMaterial({ color: 0xffffff });
  MAT.soil    = new THREE.MeshLambertMaterial({ color: 0x6b5340, side: THREE.DoubleSide });
  MAT.cupInner = new THREE.MeshLambertMaterial({ color: 0x2e2218, side: THREE.DoubleSide });
  MAT.cupLiner = new THREE.MeshLambertMaterial({ color: 0xb8b8b0, side: THREE.DoubleSide });
  MAT.cloud   = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
}
let courseMeshes   = [];
let cameraAngleV   = 0.3;
let cameraDistance = 18;
const CAMERA_FOV_PLAY    = 55;
const CAMERA_FOV_ADDRESS = 58;
//
// ── アドレス・キャラ仕様（ここ以外は触らない：カメラの横ずらし・ホール向き強制など無し）
//   カメラ：打ち出し線 fwd の延長上（ティー側）のみ lookAt はボール
//   キャラ ：全体 yaw = atan2(足元→ボール)+PLAYER_FACE_YAW_FLIP（前後だけ逆なら 0 と π を入れ替え）
//   クラブ ：右腕の手首。アドレス中のみ手首→ボールへローカル軸合わせ（setFromUnitVectors。lookAt は使わない）
// ──
const ADDRESS_CAM_BEHIND_BALL = 5.0;
const ADDRESS_CAM_HEIGHT = 1.12;
/** モデル正面と atan2 が半ズレしているときのみ。試行しない：前後が逆ならこの行だけ 0 ↔ Math.PI */
const PLAYER_FACE_YAW_FLIP = 0;

let shotState   = SHOT_IDLE;
let power       = 0;   // 現在のバー値（0〜100）
let powerDir    = 1;   // 往復方向
let lockedPower = 0;   // ② 確定したパワー値

let cupInProgress   = false;
let cupInTimer      = 0;
const CUP_IN_ROLL_FRAMES    = 22;
const CUP_IN_DROP_FRAMES    = 18;
const CUP_IN_SETTLE_FRAMES  = 10;
const CUP_IN_CAM_FRAMES     = 24;
const CUP_IN_TOTAL_FRAMES   = CUP_IN_ROLL_FRAMES + CUP_IN_DROP_FRAMES + CUP_IN_SETTLE_FRAMES;
const FOG_NEAR_DEFAULT    = 90;
const FOG_FAR_DEFAULT     = 320;
let cupCamFromPos    = null;
let cupCamToPos      = null;
let cupCamFromTarget = null;
let cupCamToTarget   = null;
let ballCupStart     = { x: 0, y: 0, z: 0 };
let holeGreenMesh    = null;
const greenRaycaster = new THREE.Raycaster();
const greenRayOrigin = new THREE.Vector3();
const greenRayDir    = new THREE.Vector3(0, -1, 0);
const FLAG_WIDTH     = 1.2;
const FLAG_HEIGHT    = 0.8;
const FLAG_LOCAL_X   = 0.6;
const FLAG_LOCAL_Y   = 3.8;
const _flagLocalBall = new THREE.Vector3();
const _flagNormal    = new THREE.Vector3();
const _flagWorldPos  = new THREE.Vector3();
const _clubHandW      = new THREE.Vector3();
const _clubBallW      = new THREE.Vector3();
const _clubDirW       = new THREE.Vector3();
const _clubDirLocal   = new THREE.Vector3();
const _clubShaftNegY  = new THREE.Vector3(0, -1, 0);
const _clubQParent    = new THREE.Quaternion();
const _clubQParentInv = new THREE.Quaternion();
const _clubQAlign     = new THREE.Quaternion();
let showingDistance     = false;
let preRetryStrokeCount = 0;
let impactQueued        = false; // インパクト入力を次フレームで確実に処理

// ===== プレイヤー =====
let playerGroup  = null;
let playerParts  = {};
// アドレスの腕ピッチ armsGrp.rotation.x（このモデルは小さいほど前）
const SWING_ADDR = -0.46;
const SWING_BACK = -1.55;   // バックスウィング
const SWING_THRU =  2.7;    // フォロースルー
/** 構え：膝の曲げ（太腿直下 kneeGrp の rotation.x、大きいほどしゃがむ） */
const ADDRESS_KNEE_X = 0.46;
/** 構え：肘の曲げ（肘グループ rotation.x。逆に見えたら符号だけ反転） */
const ADDRESS_ELBOW_X = -0.52;
/** 靴底がローカル y=0 より下のオフセットに合わせる（スケール前・頭半径ベース） */
const PLAYER_SOLE_BELOW_ORIGIN = PLAYER_MODEL_HEAD_R * 0.32 - 0.035;
/** 膝曲げでつま先が沈むときの持ち上げ（ワールド m） */
const ADDRESS_FOOT_EXTRA_LIFT = 0.02;
/** 膝を曲げて足首が浮くときだけ少しプラスで沈める。m 単位 */
const ADDRESS_STANCE_LOWER_Y = 0;
let swingAngle   = SWING_ADDR;
let swingTarget  = SWING_ADDR;

const GRAVITY = -0.018;
const FRICTION = 0.97;
const BOUNCE   = 0.35;
const POLE_RADIUS = 0.05; // ポール半径（m）
// ショット後のボール・カップイン演出の時間倍率（小さいほどゆっくり）
const BALL_FLIGHT_SCALE = 0.68;
const SHOT_DISTANCE_DELAY_MS = 400;

// ===== DOM =====
const titleScreen    = document.getElementById('title-screen');
const gameScreen     = document.getElementById('game-screen');
const startBtn       = document.getElementById('start-btn');
const holeNumEl      = document.getElementById('hole-num');
const parInfoEl      = document.getElementById('par-info');
const strokeEl       = document.getElementById('stroke-count');
const distanceEl     = document.getElementById('distance');
const distanceUnit   = document.getElementById('distance-unit');
const powerBar        = document.getElementById('power-bar');
const powerNeedle     = document.getElementById('power-needle');
const impactMarker    = document.getElementById('impact-marker');
const powerLockMarker = document.getElementById('power-lock-marker');
const powerPhaseLabel = document.getElementById('power-phase-label');
const impactZoneEl    = document.getElementById('impact-zone');
const powerMeterEl    = document.getElementById('power-meter-container');
const shotHintEl      = document.getElementById('shot-hint');
const shotBtn        = document.getElementById('shot-btn');
const dirLeft        = document.getElementById('dir-left');
const dirRight       = document.getElementById('dir-right');
const camUp          = document.getElementById('cam-up');
const camDown        = document.getElementById('cam-down');
const clubPrevBtn    = document.getElementById('club-prev');
const clubNextBtn    = document.getElementById('club-next');
const clubNameEl     = document.getElementById('club-name');
const clubLabelEl    = document.getElementById('club-label');
const powerLabelSpans = document.querySelectorAll('#power-labels span');
const shotEffectEl   = document.getElementById('shot-effect');
const shotDistanceEl = document.getElementById('shot-distance');
const shotDistValue  = document.getElementById('shot-dist-value');
const retryBtn       = document.getElementById('retry-btn');
const nextShotBtn    = document.getElementById('next-shot-btn');
const resultOverlay  = document.getElementById('result-overlay');
const resultTitle    = document.getElementById('result-title');
const resultScore    = document.getElementById('result-score');
const nextHoleBtn    = document.getElementById('next-hole-btn');

retryBtn.addEventListener('click',     e => { e.stopPropagation(); retryShot(); });
retryBtn.addEventListener('touchstart', e => { e.preventDefault(); e.stopPropagation(); retryShot(); }, { passive: false });
nextShotBtn.addEventListener('click',     e => { e.stopPropagation(); if (showingDistance) hideShotDistance(); });
nextShotBtn.addEventListener('touchstart', e => { e.preventDefault(); e.stopPropagation(); if (showingDistance) hideShotDistance(); }, { passive: false });

startBtn.addEventListener('click', () => {
  titleScreen.classList.add('hidden');
  gameScreen.classList.remove('hidden');
  initThree();
  loadHole(0);
});

// ===== Three.js 初期化 =====
function initThree() {
  if (threeReady) return;
  threeReady = true;
  initSharedMaterials();

  const canvas = document.getElementById('game-canvas');
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    powerPreference: 'high-performance',
  });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
  renderer.setClearColor(0x87ceeb, 1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb);
  scene.fog = new THREE.Fog(0x87ceeb, FOG_NEAR_DEFAULT, FOG_FAR_DEFAULT);

  camera = new THREE.PerspectiveCamera(CAMERA_FOV_PLAY, window.innerWidth / window.innerHeight, 0.1, 500);

  scene.add(new THREE.AmbientLight(0xffffff, 0.78));
  scene.add(new THREE.HemisphereLight(0x87ceeb, 0x3a9a4a, 0.35));

  sunLight = new THREE.DirectionalLight(0xfff8e7, 1.0);
  sunLight.position.set(30, 60, 30);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.camera.near = 0.5;
  sunLight.shadow.camera.far = 220;
  const sh = 95;
  sunLight.shadow.camera.left = -sh;
  sunLight.shadow.camera.right = sh;
  sunLight.shadow.camera.top = sh;
  sunLight.shadow.camera.bottom = -sh;
  sunLight.shadow.bias = -0.00015;
  sunLight.shadow.normalBias = 0.035;
  sunLight.shadow.camera.updateProjectionMatrix();
  scene.add(sunLight);

  addClouds();

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
  });
}

// ===== 雲 =====
function addClouds() {
  [[-30,25,-60],[20,28,-80],[-50,22,-50],[40,30,-100],[0,26,-120]].forEach(([x,y,z]) => {
    const g = new THREE.Group();
    [[0,0,0,4],[-4,-1,0,3],[4,-1,0,3],[0,-1,-3,2.5]].forEach(([cx,cy,cz,r]) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(r, 5, 5), MAT.cloud);
      m.position.set(cx,cy,cz);
      g.add(m);
    });
    g.position.set(x,y,z);
    scene.add(g);
  });
}

// ===== ホール読み込み =====
function loadHole(idx) {
  currentHoleIndex = idx;
  strokeCount     = 0;
  ballInFlight    = false;
  cupInProgress   = false;
  cupInTimer      = 0;
  hideCupInEffect();
  if (playerGroup) playerGroup.visible = true;
  gameScreen.classList.remove('cup-in-active');
  cameraAngleV    = 0.3;
  shotStartPos    = { x: 0, z: 0 };
  showingDistance = false;
  shotDistanceEl.classList.add('hidden');
  resetShotState();

  courseMeshes.forEach(m => scene.remove(m));
  courseMeshes = [];
  if (ball)      scene.remove(ball);
  if (holeMesh)  scene.remove(holeMesh);
  if (flagMesh)  scene.remove(flagMesh);
  if (arrowMesh) scene.remove(arrowMesh);
  holeGreenMesh = null;

  const hole = HOLES[idx];
  holeNumEl.textContent = hole.name;
  parInfoEl.textContent = `PAR ${hole.par}`;
  strokeEl.textContent  = '0';

  buildCourse(hole);
  placeBall(hole.ballStart.x, hole.ballStart.z);
  aimAtGreen();
  placeHole(hole.holePos.x, hole.holePos.z);
  buildArrow();
  buildPlayer();
  updateGaugeLabels();
  updateHUD();
  updateShotUI();
  updateFlagVisibility();

  updateArrow();
  updateCamera();
  renderer.render(scene, camera);

  lastFrameMs = 0;
  if (!animId) gameLoop(performance.now());
}

// ===== コース生成 =====
function buildCourse(hole) {
  const W = 30, L = hole.terrain === 'hill' ? 180 : 130;

  const fairway = new THREE.Mesh(buildTerrainGeometry(W, L, hole.terrain), MAT.fairway);
  fairway.receiveShadow = true;
  carveCupOpening(fairway, hole.holePos.x, hole.holePos.z, CUP_RADIUS * 1.15);
  scene.add(fairway);
  courseMeshes.push(fairway);

  // カップ直上を避け、外側だけを明るいグリーンにする（中央に緑の蓋が乗らない）
  const greenY = getGroundY(hole.holePos.z) + 0.003;
  const green = new THREE.Mesh(
    new THREE.RingGeometry(GREEN_INNER_RADIUS, GREEN_OUTER_RADIUS, 48),
    MAT.green
  );
  green.rotation.x = -Math.PI / 2;
  green.position.set(hole.holePos.x, greenY, hole.holePos.z);
  green.receiveShadow = true;
  scene.add(green);
  courseMeshes.push(green);
  holeGreenMesh = green;

  const rough = new THREE.Mesh(new THREE.PlaneGeometry(100, L + 40), MAT.rough);
  rough.receiveShadow = true;
  rough.rotation.x = -Math.PI / 2;
  const roughMidZ = (hole.ballStart.z + hole.holePos.z) / 2;
  rough.position.set(0, -0.02, roughMidZ);
  carveCupOpening(rough, hole.holePos.x, hole.holePos.z - roughMidZ, CUP_RADIUS * 1.12);
  scene.add(rough);
  courseMeshes.push(rough);

  addBunkers(hole);
  addTrees(hole);
}

// フェアウェイがカップ口を塞がないよう、カップ位置の面だけくり抜く（くぼみは付けない）
function carveCupOpening(mesh, cupX, cupZ, radius) {
  const geo = mesh.geometry;
  const pos = geo.attributes.position;
  const r2 = radius * radius;
  const index = geo.index;
  if (!index) {
    geo.computeVertexNormals();
    return;
  }

  const idx = index.array;
  const vA = new THREE.Vector3();
  const vB = new THREE.Vector3();
  const vC = new THREE.Vector3();
  const newIdx = [];

  for (let i = 0; i < index.count; i += 3) {
    const ia = idx[i];
    const ib = idx[i + 1];
    const ic = idx[i + 2];
    vA.fromBufferAttribute(pos, ia);
    vB.fromBufferAttribute(pos, ib);
    vC.fromBufferAttribute(pos, ic);
    const cx = (vA.x + vB.x + vC.x) / 3;
    const cz = (vA.z + vB.z + vC.z) / 3;
    const dx = cx - cupX;
    const dz = cz - cupZ;
    if (dx * dx + dz * dz < r2) continue;
    newIdx.push(ia, ib, ic);
  }

  geo.setIndex(newIdx);
  geo.computeVertexNormals();
}

function buildTerrainGeometry(W, L, type) {
  const geo = new THREE.PlaneGeometry(W, L, 12, 24);
  geo.rotateX(-Math.PI / 2);
  if (type === 'slope') {
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setY(i, pos.getZ(i) * -0.04);
    pos.needsUpdate = true;
    geo.computeVertexNormals();
  } else if (type === 'hill') {
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++)
      pos.setY(i, Math.sin((pos.getZ(i) / L) * Math.PI * 2) * 3);
    pos.needsUpdate = true;
    geo.computeVertexNormals();
  }
  return geo;
}

function addBunkers(hole) {
  const mid = (hole.ballStart.z + hole.holePos.z) / 2;
  [[8, mid - 10], [-8, mid + 10]].forEach(([x, z]) => {
    const mesh = new THREE.Mesh(new THREE.CircleGeometry(1, 12), MAT.bunker);
    mesh.receiveShadow = true;
    mesh.scale.set(4, 3, 1);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.02, z);
    scene.add(mesh);
    courseMeshes.push(mesh);
  });
}

function addTrees(hole) {
  const mid = (hole.ballStart.z + hole.holePos.z) / 2;
  [[16,mid-20],[-16,mid-10],[17,mid+15],[-17,mid+5],[15,mid-35],[-15,mid+30]].forEach(([x,z]) => {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.5, 3, 6), MAT.trunk);
    trunk.castShadow = true;
    trunk.receiveShadow = true;
    trunk.position.set(x, 1.5, z);
    scene.add(trunk);
    courseMeshes.push(trunk);

    const leaves = new THREE.Mesh(new THREE.ConeGeometry(2.5, 5, 6), MAT.leaves);
    leaves.castShadow = true;
    leaves.receiveShadow = true;
    leaves.position.set(x, 6, z);
    scene.add(leaves);
    courseMeshes.push(leaves);
  });
}

// ===== ボール配置 =====
function placeBall(x, z) {
  ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_RADIUS, 12, 12), MAT.ball);
  ball.visible = true;
  ball.scale.setScalar(1);
  ballPos = { x, y: BALL_RADIUS, z };
  ball.position.set(x, BALL_RADIUS, z);
  ball.castShadow = true;
  ball.receiveShadow = true;
  scene.add(ball);
}

// ===== ホール＆フラッグ =====
// 穴口（暗い円）→ 漏斗内壁 → ライナー → 底面
function placeHole(x, z) {
  holeMesh = new THREE.Group();

  // 地面の穴口（#2e2218）。低いカメラ角でも「緑の蓋」に見えない
  const cupOpening = new THREE.Mesh(
    new THREE.CircleGeometry(CUP_RADIUS * 0.98, 32),
    MAT.cupInner
  );
  cupOpening.rotation.x = -Math.PI / 2;
  cupOpening.position.y = 0.002;
  holeMesh.add(cupOpening);

  const cupWell = new THREE.Mesh(
    new THREE.CylinderGeometry(
      CUP_RADIUS * 0.98,
      CUP_LINER_RADIUS * 0.9,
      CUP_TOTAL_DEPTH,
      24, 1, true
    ),
    MAT.cupInner
  );
  cupWell.position.y = -CUP_TOTAL_DEPTH / 2;
  holeMesh.add(cupWell);

  const linerSection = new THREE.Mesh(
    new THREE.CylinderGeometry(
      CUP_LINER_RADIUS * 0.9,
      CUP_LINER_RADIUS * 0.85,
      CUP_LINER_DEPTH * 0.55,
      16, 1, true
    ),
    MAT.cupLiner
  );
  linerSection.position.y = -CUP_SOIL_DEPTH - CUP_LINER_DEPTH * 0.28;
  holeMesh.add(linerSection);

  const linerBottom = new THREE.Mesh(
    new THREE.CircleGeometry(CUP_LINER_RADIUS * 0.85, 16),
    MAT.cupLiner
  );
  linerBottom.rotation.x = -Math.PI / 2;
  linerBottom.position.y = -CUP_TOTAL_DEPTH + 0.006;
  holeMesh.add(linerBottom);

  const drain = new THREE.Mesh(
    new THREE.CircleGeometry(CUP_LINER_RADIUS * 0.12, 12),
    new THREE.MeshLambertMaterial({ color: 0x111111 })
  );
  drain.rotation.x = -Math.PI / 2;
  drain.position.y = -CUP_TOTAL_DEPTH + 0.007;
  holeMesh.add(drain);

  holeMesh.position.set(x, getGroundY(z), z);
  holeMesh.traverse(obj => {
    if (obj.isMesh) obj.receiveShadow = true;
  });
  scene.add(holeMesh);

  flagMesh = new THREE.Group();
  flagPolePart = new THREE.Mesh(
    new THREE.CylinderGeometry(POLE_RADIUS, POLE_RADIUS, 4, 8),
    new THREE.MeshLambertMaterial({ color: 0xcccccc })
  );
  flagPolePart.position.y = 2;
  flagMesh.add(flagPolePart);

  flagClothPart = new THREE.Mesh(
    new THREE.PlaneGeometry(FLAG_WIDTH, FLAG_HEIGHT),
    new THREE.MeshLambertMaterial({ color: 0xff2222, side: THREE.DoubleSide })
  );
  flagClothPart.position.set(FLAG_LOCAL_X, FLAG_LOCAL_Y, 0);
  flagMesh.add(flagClothPart);

  flagMesh.position.set(x, getGroundY(z), z);
  scene.add(flagMesh);
}

// ===== 方向矢印 =====
function buildArrow() {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0.6);
  shape.lineTo(0.25, -0.2);
  shape.lineTo(0, 0.1);
  shape.lineTo(-0.25, -0.2);
  shape.closePath();
  arrowMesh = new THREE.Mesh(
    new THREE.ShapeGeometry(shape),
    new THREE.MeshBasicMaterial({ color: 0xffff00, side: THREE.DoubleSide })
  );
  arrowMesh.rotation.x = -Math.PI / 2;
  arrowMesh.scale.setScalar(0.35);
  arrowMesh.position.y = BALL_RADIUS + 0.08;
  scene.add(arrowMesh);
}

// ===== プレイヤー（キャラ）— 向き・腕・クラブはここから追う =====
//   buildPlayer → updatePlayerTransform → updatePlayer
//   クラブ向き: updateClubAddressOrientation ／ カメラ: updateAddressCamera
function buildPlayer() {
  if (playerGroup) scene.remove(playerGroup);
  playerParts = {};
  swingAngle = swingTarget = SWING_ADDR;
  playerGroup = new THREE.Group();

  const mSkin  = new THREE.MeshLambertMaterial({ color: 0xffbb88 });
  const mShirt = new THREE.MeshLambertMaterial({ color: 0x1155ee });
  const mPants = new THREE.MeshLambertMaterial({ color: 0x1a2a44 });
  const mShoe  = new THREE.MeshLambertMaterial({ color: 0x221100 });
  const mCap   = new THREE.MeshLambertMaterial({ color: 0xdd2200 });
  const mGlove = new THREE.MeshLambertMaterial({ color: 0xf0f0f0 });
  const mShaft = new THREE.MeshLambertMaterial({ color: 0xc0c0c0 });
  const mClub  = new THREE.MeshLambertMaterial({ color: 0x777777 });
  const mEye   = new THREE.MeshLambertMaterial({ color: 0x1a1a22 });

  function mk(geo, mat, px, py, pz) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(px || 0, py || 0, pz || 0);
    return m;
  }
  const B = (w,h,d) => new THREE.BoxGeometry(w, h, d);
  const C = (rt,rb,h,s) => new THREE.CylinderGeometry(rt, rb, h, s);
  const Sp = (r,s) => new THREE.SphereGeometry(r, s, s);

  const hr = PLAYER_MODEL_HEAD_R;
  const legH = hr * 2.6;
  const hipY = 0.035 + legH + 0.11;
  const uLegH = legH * 0.54;
  const lLegH = legH * 0.46;
  const hipLineY = 0.035 + legH;

  function buildLeg(side) {
    const sx = side * hr * 0.65;
    const legRoot = new THREE.Group();
    legRoot.position.set(sx, hipLineY, 0);
    playerGroup.add(legRoot);
    legRoot.add(mk(C(hr * 0.42, hr * 0.38, uLegH, 8), mPants, 0, -uLegH * 0.5, 0));
    const kneeGrp = new THREE.Group();
    kneeGrp.position.set(0, -uLegH, 0);
    kneeGrp.rotation.x = ADDRESS_KNEE_X;
    legRoot.add(kneeGrp);
    kneeGrp.add(mk(C(hr * 0.39, hr * 0.36, lLegH, 8), mPants, 0, -lLegH * 0.5, 0));
    kneeGrp.add(mk(B(hr * 0.65, hr * 0.32, hr * 1.1), mShoe, 0, -lLegH - hr * 0.16, hr * 0.18));
    if (side < 0) {
      playerParts.lLegRoot = legRoot;
      playerParts.lKneeGrp = kneeGrp;
    } else {
      playerParts.rLegRoot = legRoot;
      playerParts.rKneeGrp = kneeGrp;
    }
  }
  buildLeg(-1);
  buildLeg(1);

  playerGroup.add(mk(B(hr * 1.95, hr * 1.0, hr * 1.2), mPants, 0, hipY));

  const bodyGrp = new THREE.Group();
  bodyGrp.position.set(0, hipY + hr * 0.35, 0);
  bodyGrp.rotation.x = 0;
  playerGroup.add(bodyGrp);
  playerParts.bodyGrp = bodyGrp;

  bodyGrp.add(mk(B(hr * 2.0, hr * 2.35, hr * 1.25), mShirt, 0, hr * 1.15));
  bodyGrp.add(mk(C(hr * 0.34, hr * 0.32, hr * 0.55, 8), mSkin, 0, hr * 2.65));
  const headMesh = mk(Sp(hr, 14), mSkin, 0, hr * 3.55);
  bodyGrp.add(headMesh);
  playerParts.headMesh = headMesh;
  // 目（頭の +Z 側＝ボール向きと揃えやすい）
  const eyeR = hr * 0.11;
  bodyGrp.add(mk(Sp(eyeR, 8), mEye, -hr * 0.36, hr * 3.62, hr * 0.82));
  bodyGrp.add(mk(Sp(eyeR, 8), mEye,  hr * 0.36, hr * 3.62, hr * 0.82));
  bodyGrp.add(mk(Sp(hr * 0.3, 6), mSkin, -hr * 1.0, hr * 3.55));
  bodyGrp.add(mk(Sp(hr * 0.3, 6), mSkin,  hr * 1.0, hr * 3.55));
  bodyGrp.add(mk(C(hr * 0.68, hr * 1.05, hr * 1.0, 8), mCap, 0, hr * 4.45));
  bodyGrp.add(mk(C(hr * 1.35, hr * 1.35, hr * 0.18, 12), mCap, hr * 0.32, hr * 4.05));

  const armsGrp = new THREE.Group();
  armsGrp.position.set(0, hr * 1.95, 0);
  bodyGrp.add(armsGrp);
  playerParts.armsGrp = armsGrp;

  const uArmLen = hr * 1.1;
  const foreLen = hr * 1.86;

  const lArmGrp = new THREE.Group();
  lArmGrp.position.set(-hr * 1.28, 0, 0);
  armsGrp.add(lArmGrp);
  playerParts.lArmGrp = lArmGrp;
  lArmGrp.add(mk(C(hr * 0.33, hr * 0.3, uArmLen, 8), mShirt, 0, -uArmLen * 0.52, 0));
  const lElbowGrp = new THREE.Group();
  lElbowGrp.position.set(0, -uArmLen, 0);
  lElbowGrp.rotation.x = ADDRESS_ELBOW_X;
  lArmGrp.add(lElbowGrp);
  playerParts.lElbowGrp = lElbowGrp;
  lElbowGrp.add(mk(C(hr * 0.28, hr * 0.25, foreLen, 8), mSkin, 0, -foreLen * 0.5, 0));
  lElbowGrp.add(mk(Sp(hr * 0.36, 8), mGlove, 0, -foreLen * 0.94, 0));

  const rArmGrp = new THREE.Group();
  rArmGrp.position.set(hr * 1.28, 0, 0);
  armsGrp.add(rArmGrp);
  playerParts.rArmGrp = rArmGrp;
  rArmGrp.add(mk(C(hr * 0.33, hr * 0.3, uArmLen, 8), mShirt, 0, -uArmLen * 0.52, 0));
  const rElbowGrp = new THREE.Group();
  rElbowGrp.position.set(0, -uArmLen, 0);
  rElbowGrp.rotation.x = ADDRESS_ELBOW_X;
  rArmGrp.add(rElbowGrp);
  playerParts.rElbowGrp = rElbowGrp;
  rElbowGrp.add(mk(C(hr * 0.28, hr * 0.25, foreLen, 8), mSkin, 0, -foreLen * 0.5, 0));
  rElbowGrp.add(mk(Sp(hr * 0.36, 8), mGlove, 0, -foreLen * 0.94, 0));

  const clubGrp = new THREE.Group();
  clubGrp.position.set(0, -foreLen * 0.88, 0);
  clubGrp.quaternion.identity();
  rElbowGrp.add(clubGrp);
  playerParts.clubGrp = clubGrp;
  clubGrp.add(mk(C(hr * 0.08, hr * 0.07, hr * 4.9, 6), mShaft, 0, -hr * 2.45));
  clubGrp.add(mk(B(hr * 0.22, hr * 0.45, hr * 0.4), mClub, 0, -hr * 5.0, hr * 0.08));

  armsGrp.rotation.x = SWING_ADDR;

  // 全高 = 頭直径 × 5（5頭身）
  playerGroup.scale.setScalar(PLAYER_HEIGHT / (PLAYER_HEADS * PLAYER_MODEL_HEAD_R * 2));
  playerGroup.traverse(obj => {
    if (obj.isMesh) {
      obj.castShadow = true;
      obj.receiveShadow = false;
    }
  });
  scene.add(playerGroup);
  updatePlayerTransform();
}

function getShotBasis() {
  return {
    fwd:   { x: Math.sin(shotDirection), z: -Math.cos(shotDirection) },
    right: { x: Math.cos(shotDirection), z: Math.sin(shotDirection) },
  };
}

function aimAtGreen() {
  const hole = HOLES[currentHoleIndex];
  const dx = hole.holePos.x - ballPos.x;
  const dz = hole.holePos.z - ballPos.z;
  shotDirection = Math.atan2(dx, -dz);
}

function getPlayerFeetAlignY(groundY) {
  if (!playerGroup) return groundY - ADDRESS_STANCE_LOWER_Y;
  const lift =
    PLAYER_SOLE_BELOW_ORIGIN * playerGroup.scale.x + ADDRESS_FOOT_EXTRA_LIFT;
  return groundY + lift - ADDRESS_STANCE_LOWER_Y;
}

function updatePlayerTransform() {
  if (!playerGroup) return;
  const { right } = getShotBasis();
  const stanceR = PLAYER_HEIGHT * 0.33;
  const groundY = getGroundY(ballPos.z);
  const feetY = getPlayerFeetAlignY(groundY);
  // 右打ち：ボールの左側
  playerGroup.position.set(
    ballPos.x - right.x * stanceR,
    feetY,
    ballPos.z - right.z * stanceR
  );
  const px = playerGroup.position.x;
  const pz = playerGroup.position.z;
  const dx = ballPos.x - px;
  const dz = ballPos.z - pz;
  playerGroup.rotation.y = Math.atan2(dx, dz) + PLAYER_FACE_YAW_FLIP;
}

/** アドレス中のみ：シャフト（ローカル −Y）を手首からボールへ向ける */
function updateClubAddressOrientation() {
  const club = playerParts.clubGrp;
  if (!club || !playerGroup) return;
  if (ballInFlight || cupInProgress || showingDistance) return;
  if (shotState !== SHOT_IDLE && shotState !== SHOT_POWER) return;

  club.updateMatrixWorld(true);
  club.getWorldPosition(_clubHandW);
  _clubBallW.set(ballPos.x, ballPos.y, ballPos.z);
  _clubDirW.subVectors(_clubBallW, _clubHandW);
  const len = _clubDirW.length();
  if (len < 1e-5) return;
  _clubDirW.multiplyScalar(1 / len);

  const arm = club.parent;
  if (!arm) return;
  arm.updateMatrixWorld(true);
  arm.getWorldQuaternion(_clubQParent);
  _clubQParentInv.copy(_clubQParent).invert();
  _clubDirLocal.copy(_clubDirW).applyQuaternion(_clubQParentInv);

  _clubQAlign.setFromUnitVectors(_clubShaftNegY, _clubDirLocal);
  if (!Number.isFinite(_clubQAlign.x + _clubQAlign.y + _clubQAlign.z + _clubQAlign.w)) return;
  club.quaternion.copy(_clubQAlign);
}

function updatePlayer(dt) {
  if (!playerGroup) return;

  if (!ballInFlight && (shotState === SHOT_IDLE || shotState === SHOT_POWER)) {
    updatePlayerTransform();
    swingTarget = SWING_ADDR;
    if (playerParts.bodyGrp) playerParts.bodyGrp.rotation.y = 0;
  } else {
    if (playerParts.lArmGrp) playerParts.lArmGrp.rotation.y = 0;
    if (playerParts.rArmGrp) playerParts.rArmGrp.rotation.y = 0;
  }

  if (shotState === SHOT_SWING) {
    const t = Math.min(1, (power - lockedPower) / Math.max(1, 100 - lockedPower));
    swingTarget = SWING_ADDR + (SWING_BACK - SWING_ADDR) * t;
    if (playerParts.bodyGrp) playerParts.bodyGrp.rotation.y = t * 0.4;
  }

  if (shotState === SHOT_RETURN) {
    const t = 1 - power / 100;
    swingTarget = SWING_BACK + (SWING_THRU - SWING_BACK) * t;
    if (playerParts.bodyGrp) playerParts.bodyGrp.rotation.y = (1 - t) * 0.4;
  }

  if (ballInFlight) swingTarget = SWING_THRU;

  const atAddressReady =
    !ballInFlight &&
    !cupInProgress &&
    !showingDistance &&
    (shotState === SHOT_IDLE || shotState === SHOT_POWER);
  if (atAddressReady) {
    swingAngle = SWING_ADDR;
    swingTarget = SWING_ADDR;
  }

  swingAngle += (swingTarget - swingAngle) * (ballInFlight ? 0.04 : 0.16) * dt;
  if (playerParts.armsGrp) playerParts.armsGrp.rotation.x = swingAngle;

  if (
    !ballInFlight &&
    (shotState === SHOT_IDLE || shotState === SHOT_POWER) &&
    !cupInProgress &&
    !showingDistance
  ) {
    updateClubAddressOrientation();
  } else if (playerParts.clubGrp) {
    playerParts.clubGrp.quaternion.identity();
  }

  if (shotState === SHOT_IDLE && !ballInFlight) {
    playerGroup.position.y =
      getPlayerFeetAlignY(getGroundY(ballPos.z)) +
      Math.sin(Date.now() * 0.0016) * 0.012;
  }
}

function updateArrow() {
  if (!arrowMesh || !ball) return;
  const dist = BALL_RADIUS * 9;
  arrowMesh.position.x = ballPos.x + Math.sin(shotDirection) * dist;
  arrowMesh.position.z = ballPos.z - Math.cos(shotDirection) * dist;
  arrowMesh.position.y = BALL_RADIUS + 0.08;
  arrowMesh.rotation.z = -shotDirection;
}

// ===== HUD =====
function updateHUD() {
  strokeEl.textContent = strokeCount;
  const hole = HOLES[currentHoleIndex];
  const dx = ballPos.x - hole.holePos.x;
  const dz = ballPos.z - hole.holePos.z;
  const distUnits = Math.round(Math.sqrt(dx * dx + dz * dz));
  if (isPutterClub()) {
    // パターはメートル表示
    distanceEl.textContent = distUnits;
    distanceUnit.textContent = 'm';
  } else {
    // それ以外はヤード換算（1単位≒2.5yd）
    distanceEl.textContent = Math.round(distUnits * 1.3);
    distanceUnit.textContent = 'yd';
  }
}

// ===== カメラ =====
function setCameraFov(fov) {
  if (camera.fov === fov) return;
  camera.fov = fov;
  camera.updateProjectionMatrix();
}

function isAddressCameraActive() {
  return !ballInFlight && !cupInProgress && !showingDistance;
}

function updateAddressCamera() {
  const { fwd } = getShotBasis();
  const putt = isPutterClub();
  const backD  = putt ? 2.4 : ADDRESS_CAM_BEHIND_BALL;
  const height = (putt ? 0.9 : ADDRESS_CAM_HEIGHT) + (cameraAngleV - 0.3) * 2;
  const groundY = getGroundY(ballPos.z);
  const lookY = groundY + BALL_RADIUS;

  // 打ち出し線そのもの（ボール〜ホール）の延長上、ティー側。斜め見せはしない。
  camera.position.set(
    ballPos.x - fwd.x * backD,
    groundY + height,
    ballPos.z - fwd.z * backD
  );
  camera.lookAt(ballPos.x, lookY, ballPos.z);
  setCameraFov(putt ? 52 : CAMERA_FOV_ADDRESS);
}

function updateFollowCamera() {
  const cx = ballPos.x - Math.sin(shotDirection) * cameraDistance * Math.cos(cameraAngleV);
  const cy = ballPos.y + cameraDistance * Math.sin(cameraAngleV);
  const cz = ballPos.z + Math.cos(shotDirection) * cameraDistance * Math.cos(cameraAngleV);
  camera.position.set(cx, cy, cz);
  const rx = Math.cos(shotDirection) * 0.4;
  const rz = Math.sin(shotDirection) * 0.4;
  camera.lookAt(ballPos.x + rx, ballPos.y + 0.9, ballPos.z + rz);
  setCameraFov(CAMERA_FOV_PLAY);
}

function updateCamera() {
  if (isAddressCameraActive()) updateAddressCamera();
  else updateFollowCamera();
}

function isPutterClub() {
  return CLUBS[currentClub].name === 'PT';
}

function isBallOnGreen() {
  if (!holeGreenMesh || ballInFlight) return false;

  greenRayOrigin.set(ballPos.x, ballPos.y + 0.5, ballPos.z);
  greenRaycaster.set(greenRayOrigin, greenRayDir);
  const hit = greenRaycaster.intersectObject(holeGreenMesh, false)[0];
  if (!hit) return false;
  // ボールの真下近くでグリーン面に当たっている＝グリーン上
  return hit.distance <= ballPos.y + 0.12;
}

function updateFlagVisibility() {
  if (!flagMesh) return;
  flagMesh.visible = !cupInProgress && !isBallOnGreen();
}

function updateShotUI() {
  const putt = isPutterClub();
  powerMeterEl.classList.toggle('putter-mode', putt);
  if (shotState === SHOT_IDLE) {
    shotBtn.textContent = '① スタート';
    powerPhaseLabel.textContent = '待機中';
  }
  if (shotHintEl) {
    shotHintEl.textContent = putt
      ? '[ SPACE ] パワー決定で打つ　クラブ: Q / E'
      : '[ SPACE ] or タップ　クラブ: Q / E';
  }
}

// ===== ショット状態リセット =====
function resetShotState() {
  shotState    = SHOT_IDLE;
  impactQueued = false;
  power       = 0;
  powerDir    = 1;
  lockedPower = 0;
  powerBar.style.width           = '0%';
  powerNeedle.style.display       = 'none';
  impactZoneEl.classList.remove('active');
  updateShotUI();
}

// インパクト入力（キー／ボタン）をフレーム更新より先に処理する
function processImpactInput() {
  if (!impactQueued || shotState !== SHOT_RETURN || ballInFlight) return;
  impactQueued = false;
  shotState = SHOT_IDLE;
  fireShot(power);
}

function queueImpact() {
  if (ballInFlight || showingDistance || isPutterClub()) return;
  if (shotState === SHOT_RETURN) {
    impactQueued = true;
  }
}

// ===== 3段階ショットアクション =====
function nextShotAction() {
  if (ballInFlight) return;

  if (showingDistance) {
    hideShotDistance();
    return;
  }

  if (shotState === SHOT_RETURN) {
    queueImpact();
    return;
  }

  if (shotState === SHOT_SWING) {
    power = 100;
    shotState = SHOT_RETURN;
    impactZoneEl.classList.add('active');
    return;
  }

  if (shotState === SHOT_IDLE) {
    impactMarker.style.display    = 'none';
    powerLockMarker.style.display = 'none';
    shotState = SHOT_POWER;
    power     = isPutterClub() ? 0 : IMPACT_ZONE;
    powerDir  = 1;
    powerBar.style.width      = '0%';
    powerNeedle.style.display = 'block';
    powerNeedle.style.left    = power + '%';
    powerPhaseLabel.textContent = 'パワーを決めろ！';
    shotBtn.textContent = isPutterClub() ? '② ショット' : '② パワー確定';

  } else if (shotState === SHOT_POWER) {
    lockedPower = power;
    powerLockMarker.style.left    = lockedPower + '%';
    powerLockMarker.style.display = 'block';

    if (isPutterClub()) {
      shotState = SHOT_IDLE;
      fireShot(IMPACT_ZONE);
      return;
    }

    shotState   = SHOT_SWING;
    powerDir    = 1;
    powerPhaseLabel.textContent = '⚡ インパクト！';
    shotBtn.textContent = '③ インパクト！';
  }
}

// ===== ショットエフェクト =====
function showShotEffect(text, color) {
  shotEffectEl.textContent  = text;
  shotEffectEl.style.color  = color;
  shotEffectEl.style.textShadow = `0 0 24px ${color}, 0 0 50px ${color}, 2px 2px 0 rgba(0,0,0,0.6)`;
  shotEffectEl.classList.remove('show');
  void shotEffectEl.offsetWidth; // reflow で再アニメーション
  shotEffectEl.classList.add('show');
}

// ===== 飛距離表示 =====
function showShotDistance() {
  const dx = ballPos.x - shotStartPos.x;
  const dz = ballPos.z - shotStartPos.z;
  const distUnits = Math.sqrt(dx * dx + dz * dz);
  const distText = isPutterClub()
    ? Math.round(distUnits) + 'm'
    : Math.round(distUnits * 1.3) + 'yd';
  shotDistValue.textContent = distText;
  shotDistanceEl.classList.remove('hidden');
  showingDistance = true;
}

function hideShotDistance() {
  shotDistanceEl.classList.add('hidden');
  showingDistance = false;
}

function retryShot() {
  hideShotDistance();
  ballPos      = { x: shotStartPos.x, y: BALL_RADIUS, z: shotStartPos.z };
  ballVel      = { x: 0, y: 0, z: 0 };
  ballInFlight = false;
  strokeCount  = preRetryStrokeCount;
  ball.position.set(ballPos.x, ballPos.y, ballPos.z);
  ball.scale.setScalar(1);
  ball.visible = true;
  updateHUD();
  if (strokeCount >= 1) aimAtHole();
  updatePlayerTransform();
}

// ===== ショット発射 =====
// impactValue: ③ 押した瞬間の power 値（IMPACT_ZONE±IMPACT_HALF=エリア内）
function fireShot(impactValue) {
  impactZoneEl.classList.remove('active');
  powerNeedle.style.display = 'none';
  powerBar.style.width      = '0%';

  const isPutter = isPutterClub();

  if (!isPutter) {
    const zoneMin = IMPACT_ZONE - IMPACT_HALF;
    const zoneMax = IMPACT_ZONE + IMPACT_HALF;
    if (impactValue < zoneMin || impactValue > zoneMax) {
      strokeCount++;
      updateHUD();
      powerPhaseLabel.textContent = '💨 空振り！';
      impactMarker.style.left              = impactValue + '%';
      impactMarker.style.display           = 'block';
      impactMarker.style.borderBottomColor = '#ff4b4b';
      impactMarker.style.filter            = 'drop-shadow(0 0 4px #ff4b4b)';
      setTimeout(() => resetShotState(), 1200);
      return;
    }
  }

  const club  = CLUBS[currentClub];
  const speed = club.speed * Math.sqrt(lockedPower / 100);

  let curve = 0;
  let fantastic = false;
  if (!isPutter) {
    const offset    = impactValue - IMPACT_ZONE;
    const linearDev = offset / IMPACT_HALF;
    const absLinear = Math.abs(linearDev);
    const curveDev  = Math.sign(linearDev) * linearDev * linearDev;
    curve           = curveDev * speed * 0.25;
    fantastic       = absLinear <= 0.35;
  } else {
    fantastic = lockedPower >= 90;
  }

  const perpX = Math.cos(shotDirection);
  const perpZ = Math.sin(shotDirection);

  ballVel.x = Math.sin(shotDirection) * speed + perpX * curve;
  ballVel.y = speed * club.loft;
  ballVel.z = -Math.cos(shotDirection) * speed + perpZ * curve;

  shotStartPos        = { x: ballPos.x, z: ballPos.z };
  preRetryStrokeCount = strokeCount;
  ballInFlight        = true;
  strokeCount++;
  updateHUD();

  const effectText  = fantastic ? 'FANTASTIC !!' : 'NICE SHOT !!';
  const effectColor = fantastic ? '#ffe566'       : '#4cff72';

  powerPhaseLabel.textContent = effectText;
  showShotEffect(effectText, effectColor);

  if (!isPutter) {
    impactMarker.style.left              = impactValue + '%';
    impactMarker.style.display           = 'block';
    impactMarker.style.borderBottomColor = effectColor;
    impactMarker.style.filter            = `drop-shadow(0 0 4px ${effectColor})`;
  }
  setTimeout(() => resetShotState(), 1200);
}

// ===== フレームごとのバー更新 =====
function updateShotMeters(dt) {
  if (shotState === SHOT_POWER) {
    power += powerDir * POWER_SPEED * dt;
    if (isPutterClub()) {
      if (power >= 100) { power = 100; powerDir = -1; }
      if (power <= 0)   { power = 0;   powerDir =  1; }
    } else {
      if (power >= 100)         { power = 100;        powerDir = -1; }
      if (power <= IMPACT_ZONE) { power = IMPACT_ZONE; powerDir =  1; }
    }
    powerBar.style.width   = power + '%';
    powerNeedle.style.left = power + '%';
  }

  if (shotState === SHOT_SWING && !isPutterClub()) {
    // パワー確定後、100%まで振り切る
    power += POWER_SPEED * 1.5 * dt;
    if (power >= 100) {
      power     = 100;
      shotState = SHOT_RETURN;
      impactZoneEl.classList.add('active'); // インパクトエリア点滅開始
    }
    powerBar.style.width   = power + '%';
    powerNeedle.style.left = power + '%';
  }

  if (shotState === SHOT_RETURN && !isPutterClub()) {
    power -= RETURN_SPEED * dt;
    if (power <= 0) {
      power = 0;
      if (!impactQueued) {
        shotState = SHOT_IDLE;
        fireShot(power);
      }
    }
    powerBar.style.width   = power + '%';
    powerNeedle.style.left = power + '%';
  }
}

// ===== 旗竿・旗の当たり判定 =====
function isNearCupForFlagHit() {
  const hole = HOLES[currentHoleIndex];
  return Math.hypot(ballPos.x - hole.holePos.x, ballPos.z - hole.holePos.z) < CUP_CAPTURE_RADIUS;
}

function checkPoleCollision() {
  if (!flagMesh || !flagMesh.visible || isNearCupForFlagHit()) return;

  const px = flagMesh.position.x;
  const pz = flagMesh.position.z;
  const dx = ballPos.x - px;
  const dz = ballPos.z - pz;
  const distXZ = Math.hypot(dx, dz);
  if (distXZ < 1e-6) return;

  const threshold = POLE_RADIUS + BALL_RADIUS;
  if (distXZ < threshold && ballPos.y > 0 && ballPos.y < 4.5) {
    const nx = dx / distXZ;
    const nz = dz / distXZ;
    const dot = ballVel.x * nx + ballVel.z * nz;
    if (dot < 0) {
      ballVel.x = (ballVel.x - 2 * dot * nx) * 0.55;
      ballVel.z = (ballVel.z - 2 * dot * nz) * 0.55;
    }
    ballPos.x = px + nx * (threshold + 0.02);
    ballPos.z = pz + nz * (threshold + 0.02);
  }
}

function checkFlagClothCollision() {
  if (!flagMesh || !flagMesh.visible || !flagClothPart || isNearCupForFlagHit()) return;

  _flagLocalBall.set(ballPos.x, ballPos.y, ballPos.z);
  flagMesh.worldToLocal(_flagLocalBall);

  const pad = BALL_RADIUS + 0.03;
  const halfW = FLAG_WIDTH * 0.5 + pad;
  const halfH = FLAG_HEIGHT * 0.5 + pad;
  if (Math.abs(_flagLocalBall.z) > pad) return;
  if (_flagLocalBall.x < FLAG_LOCAL_X - halfW || _flagLocalBall.x > FLAG_LOCAL_X + halfW) return;
  if (_flagLocalBall.y < FLAG_LOCAL_Y - halfH || _flagLocalBall.y > FLAG_LOCAL_Y + halfH) return;

  const side = _flagLocalBall.z >= 0 ? 1 : -1;
  _flagNormal.set(0, 0, side).transformDirection(flagMesh.matrixWorld).normalize();
  const dot = ballVel.x * _flagNormal.x + ballVel.y * _flagNormal.y + ballVel.z * _flagNormal.z;
  if (dot < 0) {
    ballVel.x = (ballVel.x - 2 * dot * _flagNormal.x) * 0.55;
    ballVel.y = (ballVel.y - 2 * dot * _flagNormal.y) * 0.55;
    ballVel.z = (ballVel.z - 2 * dot * _flagNormal.z) * 0.55;
  }

  _flagWorldPos.set(FLAG_LOCAL_X, FLAG_LOCAL_Y, 0).applyMatrix4(flagMesh.matrixWorld);
  const ox = ballPos.x - _flagWorldPos.x;
  const oy = ballPos.y - _flagWorldPos.y;
  const oz = ballPos.z - _flagWorldPos.z;
  const distN = ox * _flagNormal.x + oy * _flagNormal.y + oz * _flagNormal.z;
  const push = pad - Math.abs(distN);
  if (push > 0) {
    const sign = distN >= 0 ? 1 : -1;
    ballPos.x += _flagNormal.x * sign * push;
    ballPos.y += _flagNormal.y * sign * push;
    ballPos.z += _flagNormal.z * sign * push;
  }
}

function checkFlagObstacleCollision() {
  checkPoleCollision();
  checkFlagClothCollision();
}

// ===== カップイン演出（寄りカメラ・ボール沈み） =====
function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function easeInQuad(t) {
  return t * t;
}

function lerpVal(a, b, t) {
  return a + (b - a) * t;
}

function getBallSurfaceY(x, z) {
  return getGroundY(z) + BALL_RADIUS;
}

function getCupLinerTopY() {
  const hole = HOLES[currentHoleIndex];
  return getGroundY(hole.holePos.z) - CUP_SOIL_DEPTH;
}

function getCupBottomY() {
  const hole = HOLES[currentHoleIndex];
  return getGroundY(hole.holePos.z) - CUP_TOTAL_DEPTH + BALL_RADIUS;
}

function cupMouthRadius() {
  return Math.max(BALL_RADIUS * 0.5, CUP_RADIUS - BALL_RADIUS * 0.9);
}

function setupCupInCamera() {
  const hole = HOLES[currentHoleIndex];
  const hx = hole.holePos.x;
  const hz = hole.holePos.z;

  if (!cupCamFromPos) {
    cupCamFromPos    = new THREE.Vector3();
    cupCamToPos      = new THREE.Vector3();
    cupCamFromTarget = new THREE.Vector3();
    cupCamToTarget   = new THREE.Vector3();
  }

  cupCamFromPos.copy(camera.position);
  const lookDir = new THREE.Vector3();
  camera.getWorldDirection(lookDir);
  cupCamFromTarget.copy(camera.position).add(lookDir.multiplyScalar(12));

  // 斜め前方 — カップ縁とボールが見える高さ（穴の底は見ない）
  const groundY = getGroundY(hz);
  const camHoriz = CUP_RADIUS * 3.2;
  const camHeight = CUP_RADIUS * 2.2;
  cupCamToPos.set(hx + camHoriz * 0.65, camHeight, hz + camHoriz * 0.85);
  cupCamToTarget.set(hx, groundY + BALL_RADIUS * 0.4, hz);
}

function updateCupInCamera(t, lookAtY) {
  const e = easeInOutCubic(Math.min(1, Math.max(0, t)));
  camera.position.lerpVectors(cupCamFromPos, cupCamToPos, e);
  const look = new THREE.Vector3().lerpVectors(cupCamFromTarget, cupCamToTarget, e);
  if (lookAtY !== undefined) look.y = lookAtY;
  camera.lookAt(look);
}

function showCupInEffect() {
  gameScreen.classList.add('cup-in-active');
}

function hideCupInEffect() {
  gameScreen.classList.remove('cup-in-active');
}

function startCupIn() {
  if (cupInProgress) return;
  cupInProgress = true;
  cupInTimer    = 0;
  ballInFlight  = false;
  ballVel       = { x: 0, y: 0, z: 0 };
  ballCupStart  = { x: ballPos.x, y: ballPos.y, z: ballPos.z };
  if (playerGroup) playerGroup.visible = false;
  if (arrowMesh) arrowMesh.visible = false;
  ball.visible = true;
  ball.scale.setScalar(1);
  setupCupInCamera();
  showCupInEffect();
}

function updateCupIn(dt) {
  const hole = HOLES[currentHoleIndex];
  const hx = hole.holePos.x;
  const hz = hole.holePos.z;
  cupInTimer += dt * BALL_FLIGHT_SCALE;

  const mouthR     = cupMouthRadius();
  const lipDist    = CUP_RADIUS + BALL_RADIUS * 0.35;
  const linerEntryY = getCupLinerTopY() + BALL_RADIUS;
  const bottomY     = getCupBottomY();
  const startDx = ballCupStart.x - hx;
  const startDz = ballCupStart.z - hz;
  const startDist = Math.hypot(startDx, startDz);
  const lipX = hx + (startDist > 0.001 ? (startDx / startDist) * lipDist : 0);
  const lipZ = hz + (startDist > 0.001 ? (startDz / startDist) * lipDist : 0);
  const restX = hx + CUP_LINER_RADIUS * 0.22;
  const restZ = hz - CUP_LINER_RADIUS * 0.16;

  const rollEnd   = CUP_IN_ROLL_FRAMES;
  const dropEnd   = rollEnd + CUP_IN_DROP_FRAMES;
  const settleEnd = dropEnd + CUP_IN_SETTLE_FRAMES;

  if (cupInTimer <= rollEnd) {
    const t = easeInOutCubic(cupInTimer / rollEnd);
    ballPos.x = lerpVal(ballCupStart.x, lipX, t);
    ballPos.z = lerpVal(ballCupStart.z, lipZ, t);
    const surfaceY = getBallSurfaceY(ballPos.x, ballPos.z);
    ballPos.y = lerpVal(Math.max(ballCupStart.y, surfaceY), surfaceY, t);
    ball.rotation.x += 0.12 * (startDist / Math.max(lipDist, 0.01)) * dt;
  } else if (cupInTimer <= dropEnd) {
    const t = (cupInTimer - rollEnd) / CUP_IN_DROP_FRAMES;
    const horizT = easeInOutCubic(Math.min(1, t / 0.5));
    ballPos.x = lerpVal(lipX, hx, horizT);
    ballPos.z = lerpVal(lipZ, hz, horizT);

    const dist = Math.hypot(ballPos.x - hx, ballPos.z - hz);
    const rimY = getBallSurfaceY(ballPos.x, ballPos.z);

    if (dist > mouthR || t < 0.35) {
      ballPos.y = rimY;
    } else if (t < 0.58) {
      const soilT = easeInQuad((t - 0.35) / 0.23);
      ballPos.y = lerpVal(rimY, linerEntryY, soilT);
    } else {
      const fallT = easeInQuad((t - 0.58) / 0.42);
      ballPos.y = lerpVal(linerEntryY, bottomY, fallT);
    }

    if (t > 0.62) {
      const slide = (t - 0.62) / 0.38;
      ballPos.x = lerpVal(hx, restX, easeInOutCubic(slide));
      ballPos.z = lerpVal(hz, restZ, easeInOutCubic(slide));
    }
  } else if (cupInTimer <= settleEnd) {
    const t = (cupInTimer - dropEnd) / CUP_IN_SETTLE_FRAMES;
    ballPos.x = restX;
    ballPos.z = restZ;
    ballPos.y = bottomY + Math.sin(t * Math.PI) * BALL_RADIUS * 0.2;
  } else {
    ballPos.x = restX;
    ballPos.z = restZ;
    ballPos.y = bottomY;
  }

  ball.position.set(ballPos.x, ballPos.y, ballPos.z);

  const tCam = Math.min(1, cupInTimer / CUP_IN_CAM_FRAMES);
  const lookY = cupInTimer > CUP_IN_ROLL_FRAMES ? ballPos.y : undefined;
  updateCupInCamera(tCam, lookY);

  if (cupInTimer >= CUP_IN_TOTAL_FRAMES) {
    cupInProgress = false;
    ball.visible  = false;
    if (arrowMesh) arrowMesh.visible = true;
    hideCupInEffect();
    showResult();
  }
}

// ===== ボール物理 =====
function updateBall(dt) {
  if (cupInProgress) { updateCupIn(dt); return; }
  if (!ballInFlight) return;

  const bdt = dt * BALL_FLIGHT_SCALE;

  ballVel.y += GRAVITY * bdt;
  ballPos.x += ballVel.x * bdt;
  ballPos.y += ballVel.y * bdt;
  ballPos.z += ballVel.z * bdt;

  // 旗竿・旗の当たり判定
  checkFlagObstacleCollision();

  // 地面近くでカップ範囲に入ったら吸い込む
  if (ballPos.y < 0.5) {
    const hole = HOLES[currentHoleIndex];
    const dx = ballPos.x - hole.holePos.x;
    const dz = ballPos.z - hole.holePos.z;
    if (Math.sqrt(dx * dx + dz * dz) < CUP_CAPTURE_RADIUS) {
      startCupIn();
      return;
    }
  }

  const ground = getGroundY(ballPos.z);
  if (ballPos.y <= ground + BALL_RADIUS) {
    ballPos.y = ground + BALL_RADIUS;
    if (Math.abs(ballVel.y) > 0.05) {
      ballVel.y = -ballVel.y * BOUNCE;
    } else {
      ballVel.y = 0;
    }
    const rollFriction = Math.pow(FRICTION, bdt);
    ballVel.x *= rollFriction;
    ballVel.z *= rollFriction;
    if (Math.abs(ballVel.x) < 0.001 && Math.abs(ballVel.z) < 0.001 && Math.abs(ballVel.y) < 0.005) {
      ballVel = { x: 0, y: 0, z: 0 };
      ballInFlight = false;
      if (strokeCount >= 1) aimAtHole();
      checkHole();
      if (!cupInProgress) {
        setTimeout(() => {
          if (!ballInFlight && !cupInProgress && !showingDistance) showShotDistance();
        }, SHOT_DISTANCE_DELAY_MS);
      }
    }
  }

  ball.position.set(ballPos.x, ballPos.y, ballPos.z);
  ball.rotation.x += ballVel.z * 5 * bdt;
  ball.rotation.z -= ballVel.x * 5 * bdt;
}

function getGroundY(z) {
  const hole = HOLES[currentHoleIndex];
  if (hole.terrain === 'slope') return z * -0.04;
  if (hole.terrain === 'hill')  return Math.sin((z / 180) * Math.PI * 2) * 3;
  return 0;
}

// ===== カップ方向へ自動照準 =====
function aimAtHole() {
  aimAtGreen();
}

// ===== ボール停止時のカップ確認（転がって止まった場合）=====
function checkHole() {
  const hole = HOLES[currentHoleIndex];
  const dx = ballPos.x - hole.holePos.x;
  const dz = ballPos.z - hole.holePos.z;
  if (Math.sqrt(dx * dx + dz * dz) < CUP_CAPTURE_RADIUS) startCupIn();
}

function showResult() {
  const hole = HOLES[currentHoleIndex];
  const diff = strokeCount - hole.par;
  const labels = { '-3':'ALBATROSS', '-2':'EAGLE', '-1':'BIRDIE', '0':'PAR', '1':'BOGEY', '2':'DOUBLE BOGEY' };
  resultTitle.textContent = labels[String(diff)] || (diff < -3 ? 'CONDOR!!' : `+${diff}`);
  resultScore.textContent = `${strokeCount} ストローク / PAR ${hole.par}`;
  resultOverlay.classList.remove('hidden');
}

// ゲージtick位置のCSS power値（0〜100）。√スケーリング後の飛距離 = p/100 * maxYard
const TICK_POWERS = [1.0, 0.7875, 0.575, 0.3625, 0.15];

function updateGaugeLabels() {
  const club = CLUBS[currentClub];
  const unit = club.name === 'PT' ? 'm' : 'yd';
  TICK_POWERS.forEach((p, i) => {
    powerLabelSpans[i].textContent = Math.round(p * club.maxYard) + unit;
  });
}

// ===== クラブ切替 =====
function changeClub(dir) {
  if (shotState !== SHOT_IDLE || ballInFlight) return;
  currentClub = (currentClub + dir + CLUBS.length) % CLUBS.length;
  const club = CLUBS[currentClub];
  clubNameEl.textContent  = club.name;
  clubLabelEl.textContent = club.label;
  updateGaugeLabels();
  updateHUD();
  updateShotUI();
}

clubPrevBtn.addEventListener('click', () => changeClub(-1));
clubNextBtn.addEventListener('click', () => changeClub(1));

nextHoleBtn.addEventListener('click', () => {
  resultOverlay.classList.add('hidden');
  const next = currentHoleIndex + 1;
  if (next < HOLES.length) loadHole(next);
  else {
    gameScreen.classList.add('hidden');
    titleScreen.classList.remove('hidden');
  }
});

// ===== メインループ（dt=1 が 60fps 相当。fps が落ちても速度は一定） =====
function gameLoop(now) {
  animId = requestAnimationFrame(gameLoop);
  const dt = lastFrameMs
    ? Math.min((now - lastFrameMs) / (1000 / 60), 1.35)
    : 1;
  lastFrameMs = now;

  processImpactInput();
  updateShotMeters(dt);
  updateBall(dt);
  updatePlayer(dt);
  if (!cupInProgress) {
    updateArrow();
    updateCamera();
    updateFlagVisibility();
    if ((hudTick++ & 3) === 0) updateHUD();
  }
  if (flagMesh && flagMesh.visible) flagMesh.rotation.y += 0.01 * dt;
  renderer.render(scene, camera);
}

// ===== 入力ハンドラ =====

shotBtn.addEventListener('click', () => nextShotAction());
shotBtn.addEventListener('touchstart', e => { e.preventDefault(); nextShotAction(); }, { passive: false });

// 方向ボタン（連続押し対応）
let dirInterval = null;
function startDirRepeat(delta) {
  if (dirInterval) clearInterval(dirInterval);
  if (!ballInFlight && shotState === SHOT_IDLE) shotDirection += delta;
  dirInterval = setInterval(() => { if (!ballInFlight && shotState === SHOT_IDLE) shotDirection += delta; }, 80);
}
function stopDirRepeat() { clearInterval(dirInterval); dirInterval = null; }
dirLeft.addEventListener('mousedown',   () => startDirRepeat(-0.05));
dirLeft.addEventListener('mouseup',     stopDirRepeat);
dirLeft.addEventListener('mouseleave',  stopDirRepeat);
dirLeft.addEventListener('touchstart',  e => { e.preventDefault(); startDirRepeat(-0.05); }, { passive: false });
dirLeft.addEventListener('touchend',    stopDirRepeat);
dirRight.addEventListener('mousedown',  () => startDirRepeat(0.05));
dirRight.addEventListener('mouseup',    stopDirRepeat);
dirRight.addEventListener('mouseleave', stopDirRepeat);
dirRight.addEventListener('touchstart', e => { e.preventDefault(); startDirRepeat(0.05); }, { passive: false });
dirRight.addEventListener('touchend',   stopDirRepeat);

// カメラボタン
let camInterval = null;
function startCamRepeat(delta) {
  if (camInterval) clearInterval(camInterval);
  camInterval = setInterval(() => { cameraAngleV = Math.min(1.2, Math.max(0.1, cameraAngleV + delta)); }, 80);
}
function stopCamRepeat() { clearInterval(camInterval); camInterval = null; }
camUp.addEventListener('mousedown',    () => startCamRepeat(0.04));
camUp.addEventListener('mouseup',      stopCamRepeat);
camUp.addEventListener('mouseleave',   stopCamRepeat);
camDown.addEventListener('mousedown',  () => startCamRepeat(-0.04));
camDown.addEventListener('mouseup',    stopCamRepeat);
camDown.addEventListener('mouseleave', stopCamRepeat);

function isShotActionKey(code) {
  return code === 'Space' || code === 'KeyZ' || code === 'Enter';
}

// キーボード（Space / Z / Enter でショット操作）
document.addEventListener('keydown', e => {
  if (showingDistance) {
    if (e.code === 'KeyR') { retryShot(); return; }
    if (isShotActionKey(e.code)) {
      e.preventDefault();
      if (!e.repeat) hideShotDistance();
    }
    return;
  }
  switch (e.code) {
    case 'Space':
    case 'KeyZ':
    case 'Enter':
      e.preventDefault();
      if (e.repeat && shotState !== SHOT_IDLE) break;
      if (shotState === SHOT_RETURN) queueImpact();
      else nextShotAction();
      break;
    case 'KeyQ':
      changeClub(-1);
      break;
    case 'KeyE':
      changeClub(1);
      break;
    case 'ArrowLeft':
      if (!ballInFlight && shotState === SHOT_IDLE) shotDirection -= 0.08;
      break;
    case 'ArrowRight':
      if (!ballInFlight && shotState === SHOT_IDLE) shotDirection += 0.08;
      break;
    case 'ArrowUp':
      cameraAngleV = Math.min(1.2, cameraAngleV + 0.08);
      break;
    case 'ArrowDown':
      cameraAngleV = Math.max(0.1, cameraAngleV - 0.08);
      break;
  }
});
