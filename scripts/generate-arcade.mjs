#!/usr/bin/env node
// Generates docs/assets/arcade-snake.svg by simulating a full game of
// snake. Phase 1: classic free-roaming chase with randomly placed food,
// ends when the snake is big (or trapped). Phase 2: the snake follows a
// serpentine cycle that visits every cell of the board, eating food
// placed ahead on the cycle, growing until it has covered the screen.
// The whole timeline is one discretely-keyframed path, so the file
// stays small and the motion is identical in every renderer.

import fs from 'node:fs';

const OUT = 'docs/assets/arcade-snake.svg';
const SEED = 0xbeef01;

// ---------- deterministic PRNG (mulberry32) ----------

function prng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- board geometry ----------

const COLS = 18;
const ROWS = 8;
const CELL = 28;
const BX = 48;
const BY = 72;
const TICK = 0.12; // seconds per move
const PHASE1_LEN = 40; // first life: grow to this size, then "game over"
const PHASE2_LEN = 100; // second life: follow the cycle until the board is mostly body
const FREEZE_TICKS = 8; // pause at "game over" so the restart reads as deliberate
const MAX_TICKS_PER_PHASE = 2500;

// serpentine cycle over every cell: rows alternate direction, column 0
// is the return ascent. Works for any even ROWS. Closed loop.
function buildCycle() {
  const cells = [];
  for (let y = 0; y < ROWS; y++) {
    if (y % 2 === 0) {
      for (let x = 1; x < COLS; x++) cells.push({ x, y });
    } else {
      for (let x = COLS - 1; x >= 1; x--) cells.push({ x, y });
    }
  }
  for (let y = ROWS - 1; y >= 0; y--) cells.push({ x: 0, y });
  return cells; // length === COLS * ROWS
}

// ---------- simulation ----------

