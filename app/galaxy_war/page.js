'use client';
import { useEffect, useRef } from 'react';
import * as PIXI from 'pixi.js';

export default function GalaxyWar() {
  const gameRef = useRef(null);

  useEffect(() => {
    if (!gameRef.current) return;

    const WIDTH = 800;
    const HEIGHT = 600;

    const canvas = document.createElement('canvas');

    const app = new PIXI.Application({
      view: canvas,
      width: WIDTH,
      height: HEIGHT,
      backgroundColor: 0x000000,
    });

    gameRef.current.appendChild(canvas);

    const bullets = [];
    const enemies = [];
    let player;

    const handleKeyDown = (e) => {
      if (!player) return; // guard before player is ready
      if (e.code === 'ArrowLeft') player.x -= 15;
      if (e.code === 'ArrowRight') player.x += 15;
      if (e.code === 'Space') {
        const bullet = new PIXI.Sprite(PIXI.Texture.EMPTY);
        bullet.texture = PIXI.Texture.from('/assets/bullet.png');
        bullet.anchor.set(0.5);
        bullet.x = player.x;
        bullet.y = player.y - 20;
        app.stage.addChild(bullet);
        bullets.push(bullet);
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    const checkCollision = (a, b) => {
      const ab = a.getBounds();
      const bb = b.getBounds();
      return (
        ab.x < bb.x + bb.width &&
        ab.x + ab.width > bb.x &&
        ab.y < bb.y + bb.height &&
        ab.y + ab.height > bb.y
      );
    };

    // Game loop
    const gameLoop = () => {
      for (let b = bullets.length - 1; b >= 0; b--) {
        const bullet = bullets[b];
        bullet.y -= 10;
        if (bullet.y < 0) {
          app.stage.removeChild(bullet);
          bullets.splice(b, 1);
          continue;
        }

        for (let e = enemies.length - 1; e >= 0; e--) {
          const enemy = enemies[e];
          if (checkCollision(bullet, enemy)) {
            app.stage.removeChild(enemy);
            app.stage.removeChild(bullet);
            enemies.splice(e, 1);
            bullets.splice(b, 1);
            break;
          }
        }
      }
    };

    app.ticker.add(gameLoop); // Add the ticker immediately

    // Load assets
    const loadAssets = async () => {
      const textures = await PIXI.Assets.load([
        '/assets/player.png',
        '/assets/enemy.png',
        '/assets/bullet.png',
      ]);

      // Player
      player = new PIXI.Sprite(textures['/assets/player.png']);
      player.anchor.set(0.5);
      player.x = WIDTH / 2;
      player.y = HEIGHT - 50;
      app.stage.addChild(player);

      // Enemies
      for (let i = 0; i < 6; i++) {
        const enemy = new PIXI.Sprite(textures['/assets/enemy.png']);
        enemy.anchor.set(0.5);
        enemy.x = 100 + i * 100;
        enemy.y = 100;
        app.stage.addChild(enemy);
        enemies.push(enemy);
      }
    };

    loadAssets();

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      app.destroy(true, { children: true });
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    };
  }, []);

  return <div ref={gameRef} />;
}
