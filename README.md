# Topo Bearing Trainer

A small 3D navigation prototype for practicing compass bearings and topographic map reading.

The first slice is built with **TypeScript + Three.js**. That keeps the code close to JavaScript while adding useful types, and it is a good bridge before moving into engines such as Godot, Unity, or Bevy.

## What is playable now

- Start from a home menu with Tutorial and Challenge modes.
- Walk through a generated mountain terrain.
- Read a topographic map generated from the same heightfield as the 3D world.
- Compare contour spacing on the map with hills, ridges, valleys, and slopes in the scene.
- Plot a bearing from the start to the control.
- Follow the bearing using the compass HUD.
- Get scored by cross-track drift from the planned bearing line.
- Hunt for clues and a treasure chest in Grasslands, Desert, and Mountain challenge levels.

## Modes

- **Tutorial Level 1**: small practice tile with one hill, one depression, one tree, and one rock.
- **Tutorial Level 2**: contour playground with raise/lower/flatten tools on the topo map.
- **Tutorial Level 3**: the original bearing-following lesson.
- **Challenge**: collect three clues, reveal the treasure chest, and score well by keeping routes short while avoiding steep slopes.

## Run it

```bash
npm install
npm run dev
```

Open the local URL printed by Vite.

```bash
npm run build
npm run verify:render
```

The render check expects the dev server to be running.

## Publish on GitHub Pages

This repo includes a GitHub Actions workflow that builds the Vite app and deploys `dist/` to GitHub Pages whenever `main` is pushed.

In GitHub, open the repository settings and set:

- **Pages > Build and deployment > Source**: GitHub Actions

After the first successful workflow run, the game should be playable at:

```text
https://<your-github-username>.github.io/3D_compass_navigation_game/
```

If you rename the repository or use a custom domain, the relative Vite asset base in `vite.config.ts` should still work.

## Controls

- `W` / `S`: forward and back
- `A` / `D`: strafe
- `Q` / `E` or arrow keys: turn
- Hold `Shift`: run
- Drag on the 3D view: turn

## Why this stack

For a learning project, TypeScript and Three.js let you focus on the core navigation ideas without fighting a full editor-driven engine. When the prototype grows, good next languages and engines would be:

- **GDScript with Godot** for a friendly open-source game engine.
- **C# with Godot or Unity** if you want a mature 3D engine and a language close to Java.
- **Rust with Bevy** if you want to learn a modern systems language and an entity-component game architecture.
- **C++ with Unreal** only if you eventually want high-end 3D engine work; it is probably too heavy for this first version.

## Next feature ideas

- Hide the ideal bearing line for a harder mode.
- Add multiple control points and route choice.
- Add map rotation and compass/map alignment drills.
- Add contour-only and path-only map modes.
- Add a lesson mode for ridge, spur, saddle, and reentrant recognition.
