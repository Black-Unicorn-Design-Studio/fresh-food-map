# syntax=docker/dockerfile:1

# The intake service and the batching agent in one image. Which of the two runs, and
# which queue backend it uses, is chosen by environment at run time — never by building
# twice. server/store/index.ts makes the same argument about the store itself: two
# builds of one service drift exactly the way two copies of a schema do.

# Node 22, pinned to a patch and a digest, because the major here is not a preference:
#   * .nvmrc says 22, and package.json has no `engines` field to say otherwise;
#   * the default queue is node:sqlite — the runtime IS the database driver, which is
#     why this project has no database dependency — and on 22 that module lives behind
#     --experimental-sqlite, which the committed npm scripts pass. On a newer major the
#     module is stable and the flag is a liability rather than a no-op;
#   * so the base image version is a data-tier decision. Bumping it should be a commit
#     someone can object to, like everything else here.
# -slim rather than -alpine: node:sqlite is compiled into the runtime and nothing in
# this repo is tested against musl. Nothing built here needs a compiler either way.
# The digest is a manifest list, so this resolves per-architecture and building on the
# VPS itself is the intended path. Building on an arm64 laptop and shipping the result
# to an amd64 host produces an image that fails at exec; use --platform linux/amd64 if
# it ever comes to that.
FROM node:22.23.2-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5

