#!/bin/sh

set -eu

TV_HOST="${1:-webos}"
RUNTIME_ARCHIVE="${2:-${VOT_RUNTIME_ARCHIVE:-}}"
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
DEPLOY_ID="$(date -u '+%Y%m%dT%H%M%SZ')-$$"
REMOTE_STAGE="/home/root/local-patches/vot/.deploy-$DEPLOY_ID"
RUNTIME_SHA=""
RUNTIME_SHA_LOCK="$SCRIPT_DIR/runtime/entware-armv7sf-runtime.sha256"

cleanup_remote_stage() {
    ssh "$TV_HOST" \
        "if [ -d '$REMOTE_STAGE' ] && [ ! -L '$REMOTE_STAGE' ] && \
             [ -f '$REMOTE_STAGE/.vot-stage' ]; then \
             rm -rf '$REMOTE_STAGE'; \
         fi" >/dev/null 2>&1 || true
}

trap cleanup_remote_stage 0 HUP INT TERM

if [ -n "$RUNTIME_ARCHIVE" ]; then
    [ -f "$RUNTIME_ARCHIVE" ] || {
        echo "VOT runtime archive does not exist: $RUNTIME_ARCHIVE" >&2
        exit 2
    }
    RUNTIME_SHA="$(sha256sum "$RUNTIME_ARCHIVE" | sed 's/[[:space:]].*$//')"
    PINNED_RUNTIME_SHA="$(sed -n 's/[[:space:]].*$//p' "$RUNTIME_SHA_LOCK")"
    [ -n "$PINNED_RUNTIME_SHA" ] && [ "$RUNTIME_SHA" = "$PINNED_RUNTIME_SHA" ] || {
        echo "VOT runtime does not match the pinned release digest" >&2
        exit 2
    }
fi

ssh "$TV_HOST" \
    "mkdir -p '$REMOTE_STAGE/service'; chmod 700 '$REMOTE_STAGE' '$REMOTE_STAGE/service'; \
     : >'$REMOTE_STAGE/.vot-stage'; chmod 600 '$REMOTE_STAGE/.vot-stage'"
scp \
    "$SCRIPT_DIR/vot-proxy.cjs" \
    "$SCRIPT_DIR/vot-audio.cjs" \
    "$SCRIPT_DIR/vot-pairing.cjs" \
    "$SCRIPT_DIR/vot-runner.sh" \
    "$SCRIPT_DIR/vot-node.sh" \
    "$SCRIPT_DIR/vot-mpg123.sh" \
    "$SCRIPT_DIR/310-youtube-vot" \
    "$SCRIPT_DIR/install-remote.sh" \
    "$SCRIPT_DIR/runtime/entware-armv7sf.lock" \
    "$SCRIPT_DIR/runtime/entware-armv7sf-notices.lock" \
    "$SCRIPT_DIR/runtime/entware-armv7sf-runtime.sha256" \
    "$SCRIPT_DIR/runtime/THIRD_PARTY_NOTICES.md" \
    "$TV_HOST:$REMOTE_STAGE/service/"

if [ -n "$RUNTIME_ARCHIVE" ]; then
    scp "$RUNTIME_ARCHIVE" "$TV_HOST:$REMOTE_STAGE/runtime.tar.gz"
fi

ssh "$TV_HOST" \
    "chmod 700 '$REMOTE_STAGE/service/install-remote.sh'; \
     '$REMOTE_STAGE/service/install-remote.sh' '$REMOTE_STAGE' '$RUNTIME_SHA'"

trap - 0 HUP INT TERM
