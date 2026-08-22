#!/usr/bin/env bash

set -euo pipefail

extension_uuid='music-lyrics@achaudhary2304.github.io'
source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
data_dir=${XDG_DATA_HOME:-"$HOME/.local/share"}
extension_dir="$data_dir/gnome-shell/extensions/$extension_uuid"
venv_dir="$data_dir/music-lyrics-venv"

for command_name in python3 glib-compile-schemas; do
    if ! command -v "$command_name" >/dev/null 2>&1; then
        printf 'Missing required command: %s\n' "$command_name" >&2
        exit 1
    fi
done

python3 -m venv "$venv_dir"
"$venv_dir/bin/python3" -m pip install --requirement "$source_dir/requirements.txt"

mkdir -p "$extension_dir/schemas"
install -m 0644 "$source_dir/extension.js" "$extension_dir/extension.js"
install -m 0644 "$source_dir/metadata.json" "$extension_dir/metadata.json"
install -m 0644 "$source_dir/prefs.js" "$extension_dir/prefs.js"
install -m 0644 "$source_dir/stylesheet.css" "$extension_dir/stylesheet.css"
install -m 0644 \
    "$source_dir/schemas/org.gnome.shell.extensions.music-lyrics.gschema.xml" \
    "$extension_dir/schemas/org.gnome.shell.extensions.music-lyrics.gschema.xml"

glib-compile-schemas "$extension_dir/schemas"

printf 'Installed %s\n' "$extension_uuid"
printf 'Restart GNOME Shell, then run: gnome-extensions enable %s\n' "$extension_uuid"
