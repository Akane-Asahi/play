# Clues · multiplayer

Create a room, share the link, and friends join from their own phones. Add bots (Bebun, Shishu, Protibondhi, Sir, Dada, Bro) to fill the table.

**Status:** playable. Rooms, share links, bots, private hands, suggestions, answers, accusations, a shared turn log and per-player notes all work.

## How a game goes

1. Open `/clue/`, type your name and create a room. Share the link.
2. Friends open the link, type a name and join. The host can add bots and starts the game (3 to 6 players).
3. On your turn, pick a suspect, a weapon and a room and tap **Suggest**. Players are asked in seat order. The first one who holds one of the cards shows it to you, and only you see which.
4. When you are asked and hold more than zero of the cards, tap the one to show. A 👁️ marks a card you already showed that player.
5. After your suggestion, end your turn or make an accusation. A right accusation wins. A wrong one puts you out, but you still show cards.
6. **Your notes** is a sheet where you tick (✓) or cross (✕) what each player holds and what is in the envelope. It is saved on your device. The host can switch it off in the lobby. A player named Telot gets a table that works out the possibilities instead, and the Turns list also marks cards the calculator can place (👁️ one card, a moon when it is down to two, ? for envelope-only), and the suggestion pop-up shows a 🤡 on a card the suggester is known to hold (a bluff), the notes summary has "Best to ask in the <room you stand in>" on the left, the candidate counts in the middle and "Best to ask anywhere" (the question that cuts the possibilities down most) on the right, and when you can choose which card to show, a 🛡️ marks the one that tells the asker the least.

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
- `clue/table/index.html`: the real-table tracker (bookkeeping only, works offline after load)
- `database.rules.json`: the Realtime Database rules (repo root)

## Fast game and full game

When you create a room you pick the kind of game (the host can still switch it in the lobby):

- **Fast game** – cards only: take turns making suggestions.
- **Full game** – an isometric mansion (`clue/board.js`, drawn by `clue/boardview.js`). No dice: every player holds
  public movement cards, **Stamina & Pace**: 3 Sprint (up to 10 spaces), 5 Jog (6) and 4 Walk (3). Press a card to see
  where it reaches; it is spent when you tap the square or room. A suggestion can only be made in the room you walk into.
  Corner rooms have secret passages, which are free. With every card used you are Tired and move 2 spaces a turn.
  **Deduce** refills (+1 Sprint, +2 Jog, +2 Walk) but costs the whole turn, and is locked until one kind has run out.
  Pawns in corridors block the way. Bots spend cards and Deduce according to a personality (`PERSONAS` in `clue/engine.js`).
- **3D game** – the full game with the mansion in 3D (see below).

## Real table (bookkeeping only)

Playing Clue with a real board and real cards? Open `/clue/table/` (the link under Join room on the first page, or
**Real table** under "What kind of game?"). It is the Clues tracker from the Akane-Asahi/clue repo: no room, no
Firebase, nothing shared. One phone logs every suggestion, who said none, who showed and who refused, and works out
what can still be in the envelope. The game is saved on that device under its own keys (`clues-table-*`), so it never
mixes with the standalone tracker's saved game. It reuses `clue/solver.js` and `clue/portraits.js`.

## Clues 3D (in progress)

A 3D version of the full game with a toy-diorama look lives in `Clue3D/`, drawn with three.js and still with no build step.

- **3D game mode:** when creating a room in `/clue/`, choose **3D game** next to Fast game and Full game. It is the full game
  (same rules, same room, same Firebase) with the mansion drawn in 3D. If a phone cannot do WebGL, that room shows the flat map.
- **Sandbox:** `/Clue3D/` is a single-device sandbox (you against two bots) used to try the look.
- The plan and progress are on the task board at `Clue3D/tasks.html`. See `Clue3D/README.md`.
