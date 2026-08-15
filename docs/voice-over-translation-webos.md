# Voice-over Translation on rooted LG webOS

This document describes the Voice-over Translation (VOT) integration carried
by this fork: why it needs a root-side component, how the browser controller
and the three localhost services cooperate, how to install and diagnose it,
and what must be revalidated before enabling it on another webOS generation.

The integration uses an unofficial Yandex translation API and private webOS
audio APIs. It is therefore best-effort and can break independently of this
repository when YouTube, Yandex, or LG changes an internal interface.

## Proven C4 baseline

The following deliberately generic values describe the tested compatibility
class without publishing a device fingerprint. They are a known-good baseline,
not a declaration that every TV in the same product family has identical
firmware.

| Property         | Observed value                                                            |
| ---------------- | ------------------------------------------------------------------------- |
| Product family   | LG C4                                                                     |
| Platform         | webOS 24                                                                  |
| Root runtime     | `/usr/bin/node` `16.19.1`, `/usr/bin/mpg123` `1.29.3`                     |
| Audio runtime    | PulseAudio `15.0.0`, protocol `35`, native socket `/var/run/pulse/native` |
| Translation sink | `ptts`, stereo signed 16-bit; sink advertised at 48 kHz                   |
| Installed app    | `youtube.leanback.v4` `0.8.2`, `volumeRatioOnTTS: 100`                    |
| Root services    | loopback ports `8766`, `8767`, and `8768` healthy                         |

A live status sample also proved that `mpg123` was playing through `ptts`, the
digital mixer was enabled, and the foreground subscription recognized
`youtube.leanback.v4`. That is the functional proof that matters; finding a
binary or LS2 service name alone is not sufficient.

## C9 compatibility baseline

The older compatibility class has a materially different browser, userspace,
and audio policy. These generic values intentionally omit model, board,
firmware-build, network, and host identifiers:

| Property        | Observed value                                                                      |
| --------------- | ----------------------------------------------------------------------------------- |
| Product family  | LG C9                                                                               |
| Platform        | webOS SDK `4.9.0`, Chromium `53.0.2785.34`                                          |
| System runtime  | `/usr/bin/node` `0.12.2` (unsupported and left untouched)                           |
| Private runtime | Node `18.20.2`, mpg123 `1.32.6`, pinned Entware armv7sf packages                    |
| Audio runtime   | PulseAudio `9`, stock ALSA `tts` PCM routed to the dedicated Pulse `ptts` sink      |
| Mixer API       | `mixDigitalAudioOut` / `unmixDigitalAudioOut`, acknowledged with the YouTube app ID |
| Package manager | Homebrew Channel `0.7.2`; normal IPK receipt/SAM registration is required           |
| Installed app   | `youtube.leanback.v4` downstream `0.8.3` (`vot.1`, based on upstream `0.8.2`)       |

The private runtime is loaded by absolute path below the VOT installation and
uses its own loader and libraries. The webOS Node binary and system audio tools
are never replaced. The legacy web bundle is required for Chromium 53; its
early Abort API polyfill also makes native `fetch` reject on manual abort and
timeout instead of relying on a `signal` option that this browser ignores.
Chromium 53 also serializes privileged WAM requests to a loopback HTTP service
with the literal `Origin: null`. The three services accept that exact legacy
origin only on their loopback listeners; paths, methods, body sizes, upstream
hosts, and audio hosts remain allowlisted. The temporary phone pairing listener
still requires its session-specific LAN Host and Origin and never accepts the
WAM origin.

## Why a root service is required

YouTube already owns the WAM application's active media-player slot. Starting
the translated MP3 in a second `<audio>` or `<video>` element causes one of the
two web media streams to pause or lose audio on the tested TV. Browser APIs do
not provide a reliable way to route a second stream through an independent
webOS system category and mix it with the first stream.

This implementation consequently leaves the original video and original
audio in YouTube's WAM player and moves only the translated MP3 outside WAM:

1. The injected controller observes the YouTube TV route and the real video
   element, determines the source and target languages, and asks
   `@vot.js/core` `3.0.2` for a translation.
2. A loopback proxy forwards the allowed VOT protobuf requests to Yandex. This
   avoids the TV web view's cross-origin boundary without turning the service
   into a general-purpose proxy.
