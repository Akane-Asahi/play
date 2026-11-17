# Clues · multiplayer

Create a room, share the link, and friends join from their own phones. Add bots (Bebun, Shishu, Protibondhi, Sir, Dada, Bro) to fill the table.

**Status:** rooms, share links, bots, the private deal and the rules are in place. Turn play (suggestions, answers, the shared log) is the next step.

## Set up Firebase (one time)

1. In the Firebase console, open the project and go to **Build → Realtime Database**. Create a database, choose a location and start in locked mode.
2. Go to **Build → Authentication → Sign-in method** and enable **Anonymous**.
3. Publish the security rules in `database.rules.json`: in the Realtime Database, open **Rules**, paste the file's contents and click **Publish**.
4. `firebase-config.js` holds the web config. These values are public by design. Access is controlled by the rules.

## Run it

No build step. Serve the folder with any static server, or use GitHub Pages from `main`, root.

## How it works

- `rooms/{code}/meta`: host, edition, status (`lobby` or `playing`). Only the host can change it.
- `rooms/{code}/players/{id}`: name, seat, bot flag, public hand size. Anyone in the room can read it. Each player writes their own entry; the host adds and removes bots.
- `rooms/{code}/hands/{id}`: a player's own cards. Only that player and the host can read it, and only the host writes it.
- `rooms/{code}/secret`: the envelope. Only the host can read it.

**Known limit:** the host deals, so the host's device can read every hand through the database. That is fine for friends. A later step can deal on each device to remove this.

## Files

- `index.html`, `style.css`, `app.js`: the lobby and game screen
- `solver.js`: the deduction engine and deck helpers, copied from the Clues repo
- `portraits.js`, `img/`: card art
- `database.rules.json`: the Realtime Database rules
