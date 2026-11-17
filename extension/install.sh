#!/usr/bin/env bash
# Install the GNOME Shell extension into ~/.local/share and enable it.
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)/ai-rigtemps@a.local"
DEST="${HOME}/.local/share/gnome-shell/extensions/ai-rigtemps@a.local"
mkdir -p "$DEST"
cp "$SRC/extension.js" "$SRC/metadata.json" "$DEST/"
echo "installed to $DEST"
if gnome-extensions list 2>/dev/null | grep -q 'ai-rigtemps@a.local'; then
    gnome-extensions enable ai-rigtemps@a.local
    echo "enabled (log out/in if the shell was already running)"
else
    echo "extension not visible to the running shell yet — log out and back in"
fi