3. A root audio service downloads the signed MP3, validates and caches it, and
   controls `mpg123` through its remote protocol.
4. `mpg123` sends only translated speech to the PulseAudio `ptts` sink.
5. The service capability-probes LG's digital TTS mixing policy. It prefers
   `com.webos.service.audio/tv/mixDigitalSoundOutput` and falls back to the
   older `com.webos.service.tv.sound` mix/unmix pair. YouTube remains on its
   normal media path, so both streams can be heard at the same time.

Root is required for the private LS2 call, access to the platform PulseAudio
devices, a persistent boot service, and root-owned credential storage. The
current integration has no supported rootless audio fallback.

`assets/appinfo.json` sets `volumeRatioOnTTS` to `100`. On the proven C4 this
prevents the stock TTS policy from halving YouTube's media volume while `ptts`
is active. The setting affects registered application metadata: after changing
it, rebuild and reinstall the IPK. Copying only `userScript.js` does not
re-register the value in WAM.

## Components and data flow

### Browser controller

The controller lives under `src/voice-over-translation/` and is loaded from
the fork's injected user script. It:

- recognizes both normal and hash-based TV watch routes;
- attaches to the current HTML video element and survives element replacement;
- follows `play`, `pause`, buffering, seek, playback-rate, end, navigation,
  and page teardown events;
- derives language from the current/default YouTube audio track, adaptive
  formats, linked captions, ASR captions, or player defaults;
- keeps the original and translation volume controls independent;
- polls translation readiness and reports short, OLED-safe notifications;
- keeps the translated audio synchronized through position, rate, and
  heartbeat calls to the root service;
- can switch a YouTube auto-dubbed track back to the original track only after
  translated audio is ready, and restores the previous track when appropriate.

The browser stores settings in the existing `ytaf-configuration` localStorage
object. Signed audio URLs are redacted from controller logs and are not part of
the public state event.

### VOT proxy: `127.0.0.1:8766`

`vot-proxy.cjs` exposes:

| Method and path     | Purpose                                      |
| ------------------- | -------------------------------------------- |
| `GET /health`       | Liveness check                               |
| `OPTIONS /v1/fetch` | CORS preflight for an allowed YouTube origin |
| `POST /v1/fetch`    | Forward one encoded VOT request              |

Only the exact origins `https://www.youtube.com` and `https://youtube.com` are
accepted. Upstream traffic is HTTPS-only, limited to
`api.browser.yandex.ru`, limited to the VOT path prefixes in the source, and
limited to `POST` or `PUT`. Browser-supplied authorization headers are removed.
Request and response sizes and upstream time are bounded.

### Audio service: `127.0.0.1:8767`

`vot-audio.cjs` exposes:

| Method and path      | Purpose                                                    |
| -------------------- | ---------------------------------------------------------- |
| `GET /health`        | Liveness check                                             |
| `GET /v1/status`     | Secret-free decoder, mixer, lease, and foreground state    |
| `POST /v1/load`      | Validate, download, cache, and preload an MP3 while paused |
| `POST /v1/play`      | Seek to the controller position and start playback         |
| `POST /v1/pause`     | Pause translated audio and unmix                           |
| `POST /v1/seek`      | Seek and optionally resume using the requested play state  |
| `POST /v1/volume`    | Change translated-audio gain only                          |
| `POST /v1/heartbeat` | Renew playback and safe screensaver leases                 |
| `POST /v1/stop`      | Stop, unmix, and retain the current cache for quick replay |

Mutating requests carry the YouTube `videoId`; a request for an older video is
rejected as stale, except that a stale best-effort stop is harmless. Positions
are expressed in video seconds and are converted to exact output samples after
the MP3 format has been read. Playback rates from `0.5` through `2.0` are
applied with mpg123 `PITCH`, so pitch changes with speed.

The downloader accepts HTTPS MP3s from
`vtrans.s3-private.mds.yandex.net` by default. It rejects private DNS answers,
pins a verified public address, repeats validation on redirects, checks the
content type and MP3 signature, and limits each cache object to 256 MiB. Cache
files are random, mode `0600`, and kept below the root-only runtime directory
`/run/youtube-vot/audio-cache`. Signed query strings are neither logged nor returned
from status. Do not replace the exact-host allowlist with a wildcard; if Yandex
changes the media host, add only the observed exact host through the root-owned
`VOT_AUDIO_ALLOWED_HOSTS` setting and re-test redirects and DNS behavior.

