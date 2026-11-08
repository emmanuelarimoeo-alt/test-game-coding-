# Network Arena online deployment

The game is ready to run as a single Node.js web service. Publishing is a separate step; these files alone do not create a live website.

## Render configuration

Use the included `render.yaml` with a Render Blueprint, or these Web Service settings:

| Setting | Value |
| --- | --- |
| Runtime | Node |
| Plan | Free |
| Build command | `node --test tests.mjs` |
| Start command | `node server.mjs` |
| Health check path | `/healthz` |
| Instances | 1 |
| `NODE_VERSION` | `22` |
| `NODE_ENV` | `production` |

The repository root should contain `server.mjs`, `engine.mjs`, `package.json`, `render.yaml`, and `public/`. If this folder is nested in a larger repository, set the service root directory to this folder. No third-party packages, API keys, or database are required. The server listens on Render's `PORT` automatically.

After deployment reports successful, open the assigned HTTPS URL. Create a match, copy its invite, and have players on any network join that URL. The host player controls the round from their browser; no player laptop needs to run the server.

## Check before sharing

1. Open the live URL on two devices or in two separate browser profiles.
2. Create a match on Cyan and join on Coral with the code.
3. Start a round, complete an attack, then complete cleanup from the opposing side.
4. Confirm both clients show the same score and computer statuses.

## Free hosting behavior

Render's free web service sleeps after 15 minutes without inbound traffic and may take about a minute to wake up. Matches use memory, so sleeping, restarting, or deploying clears current rooms and scores. Open the site before the group arrives, then create a fresh match. Free usage limits also apply; this deployment does not require a paid plan.

Do not scale beyond one instance: this version keeps all match state in that one server process. Keep the service on HTTPS for private player-session tokens. It is designed for casual play with a trusted group, not ranked or cheat-resistant competition.

Official documentation: https://render.com/docs/web-services and https://render.com/docs/free
