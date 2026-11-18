# Models for Clue3D

Drop GLB files here and name them in `manifest.json`. Any slot left `null` uses the built-in stand-in, so the game always runs.

```
models/
  manifest.json
  suspects/scarlett.glb  mustard.glb  white.glb  green.glb  peacock.glb  plum.glb
  weapons/candlestick.glb  knife.glb  lead-pipe.glb  revolver.glb  rope.glb  wrench.glb
  rooms/kitchen.glb  ballroom.glb  ...  study.glb
```

## The look (so everything matches)

- **Chibi proportions** for suspects: head about 40–45% of total height, short legs, big hands, simple faces.
- **Toy-like, rounded shapes.** No tiny detail that disappears on a phone screen.
- **Flat colours from the game palette** (`js/look.js` → `PALETTE`). No photo textures, no baked lighting, no roughness/metal maps. The game recolours to toon shading anyway.
- Weapons are **oversized and chunky**, readable from far away.
- Rooms are **cut-away dioramas**: floor + furniture only (the game draws the walls), and keep the front open.

## Prompt to use in the 3D generator (Meshy, Tripo, Rodin, etc.)

> Stylized chibi 3D character, toy figure, big head, small body, smooth rounded shapes, hand-painted flat colors, low poly, game-ready, T-pose, front view, white background. [Character: a glamorous woman in a red dress, 1920s mansion mystery]

For weapons: "stylized chunky toy [candlestick], cartoon proportions, low poly, flat colors".
For rooms: "isometric cut-away diorama of a cozy [library], toy-like furniture only, no walls, stylized low poly, flat pastel colors".

## Technical rules

| | Suspect | Weapon | Room |
|---|---|---|---|
| Triangles | 3k–8k | 500–2k | 10k–25k |
| Texture | 512×512 (or none) | 256×256 (or none) | 1024×1024 |
| Origin | between the feet | centre of the base | centre of the floor |
| Facing | +Z (towards the camera) | any | front side at +Z |
| Rig | Mixamo humanoid (idle, walk, jump, surprised) | none | none |

Scale does not matter: the game fits suspects to pawn height and rooms to the 4×4 floor.

## Clean-up steps in Blender

1. Import the generated GLB. Delete extra objects, lights and cameras.
2. **Decimate** (Modifier → Decimate, Collapse) down to the triangle budget above.
3. Replace the generator's materials with a few flat-coloured ones (or one small palette texture).
4. Apply all transforms (Ctrl+A → All Transforms). Put the origin where the table says.
5. Suspects: upload to Mixamo, auto-rig, download idle/walk/jump/surprised, merge into one GLB with named animations `Idle`, `Walk`, `Jump`, `Surprised`.
6. Export glTF Binary (.glb).
7. Compress: `npx @gltf-transform/cli optimize in.glb out.glb --compress meshopt --texture-compress webp`
8. Put the file here and set its slot in `manifest.json`.

## Rights

Use only models you generated yourself or that allow use (check the licence). Don't copy models, characters or UI from Tiny Hunters or the official Clue game. Keep credits in `CREDITS.md`.