The service uses caller/application name `com.yasich.votd`, Pulse output
module `pulse`, device `ptts`, signed 16-bit stereo output, a 100 ms device
buffer, and a 200 ms mixer-settle delay by default. The values can be changed
only in the root process through the documented `VOT_AUDIO_*` environment
variables; a different sink or delay must be measured on the actual TV.

### Pairing service: `127.0.0.1:8768` and temporary LAN port `8769`

The permanent loopback API is:

| Method and path             | Purpose                                 |
| --------------------------- | --------------------------------------- |
| `GET /health`               | Liveness check                          |
| `GET /v1/auth/status`       | Secret-free account and pairing state   |
| `POST /v1/auth/pair/start`  | Create one three-minute QR/code session |
| `POST /v1/auth/pair/cancel` | Cancel the current session              |

Starting a session opens one temporary HTTP listener on one assigned RFC1918
address (port `8769` by default). A root-owned deployment may override the
high TCP port with `VOT_PAIRING_LAN_PORT`; the QR URL remains the source of
truth for the client. The phone loads `GET /?pairId=...` and submits the token to
`POST /v1/pair`. The QR secret is 256 random bits in the URL fragment; the page
removes it from the address immediately and submits it in a header together
with the displayed six-digit code. A session expires after 180 seconds and has
a hard five-attempt limit.

The phone page is plain HTTP because it is served directly by the TV. Pair only
on a trusted local network. Do not expose port `8769` through a router, reverse
proxy, or VPN ingress.

## Audio mixing and lifecycle invariants

The original-volume and translation-volume sliders are independent `0..100`
controls:

- original volume changes the YouTube video element's volume;
- translation volume changes only mpg123's gain;
- `100 / 100` is a valid configuration on the proven C4;
- pausing, stopping, disabling VOT, leaving the video, or an audio error
  restores the original video volume and disables digital mixing.

The mixer is enabled immediately before translated playback and disabled on
every normal and exceptional exit path. The service waits for the mixer to
settle, rechecks that YouTube is still foreground, then unpauses mpg123. A
foreground change during that transition is rolled back before audio can leak
onto Home or another application.

The controller sends a heartbeat every 30 seconds while playing. The normal
audio lease is 120 seconds. The service pauses and unmixes when that lease
expires, the decoder stalls, the player exits, a critical command fails, or the
service receives `SIGTERM`/`SIGINT`.

## Foreground and screensaver safety

The audio service subscribes to
`com.webos.applicationManager/getForegroundAppInfo` and also runs one bounded
one-shot query every two seconds. The poll is required because an older LS2
build can keep the subscription process alive while silently omitting later
foreground changes. Overlapping polls are suppressed. The guard allows
`youtube.leanback.v4` and ignores short-lived system overlays such as volume,
mute, notification, and assistant UI. An unknown foreground state, a failed
query, a dead subscription, Home, or another real application is fail-closed:
translated audio is paused and the mixer is disabled.

While translated audio is genuinely playing, a fresh controller heartbeat may
request one
`com.webos.surfacemanager.screenSaver/restartUserActivityTimer` call at most
once every 55 seconds. This is a one-shot activity notification, not a global
screensaver setting. Refreshes stop on pause/end/stop, stop after controller
heartbeats become stale, and have an absolute non-renewable 20-minute cap for
one playback session. If that Luna method is unavailable, playback continues
and the normal screensaver remains in control.

Never disable the OLED screensaver globally as part of VOT installation or
testing.

## Settings and shortcuts

The fork adds a **Translation** page with the following controls:

