import React, { useEffect, useState, useRef } from 'react';
import * as THREE from 'three';
import { QUESTIONS } from './preguntas'; // Cambia este archivo para tus preguntas
//d

export default function App() {
  // ---- UI state ----
  const [difficulty, setDifficulty] = useState('medium');
  const [voidUrl, setVoidUrl] = useState('https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?q=80&w=1600&auto=format&fit=crop');
  const [menuOpen, setMenuOpen] = useState(true);
  const [inQuiz, setInQuiz] = useState(false);
  const [ended, setEnded] = useState(false);
  const [result, setResult] = useState({ title: '', msg: '' });
  const [lives, setLives] = useState(3);
  const [checkpoint, setCheckpoint] = useState('Inicio');
  const [tSpd, setTSpd] = useState(0);
  const [tJmp, setTJmp] = useState(0);
  const [tGlide, setTGlide] = useState(0);
  const [tShield, setTShield] = useState(0);
  const [q, setQ] = useState(null);

  // Sensibilidad mouse (ajustable)
  const sensRef = useRef(0.0011);
  const canvasRef = useRef(null);
  const cmdRef = useRef(null);
  const diffRef = useRef(difficulty);
  const livesRef = useRef(lives);
  const mouseRef = useRef({ x: 0, y: 0 });
  const startPos = new THREE.Vector3(0, 2, 0);
  const lastCheckpoint = new THREE.Vector3(0, 2, 0);
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
      game.yaw += e.movementX * sensitivity;
      game.pitch -= e.movementY * sensitivity;
      game.pitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, game.pitch));
    };
    document.addEventListener('mousemove', onMouseMove);

    // ---- PLAYER ----
    const playerGeo = new THREE.BoxGeometry(1, 2, 1);
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
      pSpeed: 0, pJump: 0, pGlide: 0, pShield: 0,
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
    const powerups = [];

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
      for (let i = 0; i < 10; i++) {
        x += 10;
        y += Math.random() * 4;
        const p = addPlatform(x, y, z, 7.5, 1, 7.5, 0x111827);
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
      fallingHandled = false;
      // NEW: reactivar el juego tras respawn
      game.playing = true;
      game.inQuiz = false;
      setEnded(false);
      setInQuiz = false;
    }

    function resetGame() {
      game.lives = 3; setLivesHUD(game.lives);
      game.pSpeed = game.pJump = game.pGlide = 0; game.pShield = 0; updateTimersHUD();
      game.ended = false; game.inQuiz = false; game.playing = false; game.yaw = 0; game.pitch = 0;
      safePosRef.current.copy(startPos);
      buildMap(true);
    }

    function start(preview = false) {
      buildMap(preview);
      player.position.copy(startPos); game.vel.set(0, 0, 0); game.onGround = false; game.groundedPlatform = null;
      coyoteTimer = 0; jumpBufferTimer = 0;
      game.yaw = 0; game.pitch = 0;
      game.playing = !preview;
      game.ended = false;
      game.inQuiz = false;
      setEnded(false);
      setInQuiz(false);
    }

    // --- NUEVO BLOQUE: ejecuta comandos desde React ---
    function checkCmd() {
      if (cmdRef.current === 'start') {
        start(false);
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
      if (cmdRef.current === 'respawn_safe') {
        respawn(safePosRef.current, false);
        cmdRef.current = null;
      }
      if (cmdRef.current === 'respawn_checkpoint') {
        respawn(new THREE.Vector3(lastCheckpoint.x, lastCheckpoint.y, lastCheckpoint.z), false);
        cmdRef.current = null;
      }
    }

    let fallingHandled = false;
    function onFall() {
      if (game.pShield > 0) {
        game.pShield -= 1;
        updateTimersHUD();
        respawn(safePosRef.current, false);
        return;
      }
      openQuiz(randomQuestion());
    }

    function applyPowerup(kind) {
      switch (kind) {
        case 'life':
          game.lives += 1;
          setLivesHUD(game.lives);
          break;
        case 'speed':
          game.pSpeed = Math.max(game.pSpeed, 12);
          break;
        case 'jump':
          game.pJump = Math.max(game.pJump, 10);
          break;
        case 'glide':
          game.pGlide = Math.max(game.pGlide, 10);
          break;
        case 'shield':
        default:
          game.pShield += 1;
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

    let raf = 0;
    let hudT = 0;
    function update(dt) {
      if (game.pSpeed > 0) game.pSpeed = Math.max(0, game.pSpeed - dt);
      if (game.pJump > 0) game.pJump = Math.max(0, game.pJump - dt);
      if (game.pGlide > 0) game.pGlide = Math.max(0, game.pGlide - dt);
      hudT += dt; if (hudT > 0.2) { updateTimersHUD(); hudT = 0; }

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
      powerups.forEach(pu => { pu.mesh.rotation.y += dt * pu.spin; pu.mesh.rotation.x += dt * 0.2 });

      if (game.onGround && game.groundedPlatform) {
        const p = game.groundedPlatform;
        const delta = p.mesh.position.clone().sub(p.lastPos);
        player.position.add(delta);
      }

      // Cámara 3ra persona
      const camFollow = () => {
        const forward = new THREE.Vector3(Math.sin(game.yaw), 0, Math.cos(game.yaw));
        const camDist = 8;
        const camHeight = 3.5;
        const desiredPos = player.position.clone()
          .addScaledVector(forward, -camDist)
          .add(new THREE.Vector3(0, camHeight, 0));
        camera.position.lerp(desiredPos, 0.15);
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

      // movimiento
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

      if (game.onGround) coyoteTimer = COYOTE_TIME; else coyoteTimer = Math.max(0, coyoteTimer - dt);
      jumpBufferTimer = Math.max(0, jumpBufferTimer - dt);

      const grav = (game.vel.y < 0 && game.pGlide > 0) ? GLIDE_GRAVITY : GRAVITY;
      game.vel.y += grav * dt;

      const canJump = coyoteTimer > 0;
      if (jumpBufferTimer > 0 && canJump) {
        const j = (game.pJump > 0 ? JUMP_VEL * JUMP_VEL_BOOST : JUMP_VEL);
        game.vel.y = j; game.onGround = false; game.groundedPlatform = null; jumpBufferTimer = 0;
      }
      if (!keys.spaceHold && game.vel.y > 0) game.vel.y += JUMP_CUT * dt;

      player.position.addScaledVector(game.vel, dt);

      game.onGround = false; game.groundedPlatform = null;

      const r = 1.05;
      for (const p of platforms) {
        const m = p.mesh; const hw = p.w / 2, hh = 0.5, hd = p.d / 2;
        const min = new THREE.Vector3(m.position.x - hw, m.position.y - hh, m.position.z - hd);
        const max = new THREE.Vector3(m.position.x + hw, m.position.y + hh, m.position.z + hd);
        const insideXZ = player.position.x > min.x - r && player.position.x < max.x + r && player.position.z > min.z - r && player.position.z < max.z + r;
        const top = max.y + r * 0.05;
        if (insideXZ && player.position.y <= top + 0.22 && player.position.y >= max.y - 0.55 && game.vel.y <= 0) {
          player.position.y = top; game.vel.y = 0; game.onGround = true; game.groundedPlatform = p; coyoteTimer = COYOTE_TIME;
          safePosRef.current.set(player.position.x, player.position.y, player.position.z);
          fallingHandled = false;
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

      for (let i = powerups.length - 1; i >= 0; i--) {
        const pu = powerups[i];
        if (player.position.distanceTo(pu.mesh.position) <= pu.radius + 0.8) {
          applyPowerup(pu.kind);
          scene.remove(pu.mesh);
          powerups.splice(i, 1);
        }
      }

      if (player.position.y < -25) {
        if (!fallingHandled) {
          fallingHandled = true;
          onFall();
        }
      }

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

    resetGame();

    const handleCanvasClick = () => {
      if (!document.pointerLockElement) {
        canvas.requestPointerLock();
      }
    };
    canvas.addEventListener('click', handleCanvasClick);

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
      setTimeout(() => {
        canvasRef.current?.focus();
      }, 200);
    }, 100);
    cmdRef.current = 'start'; 
  }
  const onPreview = () => { cmdRef.current = 'preview'; }
  const onAgain = () => { cmdRef.current = 'reset'; }

  // quiz actions
  const chooseOpt = (i) => {
    if (!q) return;
    const ok = (i === q.a);
    setInQuiz(false);
    if (ok) {
      cmdRef.current = 'respawn_safe';
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
          <div className="card" style={{
            maxWidth: 420,
            background: 'rgba(30,41,59,0.97)',
            color: '#fff',
            borderRadius: 18,
            boxShadow: '0 8px 32px #0008',
            padding: 32
          }}>
            <h1 style={{marginBottom: 8}}>Historia Parkour & Quiz</h1>
            <p style={{fontSize: 17, marginBottom: 18, color: '#cbd5e1'}}>
              ¡Bienvenido! El objetivo es <b>llegar a la meta</b> superando plataformas y respondiendo preguntas de historia.<br />
              Si caes, deberás responder una pregunta para reaparecer. Si fallas, pierdes una vida.<br />
              <b>Controles:</b> WASD para moverse, ratón para mirar, espacio para saltar.<br />
              <span style={{color:'#fbbf24'}}>¡Pon a prueba tu memoria y tus reflejos!</span>
            </p>
            <label className="row" style={{marginBottom: 10}}>Dificultad:
              <select value={difficulty} onChange={e => setDifficulty(e.target.value)} style={{marginLeft:8}}>
                <option value="easy">Fácil</option>
                <option value="medium">Media</option>
                <option value="hard">Difícil</option>
              </select>
            </label>
            <label className="row" style={{marginBottom: 10}}>Fondo del vacío (URL):
              <input value={voidUrl} onChange={e => setVoidUrl(e.target.value)} placeholder="https://..." style={{marginLeft:8, width:180}} />
            </label>
            <label className="row" style={{marginBottom: 18}}>Sensibilidad mouse:
              <input type="range" min="0.0006" max="0.0020" step="0.0001"
                     defaultValue={sensRef.current}
                     onChange={e => (sensRef.current = parseFloat(e.target.value))}
                     style={{marginLeft:8}} />
            </label>
            <div className="actions" style={{display:'flex', gap:12, marginTop:10}}>
              <button id="playBtn" onClick={onPlay} style={{padding:'10px 28px', fontSize:17, borderRadius:8, background:'#38bdf8', color:'#fff', border:'none'}}>Jugar</button>
              <button id="previewBtn" onClick={onPreview} style={{padding:'10px 18px', fontSize:16, borderRadius:8, background:'#64748b', color:'#fff', border:'none'}}>Vista previa</button>
            </div>
          </div>
        </div>
      )}

      {/* Quiz */}
      {inQuiz && q && (
        <div id="quizLayer" className="overlay">
          <div className="card" style={{
            maxWidth: 420,
            background: 'rgba(30,41,59,0.97)',
            color: '#fff',
            borderRadius: 18,
            boxShadow: '0 8px 32px #0008',
            padding: 32
          }}>
            <h2 id="qTitle">{q.country ? `${q.country} • ` : ''}{q.tag}</h2>
            <p id="qText">{q.q}</p>
            <div id="qBadges" className="badges" style={{marginBottom:12}}>
              {q.country && <span className={`badge flag ${q.code?.toLowerCase()}`}>{q.country}</span>}
            </div>
            <div id="qOpts" className="opts" style={{display:'flex', flexDirection:'column', gap:10}}>
              {[0, 1, 2, 3].map(i => (
                <button key={i} className="opt" onClick={() => chooseOpt(i)} style={{
                  padding:'10px 0', fontSize:16, borderRadius:7, background:'#334155', color:'#fff', border:'none', cursor:'pointer'
                }}>{q.opts[i]}</button>
              ))}
            </div>
            <div className="actions" style={{marginTop:18}}>
              <button id="qSkip" onClick={skipQuiz} style={{
                padding:'8px 18px', fontSize:15, borderRadius:7, background:'#f87171', color:'#fff', border:'none'
              }}>Perder 1 vida y saltar</button>
            </div>
          </div>
        </div>
      )}

      {/* Resultado */}
      {ended && (
        <div id="resultLayer" className="overlay">
          <div className="card" style={{
            maxWidth: 420,
            background: 'rgba(30,41,59,0.97)',
            color: '#fff',
            borderRadius: 18,
            boxShadow: '0 8px 32px #0008',
            padding: 32
          }}>
            <h2 id="resultTitle">{result.title}</h2>
            <p id="resultMsg">{result.msg}</p>
            <div className="actions" style={{marginTop:18}}>
              <button id="againBtn" onClick={onAgain} style={{
                padding:'10px 28px', fontSize:17, borderRadius:8, background:'#38bdf8', color:'#fff', border:'none'
              }}>Volver al menú</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
