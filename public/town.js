// ============================================================================
// town.js - the surroundings of the site: two crossing streets with signals and traffic,
// a fenced job site, and the equipment on it. Loaded after the main script, so it can use
// its scene, ground, makePerson() and OBSTACLES. All sizes are in feet.
//
// - The traffic is only scenery: every screen runs its own copy, nothing is sent over the network.
//   Press T to turn the traffic off (a lighter scene for phones).
// - The big pieces of equipment are solid: if the rig, the spreader or the load touches one, it is
//   game over, like touching the building (see OBSTACLES in index.html).
// ============================================================================
(function () {
  'use strict';

  const town = new THREE.Group();
  town.name = 'town';
  scene.add(town);

  // ---------- small helpers ----------
  const mats = {};
  function mat(color, opts) {
    const key = color + ':' + (opts ? JSON.stringify(opts) : '');
    return mats[key] || (mats[key] = new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.9, metalness: 0 }, opts || {})));
  }
  // Box with its BOTTOM at y, centred on x, z
  function box(parent, w, h, d, color, x, y, z, noShadow) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
    m.position.set(x, y + h / 2, z);
    if (!noShadow) { m.castShadow = true; m.receiveShadow = true; }
    parent.add(m);
    return m;
  }
  // Upright cylinder with its bottom at y
  function cyl(parent, rTop, rBottom, h, color, x, y, z, seg, noShadow) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, h, seg || 10), mat(color));
    m.position.set(x, y + h / 2, z);
    if (!noShadow) { m.castShadow = true; m.receiveShadow = true; }
    parent.add(m);
    return m;
  }
  // Flat paint on the ground (sizeX along x, sizeZ along z), drawn over the asphalt without flicker
  const flatMats = {};
  function flat(parent, sizeX, sizeZ, color, x, z, y, order) {
    const key = color + ':' + order;
    const material = flatMats[key] || (flatMats[key] = new THREE.MeshStandardMaterial({ color, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -order, polygonOffsetUnits: -order }));
    const m = new THREE.Mesh(new THREE.PlaneGeometry(sizeX, sizeZ), material);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y, z);
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }
  // Solid equipment: a box in world space that ends the game if touched
  function solid(name, cx, cz, sizeX, sizeZ, height, y0) {
    const y = y0 || 0;
    OBSTACLES.push({ name, minX: cx - sizeX / 2, maxX: cx + sizeX / 2, minY: y, maxY: y + height, minZ: cz - sizeZ / 2, maxZ: cz + sizeZ / 2 });
  }
  // Merge the meshes under `root` that share a material into one mesh each, so the scene needs far fewer
  // draw calls (this matters on phones). Textured meshes and anything under `skip` are left alone.
  function mergeStatic(root, skip) {
    root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
    const list = [];
    (function walk(o) {
      if (o === skip) return;
      if (o.isMesh && !o.isInstancedMesh && !o.material.map && o.geometry.attributes.position) list.push(o);
      o.children.forEach(walk);
    })(root);
    const buckets = new Map(), rel = new THREE.Matrix4(), nm = new THREE.Matrix3(), v = new THREE.Vector3();
    for (const m of list) {
      const key = m.material.uuid + '|' + (m.castShadow ? 1 : 0) + (m.receiveShadow ? 1 : 0);
      let b = buckets.get(key);
      if (!b) { b = { material: m.material, cast: m.castShadow, receive: m.receiveShadow, pos: [], nor: [] }; buckets.set(key, b); }
      const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry;
      rel.multiplyMatrices(inv, m.matrixWorld);
      nm.getNormalMatrix(rel);
      const P = g.attributes.position, N = g.attributes.normal;
      for (let i = 0; i < P.count; i++) {
        v.fromBufferAttribute(P, i).applyMatrix4(rel);
        b.pos.push(v.x, v.y, v.z);
        if (N) { v.fromBufferAttribute(N, i).applyMatrix3(nm).normalize(); b.nor.push(v.x, v.y, v.z); }
      }
      m.parent.remove(m);
      if (g !== m.geometry) g.dispose();
      m.geometry.dispose();
    }
    for (const b of buckets.values()) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
      if (b.nor.length === b.pos.length) g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3)); else g.computeVertexNormals();
      const mesh = new THREE.Mesh(g, b.material);
      mesh.castShadow = b.cast; mesh.receiveShadow = b.receive;
      root.add(mesh);
    }
  }
  function seeded(seed) { // small repeatable random numbers
    let s = seed >>> 0;
    return function () { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function labelTexture(lines, bg, fg) {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 192;
    const x = c.getContext('2d');
    x.fillStyle = bg; x.fillRect(0, 0, 512, 192);
    x.strokeStyle = fg; x.lineWidth = 8; x.strokeRect(8, 8, 496, 176);
    x.fillStyle = fg; x.textAlign = 'center'; x.textBaseline = 'middle';
    lines.forEach((t, i) => { x.font = (i === 0 ? 'bold 56px' : 'bold 40px') + ' sans-serif'; x.fillText(t, 256, 62 + i * 70); });
    return new THREE.CanvasTexture(c);
  }

  // ---------- the ground: bigger, so the streets have room ----------
  ground.scale.set(3.4, 3.4, 1); // 300 ft -> 1,020 ft square

  // ========================================================================
  // STREETS: two 36 ft streets crossing near the close-left corner (seen from the rig's start)
  // ========================================================================
  const CX = 100, CZ = 100;        // centre of the intersection
  const HALF = 18, SW = 8;         // half street width, sidewalk width
  const EXT = 480;                 // how far the streets run
  const ASPHALT = 0x3a3d42, WALK = 0xb9b6ad, YELLOW = 0xe8b800, WHITE = 0xf0f0ee;

  flat(town, 2 * EXT, 2 * HALF, ASPHALT, 0, CZ, 0.05, 1);  // street A runs along x
  flat(town, 2 * HALF, 2 * EXT, ASPHALT, CX, 0, 0.05, 1);  // street B runs along z

  // Centre lines and edge lines stop before the crosswalks
  const CLEAR = HALF + 11;
  const segsX = [[-EXT, CX - CLEAR], [CX + CLEAR, EXT]];
  const segsZ = [[-EXT, CZ - CLEAR], [CZ + CLEAR, EXT]];
  for (const [a, b] of segsX) {
    const len = b - a, mid = (a + b) / 2;
    flat(town, len, 0.4, YELLOW, mid, CZ - 0.35, 0.1, 3);
    flat(town, len, 0.4, YELLOW, mid, CZ + 0.35, 0.1, 3);
    flat(town, len, 0.5, WHITE, mid, CZ - HALF + 1, 0.1, 3);
    flat(town, len, 0.5, WHITE, mid, CZ + HALF - 1, 0.1, 3);
  }
  for (const [a, b] of segsZ) {
    const len = b - a, mid = (a + b) / 2;
    flat(town, 0.4, len, YELLOW, CX - 0.35, mid, 0.1, 3);
    flat(town, 0.4, len, YELLOW, CX + 0.35, mid, 0.1, 3);
    flat(town, 0.5, len, WHITE, CX - HALF + 1, mid, 0.1, 3);
    flat(town, 0.5, len, WHITE, CX + HALF - 1, mid, 0.1, 3);
  }
  // Crosswalks (zebra bars, 8 ft deep) and stop lines on all four approaches
  for (const side of [-1, 1]) {
    for (let i = 0; i < 12; i++) {
      const off = -HALF + 1.5 + i * 3;
      flat(town, 8, 1.5, WHITE, CX + side * (HALF + 5), CZ + off + 1.5, 0.1, 3); // across street A, east and west of the crossing
      flat(town, 1.5, 8, WHITE, CX + off + 1.5, CZ + side * (HALF + 5), 0.1, 3); // across street B, north and south
    }
  }
  flat(town, 1.2, HALF - 1, WHITE, CX - HALF - 10.5, CZ + HALF / 2, 0.1, 3);  // eastbound stop line (right-hand lane, +z)
  flat(town, 1.2, HALF - 1, WHITE, CX + HALF + 10.5, CZ - HALF / 2, 0.1, 3);  // westbound
  flat(town, HALF - 1, 1.2, WHITE, CX - HALF / 2, CZ - HALF - 10.5, 0.1, 3);  // southbound... (travelling +z, right-hand lane is -x)
  flat(town, HALF - 1, 1.2, WHITE, CX + HALF / 2, CZ + HALF + 10.5, 0.1, 3);

  // Sidewalks (raised 6 in). Street A's strips run the full length; street B's stop short of them
  for (const side of [-1, 1]) {
    box(town, 2 * EXT, 0.5, SW, WALK, 0, 0, CZ + side * (HALF + SW / 2));
    const zFrom = side < 0 ? -EXT : CZ + HALF + SW, zTo = side < 0 ? CZ - HALF - SW : EXT;
    for (const [a, b] of [[-EXT, CZ - HALF - SW], [CZ + HALF + SW, EXT]]) {
      box(town, SW, 0.5, b - a, WALK, CX + side * (HALF + SW / 2), 0, (a + b) / 2);
    }
  }

  // ---------- corner poles: street light + traffic signal heads ----------
  const lensMats = []; // [{street, color, lit, dim, mesh material}]
  function signalHead(parent, street, fx, fz, x, y, z) {
    const head = new THREE.Group();
    head.position.set(x, y, z);
    head.rotation.y = Math.atan2(fx, fz); // faces along (fx, fz)
    box(head, 1.4, 3.8, 1.2, 0x15171a, 0, 0, 0, true);
    const colors = [['red', 0xff2a1a, 0x3a0d0a, 2.7], ['yellow', 0xffc21a, 0x3a2e0a, 1.8], ['green', 0x22e060, 0x0a3018, 0.9]];
    for (const [name, lit, dim, h] of colors) {
      const lens = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.2), new THREE.MeshBasicMaterial({ color: dim }));
      lens.position.set(0, h, 0.65);
      head.add(lens);
      lensMats.push({ street, name, lit, dim, material: lens.material });
    }
    parent.add(head);
  }
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const px = CX + sx * (HALF + 2.5), pz = CZ + sz * (HALF + 2.5);
      cyl(town, 0.35, 0.45, 26, 0x555a60, px, 0, pz, 8);
      // lamp arm reaching toward the intersection
      box(town, 0.4, 0.4, 7, 0x555a60, px, 25, pz - sz * 3.2, true);
      box(town, 1.1, 0.4, 2.2, 0xfff2c0, px, 24.5, pz - sz * 6.6, true).material = new THREE.MeshBasicMaterial({ color: 0xfff2c0 });
      // two signal heads, one for each street, facing the traffic that approaches from outside the crossing
      signalHead(town, 'A', sx, 0, px + sx * 1.2, 13, pz);
      signalHead(town, 'B', 0, sz, px, 13, pz + sz * 1.2);
    }
  }

  // ========================================================================
  // TRAFFIC: cars follow each other on four lanes and stop at red lights
  // ========================================================================
  const trafficGroup = new THREE.Group();
  town.add(trafficGroup);
  const PALETTE = [0xb22222, 0x1f4e8c, 0xdadada, 0x222222, 0x2e7d32, 0xc9a227, 0x6a1b9a, 0x888c90];

  function wheels(g, len, w, r) {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const wh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.8, 10), mat(0x101010));
      wh.rotation.x = Math.PI / 2;
      wh.position.set(sx * len * 0.32, r, sz * (w / 2 - 0.2));
      g.add(wh);
    }
  }
  // Vehicles point along +x with their centre at the origin
  function makeVehicle(type, color) {
    const g = new THREE.Group();
    let len;
    if (type === 'bus') {
      len = 36; box(g, len, 8, 8.5, 0xf2b705, 0, 1.2, 0, true); box(g, len + 0.1, 2.2, 8.6, 0x1b2733, 0, 4.6, 0, true); box(g, len + 0.2, 0.4, 8.7, 0x111111, 0, 3.6, 0, true); wheels(g, len * 1.1, 8.5, 1.5);
    } else if (type === 'truck') {
      len = 26; box(g, 18, 8.5, 8, 0xe8e8e8, -3.5, 2.2, 0, true); box(g, 7, 6, 7.6, color, 9.5, 1.4, 0, true); box(g, 0.2, 2, 6.8, 0x1b2733, 13.1, 4.2, 0, true); wheels(g, len * 1.15, 8, 1.5);
    } else if (type === 'pickup') {
      len = 18; box(g, len, 2.4, 6.6, color, 0, 1.3, 0, true); box(g, 6, 2.4, 5.8, 0x1b2733, 2.2, 3.7, 0, true); box(g, 6.2, 0.3, 6, color, 2.2, 6.1, 0, true); wheels(g, len, 6.6, 1.3);
    } else {
      len = 15; box(g, len, 2.3, 6.2, color, 0, 1.2, 0, true); box(g, 8, 2.2, 5.4, 0x1b2733, -0.8, 3.5, 0, true); box(g, 7.4, 0.3, 5.6, color, -0.8, 5.7, 0, true); wheels(g, len, 6.2, 1.1);
    }
    g.userData.len = len;
    mergeStatic(g); // a handful of meshes per vehicle instead of dozens
    return g;
  }

  const LANE_LEN = 900, HALFL = LANE_LEN / 2;
  const STOP_P = HALFL - HALF - 10.5;  // stop line, measured along the lane from its start
  // Driving on the right: eastbound (+x) uses z = CZ + 6, westbound z = CZ - 6, northbound... (+z) x = CX - 6, (-z) x = CX + 6
  const lanes = [
    { street: 'A', axis: 'x', sign: +1, fixed: CZ + 6, rotY: 0 },
    { street: 'A', axis: 'x', sign: -1, fixed: CZ - 6, rotY: Math.PI },
    { street: 'B', axis: 'z', sign: +1, fixed: CX - 6, rotY: -Math.PI / 2 },
    { street: 'B', axis: 'z', sign: -1, fixed: CX + 6, rotY: Math.PI / 2 },
  ];
  const rnd = seeded(20261004);
  const TYPES = ['sedan', 'sedan', 'pickup', 'sedan', 'truck', 'sedan', 'bus', 'sedan'];
  lanes.forEach((lane, li) => {
    lane.cars = [];
    const n = 8;
    for (let i = 0; i < n; i++) {
      const type = TYPES[(i + li * 3) % TYPES.length];
      const mesh = makeVehicle(type, PALETTE[Math.floor(rnd() * PALETTE.length)]);
      mesh.rotation.y = lane.rotY;
      trafficGroup.add(mesh);
      lane.cars.push({ mesh, len: mesh.userData.len, p: (i + rnd() * 0.5) * (LANE_LEN / n), v: 20 + rnd() * 8, v0: 28 + rnd() * 6 });
    }
  });

  // Signals: street A green 16 s, yellow 3 s, both red 2 s, then street B the same: 42 s in all
  const CYCLE = 42;
  function lightsAt(t) {
    const c = ((t % CYCLE) + CYCLE) % CYCLE;
    if (c < 16) return { A: 'green', B: 'red' };
    if (c < 19) return { A: 'yellow', B: 'red' };
    if (c < 21) return { A: 'red', B: 'red' };
    if (c < 37) return { A: 'red', B: 'green' };
    if (c < 40) return { A: 'red', B: 'yellow' };
    return { A: 'red', B: 'red' };
  }
  const IDM = { a: 6, b: 9, s0: 8, T: 1.2 }; // ft/s^2 acceleration, comfortable braking, minimum gap, time gap
  let clockT = rnd() * CYCLE, shown = { A: '', B: '' };

  function stepLane(lane, dt, light) {
    const order = lane.cars.slice().sort((p, q) => p.p - q.p);
    const n = order.length;
    for (let k = 0; k < n; k++) {
      const c = order[k], lead = order[(k + 1) % n];
      let acc = IDM.a * (1 - Math.pow(c.v / c.v0, 4));
      if (n > 1) {
        let gap = (lead.p - lead.len / 2) - (c.p + c.len / 2);
        if (gap < 0) gap += LANE_LEN;
        const sStar = IDM.s0 + Math.max(0, c.v * IDM.T + c.v * (c.v - lead.v) / (2 * Math.sqrt(IDM.a * IDM.b)));
        acc -= IDM.a * Math.pow(sStar / Math.max(gap, 0.1), 2);
      }
      const toStop = STOP_P - (c.p + c.len / 2);
      if (light !== 'green' && toStop > -1 && toStop < 160) {
        const canStopOnYellow = (c.v * c.v) / (2 * 3.5) <= toStop;
        if (light === 'red' || canStopOnYellow) {
          const sStar = IDM.s0 * 0.4 + Math.max(0, c.v * IDM.T + c.v * c.v / (2 * Math.sqrt(IDM.a * IDM.b)));
          acc = Math.min(acc, IDM.a * (1 - Math.pow(c.v / c.v0, 4) - Math.pow(sStar / Math.max(toStop, 0.1), 2)));
        }
      }
      c.v = Math.max(0, c.v + acc * dt);
      c.p += c.v * dt;
      if (c.p >= LANE_LEN) c.p -= LANE_LEN;
    }
  }
  function placeCars() {
    for (const lane of lanes) {
      for (const c of lane.cars) {
        const along = lane.sign * (c.p - HALFL);
        if (lane.axis === 'x') c.mesh.position.set(CX + along, 0, lane.fixed);
        else c.mesh.position.set(lane.fixed, 0, CZ + along);
      }
    }
  }
  function setLenses(state) {
    for (const L of lensMats) L.material.color.setHex(state[L.street] === L.name ? L.lit : L.dim);
  }

  let trafficOn = true;
  function updateTown(dt) {
    dt = Math.min(dt, 0.1);
    clockT += dt;
    const state = lightsAt(clockT);
    if (state.A !== shown.A || state.B !== shown.B) { shown = state; setLenses(state); }
    if (!trafficOn) return;
    for (let t = 0; t < dt; t += 0.05) {
      const h = Math.min(0.05, dt - t);
      for (const lane of lanes) stepLane(lane, h, state[lane.street]);
    }
    placeCars();
  }
  // Start with the cars already moving and the lights set
  { const s = lightsAt(clockT); shown = s; setLenses(s); for (let i = 0; i < 400; i++) { clockT += 0.05; const st = lightsAt(clockT); for (const lane of lanes) stepLane(lane, 0.05, st[lane.street]); } shown = lightsAt(clockT); setLenses(shown); placeCars(); }
  window.addEventListener('keydown', (e) => {
    if (e.target && e.target.tagName === 'INPUT') return;
    if (e.key.toLowerCase() === 't') { trafficOn = !trafficOn; trafficGroup.visible = trafficOn; }
  });

  // ========================================================================
  // THE JOB SITE: fence, signs, equipment, workers
  // ========================================================================
  const site = new THREE.Group();
  town.add(site);
  const FX0 = -130, FX1 = 70, FZ0 = -75, FZ1 = 70; // fence rectangle
  const GATE = { side: 'x1', from: 30, to: 55 };    // an opening on the street side, for trucks

  // Chain-link fence: posts every 10 ft and see-through panels
  const fenceCanvas = document.createElement('canvas');
  fenceCanvas.width = fenceCanvas.height = 64;
  { const x = fenceCanvas.getContext('2d'); x.strokeStyle = '#9aa0a6'; x.lineWidth = 3;
    x.beginPath(); x.moveTo(0, 0); x.lineTo(64, 64); x.moveTo(64, 0); x.lineTo(0, 64); x.stroke(); }
  const fenceTex = new THREE.CanvasTexture(fenceCanvas);
  fenceTex.wrapS = fenceTex.wrapT = THREE.RepeatWrapping;
  function fenceRun(x0, z0, x1, z1) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    if (len < 1) return;
    const tex = fenceTex.clone(); tex.needsUpdate = true; tex.repeat.set(len / 4, 6 / 4);
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(len, 6),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide }));
    panel.position.set((x0 + x1) / 2, 3.2, (z0 + z1) / 2);
    panel.rotation.y = -Math.atan2(z1 - z0, x1 - x0);
    site.add(panel);
    const posts = Math.max(1, Math.round(len / 10));
    for (let i = 0; i <= posts; i++) {
      const t = i / posts;
      cyl(site, 0.18, 0.18, 6.6, 0x7b8086, x0 + (x1 - x0) * t, 0, z0 + (z1 - z0) * t, 6, true);
    }
  }
  fenceRun(FX0, FZ0, FX1, FZ0);                 // far side (along x, z = FZ0)
  fenceRun(FX0, FZ1, FX1, FZ1);                 // street side (z = FZ1)
  fenceRun(FX0, FZ0, FX0, FZ1);                 // back (x = FX0)
  fenceRun(FX1, FZ0, FX1, GATE.from);           // x = FX1 with a gate opening
  fenceRun(FX1, GATE.to, FX1, FZ1);
  // Gate posts
  for (const z of [GATE.from, GATE.to]) box(site, 0.8, 8, 0.8, 0xc0392b, FX1, 0, z, true);

  // Safety signs on the street-side fence
  [[-20, ['HARD HATS', 'REQUIRED'], '#f2b705', '#111'], [20, ['DANGER', 'OVERHEAD LOADS'], '#c0392b', '#fff'], [55, ['AUTHORIZED', 'PERSONNEL ONLY'], '#fff', '#c0392b']].forEach(([x, lines, bg, fg]) => {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(8, 3), new THREE.MeshBasicMaterial({ map: labelTexture(lines, bg, fg), side: THREE.DoubleSide }));
    s.position.set(x, 4.2, FZ1 + 0.1);
    site.add(s);
  });

  // ---------- equipment ----------
  const CONCRETE = 0xa7a49c;

  function siteTrailer(x, z) { // office trailer, long side along x
    const g = new THREE.Group(); g.position.set(x, 0, z); site.add(g);
    box(g, 40, 0.8, 10, 0x555555, 0, 0.6, 0);
    box(g, 40, 8.6, 10, 0xe9e6dd, 0, 1.4, 0);
    box(g, 41, 0.5, 10.8, 0x777b80, 0, 10, 0);
    for (const wx of [-13, -4, 5, 14]) box(g, 3.5, 3, 0.2, 0x1b2733, wx, 5, 5.05, true);
    box(g, 3, 6.5, 0.2, 0x5b3a24, -17, 1.4, 5.05, true);
    box(g, 4, 1.4, 3, 0x888888, -17, 0, 6.8);
    box(g, 3, 2.5, 3, 0xd0d0d0, 14, 10.5, 0);
    solid('site trailer', x, z, 41, 10.8, 11);
  }
  function dumpster(x, z) { // roll-off container, long side along x
    const g = new THREE.Group(); g.position.set(x, 0, z); site.add(g);
    box(g, 22, 5.5, 8, 0x1e6b3a, 0, 0.5, 0);
    box(g, 22.4, 0.5, 8.4, 0x145230, 0, 6, 0);
    box(g, 21, 0.5, 7.4, 0x6b5a3a, 0, 5.3, 0, true); // rubbish
    box(g, 22, 0.6, 1, 0x333333, 0, 0, -3); box(g, 22, 0.6, 1, 0x333333, 0, 0, 3);
    solid('dumpster', x, z, 22.4, 8.4, 6.5);
  }
  function conex(x, z, color) { // shipping container, long side along x
    const g = new THREE.Group(); g.position.set(x, 0, z); site.add(g);
    box(g, 20, 8.5, 8, color, 0, 0, 0);
    for (let i = -9; i <= 9; i += 1.5) box(g, 0.3, 8.5, 8.3, color, i, 0, 0, true);
    solid('storage container', x, z, 20.3, 8.3, 8.5);
  }
  function mixerTruck(x, z) { // concrete mixer, long side along z (nose toward -z)
    const g = new THREE.Group(); g.position.set(x, 0, z); site.add(g);
    box(g, 8, 2.2, 30, 0x2a2d31, 0, 1.6, 0);
    box(g, 8, 6.5, 8, 0xe8e8e8, 0, 3.8, -10.5);
    box(g, 7.6, 2.4, 0.2, 0x1b2733, 0, 7.6, -14.6, true);
    for (const wz of [-10, 6, 11.5]) for (const wx of [-4, 4]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 1.2, 12), mat(0x101010)); w.rotation.z = Math.PI / 2; w.position.set(wx, 2, wz); g.add(w); }
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(4.3, 3.2, 20, 16), mat(0xf28c28));
    drum.rotation.x = Math.PI / 2 + 0.22; drum.position.set(0, 8.2, 6); drum.castShadow = true; g.add(drum);
    solid('concrete mixer truck', x, z, 9, 30, 12.6);
  }
  function portaPotty(x, z, color) {
    const g = new THREE.Group(); g.position.set(x, 0, z); site.add(g);
    box(g, 4, 7.6, 4, color, 0, 0, 0); box(g, 4.2, 0.4, 4.2, 0xdddddd, 0, 7.6, 0, true);
    box(g, 2.4, 6, 0.15, 0xe8e8e8, 0, 0.4, 2.05, true);
    solid('portable toilet', x, z, 4.2, 4.2, 8);
  }
  function lumberStack(x, z) { // along x
    const g = new THREE.Group(); g.position.set(x, 0, z); site.add(g);
    box(g, 16, 0.6, 4, 0x6b5a3a, 0, 0, 0);
    for (let i = 0; i < 6; i++) box(g, 16, 0.5, 4, i % 2 ? 0xd2ac6a : 0xc29a58, 0, 0.6 + i * 0.55, 0);
    box(g, 0.3, 4, 4.2, 0x2255aa, -4, 0.2, 0, true); box(g, 0.3, 4, 4.2, 0x2255aa, 4, 0.2, 0, true);
    solid('lumber stack', x, z, 16, 4, 4);
  }
  function rebarBundle(x, z) { // along x
    const g = new THREE.Group(); g.position.set(x, 0, z); site.add(g);
    box(g, 20, 0.5, 4, 0x6b5a3a, 0, 0, 0);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 6; c++) {
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 20, 6), mat(0x7a4b2a));
      bar.rotation.z = Math.PI / 2; bar.position.set(0, 0.9 + r * 0.45, -1.7 + c * 0.68); bar.castShadow = true; g.add(bar);
    }
    solid('rebar bundle', x, z, 20, 4, 2.4);
  }
  function brickPallets(x, z) {
    const g = new THREE.Group(); g.position.set(x, 0, z); site.add(g);
    for (let i = 0; i < 3; i++) { box(g, 4, 0.5, 4, 0x6b5a3a, i * 4.6, 0, 0); box(g, 3.8, 3.2, 3.8, 0x9c4a32, i * 4.6, 0.5, 0); box(g, 3.9, 0.2, 3.9, 0xd8d8d8, i * 4.6, 3.7, 0, true); }
    solid('brick pallets', x + 4.6, z, 13.8, 4, 3.9);
  }
  function lightTower(x, z) {
    const g = new THREE.Group(); g.position.set(x, 0, z); site.add(g);
    box(g, 6, 2, 4, 0xf2b705, 0, 0, 0); cyl(g, 0.3, 0.45, 26, 0x555a60, 0, 2, 0, 8);
    const lamp = box(g, 7, 3, 1, 0x333333, 0, 27, 0, true);
    lamp.material = new THREE.MeshBasicMaterial({ color: 0xfff6d8 });
    solid('light tower base', x, z, 6, 4, 2);
    solid('light tower mast', x, z, 1.2, 1.2, 30);
  }
  function generator(x, z) {
    const g = new THREE.Group(); g.position.set(x, 0, z); site.add(g);
    box(g, 6, 4.5, 3, 0xf2b705, 0, 0.4, 0); box(g, 5.6, 0.3, 2.6, 0x333333, 0, 4.9, 0, true); cyl(g, 0.25, 0.25, 1.6, 0x333333, 2, 4.9, 0, 6, true);
    solid('generator', x, z, 6, 3, 5.2);
  }
  function jerseyBarrier(x, z) { // 10 ft long, along x
    const g = new THREE.Group(); g.position.set(x, 0, z); site.add(g);
    box(g, 10, 1, 2, CONCRETE, 0, 0, 0); box(g, 10, 1.6, 1.2, CONCRETE, 0, 1, 0);
    solid('barrier', x, z, 10, 2, 2.7);
  }
  function cone(x, z) { // not solid
    const g = new THREE.Group(); g.position.set(x, 0, z); site.add(g);
    box(g, 1.4, 0.15, 1.4, 0x222222, 0, 0, 0, true); cyl(g, 0.15, 0.6, 2.2, 0xff6a00, 0, 0.15, 0, 8, true); cyl(g, 0.3, 0.4, 0.4, 0xffffff, 0, 1.0, 0, 8, true);
  }
  function parkedPickup(x, z, rotY, color) {
    const v = makeVehicle('pickup', color);
    v.position.set(x, 0, z); v.rotation.y = rotY; site.add(v);
    const along = rotY === 0 || rotY === Math.PI;
    solid('pickup truck', x, z, along ? 18 : 6.8, along ? 6.8 : 18, 6.4);
  }
  function worker(x, z, yaw) {
    if (typeof makePerson !== 'function') return;
    const p = makePerson(); p.position.set(x, 0, z); p.rotation.y = yaw; site.add(p);
  }

  siteTrailer(40, -58);
  dumpster(-25, -62);
  conex(-100, -67, 0x8a3b2a);   // the building fills x -106..-40, z -54..+36: keep equipment outside that
  conex(-76, -69, 0x2f5f8a);
  generator(-55, -61);
  portaPotty(62, -25, 0x2a6fb8); portaPotty(62, -19, 0x2a6fb8); portaPotty(62, -13, 0x2a6fb8);
  mixerTruck(58, 42);
  parkedPickup(32, 52, Math.PI / 2, 0xc0392b);
  lumberStack(-48, 52);
  rebarBundle(-72, 56);
  brickPallets(-95, 50);
  lightTower(-30, 58); lightTower(-75, -58);
  // Barrier rows mark the lane the crane works in (z = +-30, from the start area up to the building)
  for (const z of [-30, 30]) for (let x = 0; x >= -30; x -= 10) jerseyBarrier(x, z);
  // Cones around the pick-up area and at the foot of the building
  for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2; cone(Math.cos(a) * 27 + 5, Math.sin(a) * 27); }
  for (const z of [-14, 14, -22, 22]) cone(-38, z);
  // Workers (not solid): they keep the site looking alive
  worker(30, -50, 0.6); worker(-18, -55, -2.2); worker(52, 34, 3.0); worker(-60, 50, 1.4); worker(-85, -44, 2.5);

  mergeStatic(town, trafficGroup); // streets, signals and the whole job site: one mesh per material

  window.updateTown = updateTown;
  window.TOWN = { lanes, lights: () => shown, centre: [CX, CZ], half: HALF, setTraffic(on) { trafficOn = on; trafficGroup.visible = on; }, group: town };
})();
