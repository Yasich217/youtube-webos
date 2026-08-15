# YouTube VOT root services

`vot-proxy.cjs` forwards the VOT protobuf API. `vot-audio.cjs` is a separate
localhost audio process, while `vot-pairing.cjs` owns the short-lived
live-voice credential flow. The audio process is intentionally not an HTML media player:
it drives `mpg123` remote mode into the webOS PulseAudio
`ptts` sink, so YouTube can retain the single WAM media-player slot. On C4,
mpg123 reaches it directly through Pulse; on C9, private mpg123 uses the stock
ALSA `tts` PCM, which routes to Pulse `ptts`. This applies the stock TTS mixing
policy instead of the exclusive voice-recognition policy that mutes the active
`umimedia` input.

## Audio API

The service binds only `127.0.0.1:8767`. Browser requests are accepted only
from `https://www.youtube.com` and `https://youtube.com`; origin-less loopback
requests remain available for root-shell diagnostics.

| Request              | JSON body                                                                           | Effect                                                            |
| -------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `GET /health`        | —                                                                                   | Liveness only                                                     |
| `GET /v1/status`     | —                                                                                   | State, active `videoId`, position, duration, mixer and lease data |
| `POST /v1/load`      | `{ "url": "https://…mp3", "videoId": "…", "volume": 0.62, "playbackRate": 1 }`      | Download, validate, cache and preload paused                      |
| `POST /v1/play`      | `{ "videoId": "…", "position": 12.3, "clientTimestampMs": 123, "playbackRate": 1 }` | Sample-accurate seek and play                                     |
| `POST /v1/pause`     | `{ "videoId": "…" }`                                                                | Pause and always disable hardware mixing                          |
| `POST /v1/seek`      | `{ "videoId": "…", "position": 12.3, "resume": true, "playbackRate": 1 }`           | Seek; preserve play state unless `resume` is explicit             |
| `POST /v1/heartbeat` | `{ "videoId": "…", "leaseMs": 120000 }`                                             | Renew a live playback lease                                       |
| `POST /v1/stop`      | `{ "videoId": "…" }`                                                                | Close mpg123's track, retain the cache for replay, and unmix      |
| `POST /v1/volume`    | `{ "videoId": "…", "volume": 0.62 }`                                                | Change only translated-audio volume, including during playback    |

All POSTs require `Content-Type: application/json`. `position` is seconds in
the video timeline. If supplied, `clientTimestampMs` must come from
`Date.now()` sampled together with the video time; the service adds at most two
seconds of request transit time before converting seconds to the MP3 output
sample index.

`volume` is normalized from `0` to `1` and defaults to `0.62`. It is applied by
mpg123 only to the translated track; the service never mutes or changes the
YouTube video's original audio.

`playbackRate` is accepted from `0.5` through `2.0` and defaults to `1`.
The service maps it to mpg123 `PITCH (playbackRate - 1)`, so speed and pitch
change together. Request-transit compensation is multiplied by this rate.
`/v1/status` reports the active `videoId`, applied `playbackRate`,
`outputModule`, `outputDevice`, `mixEnabled`, and selected `mixerBackend`.
Mutating calls carrying a different `videoId` are rejected as
stale; a stale best-effort `/v1/stop` is an idempotent no-op so an old page
cannot stop a newer video's session.

The controller should heartbeat every 30–60 seconds while playing. The default
audio lease is 120 seconds and the service pauses/unmixes on expiry, decoder
stall, player exit, API failure, SIGTERM or SIGINT.

While audio is playing, a fresh controller heartbeat also permits one
`screenSaver/restartUserActivityTimer` call at most every 55 seconds. This is a
one-shot user-activity refresh, not a settings change. Refreshing stops on
pause/end/stop, stops when heartbeats are older than 75 seconds, and has an
absolute non-renewable 20-minute cap per play session. Luna failures are
fail-open for playback. The service never disables the screensaver or changes
its configured timeout.

## Download boundary

The default allowlist is the observed translation host only:
`vtrans.s3-private.mds.yandex.net`. The downloader requires HTTPS and an `.mp3`
path, verifies every DNS answer is public, pins one verified address into the
TLS request, repeats all checks across redirects, requires an MP3 content type
and header, and caps the cache object at 256 MiB. Cache filenames are random;
signed URL query strings are neither logged nor returned by `/v1/status`.

Additional exact hostnames can be supplied by the root-owned process through
`VOT_AUDIO_ALLOWED_HOSTS` if Yandex changes its media host. Do not expose this
variable to the web application.

## Live-voice pairing API

