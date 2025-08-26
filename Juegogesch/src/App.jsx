import React, { useEffect, useState, useRef } from 'react';
import * as THREE from 'three';
import { QUESTIONS } from './preguntas'; // Asegúrate de tener este archivo con preguntas

export default function App() {
  // ---- UI state ----
  const [difficulty, setDifficulty] = useState('medium');
  const [voidUrl, setVoidUrl] = useState('https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?q=80&w=1600&auto=format&fit=crop');
  const [menuOpen, setMenuOpen] = useState(true); // El menú se muestra por defecto
  const [inQuiz, setInQuiz] = useState(false);
  const [ended, setEnded] = useState(false);
  const [result, setResult] = useState({ title: '', msg: '' });

  // HUD
  const [lives, setLives] = useState(3);
  const [checkpoint, setCheckpoint] = useState('Inicio');
  const [tSpd, setTSpd] = useState(0);
  const [tJmp, setTJmp] = useState(0);
  const [tGlide, setTGlide] = useState(0);
  const [tShield, setTShield] = useState(0);

  // Quiz actual
  const [q, setQ] = useState(null);

  // Sensibilidad mouse (ajustable)
  const sensRef = useRef(0.0011);

  // canvas
  const canvasRef = useRef(null);
  // comandos desde UI -> motor
  const cmdRef = useRef(null);
  // refs para leer estado actual dentro del loop
  const diffRef = useRef(difficulty);
  const livesRef = useRef(lives);
  // mouseRef debe estar aquí:
  const mouseRef = useRef({ x: 0, y: 0 });

  // Variables para el inicio y checkpoint
  const startPos = new THREE.Vector3(0, 2, 0);
  const lastCheckpoint = new THREE.Vector3(0, 2, 0);

  // NEW: última posición segura (donde estabas de pie) para “reaparecer en el mismo lugar”
  const safePosRef = useRef(startPos.clone());

  useEffect(() => { diffRef.current = difficulty }, [difficulty]);
  useEffect(() => { livesRef.current = lives }, [lives]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, 2, 0.1, 1200);
    camera.position.set(0, 6, 14);

    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const sun = new THREE.DirectionalLight(0xffffff, 0.95);
    sun.position.set(10, 14, 6);
    scene.add(sun);

    // ---- INPUT ----
    const keys = { w: false, a: false, s: false, d: false, up: false, down: false, left: false, right: false, space: false, spaceHold: false };
    function key(e, v) {
      switch (e.code) {
        case 'KeyW': keys.w = v; break; case 'KeyA': keys.a = v; break; case 'KeyS': keys.s = v; break; case 'KeyD': keys.d = v; break;
        case 'ArrowUp': keys.up = v; break; case 'ArrowDown': keys.down = v; break; case 'ArrowLeft': keys.left = v; break; case 'ArrowRight': keys.right = v; break;
        case 'Space': keys.space = v; keys.spaceHold = v; if (v) jumpBufferTimer = JUMP_BUFFER; break;
      }
    }
    const onKeyDown = e => key(e, true);
    const onKeyUp = e => key(e, false);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    // ---- CAMERA CONTROL (con mouse y pointer lock) ----
    let pointerLocked = false;
    const onPointerLockChange = () => {
      pointerLocked = document.pointerLockElement === canvas;
    };
    document.addEventListener('pointerlockchange', onPointerLockChange);

    const onMouseMove = (e) => {
      if (!pointerLocked) return;
      const sensitivity = sensRef.current;
      // Usar movementX/Y para rotar la cámara
      game.yaw += e.movementX * sensitivity;
      game.pitch -= e.movementY * sensitivity;
      // Limitar el pitch para no voltear la cámara
      game.pitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, game.pitch));
      // NEW: no seteamos camera.rotation aquí; la cámara seguirá al jugador en el loop con lookAt
      // camera.rotation.set(game.pitch, game.yaw, 0);
    };

    document.addEventListener('mousemove', onMouseMove);

    // ---- PLAYER (cambiado a un cubo como personaje de ejemplo) ----
    const playerGeo = new THREE.BoxGeometry(1, 2, 1); // Personaje como un cubo
    const playerMat = new THREE.MeshStandardMaterial({ color: 0x60a5fa, metalness: .25, roughness: .45 });
    const player = new THREE.Mesh(playerGeo, playerMat);
    scene.add(player);

    // ---- GAME STATE ----
    const game = {
      vel: new THREE.Vector3(),
      onGround: false,
      groundedPlatform: null,
      lives: 3,
      yaw: 0, pitch: 0,
      playing: false,
      inQuiz: false,
      ended: false,
      pSpeed: 0, pJump: 0, pGlide: 0, pShield: 0, // pShield = cargas de escudo
    };

    const setLivesHUD = (n) => setLives(n);
    const setCheckpointLabel = (txt) => setCheckpoint(txt);
    const updateTimersHUD = () => {
      setTSpd(Math.ceil(Math.max(0, game.pSpeed)));
      setTJmp(Math.ceil(Math.max(0, game.pJump)));
      setTGlide(Math.ceil(Math.max(0, game.pGlide)));
      setTShield(game.pShield);
    };

    const MOVE_ACCEL = 48, MOVE_AIR_ACCEL = 18, GROUND_FRICTION = 14, AIR_DRAG = 1.0;
    const MAX_GROUND_SPEED = 10.5, MAX_AIR_SPEED = 10.0;
    const GRAVITY = -24, GLIDE_GRAVITY = -9;
    const JUMP_VEL = 10.5, JUMP_VEL_BOOST = 1.5;
    const COYOTE_TIME = 0.12, JUMP_BUFFER = 0.12, JUMP_CUT = -30;

    let coyoteTimer = 0, jumpBufferTimer = 0;

    // ---- MAP ----
    const platforms = [], hazards = [], movers = [], elevators = [];
    const powerups = []; // NEW

    function clearMap() {
      platforms.forEach(p => scene.remove(p.mesh));
      platforms.length = 0;
      powerups.forEach(p => scene.remove(p.mesh));
      powerups.length = 0;
    }

    function addPlatform(x, y, z, w = 7.5, h = 1, d = 7.5, color = 0x1f2937) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, roughness: .9, metalness: .1 }));
      m.position.set(x, y, z); scene.add(m);
      const p = { mesh: m, w, h, d, isGoal: false, isCheckpoint: false, lastPos: m.position.clone() };
      platforms.push(p);
      return p;
    }

    // NEW: power-ups (escudo, vida, velocidad, salto, planeo)
    function addPowerup(x, y, z, kind = 'shield') {
      let geom, color;
      switch (kind) {
        case 'life': geom = new THREE.SphereGeometry(0.55, 20, 16); color = 0xff4d4d; break;
        case 'speed': geom = new THREE.ConeGeometry(0.5, 1.1, 16); color = 0xf59e0b; break;
        case 'jump': geom = new THREE.CylinderGeometry(0.45, 0.45, 0.9, 16); color = 0x22c55e; break;
        case 'glide': geom = new THREE.TetrahedronGeometry(0.7); color = 0x38bdf8; break;
        default: geom = new THREE.TorusGeometry(0.7, 0.22, 12, 24); color = 0x93c5fd; kind = 'shield';
      }
      const mat = new THREE.MeshStandardMaterial({ color, metalness: .3, roughness: .35, emissive: new THREE.Color(color).multiplyScalar(0.15) });
      const m = new THREE.Mesh(geom, mat);
      m.position.set(x, y, z);
      m.castShadow = false; m.receiveShadow = false;
      scene.add(m);
      const pu = { mesh: m, kind, radius: 1.2, spin: (Math.random()*0.8+0.6) };
      powerups.push(pu);
      return pu;
    }

    function buildMap(preview = false) {
      clearMap();
      let x = 0, y = 0, z = 0;
      addPlatform(x, y, z, 9, 1, 9, 0x0f172a); // Inicio

      // Añadir plataformas con más desafío, subiendo en Y para crear un parkour real
      for (let i = 0; i < 10; i++) {
        x += 10;
        y += Math.random() * 4;  // Plataformas más altas
        const p = addPlatform(x, y, z, 7.5, 1, 7.5, 0x111827);

        // NEW: colocar algunos power-ups variados
        if (i % 3 === 0) addPowerup(x, y + 2, z + (Math.random() * 2 - 1) * 3, 'shield');
        if (i === 2) addPowerup(x + 2, y + 2, z - 2, 'speed');
        if (i === 4) addPowerup(x - 2, y + 2, z + 2, 'jump');
        if (i === 6) addPowerup(x, y + 2.2, z, 'glide');
        if (i === 8) addPowerup(x + 1.5, y + 2, z - 1.5, 'life');
      }

      const goal = addPlatform(x + 10, y, z, 10, 1, 10, 0x14532d);
      goal.isGoal = true; goal.isCheckpoint = true;
    }

    // ---- QUIZ ----
    function randomQuestion() { return QUESTIONS[Math.floor(Math.random() * QUESTIONS.length)] }
    function openQuiz(q) {
      game.inQuiz = true;
      setInQuiz(true);
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      setQ(q);
    }

    // ---- FLOW ----
    function end(victory, msg) {
      game.ended = true; game.playing = false;
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      setResult({ title: victory ? '¡Llegaste a la meta!' : 'Fin de la partida', msg: msg || (victory ? '¡Parkour completado! 🏁' : 'Vuelve a intentarlo.') });
      setEnded(true);
    }

    function respawn(pos, toStart) {
      player.position.copy(pos); game.vel.set(0, 0, 0); game.onGround = false; game.groundedPlatform = null;
      coyoteTimer = 0; jumpBufferTimer = 0;
      if (toStart) { lastCheckpoint.copy(startPos); setCheckpointLabel('Inicio'); }
      // NEW: después de cualquier respawn, reseteamos el “falling gate”
      fallingHandled = false;
    }

    function resetGame() {
      game.lives = 3; setLivesHUD(game.lives);
      game.pSpeed = game.pJump = game.pGlide = 0; game.pShield = 0; updateTimersHUD();
      game.ended = false; game.inQuiz = false; game.playing = false; game.yaw = 0; game.pitch = 0;
      safePosRef.current.copy(startPos); // NEW
      buildMap(true);
    }

    function start(preview = false) {
      buildMap(preview);
      player.position.copy(startPos); game.vel.set(0, 0, 0); game.onGround = false; game.groundedPlatform = null;
      coyoteTimer = 0; jumpBufferTimer = 0;
      game.yaw = 0; game.pitch = 0; // NEW: cámara mirando al frente
      game.playing = !preview;
    }

    // --- NUEVO BLOQUE: ejecuta comandos desde React ---
    function checkCmd() {
      if (cmdRef.current === 'start') {
        start(false);
        game.ended = false;
        game.inQuiz = false;
        setEnded(false);
        setInQuiz(false);
        cmdRef.current = null;
      }
      if (cmdRef.current === 'preview') {
        start(true);
        cmdRef.current = null;
      }
      if (cmdRef.current === 'reset') {
        resetGame();
        setMenuOpen(true);
        setEnded(false);
        setInQuiz(false);
        cmdRef.current = null;
      }
      // NEW: respawns desde UI (tras preguntas)
      if (cmdRef.current === 'respawn_safe') {
        respawn(safePosRef.current, false);
        cmdRef.current = null;
      }
      if (cmdRef.current === 'respawn_checkpoint') {
        respawn(new THREE.Vector3(lastCheckpoint.x, lastCheckpoint.y, lastCheckpoint.z), false);
        cmdRef.current = null;
      }
    }

    // NEW: caída al vacío con control (pregunta/escudo)
    let fallingHandled = false;
    function onFall() {
      if (game.pShield > 0) {
        // gastar 1 carga de escudo y reaparecer en el mismo lugar seguro
        game.pShield -= 1;
        updateTimersHUD();
        respawn(safePosRef.current, false);
        return;
      }
      openQuiz(randomQuestion());
    }

    // NEW: aplicar power-up
    function applyPowerup(kind) {
      switch (kind) {
        case 'life':
          game.lives += 1;
          setLivesHUD(game.lives);
          break;
        case 'speed':
          game.pSpeed = Math.max(game.pSpeed, 12); // 12s de boost
          break;
        case 'jump':
          game.pJump = Math.max(game.pJump, 10); // 10s salto mejorado
          break;
        case 'glide':
          game.pGlide = Math.max(game.pGlide, 10); // 10s planeo
          break;
        case 'shield':
        default:
          game.pShield += 1; // 1 carga de escudo
          break;
      }
      updateTimersHUD();
    }

    // ---- RESIZE / LOOP ----
    const clock = new THREE.Clock();
    function resize() {
      const w = canvas.parentElement.clientWidth, h = canvas.parentElement.clientHeight;
      renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    }
    const onResize = () => resize();
    window.addEventListener('resize', onResize);
    resize();

    // loop
    let raf = 0;
    let hudT = 0;
    function update(dt) {
      // timers power-ups (HUD throttled)
      if (game.pSpeed > 0) game.pSpeed = Math.max(0, game.pSpeed - dt);
      if (game.pJump > 0) game.pJump = Math.max(0, game.pJump - dt);
      if (game.pGlide > 0) game.pGlide = Math.max(0, game.pGlide - dt);
      hudT += dt; if (hudT > 0.2) { updateTimersHUD(); hudT = 0; }

      // animaciones plataformas/barras
      movers.forEach(p => {
        const { amp, axis, speed, base } = p.move;
        const t = performance.now() / 1000 * speed;
        p.mesh.position.copy(base);
        const disp = Math.sin(t) * amp;
        if (axis === 'x') p.mesh.position.x += disp; else p.mesh.position.z += disp;
      });
      elevators.forEach(p => {
        const { amp, speed, baseY } = p.elev;
        const t = performance.now() / 1000 * speed;
        p.mesh.position.y = baseY + Math.sin(t) * amp;
      });
      hazards.forEach(h => { h.mesh.rotation.y += dt * h.speed });

      // girar/spinear power-ups (efecto visual)
      powerups.forEach(pu => { pu.mesh.rotation.y += dt * pu.spin; pu.mesh.rotation.x += dt * 0.2 });

      // arrastre con plataforma bajo los pies
      if (game.onGround && game.groundedPlatform) {
        const p = game.groundedPlatform;
        const delta = p.mesh.position.clone().sub(p.lastPos);
        player.position.add(delta);
      }

      // NEW: cámara que sigue al jugador desde atrás (3ra persona suave)
      const camFollow = () => {
        const forward = new THREE.Vector3(Math.sin(game.yaw), 0, Math.cos(game.yaw));
        const camDist = 8;
        const camHeight = 3.5;
        const desiredPos = player.position.clone()
          .addScaledVector(forward, -camDist)
          .add(new THREE.Vector3(0, camHeight, 0));
        camera.position.lerp(desiredPos, 0.15);
        // mirar hacia donde mira el jugador (pitch afecta el target)
        const target = player.position.clone().add(new THREE.Vector3(
          Math.sin(game.yaw) * Math.cos(game.pitch),
          Math.sin(game.pitch) + 1.2,
          Math.cos(game.yaw) * Math.cos(game.pitch)
        ));
        camera.lookAt(target);
      };
      camFollow();

      if (!game.playing || game.inQuiz || game.ended) {
        platforms.forEach(p => p.lastPos.copy(p.mesh.position));
        return;
      }

      // movimiento (W hacia adelante)
      const forward = new THREE.Vector3(Math.sin(game.yaw), 0, Math.cos(game.yaw));
      const right = new THREE.Vector3(Math.cos(game.yaw), 0, -Math.sin(game.yaw));

      let inF = 0, inS = 0;
      if (keys.w || keys.up) inF += 1;
      if (keys.s || keys.down) inF -= 1;
      if (keys.a || keys.left) inS -= 1;
      if (keys.d || keys.right) inS += 1;

      const accel = game.onGround ? MOVE_ACCEL : MOVE_AIR_ACCEL;
      const maxSpeed = game.onGround ? MAX_GROUND_SPEED : MAX_AIR_SPEED;
      const spdMul = (game.pSpeed > 0 ? 1.35 : 1.0);

      const desired = new THREE.Vector3();
      desired.addScaledVector(forward, inF * maxSpeed * spdMul);
      desired.addScaledVector(right, inS * maxSpeed * spdMul);

      const toTarget = desired.clone().sub(new THREE.Vector3(game.vel.x, 0, game.vel.z));
      const change = toTarget.clampLength(0, accel * dt);
      game.vel.x += change.x; game.vel.z += change.z;

      if (game.onGround && inF === 0 && inS === 0) {
        game.vel.x = THREE.MathUtils.damp(game.vel.x, 0, GROUND_FRICTION, dt);
        game.vel.z = THREE.MathUtils.damp(game.vel.z, 0, GROUND_FRICTION, dt);
      } else {
        game.vel.x *= Math.pow(1 - dt * AIR_DRAG * 0.03, 1);
        game.vel.z *= Math.pow(1 - dt * AIR_DRAG * 0.03, 1);
      }

      // coyote / buffer
      if (game.onGround) coyoteTimer = COYOTE_TIME; else coyoteTimer = Math.max(0, coyoteTimer - dt);
      jumpBufferTimer = Math.max(0, jumpBufferTimer - dt);

      // gravedad / salto
      const grav = (game.vel.y < 0 && game.pGlide > 0) ? GLIDE_GRAVITY : GRAVITY;
      game.vel.y += grav * dt;

      const canJump = coyoteTimer > 0;
      if (jumpBufferTimer > 0 && canJump) {
        const j = (game.pJump > 0 ? JUMP_VEL * JUMP_VEL_BOOST : JUMP_VEL);
        game.vel.y = j; game.onGround = false; game.groundedPlatform = null; jumpBufferTimer = 0;
      }
      if (!keys.spaceHold && game.vel.y > 0) game.vel.y += JUMP_CUT * dt;

      // integrar
      player.position.addScaledVector(game.vel, dt);

      // reset grounded
      game.onGround = false; game.groundedPlatform = null;

      // colisiones (aterrizaje)
      const r = 1.05;
      for (const p of platforms) {
        const m = p.mesh; const hw = p.w / 2, hh = 0.5, hd = p.d / 2;
        const min = new THREE.Vector3(m.position.x - hw, m.position.y - hh, m.position.z - hd);
        const max = new THREE.Vector3(m.position.x + hw, m.position.y + hh, m.position.z + hd);
        const insideXZ = player.position.x > min.x - r && player.position.x < max.x + r && player.position.z > min.z - r && player.position.z < max.z + r;
        const top = max.y + r * 0.05;
        if (insideXZ && player.position.y <= top + 0.22 && player.position.y >= max.y - 0.55 && game.vel.y <= 0) {
          player.position.y = top; game.vel.y = 0; game.onGround = true; game.groundedPlatform = p; coyoteTimer = COYOTE_TIME;

          // NEW: actualizamos “lugar seguro” para reaparecer exactamente donde estabas de pie
          safePosRef.current.set(player.position.x, player.position.y, player.position.z);
          fallingHandled = false; // ya tocó piso de nuevo

          if (p.isCheckpoint) {
            lastCheckpoint.set(p.mesh.position.x, p.mesh.position.y + 2, p.mesh.position.z);
            setCheckpointLabel(p.isGoal ? 'Meta' : `x:${lastCheckpoint.x.toFixed(0)} z:${lastCheckpoint.z.toFixed(0)}`);
            if (p.isGoal) { platforms.forEach(pp => pp.lastPos.copy(pp.mesh.position)); return end(true, '¡Parkour completado! 🏁'); }
          } else {
            lastCheckpoint.set(p.mesh.position.x, p.mesh.position.y + 2, p.mesh.position.z);
            setCheckpointLabel(`x:${lastCheckpoint.x.toFixed(0)} z:${lastCheckpoint.z.toFixed(0)}`);
          }
          break;
        }
      }

      // NEW: recoger power-ups (detección simple por distancia)
      for (let i = powerups.length - 1; i >= 0; i--) {
        const pu = powerups[i];
        if (player.position.distanceTo(pu.mesh.position) <= pu.radius + 0.8) {
          applyPowerup(pu.kind);
          scene.remove(pu.mesh);
          powerups.splice(i, 1);
        }
      }

      // NEW: caída al vacío -> pregunta o escudo
      if (player.position.y < -25) {
        if (!fallingHandled) {
          fallingHandled = true;
          onFall();
        }
      }

      // guardar posiciones de plataformas animadas
      platforms.forEach(p => p.lastPos.copy(p.mesh.position));
    }

    function render() { renderer.render(scene, camera) }

    function loop() {
      checkCmd();
      const dt = Math.min(0.033, clock.getDelta());
      update(dt); render();
      raf = requestAnimationFrame(loop);
    }
    raf = requestAnimationFrame(loop);

    // inicial
    resetGame();

    // --- POINTER LOCK: pedirlo al hacer click en el canvas ---
    const handleCanvasClick = () => {
      if (!document.pointerLockElement) {
        canvas.requestPointerLock();
      }
    };
    canvas.addEventListener('click', handleCanvasClick);

    // cleanup
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('pointerlockchange', onPointerLockChange);
      canvas.removeEventListener('click', handleCanvasClick);
      renderer.dispose();
    };
  }, []);

  // ---- UI handlers ----
  const onPlay = () => { 
    setTimeout(() => {
      setMenuOpen(false); 
      // Enfoca el canvas para que reciba eventos de teclado
      setTimeout(() => {
        canvasRef.current?.focus();
      }, 200);
    }, 100); // Espera un pequeño tiempo antes de cerrar el menú
    cmdRef.current = 'start'; 
  }
  const onPreview = () => { cmdRef.current = 'preview'; }
  const onAgain = () => { cmdRef.current = 'reset'; }

  // quiz actions
  const chooseOpt = (i) => {
    if (!q) return;
    const ok = (i === q.a);
    setInQuiz(false);
    // NEW: decide respawn según respuesta
    if (ok) {
      cmdRef.current = 'respawn_safe'; // mismo lugar seguro
    } else {
      const next = Math.max(0, livesRef.current - 1);
      setLives(next);
      if (next <= 0) {
        setResult({ title: 'Fin de la partida', msg: 'Sin vidas. Repasa el vocabulario y reintenta.' });
        setEnded(true);
      } else {
        cmdRef.current = 'respawn_checkpoint';
      }
    }
  };
  const skipQuiz = () => {
    setInQuiz(false);
    // NEW: saltar = perder vida y volver a checkpoint
    const next = Math.max(0, livesRef.current - 1);
    setLives(next);
    if (next <= 0) {
      setResult({ title: 'Fin de la partida', msg: 'Sin vidas. Repasa el vocabulario y reintenta.' });
      setEnded(true);
    } else {
      cmdRef.current = 'respawn_checkpoint';
    }
  };

  return (
    <div className="app">
      {/* Fondo del vacío */}
      <div id="voidBG" className="voidBG" style={{ backgroundImage: `url(${voidUrl})` }} />

      {/* Canvas */}
      <div className="canvasWrap">
        <canvas id="scene" ref={canvasRef} tabIndex={0} />
      </div>

      {/* HUD */}
      <div className="hud">
        <div className="panel">
          <div>❤️ Vidas: <b>{lives}</b></div>
          <div>📍 {checkpoint}</div>
        </div>
        <div className="panel">
          <div>⚡ Vel: <b>{tSpd}</b>s</div>
          <div>🟢 Salto: <b>{tJmp}</b>s</div>
          <div>🪂 Planeo: <b>{tGlide}</b>s</div>
          <div>🛡️ Escudo: <b>{tShield}</b></div>
        </div>
      </div>

      {/* Menú */}
      {menuOpen && (
        <div id="menu" className="overlay">
          <div className="card">
            <h1>WWII Parkour & Quiz</h1>

            <label className="row">Dificultad:
              <select value={difficulty} onChange={e => setDifficulty(e.target.value)}>
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </select>
            </label>

            <label className="row">Fondo del vacío (URL):
              <input value={voidUrl} onChange={e => setVoidUrl(e.target.value)} placeholder="https://..." />
            </label>

            <label className="row">Sensibilidad mouse:
              <input type="range" min="0.0006" max="0.0020" step="0.0001"
                     defaultValue={sensRef.current}
                     onChange={e => (sensRef.current = parseFloat(e.target.value))} />
            </label>

            <div className="actions">
              <button id="playBtn" onClick={onPlay}>Jugar</button>
              <button id="previewBtn" onClick={onPreview}>Vista previa</button>
            </div>
          </div>
        </div>
      )}

      {/* Quiz */}
      {inQuiz && q && (
        <div id="quizLayer" className="overlay">
          <div className="card">
            <h2 id="qTitle">{q.country} • {q.tag}</h2>
            <p id="qText">{q.q}</p>
            <div id="qBadges" className="badges"><span className={`badge flag ${q.code.toLowerCase()}`}>{q.country}</span></div>
            <div id="qOpts" className="opts">
              {[0, 1, 2, 3].map(i => (
                <button key={i} className="opt" onClick={() => chooseOpt(i)}>{q.opts[i]}</button>
              ))}
            </div>
            <div className="actions"><button id="qSkip" onClick={skipQuiz}>Perder 1 vida y saltar</button></div>
          </div>
        </div>
      )}

      {/* Resultado */}
      {ended && (
        <div id="resultLayer" className="overlay">
          <div className="card">
            <h2 id="resultTitle">{result.title}</h2>
            <p id="resultMsg">{result.msg}</p>
            <div className="actions"><button id="againBtn" onClick={onAgain}>Volver al menú</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