# An init, and it is not optional here — see the ENTRYPOINT note at the bottom for the
# measurement. The short version: Node installs no SIGTERM handler of its own, the
# kernel discards signals with a default disposition when they are aimed at PID 1, and
# a container whose PID 1 is `node` therefore ignores `docker stop` until the 10-second
# grace period expires and SIGKILL lands. tini is 250 KB, is PID 1 instead, and passes
# the signal on to a process where the default disposition does apply.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini \
 && rm -rf /var/lib/apt/lists/*

# Load bearing, not decoration. server/config.ts resolves intake.config.json against
# process.cwd() at import, and server/checks.ts reads data/markets.json the same way on
# the first submission. A wrong WORKDIR therefore either kills the process at import or
# — worse, because it looks fine — 500s the first time a real person submits and the
# duplicate check runs. server/README.md says "run it from the repository root"; this
# is that sentence, expressed as a Dockerfile.
WORKDIR /app

# Deliberately absent: ENV NODE_ENV=production. Nothing in this service reads it, and
# it would make any later `npm ci`/`npm install` inside this image omit
# devDependencies — which would remove tsx, which is how every entrypoint here runs.

# Dependencies before source, so editing server/ or data/markets.json does not
# reinstall node_modules. The lockfile is copied with package.json because `npm ci`
# refuses to run without it, which is the point: this install is reproducible or it
# fails, it never resolves something new.
COPY package.json package-lock.json ./

# --include=dev is not redundant, and --omit=dev would produce an image that cannot
# start. There is no build step and no compiled server output: tsx executes the
# TypeScript directly (read the `intake` script in package.json), and tsx is a
# devDependency. The explicit flag also makes this immune to a NODE_ENV=production
# inherited from a build environment.
#
# The whole tree is installed rather than a hand-picked subset because tsconfig.json
# extends `expo/tsconfig.base`, and tsx reads tsconfig.json to resolve the `@/*` alias
# that server/index.ts uses for `@/lib/market-schema`. Remove node_modules/expo and the
# extends chain cannot be resolved, the alias goes unmapped, and the import fails —
# measured, `Cannot find module '@/constants/tags'` from src/lib/market-schema.ts. The
# Expo dependency tree is most of this image's size, and one JSON file inside it is the
# reason the whole thing is here.
RUN npm ci --include=dev --no-audit --no-fund \
 && npm cache clean --force

# Exactly what the two entrypoints load. Notably absent: app/, assets/, public/ and
# dist/ — the static web export is served by Caddy from a bind mount on the host, not
# from this image, and nothing about the API build should be able to make the site
# stale. Also absent: scripts/, because the batch path is server/batch.ts, which reads
# the dataset from the GitHub API rather than from disk; scripts/ holds CI's
# validate-data.ts and an icon generator, and no runtime import reaches either.
#
# src/lib and src/constants are copied whole even though the reachable set is only
# market-schema.ts and tags.ts. A hand-curated file list would turn a future
# server-side `import '@/lib/geo'` into a failure that exists only in the deployed
# container and nowhere a developer runs. The unreachable files (markets.ts, theme.ts,
# a11y.ts) import react-native; they are never loaded, and copying a file is not
# importing it — the rule in CLAUDE.md is about the server's import graph, which stays
# zod-and-node-builtins only.
COPY tsconfig.json intake.config.json ./
COPY server ./server
COPY src/lib ./src/lib
COPY src/constants ./src/constants
COPY data/markets.json ./data/markets.json

# The persistent-mode mount point, created in the image and chowned ON PURPOSE. Docker
# seeds a fresh named volume from whatever sits at the mount path in the image,
# ownership included, so `intake-data` mounted here comes up owned by uid 1000 and the
# non-root process can create /data/intake.db plus the -wal and -shm siblings WAL mode
# needs. Without this line the volume would be root-owned and the first write would
# fail with EACCES.
#
# This does not rescue a host bind mount — a bind mount keeps the host directory's
# ownership — so if the volume is ever swapped for ./something, chown it 1000:1000 on
# the VPS.
#
# There is deliberately no VOLUME instruction. VOLUME /data would hand the ephemeral
# profile an anonymous volume it never asked for, which is precisely the "wrong profile
# silently half-works" failure: INTAKE_STORE=github would run alongside a phantom disk
# that looks like persistence and is thrown away unnamed on every `down`.
RUN mkdir -p /data && chown node:node /data

# Non-root, and /app stays root-owned and unwritable to this user, which is the useful
# half. server/config.ts defaults dbPath to resolve(process.cwd(), 'intake.db'), so a
# container started in sqlite mode with INTAKE_DB_PATH unset would otherwise open a
# queue inside its own filesystem — the exact silent-loss case server/store/sqlite.ts
# warns about, where pending submissions vanish on every deploy and nothing errors.
# Read-only /app converts that into a boot failure instead: measured, the container
# exits with `intake failed to start: unable to open database file`. Terse, and the
# startup line that would have printed the queue path never runs — but a container that
# refuses to start beats one that accepts submissions into a file it will throw away.
USER node

# The contract: 8787 inside the container, reached only by Caddy over the compose
# network. EXPOSE publishes nothing; it is documentation and a hint to tooling. Do not
# map this to a host port. The service terminates no TLS, and its rate limiter reads the
# X-Forwarded-For that Caddy writes — Caddy trusts no proxies by default, so it discards
# whatever the client sent and the header holds exactly the peer address. Addressed
# directly instead, that header is whatever the caller says it is, and the limiter
# becomes decorative (server/client-ip.ts).
ENV PORT=8787
EXPOSE 8787

# No secret is baked in and none may be. INTAKE_IP_SALT and GITHUB_TOKEN arrive at run
# time from the operator's env file; an ARG or ENV holding either would sit in
# `docker history` for the life of the image. .dockerignore keeps .env out of the build
# context entirely so it cannot be copied in by accident.
#
# What the token must NOT be able to do: with Contents write and no branch protection
# on GITHUB_BASE_BRANCH — `staging` for this deployment — the service can commit
# straight to the base branch instead of proposing to it, publishing markets no person
# ever read. The pull request is the only gate this design has. Protect the branch.

# node itself is the probe: this image ships no curl and no wget, and adding a package
# to fetch one URL is a package to keep patched forever. fetch() is global in Node 22.
#
# What a passing check does and does not prove. server/index.ts calls assertServiceEnv()
# before server.listen(), so a missing INTAKE_IP_SALT — or a missing GITHUB_TOKEN under
# INTAKE_STORE=github — stops the container reaching healthy at all, which is the good
# outcome. But the accessors in server/config.ts are still lazy getters, and
# server/batch.ts never calls assertServiceEnv(): the batching agent starts happily
# with no token and dies at its first GitHub call, after the queue has already been
# read. Healthy here means "listening", never "correctly configured end to end".
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Exec form throughout, and node invoked directly rather than through `npm run intake`.
# A shell-form CMD puts /bin/sh at PID 1, and npm-as-PID-1 has the same shape: a parent
# that would have to relay the signal to the process doing the work. Measured with a
# shell wrapper, `docker stop` took the full 10-second grace period and then SIGKILL.
#
# Node on its own is no better, which is the counter-intuitive part and the reason tini
# is installed above. Measured in this base image, `docker stop` against a container
# whose PID 1 is node: 10.18s, exit 137. The same process under an init: 0.15s, exit
# 143. Node installs no handler for SIGTERM, and Linux does not deliver a signal to PID
# 1 unless a handler is explicitly installed for it — so the signal is simply dropped,
# and this cannot be fixed from the Dockerfile without an init, because server/index.ts
# registers no SIGTERM listener and application source is not this file's to change.
#
# -g signals the whole process group, so tsx's loader machinery goes down with the
# server rather than being left for the kill.
#
# There is still no graceful drain: a submission in flight at stop time is lost. That is
# acceptable and not worth code — the client is told "received" only after
# store.enqueue() has returned, so a dropped request is a dropped request and never a
# false acknowledgement. SQLite in WAL mode is crash-safe, so the queue survives either
# way; what the init buys is a deploy that takes a second instead of eleven, and an exit
# code that means "asked to stop" rather than "had to be killed".
ENTRYPOINT ["/usr/bin/tini", "-g", "--"]

# The flags mirror the committed `intake` script with one omission:
# --env-file-if-exists=.env is left off because configuration comes from the compose env
# file, and .env is excluded from the build context, so there is no file for it to find
# and a silent second source of configuration is not something to invent here.
# --experimental-sqlite is required by INTAKE_STORE=sqlite on Node 22 and is inert under
# INTAKE_STORE=github, so one command serves both storage modes — which is the whole
# premise of one image.
#
# The batching agent is this same image with different argv; the entrypoint stays, so
# the init applies to it too. In this deployment that argv is already wired up as its own
# compose service, and that is the invocation to use:
#   docker compose --env-file .env.staging run --rm batch             # sqlite queue
#   docker compose --env-file .env.staging run --rm batch-ephemeral   # repo queue
# Not `run --rm intake node ... server/batch.ts`: the persistent-mode `intake` service is
# deliberately given no GITHUB_TOKEN, so that would read the queue and then die on its
# first API call — server/batch.ts never calls assertServiceEnv().
CMD ["node", "--experimental-sqlite", "--import", "tsx", "server/index.ts"]
