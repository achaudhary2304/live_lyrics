# Music Lyrics

Music Lyrics is a GNOME Shell extension that displays synchronized lyrics in
the top bar for Firefox, Spotify, Strawberry, and other MPRIS-compatible media
players.

This project is a modified version of
[Spotline](https://github.com/d3osaju/Spotline) by d3osaju. It retains the
original project's GPL-3.0 license and clearly documents the changes made in
this fork.

## Features

- Detects active players and reads track metadata through D-Bus/MPRIS.
- Displays timestamped LRC lyrics in sync with the playback position.
- Searches Musixmatch, LRCLIB, NetEase, Megalobiz, and Genius through the
  `syncedlyrics` Python package.
- Reads embedded lyrics from local audio files using `ffprobe`, with an
  additional `metaflac` fallback for FLAC files.
- Provides previous, play/pause, and next controls in the panel menu.
- Supports left, center, or right panel placement and configurable text length.

## Requirements

- GNOME Shell 45 or 46
- Python 3 with the `venv` module
- `ffprobe` for embedded local-file lyrics (optional)
- `metaflac` for the FLAC-specific fallback (optional)

On Ubuntu, the dependencies can be installed with:

```bash
sudo apt install python3-venv ffmpeg flac
```

## Install

```bash
git clone https://github.com/achaudhary2304/gnome-music-lyrics.git
cd gnome-music-lyrics
./install.sh
```

Then log out and back in. On an X11 session, you can instead restart GNOME
Shell with `Alt+F2`, followed by `r` and Enter. Enable the extension with:

```bash
gnome-extensions enable music-lyrics@achaudhary2304.github.io
```

## How it works

The browser or music player exposes the current title, artist, playback state,
and position through MPRIS. The extension uses that metadata to search for
lyrics. Synchronized results are parsed as LRC timestamps, and the current line
is selected every 500 milliseconds using the MPRIS playback position.

For local `file://` tracks, embedded tags are checked before an online search.
For streamed tracks, the extension starts an isolated Python helper and asks
`syncedlyrics` to try its supported providers in sequence.

## Privacy and network access

Online lyric lookup sends the current artist and title to third-party lyric
providers selected by `syncedlyrics`. The extension does not inspect browser
tabs, scrape the Apple Music page, collect listening history, or include
telemetry. Provider availability and behavior can change independently of this
project.

## Development

The extension source is the set of files at the repository root. Validate the
JavaScript and compile the settings schema with:

```bash
node --check extension.js
glib-compile-schemas schemas
```

`schemas/gschemas.compiled` is generated locally and is intentionally ignored
by Git.

## Credits and license

- Based on [Spotline](https://github.com/d3osaju/Spotline) by d3osaju.
- Uses [syncedlyrics](https://github.com/moehmeni/syncedlyrics), an MIT-licensed
  runtime dependency that is not vendored in this repository.
- Modifications copyright (C) 2026 Aryan Chaudhary.

This project is distributed under the GNU General Public License v3.0. See
[LICENSE](LICENSE).
