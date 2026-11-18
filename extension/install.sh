#!/usr/bin/env bash
# Install the ai-rig temps widget:
#   1) GNOME Shell extension -> ~/.local/share (widget in the top bar)
#   2) background poller     -> systemd user service (fetches temps, no shell blocking)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

EXT_SRC="$ROOT/extension/ai-rigtemps@a.local"
EXT_DST="$HOME/.local/share/gnome-shell/extensions/ai-rigtemps@a.local"
SVC_SRC="$ROOT/ai-rigtemps-poller.service"
SVC_DST="$HOME/.config/systemd/user/ai-rigtemps-poller.service"

# 1) extension
mkdir -p "$EXT_DST"
cp "$EXT_SRC/extension.js" "$EXT_SRC/metadata.json" "$EXT_DST/"
echo "installed extension -> $EXT_DST"

# 2) poller service
mkdir -p "$(dirname "$SVC_DST")"
cp "$SVC_SRC" "$SVC_DST"
systemctl --user daemon-reload
systemctl --user enable --now ai-rigtemps-poller.service
echo "started poller service (ai-rigtemps-poller.service)"

# enable extension if the shell already knows it
if gnome-extensions list 2>/dev/null | grep -q 'ai-rigtemps@a.local'; then
    gnome-extensions enable ai-rigtemps@a.local || true
    echo "enabled extension"
else
    echo "note: shell hasn't loaded this extension yet — log out and back in"
fi

echo
echo "done. If the top bar still shows a stale/OLD value, log out and log back in."
