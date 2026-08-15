#!/bin/sh

set -eu

STAGING_DIR="${1:-}"
EXPECTED_RUNTIME_SHA="${2:-}"
BASE_DIR="/home/root/local-patches/vot"
SERVICE_DIR="$BASE_DIR/service"
RUNTIME_DIR="$BASE_DIR/runtime"
SECRETS_DIR="$BASE_DIR/secrets"
INIT_FILE="/var/lib/webosbrew/init.d/310-youtube-vot"
DEPLOY_ID="$(date -u '+%Y%m%dT%H%M%SZ' 2>/dev/null || date '+%s')-$$"
ROLLBACK_DIR="$BASE_DIR/rollback/$DEPLOY_ID"
INSTALL_RUNTIME=0
COMMITTED=0
OLD_INIT_SAVED=0
OLD_SERVICE_MOVED=0
OLD_RUNTIME_MOVED=0
NEW_SERVICE_INSTALLED=0
NEW_RUNTIME_INSTALLED=0
NEW_INIT_INSTALLED=0
ROLLBACK_KEEP="${VOT_ROLLBACK_KEEP:-2}"
DEPLOY_LOCK="$BASE_DIR/.deploy.lock"
LOCK_HELD=0

case "$ROLLBACK_KEEP" in
    1|2|3|4|5) ;;
    *) echo "VOT_ROLLBACK_KEEP must be from 1 to 5" >&2; exit 2 ;;
esac

case "$STAGING_DIR" in
    "$BASE_DIR"/.deploy-*) ;;
    *) echo "invalid VOT staging directory" >&2; exit 2 ;;
esac
[ -d "$STAGING_DIR/service" ] && [ ! -L "$STAGING_DIR" ] &&
    [ ! -L "$STAGING_DIR/service" ] && [ -f "$STAGING_DIR/.vot-stage" ] || exit 2
for path_to_check in "$BASE_DIR" "$SERVICE_DIR" "$RUNTIME_DIR" \
    "$BASE_DIR/rollback" "$SECRETS_DIR" "$INIT_FILE"; do
    [ ! -L "$path_to_check" ] || {
        echo "refusing symlinked VOT installation path" >&2
        exit 2
    }
done

for name in vot-proxy.cjs vot-audio.cjs vot-pairing.cjs vot-runner.sh \
    vot-node.sh vot-mpg123.sh 310-youtube-vot install-remote.sh \
    entware-armv7sf.lock entware-armv7sf-notices.lock \
    entware-armv7sf-runtime.sha256 \
    THIRD_PARTY_NOTICES.md; do
    [ -f "$STAGING_DIR/service/$name" ] || {
        echo "missing staged service file: $name" >&2
        exit 2
    }
done

