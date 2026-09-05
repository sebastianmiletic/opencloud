#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -m)" != "aarch64" ]]; then
  echo "ARM64 Wayland smoke test requires an aarch64 runner" >&2
  exit 1
fi

appimage="$(find src-tauri/target/aarch64-unknown-linux-gnu/release/bundle/appimage -maxdepth 1 -type f -name '*.AppImage' -print -quit)"
if [[ -z "$appimage" ]]; then
  echo "ARM64 AppImage was not produced" >&2
  exit 1
fi

runtime_dir="$(mktemp -d)"
chmod 700 "$runtime_dir"
weston_log="$runtime_dir/weston.log"
app_log="$runtime_dir/opencloud.log"
weston_pid=""
app_pid=""

cleanup() {
  if [[ -n "$app_pid" ]]; then
    kill "$app_pid" 2>/dev/null || true
    wait "$app_pid" 2>/dev/null || true
  fi
  if [[ -n "$weston_pid" ]]; then
    kill "$weston_pid" 2>/dev/null || true
    wait "$weston_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT

XDG_RUNTIME_DIR="$runtime_dir" weston \
  --backend=headless-backend.so \
  --socket=opencloud-wayland-ci \
  --idle-time=0 \
  --log="$weston_log" &
weston_pid="$!"

for _ in {1..50}; do
  [[ -S "$runtime_dir/opencloud-wayland-ci" ]] && break
  kill -0 "$weston_pid" 2>/dev/null || {
    cat "$weston_log" >&2
    exit 1
  }
  sleep 0.2
done

if [[ ! -S "$runtime_dir/opencloud-wayland-ci" ]]; then
  cat "$weston_log" >&2
  echo "Wayland compositor did not become ready" >&2
  exit 1
fi

env \
  XDG_RUNTIME_DIR="$runtime_dir" \
  WAYLAND_DISPLAY=opencloud-wayland-ci \
  GDK_BACKEND=wayland \
  OPEN_CLOUD_WEBKIT_RENDERER=compatible \
  "$appimage" --appimage-extract-and-run >"$app_log" 2>&1 &
app_pid="$!"

sleep 15
if ! kill -0 "$app_pid" 2>/dev/null; then
  cat "$app_log" >&2
  echo "Open Cloud exited during the ARM64 Wayland WebKitGTK smoke test" >&2
  exit 1
fi

echo "ARM64 AppImage remained healthy for 15 seconds in a native Wayland WebKitGTK session"
