# Live Lyrics

A GNOME Shell extension that displays synchronized lyrics for the currently
playing song directly in the top bar.

## Features

- Real-time LRC lyrics synchronized through MPRIS playback position
- Supports Firefox, Chromium-based browsers, Spotify, Strawberry, and other
  MPRIS-compatible players
- Searches Musixmatch, LRCLIB, NetEase, Megalobiz, and Genius
- Reads embedded lyrics from local audio files using `ffprobe` and `metaflac`
- Includes previous, play/pause, and next controls
- Configurable panel position and maximum text length

## Installation

Install the required packages on Ubuntu:

```bash
sudo apt install python3-venv ffmpeg flac
```

Clone and install the extension:

```bash
git clone https://github.com/achaudhary2304/live_lyrics.git
cd live_lyrics
./install.sh
```

Restart GNOME Shell by logging out and back in. On X11, press `Alt+F2`, enter
`r`, and press Enter. Then enable the extension:

```bash
gnome-extensions enable music-lyrics@achaudhary2304.github.io
```

## How it works

The extension uses D-Bus/MPRIS to detect the active media player and read its
track metadata, playback state, and position. A Python helper powered by
[`syncedlyrics`](https://github.com/moehmeni/syncedlyrics) searches multiple
lyrics providers. Timestamped LRC results are parsed and updated in the panel
every 500 milliseconds.

For local audio files, embedded lyrics are checked before starting an online
search. Old searches are cancelled when the track changes so that stale lyrics
cannot replace the current song.

## Privacy

Online searches send the current artist and title to third-party lyrics
providers. The extension does not inspect browser tabs, store listening
history, or include telemetry.

## Credits

Live Lyrics is based on [Spotline](https://github.com/d3osaju/Spotline) by
d3osaju and remains licensed under [GPL-3.0](LICENSE). The online lyrics helper
uses the MIT-licensed `syncedlyrics` package.