`vot-pairing.cjs` keeps its permanent API on `127.0.0.1:8768`. Browser
requests are accepted only from the exact origins `https://www.youtube.com`
and `https://youtube.com`; `/health` also remains available without an origin
for root-shell diagnostics. All responses are `no-store`.

| Request                     | JSON body                  | Sanitized response                                                                                  |
| --------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------- |
| `GET /v1/auth/status`       | —                          | Configuration/account metadata and a secret-free current pairing status                             |
| `POST /v1/auth/pair/start`  | `{}`                       | One `pairing` object with `pairId`, QR `url`, six-digit `code`, `expiresAt`, and attempts remaining |
| `POST /v1/auth/pair/cancel` | `{ "pairId": "optional" }` | `{ "ok": true, "cancelled": boolean }`                                                              |

The status shape is:

```json
{
  "ok": true,
  "configured": false,
  "valid": false,
  "provider": "yandex",
  "account": null,
  "accountLabel": null,
  "validatedAt": null,
  "pairing": {
    "pairId": "…",
    "state": "waiting",
    "expiresAt": "…",
    "attemptsRemaining": 5
  }
}
```

`pairing` is `null` when idle. The QR URL and six-digit code are returned only
by the successful start call, never by status. The URL targets a listener
bound to one assigned RFC1918 IPv4 address on port `8769` by default. A
root-owned deployment may select another high port with
`VOT_PAIRING_LAN_PORT`; the browser validates the returned private-LAN URL.
Only one listener can exist; it expires after 180 seconds and a new start closes the old one.
The URL carries a random 256-bit secret in its fragment. The phone page removes
that fragment immediately with `history.replaceState`, then submits the secret
in `X-VOT-Pairing` together with the `pairId`, displayed code, and OAuth token.
The page has a hash-pinned CSP, exact `Host`/`Origin` checks, a 4 KiB request
limit, a per-attempt delay, and a hard five-attempt limit. Because this is a
short-lived HTTP page, pairing should only be performed on a trusted LAN.

The service validates credentials with one non-redirecting, eight-second
request to the fixed endpoint
`https://login.yandex.ru/info?format=json`, capped at 64 KiB. A successful
credential is atomically stored as:

```json
{
  "version": 1,
  "provider": "yandex",
  "token": "secret",
  "validatedAt": "ISO-8601",
  "account": { "id": "…", "login": "…", "displayName": "…" }
}
```

The default file is
`/home/root/local-patches/vot/secrets/yandex-oauth.json`; its directory is mode
`0700` and the file is mode `0600`. Tokens are never logged or exposed by any
status response. `VOT_PAIRING_LAN_ADDRESS` may select a particular assigned
RFC1918 address when the TV has several interfaces. The credential path can be
overridden only in the root process with `VOT_YANDEX_SECRET_FILE`.

The proxy adds that credential only to an explicitly marked lively-voice
request for the exact Yandex translation endpoint. If Yandex returns a real
upstream `401` or `403`, the proxy compares and removes the credential it used,
replaces the upstream body with a fixed token-free error, and exposes a narrow
machine auth-state header to the TV client. The controller then disables lively
voices, retries with standard voices, and opens a fresh QR flow. The pairing
service refreshes credential state from disk, so it cannot continue reporting a
rejected token as valid. `VOT_YANDEX_TOKEN_FILE` remains a legacy proxy-only
alias; prefer `VOT_YANDEX_SECRET_FILE` so both root services use the same path.

## Runtime requirements

| Compatibility class | Node                                | mpg123 and route                             |
| ------------------- | ----------------------------------- | -------------------------------------------- |
| C4                  | system `16.19.1`                    | system `1.29.3`, Pulse output to `ptts`      |
| C9                  | private `18.20.2`; system untouched | private `1.32.6`, ALSA `tts` to Pulse `ptts` |

Both use the private-bus `/usr/bin/luna-send`. The runner requires Node 16 or
newer plus the exact service APIs it uses. It selects only a capability-probed
system runtime or the absolute private wrappers; the C9 system Node `0.12.2`
cannot pass and is never modified. The mpg123 gate checks the signed 16-bit
option and starts remote mode with the exact production output/device
arguments, not merely `--version`.

Legacy WAM serializes localhost requests with the literal `Origin: null` even
when `location.origin` is YouTube. That exact value is accepted only by the
three services bound to loopback; their method/path/body/upstream/audio
allowlists remain mandatory. The temporary LAN phone page still enforces its
session-specific Host and Origin. Foreground monitoring combines a bounded
two-second one-shot Luna poll with the long-lived subscription. Overlapping
queries are suppressed and a query failure is fail-closed. This covers both
the omitted initial event and the older LS2 behavior where the subscription
stays alive but silently omits later foreground changes.

