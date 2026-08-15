#!/bin/sh

set -eu

RUNTIME_ROOT="/home/root/local-patches/vot/runtime/opt"
LOADER="$RUNTIME_ROOT/lib/ld-linux.so.3"
MPG123="$RUNTIME_ROOT/bin/mpg123"
PRIVATE_LIBRARIES="$RUNTIME_ROOT/lib"
LIBRARIES="$PRIVATE_LIBRARIES:/usr/lib/pulseaudio:/usr/lib:/lib"

[ -x "$LOADER" ] && [ -x "$MPG123" ] || {
    echo "private VOT mpg123 runtime is incomplete" >&2
    exit 78
}
[ -f /etc/asound.conf ] || {
    echo "stock webOS ALSA configuration is unavailable" >&2
    exit 78
}
[ -f /usr/lib/alsa-lib/libasound_module_pcm_pulse.so ] || {
    echo "stock webOS ALSA Pulse plugin is unavailable" >&2
    exit 78
}

unset LD_PRELOAD LD_LIBRARY_PATH
MPG123_MODDIR="$RUNTIME_ROOT/lib/mpg123" \
ALSA_CONFIG_PATH=/etc/asound.conf \
ALSA_PLUGIN_DIR=/usr/lib/alsa-lib \
exec "$LOADER" --library-path "$LIBRARIES" "$MPG123" "$@"
