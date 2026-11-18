# Clues 3D

A 3D version of the full Clue game with a toy-diorama look: chibi pawns, flat bright colours, toon shading
and a fixed high camera. It runs the same rules as `../clue` (`engine.js`, `board.js`), drawn with three.js.

- **Play the sandbox:** `/Clue3D/` (e.g. `https://akane-asahi.github.io/play/Clue3D/`). You are Scarlett against two bots: roll, walk, enter rooms, take secret passages. Suggestions, cards and online rooms come next.
- **Task board:** `/Clue3D/tasks.html`. Drag cards between To do, In progress and Done.

## Run it

No build step, like the rest of the repo. three.js loads from jsDelivr through the import map in `index.html`.
Serve the repo root with any static server and open `/Clue3D/`.

## Files

- `index.html`, `clue3d.css`: page, import map, the bottom dock
- `js/main.js`: the sandbox game loop (local players, bots, tapping the board)
- `js/scene.js`: renderer, diorama camera, lights, shadows, controls
- `js/look.js`: the palette and toon materials (everything goes through here)
- `js/board3d.js`: the mansion built from `../clue/board.js`, room stand-in furniture, reach highlights, picking
- `js/pawns.js`: chibi stand-in pawns, turn marker, swapping in suspect models
- `js/dice.js`: dice that tumble and land on the rolled values
- `js/anim.js`: tweens, hop with squash and stretch
- `js/path.js`: the squares a pawn walks through (tested in `../test/clue3d.test.js`)
- `js/assets.js`, `models/`: loading generated GLB models; see `models/README.md` for the model rules
- `tasks.html`: the project task board

## Adding the generated 3D models

Follow `models/README.md`: clean up in Blender, export GLB, compress, put it in `models/`, name it in `models/manifest.json`.
Empty slots keep the stand-ins, so the game works at every step.
