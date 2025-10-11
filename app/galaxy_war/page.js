'use client';

import { useEffect, useRef, useState } from 'react';
import * as BABYLON from '@babylonjs/core';
import * as GUI from '@babylonjs/gui';
const GAME_WIDTH = 900; // logical width (kept for camera calculations)
const GAME_HEIGHT = 600; // logical height

export default function GalaxyWar() {
  const babylonCanvasRef = useRef(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let engine = null;
    let scene = null;
    let advancedTexture = null;
    let game = null;

    // Small utility: clamp
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

    class Pool {
      constructor(factory, size = 10) {
        this.items = [];
        this.factory = factory;
        for (let i = 0; i < size; i++) this.items.push(this.factory());
      }
      acquire() {
        const found = this.items.find(i => !i._active);
        if (found) return found;
        const created = this.factory();
        this.items.push(created);
        return created;
      }
      release(item) {
        item._active = false;
        if (item.isVisible !== undefined) item.isVisible = false;
      }
      forEach(fn) {
        this.items.forEach(fn);
      }
      releaseAll() {
        this.items.forEach(i => {
          i._active = false;
          if (i.isVisible !== undefined) i.isVisible = false;
        });
      }
    }

    class Game {
      constructor(scene, engine) {
        this.scene = scene;
        this.engine = engine;
        this.state = 'MENU'; // MENU, PLAYING, GAMEOVER, PAUSED
        this.score = 0;
        this.lives = 10;
        this.highscore = parseInt(localStorage.getItem('gw_highscore') || '0', 10);
        this.player = null;
        this.enemyGroup = [];
        this.playerPool = null;
        this.enemyBullets = null;
        this.playerBullets = null;
        this.ui = {};
        this.time = 0;
        this.lastPlayerShot = 0;
        this.lastEnemyShot = 0;
        this.input = { left: false, right: false, fire: false };
        this.inputCooldownUntil = 0; // debounce start/restart inputs
        this.touchPointers = {};
        this._visibilityHandler = null;
        this._resizeHandler = null;
        this.currentWave = 0;
        this.waveSpawnTimer = 0;
        this.init();
      }

      // Simple beep using WebAudio (no external assets required)
      _playBeep(freq = 440, duration = 0.06) {
        try {
          if (!this._audioCtx) this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
          const ctx = this._audioCtx;
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          o.type = 'sine';
          o.frequency.value = freq;
          g.gain.value = 0.0025; // keep it very subtle
          o.connect(g);
          g.connect(ctx.destination);
          o.start();
          g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
          setTimeout(() => {
            try { o.stop(); o.disconnect(); g.disconnect(); } catch (e) {}
          }, duration * 1000 + 50);
        } catch (e) {
          // audio may be blocked by browser autoplay policies; ignore silently
        }
      }

      init() {
        const scene = this.scene;

        // Camera & light (orthographic)
        const cam = new BABYLON.FreeCamera('cam', new BABYLON.Vector3(0, 0, -20), scene);
        cam.setTarget(BABYLON.Vector3.Zero());
        cam.mode = BABYLON.Camera.ORTHOGRAPHIC_CAMERA;
        this.camera = cam;

        // helper to compute ortho bounds based on canvas aspect
        this._updateOrtho = () => {
          try {
            const rect = (this.engine.getRenderingCanvasClientRect && this.engine.getRenderingCanvasClientRect()) || { width: window.innerWidth, height: window.innerHeight };
            const aspect = (rect.width / rect.height) || 1;
            const halfV = GAME_HEIGHT / 200; // vertical half span (keeps scale)
            cam.orthoTop = halfV;
            cam.orthoBottom = -halfV;
            cam.orthoLeft = -halfV * aspect;
            cam.orthoRight = halfV * aspect;
          } catch (e) {
            // fallback
            cam.orthoLeft = -GAME_WIDTH / 200;
            cam.orthoRight = GAME_WIDTH / 200;
            cam.orthoTop = GAME_HEIGHT / 200;
            cam.orthoBottom = -GAME_HEIGHT / 200;
          }
        };
        this._updateOrtho();

        // expose a helper to read current ortho bounds
        this.getBounds = () => ({
          left: cam.orthoLeft,
          right: cam.orthoRight,
          top: cam.orthoTop,
          bottom: cam.orthoBottom
        });

        new BABYLON.HemisphericLight('l', new BABYLON.Vector3(0, 1, 0), scene).intensity = 1;

        // Background plane placeholder (declared early so resize handler can reference it safely)
        let bgPlane = null;

        // Background stars using a dynamic texture on a big plane
        const bounds = this.getBounds();
        bgPlane = BABYLON.MeshBuilder.CreatePlane('bg', {
          width: (bounds.right - bounds.left) || GAME_WIDTH / 100,
          height: (bounds.top - bounds.bottom) || GAME_HEIGHT / 100,
        }, scene);
        bgPlane.position.z = 10;

        const bgDt = new BABYLON.DynamicTexture('bgdt', { width: 512, height: 512 }, scene, false);
        const ctx = bgDt.getContext();
        ctx.fillStyle = '#000010';
        ctx.fillRect(0, 0, 512, 512);
        for (let i = 0; i < 200; i++) {
          ctx.fillStyle = Math.random() > 0.95 ? '#ffffff' : '#88aaff';
          const x = Math.random() * 512;
          const y = Math.random() * 512;
          const s = Math.random() * 2 + 0.5;
          ctx.fillRect(x, y, s, s);
        }
        bgDt.update();
        const bgMat = new BABYLON.StandardMaterial('bgm', scene);
        bgMat.diffuseTexture = bgDt;
        bgMat.emissiveColor = new BABYLON.Color3(1, 1, 1);
        bgMat.backFaceCulling = false;
        bgPlane.material = bgMat;

        // Player (much smaller)
        this.player = BABYLON.MeshBuilder.CreatePlane('player', { size: 0.5 }, scene);
        this.player.position = new BABYLON.Vector3(0, -3.2, 0);
        this.player._size = 0.5;
        const pMat = new BABYLON.StandardMaterial('pMat', scene);
        pMat.diffuseTexture = new BABYLON.Texture('/assets/player.png', scene);
        pMat.diffuseTexture.hasAlpha = true;
        pMat.useAlphaFromDiffuseTexture = true;
        pMat.backFaceCulling = false;
        this.player.material = pMat;
        this.player._active = true;

        // Enemy material
        const eMat = new BABYLON.StandardMaterial('eMat', scene);
        eMat.diffuseTexture = new BABYLON.Texture('/assets/enemy.png', scene);
        eMat.diffuseTexture.hasAlpha = true;
        eMat.useAlphaFromDiffuseTexture = true;
        eMat.backFaceCulling = false;

        // Pools
        this.playerBullets = new Pool(() => {
          const b = BABYLON.MeshBuilder.CreatePlane('pbullet', { width: 0.09, height: 0.36 }, scene);
          const m = new BABYLON.StandardMaterial('pbm', scene);
          m.diffuseTexture = new BABYLON.Texture('/assets/bullet.png', scene);
          m.diffuseTexture.hasAlpha = true;
          m.useAlphaFromDiffuseTexture = true;
          m.backFaceCulling = false;
          b.material = m;
          b.isVisible = false;
          b._active = false;
          b._size = 0.2;
          return b;
        }, 12);

        this.enemyBullets = new Pool(() => {
          const b = BABYLON.MeshBuilder.CreatePlane('ebullet', { width: 0.09, height: 0.36 }, scene);
          const m = new BABYLON.StandardMaterial('ebm', scene);
          m.diffuseTexture = new BABYLON.Texture('/assets/enemy_bullet.png', scene);
          m.diffuseTexture.hasAlpha = true;
          m.useAlphaFromDiffuseTexture = true;
          m.backFaceCulling = false;
          b.material = m;
          b.isVisible = false;
          b._active = false;
          b._size = 0.2;
          return b;
        }, 24);

        // Enemies as simple meshes pooled
        this.enemyPool = new Pool(() => {
          const e = BABYLON.MeshBuilder.CreatePlane('enemy', { size: 0.5 }, scene);
          e.material = eMat;
          e.isVisible = false;
          e._active = false;
          e._size = 0.5;
          e._base = new BABYLON.Vector3(0, 0, 0);
          e._waveType = null; // Will store wave movement type
          e._waveParams = {}; // Parameters for wave movement
          return e;
        }, 24);

        // Initialize first wave
        this.enemyGroup = this._createWave();

        // HUD (Top Corners)
        advancedTexture = GUI.AdvancedDynamicTexture.CreateFullscreenUI('UI');

        // Score (Top-Left)
        this.ui.score = new GUI.TextBlock();
        this.ui.score.text = `Score: ${this.score}`;
        this.ui.score.color = 'white';
        this.ui.score.fontSize = 24 * (window.devicePixelRatio || 1);
        this.ui.score.textHorizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        this.ui.score.textVerticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
        this.ui.score.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        this.ui.score.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
        this.ui.score.paddingLeft = '20px';
        this.ui.score.paddingTop = '15px';
        advancedTexture.addControl(this.ui.score);

        // Lives (Top-Right)
        this.ui.lives = new GUI.TextBlock();
        this.ui.lives.text = `Lives: ${this.lives}`;
        this.ui.lives.color = 'white';
        this.ui.lives.fontSize = 24 * (window.devicePixelRatio || 1);
        this.ui.lives.textHorizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT;
        this.ui.lives.textVerticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
        this.ui.lives.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT;
        this.ui.lives.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
        this.ui.lives.paddingRight = '20px';
        this.ui.lives.paddingTop = '15px';
        advancedTexture.addControl(this.ui.lives);

        this.ui.center = new GUI.TextBlock();
        this.ui.center.text = `Galaxy War`;
        this.ui.center.color = 'white';
        this.ui.center.fontSize = 36 * (window.devicePixelRatio || 1);
        this.ui.center.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
        this.ui.center.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_CENTER;
        advancedTexture.addControl(this.ui.center);

        this.ui.hint = new GUI.TextBlock();
        this.ui.hint.text = `Tap to Start (or press Space)`;
        this.ui.hint.color = '#aaccff';
        this.ui.hint.fontSize = 18 * (window.devicePixelRatio || 1);
        this.ui.hint.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
        this.ui.hint.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_CENTER;
        this.ui.hint.top = '40px';
        advancedTexture.addControl(this.ui.hint);

        // Highscore display (hidden until needed)
        this.ui.highscore = new GUI.TextBlock();
        this.ui.highscore.text = `Highscore: ${this.highscore}`;
        this.ui.highscore.color = '#ffdd88';
        this.ui.highscore.fontSize = 20 * (window.devicePixelRatio || 1);
        this.ui.highscore.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
        this.ui.highscore.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_CENTER;
        this.ui.highscore.top = '70px';
        this.ui.highscore.isVisible = false;
        advancedTexture.addControl(this.ui.highscore);

        // Input handling
        window.addEventListener('keydown', this._onKeyDown = (e) => {
          if (e.code === 'ArrowLeft' || e.key === 'a') this.input.left = true;
          if (e.code === 'ArrowRight' || e.key === 'd') this.input.right = true;
          if (e.code === 'Space') this._tryStartOrFire();
        });
        window.addEventListener('keyup', this._onKeyUp = (e) => {
          if (e.code === 'ArrowLeft' || e.key === 'a') this.input.left = false;
          if (e.code === 'ArrowRight' || e.key === 'd') this.input.right = false;
          if (e.code === 'Space') this.input.fire = false;
        });

        // Pointer/touch for mobile controls
        scene.onPointerObservable.add(this._pointerObserver = (pi) => {
          if (pi.type === BABYLON.PointerEventTypes.POINTERDOWN) {
            if (performance.now() < this.inputCooldownUntil) return;
            const x = pi.event.clientX;
            const w = (this.engine.getRenderingCanvasClientRect && this.engine.getRenderingCanvasClientRect().width) || window.innerWidth;
            if (this.state === 'MENU') return this.start();
            if (this.state === 'GAMEOVER') return this.restart();
            if (x < w / 3) this.input.left = true;
            else if (x > (w * 2) / 3) this.input.right = true;
            else {
              this._firePlayer();
            }
          }
          if (pi.type === BABYLON.PointerEventTypes.POINTERUP) {
            this.input.left = false;
            this.input.right = false;
            this.input.fire = false;
          }
        });

        // Main loop
        scene.onBeforeRenderObservable.add(this._loop = () => {
          const dt = this.engine.getDeltaTime() / 1000;
          if (this.state === 'PLAYING') this.update(dt);
        });

        // Render loop with visibility handling
        const renderFn = () => {
          try { scene.render(); } catch (e) { }
        };
        engine.runRenderLoop(renderFn);

        this._visibilityHandler = () => {
          if (document.hidden) {
            try { engine.stopRenderLoop(renderFn); } catch (e) {}
          } else {
            try { engine.runRenderLoop(renderFn); } catch (e) {}
          }
        };
        document.addEventListener('visibilitychange', this._visibilityHandler);

        // Responsiveness: update ortho and UI scaling on resize
        this._resizeHandler = () => {
          try { this.engine.resize(); } catch (e) {}
          this._updateOrtho();

          // adjust background width and height dynamically
          if (bgPlane) {
            const b = this.getBounds();
            const width = (b.right - b.left) || (GAME_WIDTH / 100);
            const height = (b.top - b.bottom) || (GAME_HEIGHT / 100);
            bgPlane.scaling.x = width / (GAME_WIDTH / 100);
            bgPlane.scaling.y = height / (GAME_HEIGHT / 100);
            bgPlane.position.z = 10;
          }

          // reposition camera center if needed
          this.camera.setTarget(BABYLON.Vector3.Zero());

          // update GUI font sizes for DPI change
          const dpr = window.devicePixelRatio || 1;
          if (this.ui.score) this.ui.score.fontSize = 24 * dpr;
          if (this.ui.lives) this.ui.lives.fontSize = 24 * dpr;
          if (this.ui.center) this.ui.center.fontSize = 36 * dpr;
          if (this.ui.hint) this.ui.hint.fontSize = 18 * dpr;
          if (this.ui.highscore) this.ui.highscore.fontSize = 20 * dpr;
        };

        window.addEventListener('resize', this._resizeHandler);
      }

      _tryStartOrFire() {
        if (performance.now() < this.inputCooldownUntil) return;
        if (this.state === 'MENU') return this.start();
        if (this.state === 'PLAYING') return this._firePlayer();
        if (this.state === 'GAMEOVER') return this.restart();
      }

      start() {
        this.state = 'PLAYING';
        this.ui.center.text = '';
        this.ui.hint.text = '';
        if (this.ui.highscore) this.ui.highscore.isVisible = false;
        this.ui.score.text = `Score: ${this.score}`;
        this.ui.lives.text = `Lives: ${this.lives}`;
        this.inputCooldownUntil = performance.now() + 300;
        this.currentWave = 0;
        this.waveSpawnTimer = 0;
        this.enemyGroup = this._createWave();
      }

      restart() {
        this.score = 0;
        this.lives = 10;
        this.ui.score.text = `Score: ${this.score}`;
        this.ui.lives.text = `Lives: ${this.lives}`;
        this.playerBullets.releaseAll();
        this.enemyBullets.releaseAll();
        this.enemyGroup.forEach(e => {
          e._active = false;
          e.isVisible = false;
        });
        this.enemyGroup = [];
        const bounds = this.getBounds();
        this.player.position.x = 0;
        this.player.position.y = bounds.bottom + 0.8;
        this.player.isVisible = true;
        this.player._active = true;
        this.ui.center.text = '';
        this.ui.hint.text = '';
        if (this.ui.highscore) this.ui.highscore.isVisible = false;
        this.state = 'PLAYING';
        this.inputCooldownUntil = performance.now() + 300;
        this.currentWave = 0;
        this.waveSpawnTimer = 0;
        this.enemyGroup = this._createWave();
      }

      _firePlayer() {
        const now = performance.now();
        if (now - this.lastPlayerShot < 220) return;
        this.lastPlayerShot = now;
        const b = this.playerBullets.acquire();
        b.position = this.player.position.clone();
        b.position.y += 0.9;
        b.isVisible = true;
        b._active = true;
        this._playBeep(900, 0.05);
      }

      _enemyFire() {
        const now = performance.now();
        if (now - this.lastEnemyShot < 700) return;
        this.lastEnemyShot = now;
        const alive = this.enemyGroup.filter(e => e._active);
        if (!alive.length) return;
        const shooter = alive[Math.floor(Math.random() * alive.length)];
        const b = this.enemyBullets.acquire();
        b.position = shooter.position.clone();
        b.position.y -= 0.7;
        b.isVisible = true;
        b._active = true;
        this._playBeep(450, 0.06);
      }

      explode(pos) {
        const ps = new BABYLON.ParticleSystem('p', 200, this.scene);
        ps.particleTexture = new BABYLON.Texture('/assets/fragments.png', this.scene);
        ps.emitter = pos.clone();
        ps.minEmitBox = new BABYLON.Vector3(-0.2, -0.2, 0);
        ps.maxEmitBox = new BABYLON.Vector3(0.2, 0.2, 0);
        ps.color1 = new BABYLON.Color4(1, 0.8, 0.2, 1);
        ps.color2 = new BABYLON.Color4(1, 0.2, 0.1, 1);
        ps.minSize = 0.05;
        ps.maxSize = 0.25;
        ps.minLifeTime = 0.2;
        ps.maxLifeTime = 0.7;
        ps.emitRate = 200;
        ps.direction1 = new BABYLON.Vector3(-1, -1, 0);
        ps.direction2 = new BABYLON.Vector3(1, 1, 0);
        ps.start();
        setTimeout(() => ps.stop(), 200);
        setTimeout(() => {
          try { ps.dispose(); } catch (e) { }
        }, 1200);
        this._playBeep(200 + Math.random() * 300, 0.08);
      }

      _createWave() {
        const bounds = this.getBounds();
        const created = [];
        this.currentWave++;
        const waveType = (this.currentWave % 3) || 1; // Cycle through 3 wave types

        if (waveType === 1) {
          // Wave 1: Straight down, spread across top
          const cols = 6;
          const spacingX = 1.1;
          const startX = -(cols - 1) / 2 * spacingX;
          const topY = bounds.top - 0.6;
          for (let c = 0; c < cols; c++) {
            const en = this.enemyPool.acquire();
            en.position = new BABYLON.Vector3(startX + c * spacingX, topY, 0);
            en._base.x = en.position.x;
            en._base.y = en.position.y;
            en._waveType = 'straight';
            en._waveParams = { speed: 0.2 };
            en.isVisible = true;
            en._active = true;
            created.push(en);
          }
        } else if (waveType === 2) {
          // Wave 2: Zigzag pattern
          const count = 6;
          const spacingX = (bounds.right - bounds.left) / (count + 1);
          for (let i = 0; i < count; i++) {
            const en = this.enemyPool.acquire();
            en.position = new BABYLON.Vector3(bounds.left + spacingX * (i + 1), bounds.top - 0.6, 0);
            en._base.x = en.position.x;
            en._base.y = en.position.y;
            en._waveType = 'zigzag';
            en._waveParams = { amplitude: 1.0, frequency: 0.4, speed: 0.2, startTime: this.time + i * 0.2 };
            en.isVisible = true;
            en._active = true;
            created.push(en);
          }
        } else {
          // Wave 3: Arc pattern (semicircle descending)
          const count = 7;
          const radius = 5.0;
          const centerX = 0;
          const topY = bounds.top - 0.6;
          for (let i = 0; i < count; i++) {
            const angle = (i / (count - 1)) * Math.PI; // 0 to PI for semicircle
            const x = centerX + radius * Math.cos(angle);
            const y = topY + radius * Math.sin(angle);
            const en = this.enemyPool.acquire();
            en.position = new BABYLON.Vector3(x, y, 0);
            en._base.x = x;
            en._base.y = y;
            en._waveType = 'arc';
            en._waveParams = { speed: 1.8, radius, centerX, startAngle: angle, startTime: this.time };
            en.isVisible = true;
            en._active = true;
            created.push(en);
          }
        }
        return created;
      }

      update(dt) {
        this.time += dt;
        this.waveSpawnTimer -= dt;

        // Player movement with smooth easing
        const speed = 6;
        if (this.input.left) this.player.position.x -= speed * dt;
        if (this.input.right) this.player.position.x += speed * dt;
        const b = this.getBounds();
        const worldLeft = b.left + this.player._size / 2;
        const worldRight = b.right - this.player._size / 2;
        const worldTop = b.top - this.player._size / 2;
        const worldBottom = b.bottom + this.player._size / 2;
        this.player.position.x = clamp(this.player.position.x, worldLeft, worldRight);
        this.player.position.y = clamp(this.player.position.y, worldBottom, worldTop);

        // Bullets
        this.playerBullets.forEach(bu => {
          if (!bu._active) return;
          bu.position.y += 12 * dt;
          if (bu.position.y > worldTop + 1) this.playerBullets.release(bu);
        });
        this.enemyBullets.forEach(bu => {
          if (!bu._active) return;
          bu.position.y -= 3 * dt;
          if (bu.position.y < worldBottom - 1) this.enemyBullets.release(bu);
        });

        // Enemy movement based on wave type
        this.enemyGroup.forEach((e, idx) => {
          if (!e._active) return;
          const eb = this.getBounds();
          const eLeft = eb.left + (e._size || 0.5) / 2;
          const eRight = eb.right - (e._size || 0.5) / 2;
          const eBottom = eb.bottom + (e._size || 0.5) / 2;

          if (e._waveType === 'straight') {
            e.position.y -= e._waveParams.speed * dt;
          } else if (e._waveType === 'zigzag') {
            const t = this.time - e._waveParams.startTime;
            e.position.x = e._base.x + e._waveParams.amplitude * Math.sin(e._waveParams.frequency * t);
            e.position.y = e._base.y - e._waveParams.speed * t;
          } else if (e._waveType === 'arc') {
            const t = this.time - e._waveParams.startTime;
            const angle = e._waveParams.startAngle + 0.5 * t;
            e.position.x = e._waveParams.centerX + e._waveParams.radius * Math.cos(angle);
            e.position.y = e._base.y - e._waveParams.speed * t;
          }

          e.position.x = clamp(e.position.x, eLeft, eRight);
          e.position.y = Math.max(e.position.y, eBottom);
        });

        // Check if wave is cleared or reached bottom
        const aliveEnemies = this.enemyGroup.filter(e => e._active);
        if (aliveEnemies.length === 0 || (aliveEnemies.length > 0 && Math.min(...aliveEnemies.map(e => e.position.y)) < b.bottom + 1.0)) {
          if (aliveEnemies.length > 0 && Math.min(...aliveEnemies.map(e => e.position.y)) < b.bottom + 1.0) {
            this.gameOver();
            return;
          }
          if (this.waveSpawnTimer <= 0) {
            this.enemyGroup.forEach(e => {
              e._active = false;
              e.isVisible = false;
            });
            this.enemyGroup = this._createWave();
            this.waveSpawnTimer = 2.0; // Delay before next wave
          }
        }

        // Enemy shooting
        if (Math.random() < 0.5) this._enemyFire();

        // Collisions
        this.playerBullets.forEach(pb => {
          if (!pb._active) return;
          for (const e of this.enemyGroup) {
            if (!e._active) continue;
            if (Math.abs(pb.position.x - e.position.x) < 0.45 && Math.abs(pb.position.y - e.position.y) < 0.45) {
              this.playerBullets.release(pb);
              e._active = false;
              e.isVisible = false;
              this.score += 10;
              this.ui.score.text = `Score: ${this.score}`;
              this.explode(e.position);
              break;
            }
          }
        });

        this.enemyBullets.forEach(eb => {
          if (!eb._active) return;
          if (Math.abs(eb.position.x - this.player.position.x) < 0.5 && Math.abs(eb.position.y - this.player.position.y) < 0.5) {
            this.enemyBullets.release(eb);
            this.lives -= 1;
            this.ui.lives.text = `Lives: ${this.lives}`;
            this.explode(this.player.position);
            if (this.lives <= 0) this.gameOver();
          }
        });
      }

      win() {
        this.state = 'GAMEOVER';
        this.ui.center.text = `You Win!`;
        this.ui.hint.text = `Tap to Restart`;
        if (this.ui.highscore) {
          this.ui.highscore.text = `Highscore: ${Math.max(this.highscore, this.score)}`;
          this.ui.highscore.isVisible = true;
        }
        this._saveHighscore();
        this.inputCooldownUntil = performance.now() + 300;
      }

      gameOver() {
        this.state = 'GAMEOVER';
        this.player._active = false;
        this.player.isVisible = false;
        this.ui.center.text = `Game Over`;
        this.ui.hint.text = `Tap to Restart`;
        if (this.ui.highscore) {
          this.ui.highscore.text = `Highscore: ${Math.max(this.highscore, this.score)}`;
          this.ui.highscore.isVisible = true;
        }
        this._saveHighscore();
        this.inputCooldownUntil = performance.now() + 300;
      }

      _saveHighscore() {
        if (this.score > this.highscore) {
          this.highscore = this.score;
          localStorage.setItem('gw_highscore', String(this.highscore));
        }
      }

      dispose() {
        try {
          window.removeEventListener('keydown', this._onKeyDown);
          window.removeEventListener('keyup', this._onKeyUp);
        } catch (e) { }
        try {
          window.removeEventListener('resize', this._resizeHandler);
        } catch (e) {}
        try {
          document.removeEventListener('visibilitychange', this._visibilityHandler);
        } catch (e) {}
        if (this.scene) {
          try { this.scene.onBeforeRenderObservable.removeCallback(this._loop); } catch (e) { }
          try { this.scene.onPointerObservable.remove(this._pointerObserver); } catch (e) { }
        }
        try { if (this._audioCtx) { this._audioCtx.close(); } } catch (e) {}
      }
    }

    const init = async () => {
      if (!babylonCanvasRef.current) return;
      engine = new BABYLON.Engine(babylonCanvasRef.current, true, { preserveDrawingBuffer: true, stencil: true });
      engine.setHardwareScalingLevel(1 / Math.max(1, window.devicePixelRatio || 1));
      scene = new BABYLON.Scene(engine);
      scene.clearColor = new BABYLON.Color4(0, 0, 0, 1);
      game = new Game(scene, engine);
      setReady(true);
      (init).cleanup = () => {
        if (game) game.dispose();
        if (engine) engine.dispose();
      };
    };

    init();

    return () => {
      if (game) game.dispose();
      if (engine) engine.dispose();
    };
  }, []);

  return (
    <div style={{ position: 'fixed', inset: 0, margin: 0, padding: 0, overflow: 'hidden', background: 'black' }}>
      <canvas
        ref={babylonCanvasRef}
        style={{ width: '100vw', height: '100vh', display: 'block', outline: 'none' }}
      />
      {!ready && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white' }}>Loading...</div>
      )}
    </div>
  );
}