| UI label / config key                                                 | Default                   | Behavior                                                                             |
| --------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------ |
| Voice-over Translation / `enableVoiceOverTranslation`                 | on                        | Master switch; changes apply to the current video                                    |
| Translation Notifications / `enableVoiceOverTranslationNotifications` | on                        | Show request, waiting, ready, playing, skip, and error status                        |
| Replace YouTube Dubbing / `voiceOverTranslationForceOriginalAudio`    | off                       | Keep YouTube's selected dub while VOT prepares, then switch to original and play VOT |
| Yandex Lively Voices / `enableVoiceOverTranslationLivelyVoice`        | off                       | Use authenticated lively voices when supported                                       |
| Yandex account                                                        | not connected             | Open QR pairing and show sanitized account state                                     |
| Automatic translation / `voiceOverTranslationMode`                    | different-language videos | Translate detected foreign videos, or every eligible video                           |
| Video language / `voiceOverTranslationSourceLanguage`                 | auto-detect               | Use detected metadata or force a request language                                    |
| Translate to / `voiceOverTranslationTargetLanguage`                   | Russian                   | Select response language                                                             |
| Original Volume / `voiceOverTranslationOriginalVolume`                | 100                       | Independent YouTube volume                                                           |
| Translation Volume / `voiceOverTranslationVolume`                     | 50                        | Independent mpg123 volume                                                            |

In different-language mode the controller waits up to 2.5 seconds for YouTube
language metadata. It skips when the detected source already equals the target
or when the source remains unknown. “Every video” permits Yandex automatic
source detection when YouTube metadata is missing. A manually chosen source
language is sent as a forced source.

Notifications are removed after four seconds. A wait longer than two minutes
is reminded at most once per minute; a wait from 30 seconds to two minutes is
reminded at most every 30 seconds; no repeated countdown notification is kept
on screen for the last 30 seconds.

The **Shortcuts** page can bind any supported number or color key to:

- `Toggle Voice-over Translation` (`toggle_voice_over_translation`);
- `Toggle VOT Lively Voice` (`toggle_vot_lively_voice`).

Toggling lively voice validates the saved account state. Missing or invalid
authorization disables the option and opens pairing rather than sending an
unauthenticated “lively” request.

## Language limits

The request-language allowlist is:

`auto`, Russian, English, Chinese, Korean, Lithuanian, Latvian, Arabic, French,
Italian, Spanish, German, and Japanese.

The response-language allowlist is Russian, English, and Kazakh.

Lively voices are requested only for English-to-Russian translation. Other
language pairs use standard voices even if the lively toggle is on. These are
client-side limits in addition to whatever the current Yandex service accepts;
expanding either list requires an upstream compatibility test, not just a new
menu label.

## Lively-voice authorization and security warning

Lively voices are experimental. The pairing page accepts an already-issued
Yandex OAuth token; it does not mint one and does not prove that the token has
the private scope, entitlement, or account treatment required by the VOT
endpoint. It first validates identity against the fixed, non-redirecting
`https://login.yandex.ru/info?format=json` endpoint. The first authenticated
translation request is the effective capability test.

The credential is written atomically to
`/home/root/local-patches/vot/secrets/yandex-oauth.json`. The directory is mode
`0700` and the file is mode `0600`. The YouTube controller never receives or
stores the raw token. The root proxy adds `Authorization: OAuth ...` only when
all of these conditions hold:

- the controller explicitly marks the request as lively;
- the upstream host is exactly `api.browser.yandex.ru`;
- the path is exactly `/video-translation/translate`;
- the method is exactly `POST`.

On a genuine upstream `401` or `403`, the proxy removes the credential only if
it is still the exact credential that failed, returns a fixed token-free error,
and lets the controller fall back to standard voices and request pairing
again. Tokens, QR fragments, pairing secrets, signed audio URLs, and complete
authorization headers must never be added to logs, issues, screenshots, or
commits.

Do not ship a personal token, scraped token, OAuth client secret, or credential
copied from another public repository as a fallback. If a future version adds
token acquisition, use a documented public-client flow such as authorization
code with PKCE, request only the necessary scope, keep the callback explicit,
and retain manual QR entry as a recovery path. A public `client_id` is not a
substitute for a valid flow or scope, and a client secret cannot be protected
in a TV web bundle.

## Build and install

### Third-party components

