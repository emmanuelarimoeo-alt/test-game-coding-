# Network Arena

A two-team, browser-based hacking simulation. Each player uses a separate laptop as a virtual computer. No real files or computers are attacked.

## Play on shared Wi-Fi

1. Extract the ZIP on **one host laptop**. Keep all the files together.
2. On Windows, double-click **START-WINDOWS.cmd**. It uses Node.js if installed, including this laptop's existing Codex runtime. If needed, install Node.js 22 or newer on the host. On macOS/Linux, run `node server.mjs` from this folder.
3. Keep the host window open. It prints a local address for the host and a Wi-Fi address for other laptops, such as `http://192.168.1.20:8787`.
4. The host opens `http://localhost:8787`, enters a callsign, chooses a team, and creates a match.
5. Other players open the **Wi-Fi address** on their own laptops, choose **Join a match**, and enter the six-character code. Alternatively, the host's **Copy invite** button includes the code. Do not send other players a `localhost` link; that points to their own laptop.
6. Split into Cyan and Coral. Once at least one online player joins each team, the host clicks **Start 3-minute match**.

Only the host needs the source files or Node.js. Every other player needs only a browser. Up to 12 players can join each team. Use equal team sizes for a fair match.

## How to win

- Select **Attack** on a clean opponent, or **Clean** on an infected teammate (including yourself).
- Choose **Arrow signals** or **Typing sprint** before selecting the target.
- Arrows: match three sequences of 4, 5, and 6 arrows using your keyboard or the buttons.
- Typing: type the displayed passage exactly, including capitals and punctuation, then submit.
- Each challenge lasts 25 seconds. A wrong arrow restarts that sequence and subtracts 2 seconds. A wrong typing submission also subtracts 2 seconds. There is no game effect if time runs out or you cancel.
- Successful attacks and cleanups earn **10 points**. An infected opponent earns the attacking team **1 point per second** while that opponent remains online. Offline opponents stop generating points after 15 seconds without a check-in.
- Cleanup grants **6 seconds of protection**. Successful actions have a **2-second cooldown**.
- Infected players can still attack and clean. You can help clean any teammate.
- No automatic virus spread occurs in competitive mode: players earn each infection through challenges.
- Highest team score at the end of 3 minutes wins. The host can open a rematch lobby with the same roster and room code.

## Connections

Keep browser tabs open and the host laptop awake. Refreshing restores your session in the same browser. Leaving the view marks your computer offline after 15 seconds; you remain on the match roster. If the host server stops or restarts, all matches and scores are cleared. Matches are held in memory, not on disk.

If other laptops cannot connect:

- Check that everyone is on the same local network and is using the Wi-Fi address printed by the host, not `localhost`.
- If Windows asks, allow Node.js on your **private network** so other laptops can reach the host.
- Campus and guest Wi-Fi may block connections between devices. A personal hotspot or trusted home Wi-Fi can provide a shared network.
- If multiple addresses are printed, use the one for the active Wi-Fi/Ethernet adapter. Avoid VPN or virtual-adapter addresses.
- The host must keep the server window open. Closing it ends every match.
- If port 8787 is occupied, set the `PORT` environment variable before running `node server.mjs`.

## Players in different locations

This package includes a real shared Node.js server, so it can also run on an internet host that supports a persistent Node process and the `PORT` environment variable. Start command: `npm start`. There are no package dependencies to install. All players then open the same HTTPS address. Use HTTPS when internet-hosted; player sessions use private bearer tokens.

Uploading only `public/index.html` to Google Sites or GitHub Pages will **not** enable multiplayer. Those files need the server in this package. Google Sites can link to a separately hosted instance. See **ONLINE-SETUP.md** and the included **render.yaml** for the prepared online-hosting configuration. A live URL is available only after a successful deployment.

This is a casual game for a trusted group, not a cheat-resistant ranked service. The host controls the match and validates challenges, deadlines, targets, and scores. Browser automation can still solve visible challenges. No accounts, chat, external scripts, or real hacking functions are included.

## Source and checks

- `engine.mjs`: authoritative rooms, teams, targets, scoring, and mini-games.
- `server.mjs`: HTTP server and API, with bounded JSON input and basic request limits.
- `public/`: browser UI.
- `tests.mjs`: match, timing, scoring, validation, and HTTP integration checks.

Run checks with `node --test tests.mjs`. Node.js 22 or newer is recommended.
