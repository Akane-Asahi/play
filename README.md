# Clues · multiplayer

Create a room, share the link, and friends join from their own phones. Add bots (Bebun, Shishu, Protibondhi, Sir, Dada, Bro) to fill the table.

**Status:** playable. Rooms, share links, bots, private hands, suggestions, answers, accusations, a shared turn log and per-player notes all work.

## How a game goes

1. Open `/clue/`, type your name and create a room. Share the link.
2. Friends open the link, type a name and join. The host can add bots and starts the game (3 to 6 players).
3. On your turn, pick a suspect, a weapon and a room and tap **Suggest**. Players are asked in seat order. The first one who holds one of the cards shows it to you, and only you see which.
4. When you are asked and hold more than zero of the cards, tap the one to show. A 👁️ marks a card you already showed that player.
5. After your suggestion, end your turn or make an accusation. A right accusation wins. A wrong one puts you out, but you still show cards.
6. **Your notes** is a sheet where you tick (✓) or cross (✕) what each player holds and what is in the envelope. It is saved on your device. The host can switch it off in the lobby. A player named Telot gets a table that works out the possibilities instead.

Bots and accusation checks run on the host's device, so the host keeps the page open. Anyone can reload and return through the same link.

## Set up Firebase (one time)

1. In the Firebase console, open the project and go to **Build → Realtime Database**. Create a database, choose a location and start in locked mode.
2. Go to **Build → Authentication → Sign-in method** and enable **Anonymous**.
3. Publish the security rules in `database.rules.json`: in the Realtime Database, open **Rules**, paste the file's contents and click **Publish**.
4. `firebase-config.js` holds the web config. These values are public by design. Access is controlled by the rules.

## Run it

No build step. The Clue game lives in the `clue/` folder. Serve the repo with any static server, or use GitHub Pages from `main`, root. The game is then at `/clue/`, for example `https://akane-asahi.github.io/play/clue/`.

Each game gets its own folder. The Firebase rules at the root protect the `rooms/` path, so a new game that shares the database needs its own path in the rules.

## How it works

- `rooms/{code}/meta`: host, edition, status (`lobby` or `playing`), notes switch. Only the host can change it.
- `rooms/{code}/players/{id}`: name, seat, bot flag, public hand size.
- `rooms/{code}/hands/{id}`: a player's own cards. Only that player and the host can read it.
- `rooms/{code}/secret`: the envelope. Only the host can read it.
- `rooms/{code}/game`: whose turn it is, the suggestion being answered and the public log. Players in the room write it with transactions.
- `rooms/{code}/shown/{id}/{turn}`: the card a player was shown or showed on that turn. Only that player can read it (the host reads the bots' entries).

**Known limits:** the host deals and runs the bots, so the host's device can read every hand through the database. The rules trust players in the room not to edit the game with a modified page. Both are fine for friends.

## Tests

```
npm install
npm test
```

`test/engine.test.js` plays full bot-only games against the rules. `test/app.test.js` runs several players' pages against a fake network that enforces the same access rules. `test/preview.html` shows the screens in a browser without Firebase (serve the repo root, then open `test/preview.html?step=turn`).

## Files

- `clue/index.html`, `clue/main.js`: page and Firebase connection
- `clue/app.js`: lobby, turns, bots, notes and all screens
- `clue/engine.js`: the game rules, with no network or page code
- `clue/style.css`, `clue/play.css`: the Clues tracker look, plus multiplayer extras
- `clue/firebase-config.js`: the web config
- `clue/solver.js`: the deduction engine, copied from the Clues repo
- `clue/portraits.js`, `clue/img/`: card art
- `database.rules.json`: the Realtime Database rules (repo root)

## Fast game and full game

When you create a room you pick the kind of game (the host can still switch it in the lobby):

- **Fast game** – cards only: take turns making suggestions.
- **Full game** – an isometric mansion (`clue/board.js`, drawn by `clue/boardview.js`). Roll two dice, walk the
  corridors, and make a suggestion only in the room you walk into. Corner rooms have secret passages.
  Pawns in corridors block the way. Bots roll and walk too.

## Clues 3D (in progress)

A 3D version of the full game with a toy-diorama look lives in `Clue3D/` (`/Clue3D/` on the site). It uses the same
rules (`clue/engine.js`, `clue/board.js`) drawn with three.js, still with no build step. Today it is a sandbox: you
against two bots, rolling, walking and entering rooms. The plan and progress are on the task board at
`Clue3D/tasks.html`. See `Clue3D/README.md`.