The translation client uses `@vot.js/core` and `@vot.js/shared` `3.0.2`
from [FOSWLY/vot.js](https://github.com/FOSWLY/vot.js), published under the
MIT license, and their `@bufbuild/protobuf` `2.14.0` dependency under
Apache-2.0 and BSD-3-Clause. Offline QR rendering vendors the QR generator from
`qrcode-terminal` `0.11.0`; its Apache-2.0 notice and Kazuhiko Arase QRCode
MIT notice are preserved in
`src/voice-over-translation/vendor/qrcode-terminal/LICENSE`.

### Build the web application

Use the modern bundle for the proven C4. Build the legacy bundle for the C9
Chromium 53 compatibility class:

```sh
npm ci
npm run type-check
# C4
npm run build:modern
npm run package
# C9
npm run build
npm run package
```

`npm run build:modern` targets Chrome 87 and emits the app into `dist`.
`npm run build` emits an ES5-oriented legacy bundle with additional
polyfills. The repository itself declares Node 22 or later for development.
Root services require Node 16 or newer: C4 uses its compatible system Node,
while C9 uses the checksum-pinned private runtime described below. The runner
fails closed when version or required API checks fail.

Install the generated IPK with the webOS CLI, then close and relaunch the app:

```sh
ares-install -d c4 ./youtube.leanback.v4_0.8.3_all.ipk
ares-launch -c -d c4 youtube.leanback.v4
ares-launch -d c4 youtube.leanback.v4
```

On the current development workstation, `ares-install` from
`@webos-tools/cli` must be invoked with Node 20 because its install path fails
under Node 26. A portable nvm form is:

```sh
nvm exec 20 node node_modules/@webos-tools/cli/bin/ares-install.js \
  -d c4 ./youtube.leanback.v4_0.8.3_all.ipk
```

Use the actual generated filename. A full close/relaunch is important after a
bundle or manifest update because a WAM page reload can retain the previously
injected user script.

### Install the root services

The installer stages all three services, verifies the selected runtime, saves
a rollback snapshot, installs the Homebrew init script, restarts the services,
and commits only after all three health endpoints pass. C4 can use its system
runtime:

```sh
sh services/com.yasich.youtube.vot.service/install-webos.sh webos
```

Replace `webos` with the root SSH device name configured on the development
machine. The installer uses `webos` when no argument is supplied.

C9 must first build the private runtime from the pinned Entware armv7sf lock.
Every package and upstream notice is checksum-verified; the archive contains
the full third-party notice directory:

```sh
sh services/com.yasich.youtube.vot.service/build-c9-runtime.sh \
  /tmp/c9-vot-runtime-armv7sf.tar.gz
VOT_RUNTIME_ARCHIVE=/tmp/c9-vot-runtime-armv7sf.tar.gz \
  sh services/com.yasich.youtube.vot.service/install-webos.sh webos
```

The runtime archive is a release artifact, not a file to commit to Git. Its
runner selects only an absolute private loader/path after probing Node APIs and
the exact mpg123 remote-mode arguments. The C9 audio wrapper selects mpg123's
ALSA output and device `tts`; stock webOS ALSA then routes it to Pulse `ptts`.

The installed layout is:

```text
/home/root/local-patches/vot/service/
  vot-proxy.cjs
  vot-audio.cjs
  vot-pairing.cjs
  vot-runner.sh
  vot-node.sh
  vot-mpg123.sh
  310-youtube-vot
/home/root/local-patches/vot/runtime/
  opt/                     # optional private C9 runtime
  THIRD_PARTY_NOTICES/
/home/root/local-patches/vot/secrets/
  yandex-oauth.json        # optional; never copy into the repository
/var/lib/webosbrew/init.d/310-youtube-vot
```

The init wrapper supervises each Node process independently and restarts a
failed child after five seconds. PID files, logs, and the temporary audio cache
stay under root-only `/run/youtube-vot`; the three logs are `vot-proxy.log`,
`vot-audio.log`, and `vot-pairing.log`.

Install the app itself as a real IPK, never as a bind-only app directory.
Homebrew versions that support custom repositories may append this fork's
public HTTPS `repo.json` after the matching `0.8.3` IPK has been published,
while keeping the default repository enabled. The downstream numeric version
is required by webOS app metadata; `voiceOverTranslationRevision` records
`vot.1+upstream.0.8.2` separately. Do not add an unpublished or private URL.
Before the release exists, use Homebrew's package install service or
`ares-install` for the verified IPK so the package receipt and SAM registration
are still created; Homebrew cannot offer updates until that public manifest
exists.

## Update and rollback

Before updating, keep the previous IPK. The transactional service installer
automatically preserves the prior service, private runtime, and init script in
a root-only rollback directory. It restores them if runtime or health checks
fail and never copies, overwrites, or deletes the secrets directory. By
default, the two newest installer-created snapshots are retained; a later
successful install logs and irreversibly prunes older snapshots to bound flash
usage. Set root-owned `VOT_ROLLBACK_KEEP` from `1` through `5` for a different
retention count.

Only one service deployment may run at a time. The installer takes an atomic
root-owned lock before stopping the old services or moving files. A runtime is
accepted only when its archive hash matches the pinned release digest and its
embedded package/notice manifests exactly match the locks shipped by this
source revision. Interrupted local uploads and failed remote staging trees are
removed; rollback retention applies to failed deployments as well as successful
ones.

The legacy-compatible public Homebrew source URL is
`https://cdn.jsdelivr.net/gh/Yasich217/youtube-webos@homebrew-vot/repo.json`.
Its manifest and icons use the same public CDN, while the IPK remains the
checksum-pinned GitHub release asset. A C9-class WAM was observed rejecting the
equivalent `raw.githubusercontent.com` URL with `ERR_INSECURE_RESPONSE`; the
root Homebrew downloader can still follow the GitHub release redirects and
verify the IPK. The manifest pins that VOT IPK SHA-256 and marks the package
root-required. `homebrew-vot` is the stable public distribution branch; it
also avoids retaining a stale response previously cached under the development
branch URL. Do not add it to a TV until the referenced release asset exists and
its digest matches the manifest.

Then build/install the app and run the service installer. Verify health before
opening a translated video. Source-only changes require a new IPK; service-only
changes require reinstalling/restarting the root services; app metadata changes
always require reinstalling the IPK.

To roll back the app, reinstall the retained IPK and close/relaunch YouTube.
For a service rollback, stop the init script, move the selected snapshot's
`service`, optional `runtime`, and `previous-init` back into their documented
locations with their recorded ownership/modes, then start it and re-run all
three health checks. Do not guess a snapshot name in automation; resolve and
inspect the exact root-owned directory first.

Do not overwrite or delete the secrets directory during a normal rollback. An
emergency service stop is safe and recoverable:

```sh
/var/lib/webosbrew/init.d/310-youtube-vot stop
```

The browser controller will fail to reach the localhost services and should
leave or restore normal YouTube audio. The user-facing master toggle is the
preferred way to disable VOT while keeping the services available.

## Validation and live test matrix

Run local checks before touching a TV:

```sh
npm run type-check
node --check services/com.yasich.youtube.vot.service/vot-proxy.cjs
node --check services/com.yasich.youtube.vot.service/vot-audio.cjs
node --check services/com.yasich.youtube.vot.service/vot-pairing.cjs
node --test services/com.yasich.youtube.vot.service/vot-proxy.test.cjs
node --test services/com.yasich.youtube.vot.service/vot-audio.test.cjs
node --test services/com.yasich.youtube.vot.service/vot-pairing.test.cjs
node --test src/voice-over-translation/proxy-auth-contract.test.js
node --test src/polyfills.test.js
node --test src/legacy-event-target.test.js
node --test services/com.yasich.youtube.vot.service/service-contract.test.cjs
npm run build:modern
# Run `npm run build` as the final bundle check for C9.
```

After deployment, check only secret-free endpoints:

```sh
ssh webos 'curl -fsS http://127.0.0.1:8766/health'
ssh webos 'curl -fsS http://127.0.0.1:8767/health'
ssh webos 'curl -fsS http://127.0.0.1:8768/health'
ssh webos 'curl -fsS http://127.0.0.1:8767/v1/status'
```

Use Chrome DevTools for controller logs and the three `/run/youtube-vot`
service logs for root-side behavior. Never paste a raw proxy request, token
file, phone pairing URL, or signed audio URL into diagnostic output.

Exercise at least this matrix on the real TV:

1. Start an English video with target Russian and confirm that the picture,
   original voices, and translated voices all advance together.
2. Set original and translation volumes independently, including `100 / 100`;
   disabling VOT must not leave the original attenuated.
3. Pause and resume. Translated audio must pause, unmix, and return at the
   current position without a late start.
4. Seek forward and backward more than once. The translation must follow the
   new frame; a failed reload must restore full original audio.
5. Change playback rate and verify that drift is corrected and the service
   reports the applied rate.
6. Open a slow or unavailable translation. Original audio must remain usable,
   and wait notifications must not stay permanently on the OLED panel.
7. On a video with YouTube auto dubbing, enable **Replace YouTube Dubbing**.
   The existing dub should remain while VOT prepares, switch to the original
   only when VOT is ready, and restore safely when VOT stops. A manual audio
   track change by the user must win.
8. Press Home or open another application during translated playback. Within
   the foreground update the service must report paused/unmixed and translation
   must not continue over Home. Volume/notification overlays should not pause
   it.
9. Bind and exercise both VOT shortcuts while the same video is playing.
10. Pair lively voices on a trusted LAN, verify that status exposes only
    account metadata, then test English-to-Russian. Also test an invalid token:
    the option should disable and standard voices should remain available.
11. Leave playback long enough to confirm that the screensaver has not been
    disabled globally. The activity lease must end on pause/stop and cannot
    exceed 20 minutes per session.

## Porting to another webOS generation

Treat each TV/firmware combination as a new audio platform until the following
capabilities are proven. Marketing year alone is not a sufficient gate.

| Capability              | Requirement and failure behavior                                                                                                                            |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Root shell              | Required. Confirm `id -u` is `0`; there is no supported rootless mixing path.                                                                               |
| Browser target          | C4 uses the modern build. C9 Chromium 53 uses the legacy build and must prove Abort timeout/manual abort plus the full controller matrix.                   |
| TV Node                 | C4 uses system Node 16. C9's Node 0.12 is never selected; the absolute-path private Node 18 runner must pass its version/API gate.                          |
| mpg123                  | C4 uses system Pulse output. C9 uses pinned private mpg123 with ALSA `tts`; exact production argv and `FORMAT`, `SEEK`, and `PITCH` replies are mandatory.  |
| PulseAudio              | A usable dedicated `ptts` sink is the proven route. Never assume another category mixes instead of muting WAM.                                              |
| Digital mixer           | Require an acknowledged modern mix call or acknowledged legacy mix/unmix pair. Silence/timeout is ambiguous and triggers symmetric cleanup before fallback. |
| Foreground guard        | `getForegroundAppInfo` subscription plus bounded two-second one-shot polling; a silent subscription or failed query remains fail-closed.                 |
| Screensaver activity    | Optional. Failure is logged and playback continues; do not replace it with a permanent settings change.                                                     |
| App TTS ratio           | `volumeRatioOnTTS: 100` must be re-registered and audibly verified; firmware may interpret or ignore it differently.                                        |
| YouTube origin          | Must remain one of the exact allowed origins. If it legitimately changes, update all three origin allowlists explicitly, never to `*`.                      |
| Boot integration        | `/var/lib/webosbrew/init.d` is proven on both compatibility classes. Other root distributions may need an equivalent supervisor.                            |

A safe read-only preflight is:

```sh
id -u
uname -srm
cat /etc/os-release
nyx-cmd DeviceInfo query product_id
nyx-cmd OSInfo query webos_release
nyx-cmd OSInfo query webos_release_platformcode
nyx-cmd OSInfo query webos_manufacturing_version
/usr/bin/node --version
/usr/bin/mpg123 --version
pactl --version
pactl info
pactl list short sinks
ls-monitor -l
```

Do not query or publish `serial_number`, `nduid`, Wi-Fi/wired addresses, the
credential file, or process environments as part of a compatibility report.

On webOS, `luna-send` and `luna-send-pub` are not interchangeable evidence.
The audio, foreground, and screensaver calls used here are exercised with the
private-bus `luna-send`. A wrong bus, wrong payload, or unauthorized method can
exit or remain silent without useful output. Use `ls-monitor -l` only to prove
that a service name is registered, then use the installed service status and
an audible live test to prove that the exact method works.

After service installation, the decisive capability checks are:

- `/v1/status` reaches `foregroundKnown: true` and
  `foregroundAllowed: true` while YouTube is visible;
- a playing translation reports the expected output module/device, a non-null
  `mixerBackend`, and `mixEnabled: true`;
- original YouTube audio remains audible at its configured volume;
- leaving YouTube changes the state to paused and `mixEnabled: false`;
- no translated audio or mixer state survives a service stop.

If any required check fails, leave VOT disabled on that firmware and capture
secret-free status/log evidence before changing sink names, LS2 payloads, or
audio policy. In particular, do not compensate for firmware ducking by
globally altering system audio policy without a separate, reversible platform
implementation.
