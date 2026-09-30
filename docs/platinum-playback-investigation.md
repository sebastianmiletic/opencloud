# Platinum media startup investigation

## Observations

An isolated macOS WKWebView test embedded `https://cinesrc.st/embed/movie/550`
inside a custom-scheme page, with OpenCloud's blocker script injected into all
frames. It used an ephemeral data store, no OpenCloud collection data, and a
probe that attempted playback after media became ready.

- CineSrc's bootstrap, challenge, playlist and subtitle requests returned 200.
- Video initialization and segments from `nebula.bright67.online` returned 200.
- The video reached readyState 4 and advanced for more than 15 seconds.
- An analytics request to `a.cineflix.st` failed without preventing playback.
- A later segment request was aborted around a large timeline change. This does
  not establish that the abort caused the timeline change or the user's failure.

This is not a full OpenCloud playback test. It does not reproduce the user's
specific title, saved position, OS version, persistent cookies, or native policy.
Do not describe these results as proof that Platinum works for all users.

## Changes

- Resume waits for readyState >= 2 and a seekable range containing the target.
  Metadata alone is insufficient evidence that HLS buffers are ready.
- Retry the pending resume on loadeddata, canplay and progress; do not reload
  the provider or force quality/stream selection.
- Unknown-duration media failures are emitted as startup diagnostics, never
  written as playback checkpoints.
- Stop landing-page health probes once media-startup telemetry arrives. An HTTP
  success from the provider's HTML must not overwrite a media failure.
- A 45-second startup notice leaves the provider controls visible and suggests
  Play or another server. It neither reloads nor automatically switches sources.

## Still required

Reproduce the affected title and episode on the user's OS, compare the exact
stream and server in their browser, and test saved-position resume in the full
app. No claim of a complete Platinum fix or measured speed improvement yet.
