# Mind the Lines

A cooperative online drawing-and-guessing party game, in the spirit of Gartic Phone but with a twist: you don't draw freely.

## The game

Each round the game **deals you a set of line segments** and your only move is to **trace over the dealt lines** - you decide which of them to actually draw and which to leave out.
From those partial traces, the group tries to reconstruct and **guess** the original prompt.
Because everyone is constrained to the same dealt lines, the fun comes from *what you choose to trace* and *what you choose to omit* - a shared, cooperative sketch built one constrained stroke at a time.

- **Cooperative drawing/guessing:** players collaborate to convey and guess a prompt.
- **Trace-only-the-dealt-lines mechanic:** you can only draw along the line segments the game gives you.
- **Online lobby:** create or join a room with a short **room code**, like Gartic Phone.

## Monorepo layout

npm workspaces:

```
mind-the-lines/
├── package.json          # root: workspaces + dev/build scripts
├── tsconfig.base.json    # shared strict compiler options
├── Dockerfile.dev        # node:20-bookworm dev image
├── docker-compose.yml    # one "app" service running both dev servers
├── shared/               # @mind-the-lines/shared  - TS types (source-only)
│   └── src/types.ts
├── server/               # @mind-the-lines/server  - Node + TS + Socket.IO (port 3001)
│   └── src/
└── client/               # @mind-the-lines/client  - React + Vite + TS (port 5173)
    └── src/
```

The `shared` package is **source-only**: `server` and `client` import its types via relative path (e.g. `../../shared/src/types.ts`), so there is no build step to keep in sync during development.

## Running it

### A) Docker (recommended)

The host desktop is **Amazon Linux 2 (glibc 2.26)**, so native Node 18+ binaries will not run there. Docker with `node:20-bookworm` (glibc 2.36) is the supported path.

```
./run.sh
```

Then open **http://localhost:5173** in your browser. Follow logs with `docker logs -f mtl-dev`.

`run.sh` builds `Dockerfile.dev` and starts the container with plain `docker run`
(this host has no `docker compose`). A `docker-compose.yml` is also included for
environments that do have Compose - there, just run `docker compose up`.

- The container runs `npm install` (for the container's platform) and then `npm run dev`, which starts the server and the Vite client together.
- Ports are exposed to **localhost only**: `3001` (server/Socket.IO) and `5173` (client).
- Source is bind-mounted, so edits on the host hot-reload in the container.

### B) Local Node 20 (only if you have a compatible Node 20+)

```
npm install
npm run dev
```

`npm run dev` uses `concurrently` to run:
- `dev:server` - `tsx watch` on the Socket.IO server (port 3001)
- `dev:client` - Vite dev server (port 5173)

Build for production:

```
npm run build   # builds shared, then server, then client
```

## How to play

1. Open **http://localhost:5173**.
2. **Create a room** - you'll get a short **room code**.
3. **Share the room code** with friends; they open the same URL and **join with the code**.
4. When everyone's in, start a round. The game **deals each player a set of line segments**.
5. **Trace the dealt lines** - draw the ones you think help convey the prompt, skip the rest.
6. The group **guesses** the prompt from the combined traces. Reveal, laugh, go again.

## Ports

| Service | Port  | Bound to  |
|---------|-------|-----------|
| client  | 5173  | localhost |
| server  | 3001  | localhost |

## Deployment (Vercel + Render)

This is a real-time multiplayer game, so it deploys as **two pieces**:

- **Client** (static React/Vite build) → **Vercel**
- **Server** (persistent Socket.IO process, in-memory game rooms) → **Render**

The client can't be serverless-only because the server holds long-lived
WebSocket connections and all room state in memory - that needs an always-on
process, which Vercel's serverless model doesn't provide. Both pieces
auto-deploy from this GitHub repo on every push.

### 1. Server → Render (do this first)

1. [render.com](https://render.com) → **New** → **Blueprint** → connect this repo.
   Render reads [`render.yaml`](./render.yaml) and creates the
   `mind-the-lines-server` web service (free tier, Node 20).
2. Leave `CLIENT_ORIGIN` unset for now.
3. Deploy, then copy the service URL, e.g.
   `https://mind-the-lines-server.onrender.com`.

> Render's free tier sleeps after ~15 min idle; the first connection after a
> sleep takes ~30-60s to wake the service.

### 2. Client → Vercel

1. [vercel.com](https://vercel.com) → **New Project** → import this repo.
   It picks up [`vercel.json`](./vercel.json) automatically (builds only the
   client workspace, outputs `client/dist`).
2. Add an environment variable:
   **`VITE_SERVER_URL`** = the Render URL from step 1.
3. Deploy → you get a domain, e.g. `https://mind-the-lines.vercel.app`.

### 3. Close the CORS loop

Back in Render, set the service's **`CLIENT_ORIGIN`** to your Vercel
domain (comma-separated if you want to allow preview domains too), e.g.
`https://mind-the-lines.vercel.app`, and let it redeploy.

That's it. Future `git push` to `master` redeploys both automatically.
