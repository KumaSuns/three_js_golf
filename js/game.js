/* ===== たっくんとGOLF - game.js ===== */

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
const BALL_RADIUS         = 0.021;
// カップはボール実寸比では見えず入らないため、コース用のゲームスケールで表示・判定
const CUP_RADIUS          = 0.5;
const CUP_DEPTH           = 0.25;
const CUP_CAPTURE_RADIUS  = CUP_RADIUS * 0.9;
const PLAYER_HEIGHT       = 1.65;
const PLAYER_HEADS        = 5;
const PLAYER_MODEL_HEAD_R = 0.21;

// ===== 状態変数 =====
let scene, camera, renderer;
let ball, holeMesh, flagMesh, arrowMesh;
let ballPos    = { x: 0, y: BALL_RADIUS, z: 0 };
let ballVel    = { x: 0, y: 0, z: 0 };
let ballInFlight   = false;
let shotDirection  = 0;
let strokeCount    = 0;
let currentHoleIndex = 0;
let animId         = null;
let courseMeshes   = [];
let cameraAngleV   = 0.3;
let cameraDistance = 18;

let shotState   = SHOT_IDLE;
let power       = 0;   // 現在のバー値（0〜100）
let powerDir    = 1;   // 往復方向
let lockedPower = 0;   // ② 確定したパワー値

let cupInProgress   = false;
let cupInTimer      = 0;
const CUP_IN_FRAMES = 50;

let shotStartPos        = { x: 0, z: 0 };
let showingDistance     = false;
let preRetryStrokeCount = 0;
let impactQueued        = false; // インパクト入力を次フレームで確実に処理

// ===== プレイヤー =====
let playerGroup  = null;
let playerParts  = {};
const SWING_ADDR =  0.45;   // アドレス
const SWING_BACK = -1.55;   // バックスウィング
const SWING_THRU =  2.7;    // フォロースルー
let swingAngle   = SWING_ADDR;
let swingTarget  = SWING_ADDR;

const GRAVITY = -0.018;
const FRICTION = 0.97;
const BOUNCE   = 0.35;
const POLE_RADIUS = 0.05; // ポール半径（m）

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
  const canvas = document.getElementById('game-canvas');
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb);
  scene.fog = new THREE.Fog(0x87ceeb, 60, 200);

  camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 500);

  scene.add(new THREE.AmbientLight(0xffffff, 0.55));

  // プレイヤーを引き立てるフィルライト（前方・やや青）
  const fillLight = new THREE.DirectionalLight(0xaaccff, 0.45);
  fillLight.position.set(-15, 10, 25);
  scene.add(fillLight);

  const sun = new THREE.DirectionalLight(0xfff8e7, 1.2);
  sun.position.set(30, 60, 30);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near   =   0.5;
  sun.shadow.camera.far    = 300;
  sun.shadow.camera.left   = -100;
  sun.shadow.camera.right  =  100;
  sun.shadow.camera.top    =  100;
  sun.shadow.camera.bottom = -100;
  scene.add(sun);

  addClouds();

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

