#!/bin/sh
# ---------------------------------------------------------------------------
# How Railway starts the site (railway.json -> startCommand).
#
# Same two steps as `npm start` (database migrations, then the server), but
# without npm in between. `npm start` stays resident as a parent process for
# as long as the site runs, and here it was two of them (the root package.json
# calls into backend/): about 30 MB of memory that Railway bills around the
# clock for doing nothing. `exec` hands this shell's place to node itself, so
# node is the only process left and gets Railway's stop signal directly.
#
# MALLOC_ARENA_MAX: glibc gives every thread that allocates its own memory
# pool, up to eight per CPU core the machine has. Prisma's engine, the canvas
# library, zlib and libuv all run threads, and those pools fragment and never
# shrink - memory that a heap snapshot cannot see, which is the shape of the
# climb on race night 2026-08-07 (services/memoryDiagnostics.js). Two pools is
# the usual setting for Node servers. Set it as a Railway variable to override.
# ---------------------------------------------------------------------------
set -e
cd "$(dirname "$0")/.."
./node_modules/.bin/prisma migrate deploy
export MALLOC_ARENA_MAX="${MALLOC_ARENA_MAX:-2}"
exec node src/index.js