The init wrapper creates `/run/youtube-vot` with mode `0700`. Supervisor PID
files, service logs, and the temporary MP3 cache live below that root-only
runtime directory; they are not placed directly in the world-writable `/tmp`.

Before unpausing mpg123 the service first tries
`com.webos.service.audio/tv/mixDigitalSoundOutput` with
`{ "mix": true, "callerId": "com.yasich.votd" }`. If that modern method does
not return acknowledged JSON, it cleans up the ambiguous call before trying
the C9 pair `com.webos.service.tv.sound/mixDigitalAudioOut` and
`unmixDigitalAudioOut` with `{ "requestApp": "youtube.leanback.v4" }`.
Cleanup is symmetric with the selected backend; when state is unknown, both
backends are cleared. Calls use private-bus `luna-send -n 1 -w … -f`: `-f`
only formats a response, `-n 1` waits for one, and the LS2-native `-w` timeout
is shorter than the Node process timeout. Silence is never treated as success. The
service waits 200 ms after a new mixer enable, matching the stock TTS daemon;
the position sampled by the controller is compensated again after that wait.
`VOT_AUDIO_MIX_SETTLE_MS` can tune this root-owned delay. The default device
buffer is 100 ms and can be tuned with
`VOT_AUDIO_DEVICE_BUFFER_SECONDS` after measuring the real TV.
The output can be A/B tested through root-owned `VOT_AUDIO_OUTPUT_MODULE` and
`VOT_AUDIO_OUTPUT_DEVICE` (the older `VOT_AUDIO_PULSE_DEVICE` remains an
alias). Defaults are Pulse/`ptts`; the private C9 runner selects ALSA/`tts`.
The service always gives mpg123 the application name
`com.yasich.votd` and forces signed 16-bit stereo output. It keeps the MP3's
native sample rate (including Yandex's common 22.05 kHz output), which PulseAudio
resamples for `ptts`. It rejects a loaded stream if mpg123's `FORMAT` response
does not report a valid MP3 sample rate and stereo output;
the remote-protocol checks also require exact `SEEK` and `PITCH` replies before
playback state is advanced.

Run local validation without touching a TV:

```sh
node --check services/com.yasich.youtube.vot.service/vot-audio.cjs
node --test services/com.yasich.youtube.vot.service/vot-audio.test.cjs
node --check services/com.yasich.youtube.vot.service/vot-pairing.cjs
node --test services/com.yasich.youtube.vot.service/vot-pairing.test.cjs
node --check services/com.yasich.youtube.vot.service/vot-proxy.cjs
node --test services/com.yasich.youtube.vot.service/vot-proxy.test.cjs
node --test src/voice-over-translation/proxy-auth-contract.test.js
node --test src/polyfills.test.js
node --test src/legacy-event-target.test.js
node --test services/com.yasich.youtube.vot.service/service-contract.test.cjs
```

## Private C9 runtime and installation

Build the optional runtime only from the pinned package and notice locks:

```sh
sh services/com.yasich.youtube.vot.service/build-c9-runtime.sh \
  /tmp/c9-vot-runtime-armv7sf.tar.gz
VOT_RUNTIME_ARCHIVE=/tmp/c9-vot-runtime-armv7sf.tar.gz \
  sh services/com.yasich.youtube.vot.service/install-webos.sh webos
```

`build-c9-runtime.sh` verifies every Entware package and immutable upstream
notice SHA-256, extracts without preserving package owners, and emits a
deterministic archive containing `THIRD_PARTY_NOTICES`. The archive must not be
committed. Its digest is pinned in `entware-armv7sf-runtime.sha256`; the remote
installer also compares the embedded package and notice manifests byte-for-byte
with the staged source locks before any persistent move. Deployments use an
atomic root-owned lock, keep system Node/mpg123 untouched, and roll back service,
runtime, and init files if capability or health checks fail.

The init stop path allows the audio service to finish its bounded unmix cleanup,
then escalates TERM to KILL only after re-reading exact process command lines;
replacement cannot begin while an old runner or child remains. Private runtime
wrappers erase inherited `LD_PRELOAD` and `LD_LIBRARY_PATH` before invoking their
absolute loaders.

The installer keeps two root-only rollback snapshots by default and prunes
older installer-created snapshots after successful or failed deployments. It
also removes marker-owned interrupted staging trees. Set
`VOT_ROLLBACK_KEEP` to `1` through `5` if flash capacity permits. Pruning is
logged and is not recoverable from the TV; credential storage is outside every
snapshot and is never modified.