// ===== 雲 =====
function addClouds() {
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
  [[-30,25,-60],[20,28,-80],[-50,22,-50],[40,30,-100],[0,26,-120]].forEach(([x,y,z]) => {
    const g = new THREE.Group();
    [[0,0,0,4],[-4,-1,0,3],[4,-1,0,3],[0,-1,-3,2.5]].forEach(([cx,cy,cz,r]) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(r,7,7), mat);
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
  shotDirection   = 0;
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

  const hole = HOLES[idx];
  holeNumEl.textContent = hole.name;
  parInfoEl.textContent = `PAR ${hole.par}`;
  strokeEl.textContent  = '0';

  buildCourse(hole);
  placeBall(hole.ballStart.x, hole.ballStart.z);
  placeHole(hole.holePos.x, hole.holePos.z);
  buildArrow();
  buildPlayer();
  updateGaugeLabels();
  updateHUD();
  updateShotUI();

  if (animId) cancelAnimationFrame(animId);
  gameLoop();
}

// ===== コース生成 =====
function buildCourse(hole) {
  const W = 30, L = hole.terrain === 'hill' ? 180 : 130;

  const fairway = new THREE.Mesh(
    buildTerrainGeometry(W, L, hole.terrain),
    new THREE.MeshLambertMaterial({ color: 0x3a9a4a })
  );
  fairway.receiveShadow = true;
  scene.add(fairway);
  courseMeshes.push(fairway);

  const green = new THREE.Mesh(
    new THREE.CircleGeometry(7, 32),
    new THREE.MeshLambertMaterial({ color: 0x55dd55 })
  );
  green.rotation.x = -Math.PI / 2;
  green.position.set(hole.holePos.x, 0.01, hole.holePos.z);
  scene.add(green);
  courseMeshes.push(green);

  const rough = new THREE.Mesh(
    new THREE.PlaneGeometry(100, L + 40),
    new THREE.MeshLambertMaterial({ color: 0x2d7a35 })
  );
  rough.rotation.x = -Math.PI / 2;
  rough.position.set(0, -0.02, (hole.ballStart.z + hole.holePos.z) / 2);
  rough.receiveShadow = true;
  scene.add(rough);
  courseMeshes.push(rough);

  addBunkers(hole);
  addTrees(hole);
}

function buildTerrainGeometry(W, L, type) {
  const geo = new THREE.PlaneGeometry(W, L, 20, 40);
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
    const mesh = new THREE.Mesh(
      new THREE.CircleGeometry(1, 16),
      new THREE.MeshLambertMaterial({ color: 0xe8d5a3 })
    );
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
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.3, 0.5, 3, 7),
      new THREE.MeshLambertMaterial({ color: 0x7b4f2e })
    );
    trunk.position.set(x, 1.5, z);
    trunk.castShadow = true;
    scene.add(trunk);
    courseMeshes.push(trunk);

    const leaves = new THREE.Mesh(
      new THREE.ConeGeometry(2.5, 5, 8),
      new THREE.MeshLambertMaterial({ color: 0x1e6e2e })
    );
    leaves.position.set(x, 6, z);
    leaves.castShadow = true;
    scene.add(leaves);
    courseMeshes.push(leaves);
  });
}

// ===== ボール配置 =====
function placeBall(x, z) {
  ball = new THREE.Mesh(
    new THREE.SphereGeometry(BALL_RADIUS, 16, 16),
    new THREE.MeshLambertMaterial({ color: 0xffffff })
  );
  ball.castShadow = true;
  ball.visible = true;
  ball.scale.setScalar(1);
  ballPos = { x, y: BALL_RADIUS, z };
  ball.position.set(x, BALL_RADIUS, z);
  scene.add(ball);
}

// ===== ホール＆フラッグ =====
function placeHole(x, z) {
  holeMesh = new THREE.Group();

  const cup = new THREE.Mesh(
    new THREE.CylinderGeometry(CUP_RADIUS, CUP_RADIUS, CUP_DEPTH, 24),
    new THREE.MeshLambertMaterial({ color: 0x111111 })
  );
  cup.position.y = -CUP_DEPTH / 2;
  holeMesh.add(cup);

  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(CUP_RADIUS, 0.035, 8, 24),
    new THREE.MeshLambertMaterial({ color: 0xffffff })
  );
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.01;
  holeMesh.add(rim);

  holeMesh.position.set(x, 0, z);
  scene.add(holeMesh);

  flagMesh = new THREE.Group();
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.05, 4, 8),
    new THREE.MeshLambertMaterial({ color: 0xcccccc })
  );
  pole.position.y = 2;
  flagMesh.add(pole);

  const flag = new THREE.Mesh(
    new THREE.PlaneGeometry(1.2, 0.8),
    new THREE.MeshLambertMaterial({ color: 0xff2222, side: THREE.DoubleSide })
  );
  flag.position.set(0.6, 3.8, 0);
  flagMesh.add(flag);

  flagMesh.position.set(x, 0, z);
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