if [ -f "$STAGING_DIR/runtime.tar.gz" ]; then
    INSTALL_RUNTIME=1
    [ -n "$EXPECTED_RUNTIME_SHA" ] || exit 2
    actual_runtime_sha="$(sha256sum "$STAGING_DIR/runtime.tar.gz" | sed 's/[[:space:]].*$//')"
    pinned_runtime_sha="$(sed -n 's/[[:space:]].*$//p' \
        "$STAGING_DIR/service/entware-armv7sf-runtime.sha256")"
    [ -n "$pinned_runtime_sha" ] &&
        [ "$actual_runtime_sha" = "$EXPECTED_RUNTIME_SHA" ] &&
        [ "$actual_runtime_sha" = "$pinned_runtime_sha" ] || {
        echo "runtime archive checksum mismatch" >&2
        exit 2
    }
    tar -tzf "$STAGING_DIR/runtime.tar.gz" | while IFS= read -r entry; do
        case "$entry" in
            opt|opt/*|VOT_RUNTIME_MANIFEST.tsv|THIRD_PARTY_NOTICES|THIRD_PARTY_NOTICES/*) ;;
            *) echo "unsafe runtime archive entry" >&2; exit 2 ;;
        esac
        case "$entry" in
            /*|../*|*/../*|*/..) echo "unsafe runtime archive path" >&2; exit 2 ;;
        esac
    done
    mkdir -m 700 "$STAGING_DIR/runtime"
    tar -xzf "$STAGING_DIR/runtime.tar.gz" -C "$STAGING_DIR/runtime"
    find "$STAGING_DIR/runtime" -type l | while IFS= read -r link; do
        target="$(readlink "$link")"
        case "$target" in
            /*|../*|*/../*|*/..) echo "unsafe runtime symlink" >&2; exit 2 ;;
        esac
    done
    chmod -R go-rwx "$STAGING_DIR/runtime"
    [ -x "$STAGING_DIR/runtime/opt/bin/node" ]
    [ -x "$STAGING_DIR/runtime/opt/bin/mpg123" ]
    [ -x "$STAGING_DIR/runtime/opt/lib/ld-linux.so.3" ]
    [ -s "$STAGING_DIR/runtime/THIRD_PARTY_NOTICES/README.md" ]
    [ -s "$STAGING_DIR/runtime/THIRD_PARTY_NOTICES/NOTICE_SOURCES.tsv" ]
    cmp "$STAGING_DIR/runtime/VOT_RUNTIME_MANIFEST.tsv" \
        "$STAGING_DIR/service/entware-armv7sf.lock"
    cmp "$STAGING_DIR/runtime/THIRD_PARTY_NOTICES/NOTICE_SOURCES.tsv" \
        "$STAGING_DIR/service/entware-armv7sf-notices.lock"
    cmp "$STAGING_DIR/runtime/THIRD_PARTY_NOTICES/README.md" \
        "$STAGING_DIR/service/THIRD_PARTY_NOTICES.md"
    notice_count="$(
        find "$STAGING_DIR/runtime/THIRD_PARTY_NOTICES/licenses" -type f |
            wc -l | tr -d '[:space:]'
    )"
    [ "$notice_count" -ge 14 ]
elif [ -n "$EXPECTED_RUNTIME_SHA" ]; then
    echo "expected runtime archive is missing" >&2
    exit 2
fi

mkdir -p "$BASE_DIR/rollback" "$SECRETS_DIR"
chmod 700 "$BASE_DIR" "$BASE_DIR/rollback" "$SECRETS_DIR"

release_deploy_lock() {
    [ "$LOCK_HELD" -eq 1 ] || return 0
    lock_owner="$(cat "$DEPLOY_LOCK/owner" 2>/dev/null || true)"
    if [ "$lock_owner" = "$$" ]; then
        rm -f "$DEPLOY_LOCK/owner"
        rmdir "$DEPLOY_LOCK" 2>/dev/null || true
    fi
    LOCK_HELD=0
}

deploy_lock_owner_is_active() {
    active_owner="$(cat "$DEPLOY_LOCK/owner" 2>/dev/null || true)"
    case "$active_owner" in
        ''|*[!0-9]*) return 1 ;;
    esac
    [ -r "/proc/$active_owner/cmdline" ] || return 1
    active_cmdline="$(tr '\000' ' ' <"/proc/$active_owner/cmdline")"
    case "$active_cmdline" in
        *"$BASE_DIR"/.deploy-*/service/install-remote.sh*) return 0 ;;
        *) return 1 ;;
    esac
}

