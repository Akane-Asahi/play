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

## The task board

`tasks.html` is one self-contained page. The task list is the JSON block inside it (one task per line):
`status` is `todo`, `doing` or `done`, `you: true` marks tasks that need the owner's input, and `t` is when the
status was last set.

- Opened from the repo or GitHub Pages, your drags are saved on that device (localStorage).
- The same page is published as a private claude.ai page with a shared store:
  https://claude.ai/artifact/UAFtXrD5Sm3VfMQaPQ89FX (slug `dbf19cf4-3dbd-4646-a84d-fc90bf2bfb72`).
  There, every drag is written to `moves/<task id>` as `{ col, order, t, note? }`, so it syncs across devices and
  Claude can read and move cards too.
- A card shows the newest of its file status and its last move. When Claude finishes a task it updates both:
  the JSON line here (and pushes) and the shared `moves/<id>` document.
