'use client';

import { useEffect, useRef } from 'react';
import * as BABYLON from '@babylonjs/core';
import * as GUI from '@babylonjs/gui';

// It's good practice to define game dimensions as constants
const GAME_WIDTH = 800;
const GAME_HEIGHT = 600;

export default function GalaxyWar() {
  const babylonCanvasRef = useRef(null);

  useEffect(() => {
    let engine;
    let scene;

    const initBabylon = async () => {
      if (babylonCanvasRef.current) {
        engine = new BABYLON.Engine(babylonCanvasRef.current, true);
        scene = new BABYLON.Scene(engine);
        
        // --- Game State Variables ---
        let score = 0;
        let lives = 3;
        let isGameOver = false;
        let player, playerMaterial;
        const enemies = [];
        const playerBullets = [];
        const enemyBullets = [];
        let scoreText, livesText, gameOverText;
        let inputMap = {};

        // --- Camera and Lighting ---
        const camera = new BABYLON.FreeCamera("camera1", new BABYLON.Vector3(0, 5, -15), scene);
        camera.setTarget(BABYLON.Vector3.Zero());
        const light = new BABYLON.HemisphericLight("light1", new BABYLON.Vector3(0, 1, 0), scene);
        light.intensity = 0.8;

        // --- Background ---
        const background = new BABYLON.Layer("back", "/assets/background.png", scene);
        background.isBackground = true;
        background.texture.level = 0;
        background.texture.wAng = 0;
        
        // --- GUI ---
        const advancedTexture = GUI.AdvancedDynamicTexture.CreateFullscreenUI("UI");
        scoreText = new GUI.TextBlock();
        scoreText.text = "Score: 0";
        scoreText.color = "white";
        scoreText.fontSize = 24;
        scoreText.textHorizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        scoreText.textVerticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
        scoreText.paddingTop = "10px";
        scoreText.paddingLeft = "10px";
        advancedTexture.addControl(scoreText);

        livesText = new GUI.TextBlock();
        livesText.text = "Lives: 3";
        livesText.color = "white";
        livesText.fontSize = 24;
        livesText.textHorizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT;
        livesText.textVerticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
        livesText.paddingTop = "10px";
        livesText.paddingRight = "10px";
        advancedTexture.addControl(livesText);
        
        // --- Player Setup ---
        player = BABYLON.MeshBuilder.CreatePlane("player", {size: 1.5}, scene);
        player.position = new BABYLON.Vector3(0, 0, -5);
        playerMaterial = new BABYLON.StandardMaterial("playerMat", scene);
        playerMaterial.diffuseTexture = new BABYLON.Texture("/assets/player.png", scene);
        playerMaterial.diffuseTexture.hasAlpha = true;
        playerMaterial.useAlphaFromDiffuseTexture = true;
        playerMaterial.backFaceCulling = false;
        player.material = playerMaterial;
        
        // --- Input Handling ---
        scene.actionManager = new BABYLON.ActionManager(scene);
        scene.actionManager.registerAction(new BABYLON.ExecuteCodeAction(BABYLON.ActionManager.OnKeyDownTrigger, (evt) => {
            inputMap[evt.sourceEvent.key] = evt.sourceEvent.type == "keydown";
        }));
        scene.actionManager.registerAction(new BABYLON.ExecuteCodeAction(BABYLON.ActionManager.OnKeyUpTrigger, (evt) => {
            inputMap[evt.sourceEvent.key] = evt.sourceEvent.type == "keydown";
        }));

        // --- Enemy Setup ---
        const enemyMaterial = new BABYLON.StandardMaterial("enemyMat", scene);
        enemyMaterial.diffuseTexture = new BABYLON.Texture("/assets/enemy.png", scene);
        enemyMaterial.diffuseTexture.hasAlpha = true;
        enemyMaterial.useAlphaFromDiffuseTexture = true;
        enemyMaterial.backFaceCulling = false;

        for (let i = 0; i < 6; i++) {
            const enemy = BABYLON.MeshBuilder.CreatePlane("enemy" + i, {size: 1.5}, scene);
            enemy.material = enemyMaterial;
            enemy.position = new BABYLON.Vector3(-6 + (i * 2.4), 6, -5);
            enemies.push(enemy);
        }

        // --- Bullet Setup ---
        const createBullet = (isPlayer) => {
            const bullet = BABYLON.MeshBuilder.CreatePlane("bullet", {width: 0.2, height: 0.8}, scene);
            bullet.material = new BABYLON.StandardMaterial("bulletMat", scene);
            const bulletTextureUrl = isPlayer ? "/assets/bullet.png" : "https://placehold.co/20x80/ff0000/white?text=!";
            bullet.material.diffuseTexture = new BABYLON.Texture(bulletTextureUrl, scene);
            bullet.material.diffuseTexture.hasAlpha = true;
            bullet.material.useAlphaFromDiffuseTexture = true;
            bullet.isVisible = false;
            (isPlayer ? playerBullets : enemyBullets).push(bullet);
            return bullet;
        }

        for (let i=0; i<10; i++) createBullet(true);
        for (let i=0; i<20; i++) createBullet(false);

        let lastPlayerShot = 0;
        const firePlayerBullet = () => {
            const now = Date.now();
            if (now - lastPlayerShot < 250) return; // Cooldown
            lastPlayerShot = now;
            const bullet = playerBullets.find(b => !b.isVisible);
            if (bullet) {
                bullet.isVisible = true;
                bullet.position = player.position.clone();
            }
        }
        
        let lastEnemyShot = 0;
        const fireEnemyBullet = () => {
             const now = Date.now();
            if (now - lastEnemyShot < 1000) return; // Cooldown
            lastEnemyShot = now;
            const livingEnemies = enemies.filter(e => e.isEnabled());
            if (livingEnemies.length > 0) {
                const randomEnemy = livingEnemies[Math.floor(Math.random() * livingEnemies.length)];
                const bullet = enemyBullets.find(b => !b.isVisible);
                if (bullet) {
                    bullet.isVisible = true;
                    bullet.position = randomEnemy.position.clone();
                }
            }
        }

        const createExplosion = (position) => {
            const particleSystem = new BABYLON.ParticleSystem("particles", 2000, scene);
            // Using a placeholder for explosion as the asset might not exist
            particleSystem.particleTexture = new BABYLON.Texture("https://placehold.co/64x64/ffa500/white?text=BOOM", scene);
            particleSystem.emitter = position;
            particleSystem.minEmitBox = new BABYLON.Vector3(-0.5, -0.5, -0.5);
            particleSystem.maxEmitBox = new BABYLON.Vector3(0.5, 0.5, 0.5);
            particleSystem.color1 = new BABYLON.Color4(1, 0.5, 0, 1);
            particleSystem.color2 = new BABYLON.Color4(1, 0, 0, 1);
            particleSystem.minSize = 0.1;
            particleSystem.maxSize = 0.5;
            particleSystem.minLifeTime = 0.2;
            particleSystem.maxLifeTime = 0.5;
            particleSystem.emitRate = 1000;
            particleSystem.direction1 = new BABYLON.Vector3(-1, -1, -1);
            particleSystem.direction2 = new BABYLON.Vector3(1, 1, 1);
            particleSystem.minAngularSpeed = 0;
            particleSystem.maxAngularSpeed = Math.PI;
            particleSystem.gravity = new BABYLON.Vector3(0, 0, 0);
            particleSystem.start();
            setTimeout(() => particleSystem.dispose(), 1000);
        }

        const showGameOver = (message) => {
            isGameOver = true;
            gameOverText = new GUI.TextBlock();
            gameOverText.text = message + "\nClick to Restart";
            gameOverText.color = "white";
            gameOverText.fontSize = 48;
            gameOverText.textHorizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
            gameOverText.textVerticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_CENTER;
            advancedTexture.addControl(gameOverText);

            // Restart listener
            scene.onPointerObservable.addOnce((pointerInfo) => {
                // Reset logic here...
                 window.location.reload(); // Simple restart
            });
        }
        
        let time = 0;
        // --- Game Loop ---
        scene.onBeforeRenderObservable.add(() => {
            if (isGameOver) return;
            
            const deltaTime = engine.getDeltaTime() / 1000;
            time += deltaTime;

            // Player Movement
            if (inputMap["a"] || inputMap["ArrowLeft"]) {
                player.position.x -= 8 * deltaTime;
                if (player.position.x < -8) player.position.x = -8;
            }
            if (inputMap["d"] || inputMap["ArrowRight"]) {
                player.position.x += 8 * deltaTime;
                 if (player.position.x > 8) player.position.x = 8;
            }
            if (inputMap[" "]) {
                firePlayerBullet();
            }

            // Enemy Movement
            enemies.forEach(enemy => {
                enemy.position.x += Math.sin(time * 2 + enemy.position.y) * 0.02;
            });

            fireEnemyBullet();

            // Bullets movement
            playerBullets.forEach(bullet => {
                if (bullet.isVisible) {
                    bullet.position.y += 15 * deltaTime;
                    if (bullet.position.y > 10) bullet.isVisible = false;
                }
            });
            enemyBullets.forEach(bullet => {
                if (bullet.isVisible) {
                    bullet.position.y -= 10 * deltaTime;
                    if (bullet.position.y < -10) bullet.isVisible = false;
                }
            });

            // Collision Detection
            playerBullets.forEach(bullet => {
                if (!bullet.isVisible) return;
                enemies.forEach(enemy => {
                    if (enemy.isEnabled() && bullet.intersectsMesh(enemy, false)) {
                        createExplosion(enemy.position);
                        enemy.setEnabled(false);
                        bullet.isVisible = false;
                        score += 10;
                        scoreText.text = "Score: " + score;
                        if (enemies.every(e => !e.isEnabled())) {
                            showGameOver("You Win!");
                        }
                    }
                });
            });

            enemyBullets.forEach(bullet => {
                if (!bullet.isVisible) return;
                if (player.isEnabled() && bullet.intersectsMesh(player, false)) {
                    createExplosion(player.position);
                    bullet.isVisible = false;
                    lives--;
                    livesText.text = "Lives: " + lives;
                    if (lives <= 0) {
                        player.setEnabled(false);
                        showGameOver("Game Over");
                    }
                }
            });

        });
        
        engine.runRenderLoop(() => {
            scene.render();
        });
      }
    };
    
    initBabylon();

    return () => {
      if (engine) {
        engine.dispose();
      }
    };
  }, []);

  return (
    <div className="w-full h-screen flex justify-center items-center bg-gray-900">
      <canvas
        ref={babylonCanvasRef}
        style={{ width: `${GAME_WIDTH}px`, height: `${GAME_HEIGHT}px`, outline: 'none' }}
      />
    </div>
  );
}

