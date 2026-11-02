#!/usr/bin/env bash
# The scripted sign-in test for the Tauri shell on Linux (signin.py says what
# it checks). Runs INSIDE the Linux image (docker/linux.Dockerfile), against a
# running brain, with the release build already made:
#
#   docker run --rm --network host \
#     -v <checkout>:/work -e CARGO_TARGET_DIR=/work/target \
#     -v <login file>:/run/t1/test-login:ro \
#     -e MANTLE_TEST_BRAIN_PORT=<brain port on 127.0.0.1> \
#     <image> bash /work/client/tauri/e2e/run.sh
#
# The login file holds MANTLE_TEST_EMAIL, MANTLE_TEST_PASSWORD and, for a
# fresh brain, MANTLE_TEST_SETUP_CODE. --network host so the app reaches a
# brain on the host's loopback.
#
# Everything the run makes is in one scratch folder inside the container: the
# X display, the app's config and data folders, and a GNOME Keyring unlocked
# with a password generated here and never written down. It goes when the
# container does.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "${1:-}" != --inside ]]; then
  : "${MANTLE_TEST_BRAIN_PORT:?set MANTLE_TEST_BRAIN_PORT to the brain port on 127.0.0.1}"
  scratch="$(mktemp -d /tmp/mantle-desktop-e2e.XXXXXX)"
  export MANTLE_E2E_SCRATCH="$scratch"
  bin="${MANTLE_DESKTOP_BIN:-${CARGO_TARGET_DIR:-$here/../target}/release/mantle-desktop}"
  export MANTLE_DESKTOP_BIN="$bin"

  # One X server for every run of the app. No TCP listener: the container
  # shares the host's network.
  display=":$(( 100 + RANDOM % 800 ))"
  Xvfb "$display" -screen 0 1600x1000x24 -nolisten tcp >"$scratch/xvfb.log" 2>&1 &
  xvfb=$!
  trap 'kill "$xvfb" 2>/dev/null || true' EXIT
  for _ in $(seq 50); do [[ -S "/tmp/.X11-unix/X${display#:}" ]] && break; sleep 0.1; done
  export DISPLAY="$display"

  # WebKitGTK in a container: software GL, no DMA-BUF renderer, no a11y bus.
  export WEBKIT_DISABLE_DMABUF_RENDERER=1 LIBGL_ALWAYS_SOFTWARE=1 NO_AT_BRIDGE=1

  set +e
  dbus-run-session -- "${BASH_SOURCE[0]}" --inside
  status=$?
  set -e
  exit "$status"
fi

# ── inside the dbus session ──────────────────────────────────────────────────
scratch="$MANTLE_E2E_SCRATCH"
export HOME="$scratch/keyring-home"
export XDG_RUNTIME_DIR="$scratch/runtime"
mkdir -p "$HOME" "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"

# The Secret Service: GNOME Keyring, its login keyring created and unlocked
# with a throwaway password. It lives in $HOME above, in this container only.
keyring_password="$(head -c 32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24)"
eval "$(printf '%s' "$keyring_password" | gnome-keyring-daemon --unlock --components=secrets)"
unset keyring_password
export GNOME_KEYRING_CONTROL

# A second session bus with no Secret Service at all, and no service files to
# start one from, for the no-keychain step.
cat >"$scratch/no-keychain-bus.conf" <<EOF
<!DOCTYPE busconfig PUBLIC "-//freedesktop//DTD D-Bus Bus Configuration 1.0//EN"
 "http://www.freedesktop.org/standards/dbus/1.0/busconfig.dtd">
<busconfig>
  <type>session</type>
  <listen>unix:dir=$scratch</listen>
  <auth>EXTERNAL</auth>
  <policy context="default">
    <allow send_destination="*" eavesdrop="true"/>
    <allow eavesdrop="true"/>
    <allow own="*"/>
  </policy>
</busconfig>
EOF
bare_bus="$(dbus-daemon --config-file="$scratch/no-keychain-bus.conf" --fork --print-address=1 --print-pid=3 3>"$scratch/no-keychain-bus.pid")"
trap 'kill "$(cat "$scratch/no-keychain-bus.pid")" 2>/dev/null || true' EXIT
export MANTLE_E2E_NO_KEYCHAIN_BUS="$bare_bus"

python3 -I "$here/signin.py"