// ===== プレイヤー生成 =====
function buildPlayer() {
  if (playerGroup) scene.remove(playerGroup);
  playerParts = {};
  swingAngle = swingTarget = SWING_ADDR;
  playerGroup = new THREE.Group();

  const mSkin  = new THREE.MeshPhongMaterial({ color: 0xffbb88, shininess: 30 });
  const mShirt = new THREE.MeshPhongMaterial({ color: 0x1155ee, shininess: 25 });
  const mPants = new THREE.MeshPhongMaterial({ color: 0x1a2a44, shininess: 15 });
  const mShoe  = new THREE.MeshPhongMaterial({ color: 0x221100, shininess: 50 });
  const mCap   = new THREE.MeshPhongMaterial({ color: 0xdd2200, shininess: 20 });
  const mGlove = new THREE.MeshPhongMaterial({ color: 0xf0f0f0, shininess: 40 });
  const mShaft = new THREE.MeshPhongMaterial({ color: 0xc0c0c0, shininess: 120 });
  const mClub  = new THREE.MeshPhongMaterial({ color: 0x777777, shininess: 100 });

  function mk(geo, mat, px, py, pz) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(px || 0, py || 0, pz || 0);
    m.castShadow = true;
    return m;
  }
  const B = (w,h,d) => new THREE.BoxGeometry(w, h, d);
  const C = (rt,rb,h,s) => new THREE.CylinderGeometry(rt, rb, h, s);
  const Sp = (r,s) => new THREE.SphereGeometry(r, s, s);

  const hr = PLAYER_MODEL_HEAD_R;
  const legH = hr * 2.6;
  const hipY = 0.035 + legH + 0.11;

  // 靴
  playerGroup.add(mk(B(hr * 0.65, hr * 0.32, hr * 1.1), mShoe, -hr * 0.65, hr * 0.16, hr * 0.18));
  playerGroup.add(mk(B(hr * 0.65, hr * 0.32, hr * 1.1), mShoe,  hr * 0.65, hr * 0.16, hr * 0.18));
  // 脚（5頭身用に短め）
  playerGroup.add(mk(C(hr * 0.42, hr * 0.4, legH, 8), mPants, -hr * 0.65, 0.035 + legH * 0.5));
  playerGroup.add(mk(C(hr * 0.42, hr * 0.4, legH, 8), mPants,  hr * 0.65, 0.035 + legH * 0.5));
  playerGroup.add(mk(B(hr * 1.95, hr * 1.0, hr * 1.2), mPants, 0, hipY));

  const bodyGrp = new THREE.Group();
  bodyGrp.position.set(0, hipY + hr * 0.35, 0);
  bodyGrp.rotation.x = 0.2;
  playerGroup.add(bodyGrp);
  playerParts.bodyGrp = bodyGrp;

  bodyGrp.add(mk(B(hr * 2.0, hr * 2.35, hr * 1.25), mShirt, 0, hr * 1.15));
  bodyGrp.add(mk(C(hr * 0.34, hr * 0.32, hr * 0.55, 8), mSkin, 0, hr * 2.65));
  const headMesh = mk(Sp(hr, 14), mSkin, 0, hr * 3.55);
  bodyGrp.add(headMesh);
  playerParts.headMesh = headMesh;
  bodyGrp.add(mk(Sp(hr * 0.3, 6), mSkin, -hr * 1.0, hr * 3.55));
  bodyGrp.add(mk(Sp(hr * 0.3, 6), mSkin,  hr * 1.0, hr * 3.55));
  bodyGrp.add(mk(C(hr * 0.68, hr * 1.05, hr * 1.0, 8), mCap, 0, hr * 4.45));
  bodyGrp.add(mk(C(hr * 1.35, hr * 1.35, hr * 0.18, 12), mCap, hr * 0.32, hr * 4.05));

  const armsGrp = new THREE.Group();
  armsGrp.position.set(0, hr * 1.95, 0);
  bodyGrp.add(armsGrp);
  playerParts.armsGrp = armsGrp;

  const lArmGrp = new THREE.Group();
  lArmGrp.position.set(-hr * 1.28, 0, 0);
  armsGrp.add(lArmGrp);
  lArmGrp.add(mk(C(hr * 0.33, hr * 0.3, hr * 1.35, 8), mShirt, 0, -hr * 0.68));
  lArmGrp.add(mk(C(hr * 0.28, hr * 0.25, hr * 1.25, 8), mSkin, 0, -hr * 1.98));
  lArmGrp.add(mk(Sp(hr * 0.36, 8), mGlove, 0, -hr * 2.78));

  const rArmGrp = new THREE.Group();
  rArmGrp.position.set(hr * 1.28, 0, 0);
  armsGrp.add(rArmGrp);
  rArmGrp.add(mk(C(hr * 0.33, hr * 0.3, hr * 1.35, 8), mShirt, 0, -hr * 0.68));
  rArmGrp.add(mk(C(hr * 0.28, hr * 0.25, hr * 1.25, 8), mSkin, 0, -hr * 1.98));
  rArmGrp.add(mk(Sp(hr * 0.36, 8), mGlove, 0, -hr * 2.78));

  const clubGrp = new THREE.Group();
  clubGrp.position.set(0, -hr * 2.95, 0);
  rArmGrp.add(clubGrp);
  playerParts.clubGrp = clubGrp;
  clubGrp.add(mk(C(hr * 0.08, hr * 0.07, hr * 4.9, 6), mShaft, 0, -hr * 2.45));
  clubGrp.add(mk(B(hr * 0.22, hr * 0.45, hr * 0.4), mClub, 0, -hr * 5.0, hr * 0.08));

  armsGrp.rotation.x = SWING_ADDR;

  // 全高 = 頭直径 × 5（5頭身）
  playerGroup.scale.setScalar(PLAYER_HEIGHT / (PLAYER_HEADS * PLAYER_MODEL_HEAD_R * 2));
  scene.add(playerGroup);
  updatePlayerTransform();
}