function simulate() {
  const rnd = prng(SEED);
  const ticks = []; // { cells: [{x,y}...] head-first, food: {x,y} }
  const cycle = buildCycle();

  let snake = [
    { x: 3, y: 4 },
    { x: 2, y: 4 },
    { x: 1, y: 4 },
  ];
  let dir = { x: 1, y: 0 };
  let food = null;
  let cap = PHASE1_LEN;

  const freeCells = () => {
    const free = [];
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (!snake.some((s) => s.x === x && s.y === y)) free.push({ x, y });
      }
    }
    return free;
  };
  const placeFood = () => {
    const free = freeCells();
    food = free[Math.floor(rnd() * free.length)] || null;
  };
  placeFood();

  const record = () => ticks.push({ cells: snake.map((s) => ({ ...s })), food: { ...food } });

  const legal = (head, d) => {
    const nx = head.x + d.x;
    const ny = head.y + d.y;
    if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) return false;
    const body = snake.slice(0, snake.length - 1); // tail vacates this tick
    return !body.some((s) => s.x === nx && s.y === ny);
  };

  const respawn = (nextCap) => {
    for (let i = 0; i < FREEZE_TICKS; i++) record(); // freeze on the death frame
    snake = [
      { x: 3, y: 4 },
      { x: 2, y: 4 },
      { x: 1, y: 4 },
    ];
    dir = { x: 1, y: 0 };
    cap = nextCap;
    placeFood();
    record();
  };

  // flood fill: reachable free space from a hypothetical new position
  const key = (c) => c.x + ',' + c.y;
  function reachable(newSnake, start, limit) {
    const blocked = new Set(newSnake.slice(0, -1).map(key));
    const seen = new Set([key(start)]);
    const q = [start];
    let count = 0;
    while (q.length) {
      const c = q.pop();
      count++;
      if (count >= limit) return count;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const n = { x: c.x + dx, y: c.y + dy };
        const k = key(n);
        if (n.x < 0 || n.y < 0 || n.x >= COLS || n.y >= ROWS) continue;
        if (blocked.has(k) || seen.has(k)) continue;
        seen.add(k);
        q.push(n);
      }
    }
    return count;
  }

  record();
  let phase = 1;
  while (ticks.length < MAX_TICKS_PER_PHASE * 2 && phase <= 2) {
    const head = snake[0];

    if (phase === 1) {
      // free-roaming greedy chase with survival check
      const opts = [
        { x: 1, y: 0 },
        { x: -1, y: 0 },
        { x: 0, y: 1 },
        { x: 0, y: -1 },
      ].filter((d) => !(d.x === -dir.x && d.y === -dir.y) && legal(head, d));
      if (opts.length === 0) {
        respawn(PHASE2_LEN); // trapped: "game over", start the cycle run
        phase = 2;
        continue;
      }
      let best = null;
      let bestScore = Infinity;
      for (const d of opts) {
        const nh = { x: head.x + d.x, y: head.y + d.y };
        const eats = nh.x === food.x && nh.y === food.y;
        const newSnake = eats ? [nh, ...snake] : [nh, ...snake.slice(0, -1)];
        const area = reachable(newSnake, nh, snake.length + 2);
        const dist = Math.abs(food.x - nh.x) + Math.abs(food.y - nh.y);
        const score =
          (area >= snake.length * 0.55 ? 0 : 1000) + // unsafe: last resort
          dist +
          (d.x === dir.x && d.y === dir.y ? 0 : 0.5) + // prefer straight
          rnd() * 0.4;
        if (score < bestScore) {
          bestScore = score;
          best = d;
        }
      }
      dir = best;
      snake.unshift({ x: head.x + dir.x, y: head.y + dir.y });
      if (snake[0].x === food.x && snake[0].y === food.y) {
        placeFood();
      } else {
        snake.pop();
      }
      record();
      if (snake.length >= cap) {
        phase = 2;
        respawn(PHASE2_LEN);
      }
      continue;
    }

    // phase 2: follow the serpentine cycle — food is always ahead on the
    // cycle, so every bite grows the snake and the board gets swept
    let k = cycle.findIndex((c) => c.x === head.x && c.y === head.y);
    if (k === -1) {
      // snake is not on the cycle (odd phase-1 end): restart on the cycle
      snake = [cycle[2], cycle[1], cycle[0]];
      dir = { x: 1, y: 0 };
      food = cycle[(2 + 10) % cycle.length];
      record();
      continue;
    }
    const nk = (k + 1) % cycle.length;
    const nh = cycle[nk];
    dir = { x: nh.x - head.x, y: nh.y - head.y };
    snake.unshift({ ...nh });
    if (nh.x === food.x && nh.y === food.y) {
      // grow: keep the tail; next food appears further along the cycle
      const ahead = 8 + Math.floor(rnd() * 10);
      food = cycle[(nk + ahead) % cycle.length];
    } else {
      snake.pop();
    }
    record();
    if (snake.length >= cap) {
      for (let i = 0; i < FREEZE_TICKS; i++) record(); // freeze: board covered
      break; // loop restarts the game
    }
  }
  return ticks;
}

// ---------- svg emission ----------

const W = 600;
const H = 340;
const center = (c) => ({ x: BX + c.x * CELL + CELL / 2, y: BY + c.y * CELL + CELL / 2 });

// compact path: absolute M for the head, relative h/v for the body
function cellsToPath(cells) {
  const pts = cells.map(center);
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x;
    const dy = pts[i].y - pts[i - 1].y;
    d += dx !== 0 ? `h${dx}` : `v${dy}`;
  }
  return d;
}

