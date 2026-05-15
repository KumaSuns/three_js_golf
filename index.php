<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>たっくんとGOLF</title>
  <link rel="stylesheet" href="css/style.css">
</head>
<body>
  <div id="title-screen">
    <h1>たっくんとGOLF</h1>
    <button id="start-btn">スタート</button>
  </div>

  <div id="game-screen" class="hidden">
    <canvas id="game-canvas"></canvas>

    <div id="hud">
      <div id="hole-info">
        <span id="hole-num">HOLE 1</span>
        <span id="par-info">PAR 3</span>
      </div>
      <div id="stroke-info">
        <span>ストローク: </span><span id="stroke-count">0</span>
      </div>
      <div id="distance-info">
        <span>距離: </span><span id="distance">--</span><span id="distance-unit">yd</span>
      </div>
    </div>

    <div id="controls">
      <div id="direction-pad">
        <button class="dir-btn" id="dir-left">◀</button>
        <button class="dir-btn" id="dir-right">▶</button>
      </div>
      <div id="shot-area">
        <div id="power-meter-container">
          <div id="power-label">パワー</div>
          <div id="power-bar-bg">
            <div id="power-bar"></div>
            <div id="power-ticks"></div>
            <div id="impact-zone"></div>
            <div id="impact-line"></div>
            <div id="power-needle"></div>
            <div id="impact-marker"></div>
            <div id="power-lock-marker"></div>
          </div>
          <div id="power-labels">
            <span style="left:0%">200yd</span>
            <span style="left:21.25%">150yd</span>
            <span style="left:42.5%">100yd</span>
            <span style="left:63.75%">50yd</span>
            <span style="left:85%">0yd</span>
          </div>
          <div id="power-phase-label">待機中</div>
        </div>
        <div id="club-selector">
          <button class="club-btn" id="club-prev">◀</button>
          <div id="club-display">
            <span id="club-name">W1</span>
            <span id="club-label">ドライバー</span>
          </div>
          <button class="club-btn" id="club-next">▶</button>
        </div>
        <div id="shot-hint">[ SPACE ] or タップ　クラブ: Q / E</div>
        <button id="shot-btn">① スタート</button>
      </div>
      <div id="camera-pad">
        <button class="cam-btn" id="cam-up">▲</button>
        <button class="cam-btn" id="cam-down">▼</button>
      </div>
    </div>

    <div id="shot-effect"></div>

    <div id="cup-in-effect" class="hidden">
      <div id="cup-in-vignette"></div>
    </div>
    <div id="shot-distance" class="hidden">
      <div id="shot-dist-label">飛距離</div>
      <div id="shot-dist-value">--</div>
      <div id="shot-dist-buttons">
        <button id="retry-btn">打ち直し</button>
        <button id="next-shot-btn">次のショットへ</button>
      </div>
    </div>

    <div id="result-overlay" class="hidden">
      <div id="result-box">
        <div id="result-title"></div>
        <div id="result-score"></div>
        <button id="next-hole-btn">次のホールへ</button>
      </div>
    </div>
  </div>

  <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
  <?php
  $_gjs = __DIR__ . DIRECTORY_SEPARATOR . 'js' . DIRECTORY_SEPARATOR . 'game.js';
  $gameJsVer = is_readable($_gjs) ? ((int) filemtime($_gjs) . '-' . (int) filesize($_gjs)) : '0';
  ?>
  <script src="js/game.js?v=<?= htmlspecialchars($gameJsVer, ENT_QUOTES, 'UTF-8') ?>"></script>
</body>
</html>
