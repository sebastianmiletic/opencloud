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
appimage="$(realpath "$appimage")"

runtime_dir="$(mktemp -d)"
chmod 700 "$runtime_dir"
app_log="$runtime_dir/opencloud.log"
extract_dir="$runtime_dir/appimage"
app_pid=""

cleanup() {
  if [[ -n "$app_pid" ]]; then
    kill "$app_pid" 2>/dev/null || true
    wait "$app_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT

mkdir "$extract_dir"
(
  cd "$extract_dir"
  "$appimage" --appimage-extract >/dev/null
)
app_runner="$extract_dir/squashfs-root/AppRun"
if [[ ! -x "$app_runner" ]]; then
  echo "ARM64 AppImage extraction did not produce AppRun" >&2
  exit 1
fi

dbus-run-session -- xvfb-run --auto-servernum --server-args="-screen 0 1280x720x24 -nolisten tcp" env \
  XDG_SESSION_TYPE=x11 \
  GDK_BACKEND=x11 \
  OPEN_CLOUD_WEBKIT_RENDERER=compatible \
  "$app_runner" >"$app_log" 2>&1 &
app_pid="$!"

sleep 15
if ! kill -0 "$app_pid" 2>/dev/null; then
  cat "$app_log" >&2
  echo "Open Cloud exited during the ARM64 WebKitGTK smoke test" >&2
  exit 1
fi

echo "ARM64 AppImage remained healthy for 15 seconds in a native AArch64 WebKitGTK session"
