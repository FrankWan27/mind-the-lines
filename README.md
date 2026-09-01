# Mind the Lines

An online drawing-and-guessing party game, like Gartic Phone but you don't get to draw freely.
Each round the game deals you a tangle of random line segments and a secret word, and the only thing you can do is trace over the lines you were given.
Everyone then works together to match each drawing back to its word.

Based on the co-op board game of the same name.

## How it works

A round has two parts:

- **Draw** - everyone gets a secret prompt and their own board of random segments, and traces the word using only those lines. You pick which segments to draw and which to leave out; that's the whole game.
- **Match** - all the drawings are revealed. The real prompts get shuffled in with an equal number of decoy words, and the group cooperatively matches each drawing to a word.

Score is a team total across four rounds. Match enough and everyone wins.

Rooms work like Gartic Phone: one person creates a room and gets a short code, everyone else joins with it.

## Layout

npm workspaces:

```
mind-the-lines/
├── shared/   - types shared by client and server ([shared/src/types.ts](shared/src/types.ts))
├── server/   - Node + TypeScript + Socket.IO, rooms live in memory (port 3001)
└── client/   - React + Vite + TypeScript (port 5173)
```

`shared` is source-only - the client and server import its types by relative path, so there's nothing to build to keep them in sync.
The game logic lives in [server/src/game.ts](server/src/game.ts), the board generator in [server/src/boardGen.ts](server/src/boardGen.ts), and the trace-the-lines canvas in [client/src/components/BoardCanvas.tsx](client/src/components/BoardCanvas.tsx).

## Running it

My dev box is Amazon Linux 2 (glibc 2.26), which can't run native Node 18+, so this runs in Docker with `node:20-bookworm`.

```bash
./run.sh                    # build the image and start the container
docker logs -f mtl-dev      # follow the logs
```

Then open http://localhost:5173.

`run.sh` uses plain `docker run` because this box has no `docker compose`.
There's a `docker-compose.yml` too if you're somewhere that does - just `docker compose up`.
Either way the container runs `npm install` then both dev servers, ports are bound to localhost only, and the source is mounted so edits hot-reload.

If you have a working Node 20+ locally you can skip Docker:

```bash
npm install
npm run dev     # runs the server (tsx watch) and the client (vite) together
```

## Deploying

It's a real-time game with a stateful server (open sockets, rooms in memory), so it deploys in two halves:

- the client (static build) goes on Vercel
- the server goes on Render, which can run an always-on process

Both deploy from this repo on every push.

**Server (Render):** New → Blueprint → point it at this repo. It reads [render.yaml](render.yaml) and stands up the server on the free tier. Grab the service URL, something like `https://mind-the-lines-server.onrender.com`. Heads up that the free tier sleeps after ~15 min idle, so the first connection takes 30-60s to wake it.

**Client (Vercel):** New Project → import this repo. It picks up [vercel.json](vercel.json) on its own. Add one env var, `VITE_SERVER_URL`, set to the Render URL, and deploy. It's baked in at build time, so if you add it after the first build you have to redeploy.

**Then connect them:** back on Render, set `CLIENT_ORIGIN` to your Vercel domain (no trailing slash) so CORS lets the client in, and let it redeploy.