reclaim_stale_deploy_lock() {
    [ -d "$DEPLOY_LOCK" ] && [ ! -L "$DEPLOY_LOCK" ] || return 1
    [ -f "$DEPLOY_LOCK/owner" ] && [ ! -L "$DEPLOY_LOCK/owner" ] || return 1
    [ "$(stat -c '%u' "$DEPLOY_LOCK" 2>/dev/null || echo unknown)" = "0" ] || return 1
    [ "$(stat -c '%u' "$DEPLOY_LOCK/owner" 2>/dev/null || echo unknown)" = "0" ] || return 1
    lock_entries="$(find "$DEPLOY_LOCK" -mindepth 1 -maxdepth 1 | wc -l | tr -d '[:space:]')"
    [ "$lock_entries" = "1" ] || return 1
    deploy_lock_owner_is_active && return 1

    # A nested mkdir serializes stale-lock recovery. Once held, no second
    # contender can unlink a newly acquired deployment lock during the gap.
    mkdir -m 700 "$DEPLOY_LOCK/reclaim" 2>/dev/null || return 1
    if deploy_lock_owner_is_active; then
        rmdir "$DEPLOY_LOCK/reclaim" 2>/dev/null || true
        return 1
    fi
    lock_entries="$(find "$DEPLOY_LOCK" -mindepth 1 -maxdepth 1 | wc -l | tr -d '[:space:]')"
    if [ "$lock_entries" != "2" ]; then
        rmdir "$DEPLOY_LOCK/reclaim" 2>/dev/null || true
        return 1
    fi
    rm -f "$DEPLOY_LOCK/owner"
    rmdir "$DEPLOY_LOCK/reclaim"
    rmdir "$DEPLOY_LOCK"
}

[ ! -L "$DEPLOY_LOCK" ] || {
    echo "refusing symlinked VOT deployment lock" >&2
    exit 2
}
if ! mkdir -m 700 "$DEPLOY_LOCK" 2>/dev/null; then
    if ! reclaim_stale_deploy_lock ||
       ! mkdir -m 700 "$DEPLOY_LOCK" 2>/dev/null; then
        echo "another or unsafe VOT deployment lock exists; refusing overlap" >&2
        exit 75
    fi
fi
LOCK_HELD=1
printf '%s\n' "$$" >"$DEPLOY_LOCK/owner"
trap release_deploy_lock 0

mkdir -m 700 "$ROLLBACK_DIR"
: >"$ROLLBACK_DIR/.vot-rollback"

prune_rollbacks() {
    {
        for candidate in "$BASE_DIR"/rollback/*; do
            [ -d "$candidate" ] || continue
            [ ! -L "$candidate" ] || continue
            [ -f "$candidate/.vot-rollback" ] || continue
            printf '%s\n' "$candidate"
        done
    } | sort -r | {
        count=0
        while IFS= read -r candidate; do
            count=$((count + 1))
            [ "$count" -le "$ROLLBACK_KEEP" ] && continue
            case "$candidate" in
                "$BASE_DIR"/rollback/*)
                    name="${candidate##*/}"
                    if rm -rf "$candidate"; then
                        echo "pruned old VOT rollback snapshot: $name (not recoverable from TV)"
                    else
                        echo "could not prune old VOT rollback snapshot: $name" >&2
                    fi
                    ;;
            esac
        done
    }
}

rollback() {
    set +e
    if [ "$NEW_INIT_INSTALLED" -eq 1 ] && [ -x "$INIT_FILE" ]; then
        "$INIT_FILE" stop || true
    fi
    if [ "$NEW_SERVICE_INSTALLED" -eq 1 ] && [ -d "$SERVICE_DIR" ]; then
        mv "$SERVICE_DIR" "$ROLLBACK_DIR/failed-service"
    fi
    if [ "$NEW_RUNTIME_INSTALLED" -eq 1 ] && [ -d "$RUNTIME_DIR" ]; then
        mv "$RUNTIME_DIR" "$ROLLBACK_DIR/failed-runtime"
    fi
    if [ "$OLD_SERVICE_MOVED" -eq 1 ]; then mv "$ROLLBACK_DIR/service" "$SERVICE_DIR"; fi
    if [ "$OLD_RUNTIME_MOVED" -eq 1 ]; then mv "$ROLLBACK_DIR/runtime" "$RUNTIME_DIR"; fi
    if [ "$OLD_INIT_SAVED" -eq 1 ]; then
        cp -p "$ROLLBACK_DIR/previous-init" "$INIT_FILE"
    elif [ "$NEW_INIT_INSTALLED" -eq 1 ]; then
        rm -f "$INIT_FILE"
    fi
    if [ "$OLD_INIT_SAVED" -eq 1 ] && [ -x "$INIT_FILE" ]; then
        "$INIT_FILE" start || true
    fi
    prune_rollbacks
    if [ -d "$STAGING_DIR" ] && [ ! -L "$STAGING_DIR" ] &&
       [ -f "$STAGING_DIR/.vot-stage" ]; then
        rm -rf "$STAGING_DIR"
    fi
}

