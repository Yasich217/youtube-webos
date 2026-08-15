#!/bin/sh

set -u

BASE_DIR="/home/root/local-patches/vot/service"
RUNTIME_DIR="/run/youtube-vot"
SERVICE_NAME="${1:-}"
CHECK_ONLY=0

case "$SERVICE_NAME" in
    vot-proxy|vot-audio|vot-pairing) ;;
    --check-runtime) CHECK_ONLY=1 ;;
    *)
        echo "usage: $0 vot-proxy|vot-audio|vot-pairing" >&2
        exit 2
        ;;
esac

SCRIPT="$BASE_DIR/$SERVICE_NAME.cjs"
umask 077
if [ -L "$RUNTIME_DIR" ]; then
    echo "refusing symlink runtime directory: $RUNTIME_DIR" >&2
    exit 1
fi
mkdir -p "$RUNTIME_DIR"
chmod 700 "$RUNTIME_DIR"
LOG_FILE="$RUNTIME_DIR/$SERVICE_NAME.log"
CHILD_PID=""
STOPPING=0

log() {
    echo "$(date -Iseconds 2>/dev/null || date) [VOT-Runner] $*" >>"$LOG_FILE"
}

node_capable() {
    candidate="$1"
    "$candidate" -e '
var fs = require("fs");
var crypto = require("crypto");
var major = Number(process.versions.node.split(".")[0]);
var supported = major >= 16 && fs.promises &&
  typeof Promise === "function" &&
  typeof Promise.prototype.finally === "function" &&
  typeof URL === "function" &&
  typeof crypto.randomInt === "function";
process.exit(supported ? 0 : 1);
' >/dev/null 2>&1
}

select_node() {
    private_node="$BASE_DIR/vot-node.sh"
    if [ -x "$private_node" ] && node_capable "$private_node"; then
        NODE_BIN="$private_node"
        NODE_SOURCE="private"
    elif [ -x /usr/bin/node ] && node_capable /usr/bin/node; then
        NODE_BIN="/usr/bin/node"
        NODE_SOURCE="system"
    else
        log "no compatible Node runtime (requires Node >=16 and service capabilities)"
        return 1
    fi
    NODE_VERSION="$($NODE_BIN -p 'process.version' 2>/dev/null || true)"
    [ -n "$NODE_VERSION" ] || return 1
}

select_mpg123() {
    private_mpg123="$BASE_DIR/vot-mpg123.sh"
    if [ -x "$private_mpg123" ] &&
        mpg123_capable "$private_mpg123" alsa tts; then
        MPG123_BIN="$private_mpg123"
        MPG123_SOURCE="private-alsa-tts"
        return 0
    fi
    if [ -x /usr/bin/mpg123 ] &&
        mpg123_capable /usr/bin/mpg123 pulse ptts; then
        MPG123_BIN="/usr/bin/mpg123"
        MPG123_SOURCE="system-pulse-ptts"
        return 0
    fi
    log "no compatible mpg123 runtime"
    return 1
}

mpg123_capable() {
    candidate="$1"
    output_module="$2"
    output_device="$3"
    "$candidate" --longhelp 2>&1 |
        grep -F -- '-e <c> --encoding' >/dev/null 2>&1 || return 1
    remote_probe="$({
        printf 'QUIT\n'
    } | "$candidate" -q -R --remote-err --keep-open \
        --name com.yasich.votd --stereo -e s16 --timeout 10 \
        --devbuffer 0.10 -o "$output_module" -a "$output_device" 2>&1)" ||
        return 1
    printf '%s\n' "$remote_probe" | grep '^@R MPG123' >/dev/null 2>&1
}

select_node || exit 78
if [ "$CHECK_ONLY" -eq 1 ]; then
    select_mpg123 || exit 78
    log "runtime check passed: node=$NODE_VERSION ($NODE_SOURCE), audio=$MPG123_SOURCE"
    exit 0
fi

if [ "$SERVICE_NAME" = "vot-audio" ]; then
    select_mpg123 || exit 78
    export VOT_AUDIO_MPG123_BIN="$MPG123_BIN"
    if [ "$MPG123_SOURCE" = "private-alsa-tts" ]; then
        export VOT_AUDIO_OUTPUT_MODULE="alsa"
        export VOT_AUDIO_OUTPUT_DEVICE="tts"
    fi
fi
log "starting $SERVICE_NAME with node=$NODE_VERSION ($NODE_SOURCE)"

stop_child() {
    [ -n "$CHILD_PID" ] || return 0
    if kill -0 "$CHILD_PID" 2>/dev/null; then
        kill -TERM "$CHILD_PID" 2>/dev/null || true
        wait "$CHILD_PID" 2>/dev/null || true
    fi
    CHILD_PID=""
}

shutdown() {
    STOPPING=1
    stop_child
}

trap shutdown TERM INT HUP

while [ "$STOPPING" -eq 0 ]; do
    if [ ! -f "$SCRIPT" ]; then
        log "missing service script: $SCRIPT"
        exit 1
    fi

    "$NODE_BIN" "$SCRIPT" >>"$LOG_FILE" 2>&1 &
    CHILD_PID="$!"
    wait "$CHILD_PID"
    STATUS="$?"
    CHILD_PID=""

    [ "$STOPPING" -eq 0 ] || break
    log "$SERVICE_NAME exited with status $STATUS; restarting in 5 seconds"
    sleep 5 &
    CHILD_PID="$!"
    wait "$CHILD_PID" 2>/dev/null || true
    CHILD_PID=""
done

exit 0