function simulateAndEmit() {
  const ticks = simulate();
  const dur = (ticks.length * TICK).toFixed(2);

  const dValues = ticks.map((t) => cellsToPath(t.cells));
  dValues.push(dValues[0]); // seamless loop: last frame = first frame

  const headX = ticks.map((t) => center(t.cells[0]).x);
  const headY = ticks.map((t) => center(t.cells[0]).y);
  const foodX = ticks.map((t) => center(t.food).x);
  const foodY = ticks.map((t) => center(t.food).y);
  const list = (arr) => arr.concat(arr[0]).join(';');

  const mono = 'font-family="Menlo, Consolas, monospace"';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Retro arcade screen showing a self-playing snake game demo">
  <defs>
    <linearGradient id="crt" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#141426"/>
      <stop offset="1" stop-color="#0F0F1B"/>
    </linearGradient>
    <linearGradient id="glow" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#22D3EE"/>
      <stop offset="0.5" stop-color="#A78BFA"/>
      <stop offset="1" stop-color="#FF2E88"/>
    </linearGradient>
    <filter id="neon" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="2.5" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <pattern id="scan" width="4" height="4" patternUnits="userSpaceOnUse">
      <rect width="4" height="2" fill="rgba(255,255,255,0.03)"/>
    </pattern>
    <clipPath id="board"><rect x="${BX}" y="${BY}" width="${COLS * CELL}" height="${ROWS * CELL}" rx="6"/></clipPath>
  </defs>

  <!-- cabinet frame -->
  <rect x="4" y="4" width="${W - 8}" height="${H - 8}" rx="14" fill="url(#crt)" stroke="#A78BFA" stroke-opacity="0.55" stroke-width="2"/>
  <rect x="4" y="4" width="${W - 8}" height="${H - 8}" rx="14" fill="url(#scan)"/>

  <!-- header -->
  <text x="300" y="42" text-anchor="middle" ${mono} font-size="15" fill="#FFD166" textLength="180" lengthAdjust="spacing">BAYU ARCADE</text>
  <text x="24" y="42" ${mono} font-size="12" fill="#22D3EE">SCORE 00420</text>
  <text x="576" y="42" text-anchor="end" ${mono} font-size="12" fill="#FF2E88">HI 999999</text>
  <line x1="20" y1="56" x2="580" y2="56" stroke="url(#glow)" stroke-width="1.5"/>

  <!-- board -->
  <rect x="${BX}" y="${BY}" width="${COLS * CELL}" height="${ROWS * CELL}" rx="6" fill="#0A0A14" stroke="#A78BFA" stroke-opacity="0.35"/>

  <!-- gameplay, hard-clipped to the board -->
  <g clip-path="url(#board)">
    <path fill="none" stroke="#22D3EE" stroke-width="${CELL - 2}" stroke-linecap="round" stroke-linejoin="round" filter="url(#neon)" d="${dValues[0]}">
      <animate attributeName="d" dur="${dur}s" repeatCount="indefinite" calcMode="discrete" values="${dValues.join(';')}"/>
    </path>
    <circle r="11" fill="#FF2E88" filter="url(#neon)" cx="${headX[0]}" cy="${headY[0]}">
      <animate attributeName="cx" dur="${dur}s" repeatCount="indefinite" calcMode="discrete" values="${list(headX)}"/>
      <animate attributeName="cy" dur="${dur}s" repeatCount="indefinite" calcMode="discrete" values="${list(headY)}"/>
    </circle>
    <circle r="8" fill="#FFD166" filter="url(#neon)" cx="${foodX[0]}" cy="${foodY[0]}">
      <animate attributeName="cx" dur="${dur}s" repeatCount="indefinite" calcMode="discrete" values="${list(foodX)}"/>
      <animate attributeName="cy" dur="${dur}s" repeatCount="indefinite" calcMode="discrete" values="${list(foodY)}"/>
      <animate attributeName="opacity" values="1;0.55;1" dur="0.9s" repeatCount="indefinite"/>
    </circle>
  </g>

  <!-- footer: attract-mode blink -->
  <text x="300" y="318" text-anchor="middle" ${mono} font-size="14" fill="#FFD166" textLength="220" lengthAdjust="spacing">INSERT COIN &#9654; PLAY
    <animate attributeName="opacity" values="1;0.15;1" dur="1.2s" repeatCount="indefinite"/>
  </text>
</svg>
`;
}

fs.writeFileSync(OUT, simulateAndEmit());
const ticks = simulate();
console.log(`wrote ${OUT}: ${ticks.length} ticks, loop ${(ticks.length * TICK).toFixed(1)}s, peak snake ${Math.max(...ticks.map((t) => t.cells.length))} cells of ${COLS * ROWS}`);