function updatePlayerTransform() {
  if (!playerGroup) return;
  const fwd   = { x:  Math.sin(shotDirection), z: -Math.cos(shotDirection) };
  const right = { x:  Math.cos(shotDirection), z:  Math.sin(shotDirection) };
  const stanceR = PLAYER_HEIGHT * 0.33;
  const stanceB = PLAYER_HEIGHT * 0.15;
  playerGroup.position.set(
    ballPos.x + right.x * stanceR - fwd.x * stanceB,
    0,
    ballPos.z + right.z * stanceR - fwd.z * stanceB
  );
  // ボールの方向を向く
  const dx = ballPos.x - playerGroup.position.x;
  const dz = ballPos.z - playerGroup.position.z;
  playerGroup.rotation.y = Math.atan2(dx, -dz) + Math.PI;
}

function updatePlayer() {
  if (!playerGroup) return;

  if (!ballInFlight && (shotState === SHOT_IDLE || shotState === SHOT_POWER)) {
    updatePlayerTransform();
    swingTarget = SWING_ADDR;
    if (playerParts.bodyGrp) playerParts.bodyGrp.rotation.y = 0;
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

  swingAngle += (swingTarget - swingAngle) * (ballInFlight ? 0.04 : 0.16);
  if (playerParts.armsGrp) playerParts.armsGrp.rotation.x = swingAngle;

  if (shotState === SHOT_IDLE && !ballInFlight) {
    playerGroup.position.y = Math.sin(Date.now() * 0.0016) * 0.012;
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
function updateCamera() {
  const cx = ballPos.x - Math.sin(shotDirection) * cameraDistance * Math.cos(cameraAngleV);
  const cy = ballPos.y + cameraDistance * Math.sin(cameraAngleV);
  const cz = ballPos.z + Math.cos(shotDirection) * cameraDistance * Math.cos(cameraAngleV);
  camera.position.set(cx, cy, cz);
  // プレイヤーとボールが両方映るよう右へ少しシフト
  const rx = Math.cos(shotDirection) * 0.4;
  const rz = Math.sin(shotDirection) * 0.4;
  camera.lookAt(ballPos.x + rx, ballPos.y + 0.9, ballPos.z + rz);
}

function isPutterClub() {
  return CLUBS[currentClub].name === 'PT';
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
function updateShotMeters() {
  if (shotState === SHOT_POWER) {
    power += powerDir * POWER_SPEED;
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
    power += POWER_SPEED * 1.5;
    if (power >= 100) {
      power     = 100;
      shotState = SHOT_RETURN;
      impactZoneEl.classList.add('active'); // インパクトエリア点滅開始
    }
    powerBar.style.width   = power + '%';
    powerNeedle.style.left = power + '%';
  }

  if (shotState === SHOT_RETURN && !isPutterClub()) {
    power -= RETURN_SPEED;
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

// ===== ポール当たり判定 =====
function checkPoleCollision() {
  const hole = HOLES[currentHoleIndex];
  const dx = ballPos.x - hole.holePos.x;
  const dz = ballPos.z - hole.holePos.z;
  const distXZ = Math.sqrt(dx * dx + dz * dz);
  if (distXZ < CUP_CAPTURE_RADIUS) return; // カップ付近はポール判定をスキップ

  const threshold = POLE_RADIUS + BALL_RADIUS;
  if (distXZ < threshold && ballPos.y > 0 && ballPos.y < 4.5) {
    const nx = dx / distXZ;
    const nz = dz / distXZ;
    const dot = ballVel.x * nx + ballVel.z * nz;
    if (dot < 0) { // ポールへ向かっているときだけ反射
      ballVel.x = (ballVel.x - 2 * dot * nx) * 0.55;
      ballVel.z = (ballVel.z - 2 * dot * nz) * 0.55;
    }
    // めり込み解消
    ballPos.x = hole.holePos.x + nx * (threshold + 0.02);
    ballPos.z = hole.holePos.z + nz * (threshold + 0.02);
  }
}

// ===== カップイン演出 =====
function startCupIn() {
  if (cupInProgress) return;
  cupInProgress = true;
  cupInTimer    = 0;
  ballInFlight  = false;
  ballVel       = { x: 0, y: 0, z: 0 };
}

function updateCupIn() {
  const hole = HOLES[currentHoleIndex];
  cupInTimer++;
  const t = Math.min(cupInTimer / CUP_IN_FRAMES, 1);

  // カップ中心へ引き寄せ
  ballPos.x += (hole.holePos.x - ballPos.x) * 0.18;
  ballPos.z += (hole.holePos.z - ballPos.z) * 0.18;
  // 沈む
  ballPos.y = BALL_RADIUS * (1 - t) - CUP_DEPTH * 0.5 * t;
  // 縮む
  ball.scale.setScalar(Math.max(0.01, 1 - t));
  ball.position.set(ballPos.x, ballPos.y, ballPos.z);

  if (t >= 1) {
    cupInProgress = false;
    ball.visible  = false; // 完全に消す
    showResult();
  }
}

// ===== ボール物理 =====
function updateBall() {
  if (cupInProgress) { updateCupIn(); return; }
  if (!ballInFlight) return;

  ballVel.y += GRAVITY;
  ballPos.x += ballVel.x;
  ballPos.y += ballVel.y;
  ballPos.z += ballVel.z;

  // ポール当たり判定
  checkPoleCollision();

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
    ballVel.x *= FRICTION;
    ballVel.z *= FRICTION;
    if (Math.abs(ballVel.x) < 0.001 && Math.abs(ballVel.z) < 0.001 && Math.abs(ballVel.y) < 0.005) {
      ballVel = { x: 0, y: 0, z: 0 };
      ballInFlight = false;
      if (strokeCount >= 1) aimAtHole();
      checkHole();
      if (!cupInProgress) showShotDistance();
    }
  }

  ball.position.set(ballPos.x, ballPos.y, ballPos.z);
  ball.rotation.x += ballVel.z * 5;
  ball.rotation.z -= ballVel.x * 5;
}

function getGroundY(z) {
  const hole = HOLES[currentHoleIndex];
  if (hole.terrain === 'slope') return z * -0.04;
  if (hole.terrain === 'hill')  return Math.sin((z / 180) * Math.PI * 2) * 3;
  return 0;
}

// ===== カップ方向へ自動照準 =====
function aimAtHole() {
  const hole = HOLES[currentHoleIndex];
  const dx = hole.holePos.x - ballPos.x;
  const dz = hole.holePos.z - ballPos.z;
  shotDirection = Math.atan2(dx, -dz);
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

// ===== メインループ =====
function gameLoop() {
  animId = requestAnimationFrame(gameLoop);
  processImpactInput();
  updateShotMeters();
  processImpactInput();
  updateBall();
  updatePlayer();
  updateArrow();
  updateCamera();
  updateHUD();
  if (flagMesh) flagMesh.rotation.y += 0.01;
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
