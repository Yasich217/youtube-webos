#!/bin/sh

set -eu

RUNTIME_ROOT="/home/root/local-patches/vot/runtime/opt"
LOADER="$RUNTIME_ROOT/lib/ld-linux.so.3"
NODE="$RUNTIME_ROOT/bin/node"
LIBRARIES="$RUNTIME_ROOT/lib"

[ -x "$LOADER" ] && [ -x "$NODE" ] || {
    echo "private VOT Node runtime is incomplete" >&2
    exit 78
}

unset LD_PRELOAD LD_LIBRARY_PATH
exec "$LOADER" --library-path "$LIBRARIES" "$NODE" "$@"
