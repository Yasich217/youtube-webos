#!/bin/sh

set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
LOCK_FILE="$SCRIPT_DIR/runtime/entware-armv7sf.lock"
NOTICE_LOCK_FILE="$SCRIPT_DIR/runtime/entware-armv7sf-notices.lock"
NOTICE_FILE="$SCRIPT_DIR/runtime/THIRD_PARTY_NOTICES.md"
BASE_URL="https://bin.entware.net/armv7sf-k3.2"
OUTPUT="${1:-$SCRIPT_DIR/c9-vot-runtime-armv7sf.tar.gz}"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/youtube-vot-runtime.XXXXXX")"

cleanup() {
    case "$WORK_DIR" in
        "${TMPDIR:-/tmp}"/youtube-vot-runtime.*) rm -rf -- "$WORK_DIR" ;;
    esac
}
trap cleanup EXIT HUP INT TERM

mkdir -p "$WORK_DIR/packages" "$WORK_DIR/root" \
    "$WORK_DIR/root/THIRD_PARTY_NOTICES/licenses"

TAB="$(printf '\t')"
while IFS="$TAB" read -r package version license filename expected_sha; do
    case "$package" in
        ''|'#'*) continue ;;
    esac
    [ -n "$version" ] && [ -n "$license" ] && [ -n "$filename" ] && [ -n "$expected_sha" ]
    destination="$WORK_DIR/packages/$filename"
    curl --fail --silent --show-error --location \
        "$BASE_URL/$filename" -o "$destination"
    actual_sha="$(sha256sum "$destination" | sed 's/[[:space:]].*$//')"
    if [ "$actual_sha" != "$expected_sha" ]; then
        echo "Checksum mismatch for $package ($filename)" >&2
        exit 1
    fi
    tar -xOzf "$destination" ./data.tar.gz |
        tar --no-same-owner -xzf - -C "$WORK_DIR/root"
done <"$LOCK_FILE"

while IFS="$TAB" read -r component filename url expected_sha; do
    case "$component" in
        ''|'#'*) continue ;;
    esac
    [ -n "$filename" ] && [ -n "$url" ] && [ -n "$expected_sha" ]
    case "$filename" in
        *[!A-Za-z0-9._-]*|'') echo "Unsafe notice filename" >&2; exit 1 ;;
    esac
    destination="$WORK_DIR/root/THIRD_PARTY_NOTICES/licenses/$filename"
    curl --fail --silent --show-error --location "$url" -o "$destination"
    actual_sha="$(sha256sum "$destination" | sed 's/[[:space:]].*$//')"
    if [ "$actual_sha" != "$expected_sha" ]; then
        echo "Checksum mismatch for $component notice ($filename)" >&2
        exit 1
    fi
done <"$NOTICE_LOCK_FILE"

test -x "$WORK_DIR/root/opt/bin/node"
test -x "$WORK_DIR/root/opt/bin/mpg123"
test -x "$WORK_DIR/root/opt/lib/ld-linux.so.3"
cp "$LOCK_FILE" "$WORK_DIR/root/VOT_RUNTIME_MANIFEST.tsv"
cp "$NOTICE_LOCK_FILE" \
    "$WORK_DIR/root/THIRD_PARTY_NOTICES/NOTICE_SOURCES.tsv"
cp "$NOTICE_FILE" "$WORK_DIR/root/THIRD_PARTY_NOTICES/README.md"

temporary_output="$OUTPUT.tmp.$$"
tar --sort=name --mtime='UTC 2000-01-01' --owner=0 --group=0 \
    --numeric-owner -C "$WORK_DIR/root" -cf - \
    opt VOT_RUNTIME_MANIFEST.tsv THIRD_PARTY_NOTICES |
    gzip -n >"$temporary_output"
chmod 600 "$temporary_output"
mv "$temporary_output" "$OUTPUT"
sha256sum "$OUTPUT"