rollback_on_exit() {
    status="$?"
    trap - 0 HUP INT TERM
    if [ "$COMMITTED" -ne 1 ]; then rollback; fi
    release_deploy_lock
    exit "$status"
}
trap rollback_on_exit 0
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

if [ -f "$INIT_FILE" ] && [ ! -L "$INIT_FILE" ]; then
    cp -p "$INIT_FILE" "$ROLLBACK_DIR/previous-init"
    OLD_INIT_SAVED=1
    if [ -x "$INIT_FILE" ]; then "$INIT_FILE" stop || true; fi
fi
# The installed init may be an older revision with a shorter stop timeout.
# Re-run cleanup through the staged, capability-matched stop implementation
# and refuse to move files while any exact runner/service cmdline survives.
"$STAGING_DIR/service/310-youtube-vot" stop
if [ -d "$SERVICE_DIR" ]; then
    mv "$SERVICE_DIR" "$ROLLBACK_DIR/service"
    OLD_SERVICE_MOVED=1
fi
if [ "$INSTALL_RUNTIME" -eq 1 ] && [ -d "$RUNTIME_DIR" ]; then
    mv "$RUNTIME_DIR" "$ROLLBACK_DIR/runtime"
    OLD_RUNTIME_MOVED=1
fi

mv "$STAGING_DIR/service" "$SERVICE_DIR"
NEW_SERVICE_INSTALLED=1
if [ -d "$STAGING_DIR/runtime" ]; then
    mv "$STAGING_DIR/runtime" "$RUNTIME_DIR"
    NEW_RUNTIME_INSTALLED=1
fi

chmod 600 "$SERVICE_DIR"/*.cjs "$SERVICE_DIR"/*.lock \
    "$SERVICE_DIR"/*.sha256 \
    "$SERVICE_DIR/THIRD_PARTY_NOTICES.md"
chmod 700 "$SERVICE_DIR"/*.sh "$SERVICE_DIR/310-youtube-vot"
cp "$SERVICE_DIR/310-youtube-vot" "$INIT_FILE"
chmod 700 "$INIT_FILE"
NEW_INIT_INSTALLED=1

"$INIT_FILE" start

healthy=0
attempt=0
while [ "$attempt" -lt 15 ]; do
    if curl -fsS --max-time 2 http://127.0.0.1:8766/health >/dev/null 2>&1 &&
       curl -fsS --max-time 2 http://127.0.0.1:8767/health >/dev/null 2>&1 &&
       curl -fsS --max-time 2 http://127.0.0.1:8768/health >/dev/null 2>&1; then
        healthy=1
        break
    fi
    attempt=$((attempt + 1))
    sleep 1
done

if [ "$healthy" -ne 1 ]; then
    echo "VOT health check failed; restoring previous deployment" >&2
    exit 1
fi

COMMITTED=1
release_deploy_lock
trap - 0 HUP INT TERM
rm -f "$STAGING_DIR/runtime.tar.gz"
rm -f "$STAGING_DIR/.vot-stage"
rmdir "$STAGING_DIR" 2>/dev/null || true
prune_rollbacks
echo "VOT deployment healthy; rollback snapshot: $ROLLBACK_DIR"
