/*
 * Music Lyrics GNOME Shell Extension
 * Based on Spotline by d3osaju: https://github.com/d3osaju/Spotline
 * Modifications copyright (C) 2026 Aryan Chaudhary.
 * SPDX-License-Identifier: GPL-3.0-only
 */

import GObject from 'gi://GObject';
import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

const MPRIS_PLAYER_PATH = '/org/mpris/MediaPlayer2';
const MPRIS_PLAYER_INTERFACE = 'org.mpris.MediaPlayer2.Player';

const SYNCED_LYRICS_PYTHON = GLib.build_filenamev([
    GLib.get_user_data_dir(),
    'music-lyrics-venv',
    'bin',
    'python3'
]);
const SYNCED_LYRICS_SCRIPT = String.raw`
import re
import syncedlyrics
import sys

artist, title = sys.argv[1], sys.argv[2]
exact_query = f"{artist} {title}".strip()
normalized_artist = re.sub(r"\s*[&,]\s*", " ", artist)
normalized_title = re.sub(r"\s*[\[(].*?[\])]\s*$", "", title)
normalized_query = re.sub(r"\s+", " ", f"{normalized_artist} {normalized_title}").strip()

result = syncedlyrics.search(exact_query, synced_only=True)
if not result and normalized_query != exact_query:
    result = syncedlyrics.search(normalized_query, synced_only=True)
if not result:
    result = syncedlyrics.search(exact_query)

print(result or "")
`;

// Helper function to check if a bus name is a supported music player
function isSupportedPlayer(busName) {
    return busName.startsWith('org.mpris.MediaPlayer2.') && busName !== 'org.mpris.MediaPlayer2';
    // Desktop apps
}

const MusicLyricsIndicator = GObject.registerClass(
    class MusicLyricsIndicator extends PanelMenu.Button {
        _init(settings) {
            super._init(0.5, 'Music Lyrics Indicator');
            this.add_style_class_name('music-lyrics-indicator');

            this._settings = settings;

            // Create a box to hold label and info icon
            const box = new St.BoxLayout({
                style_class: 'panel-status-menu-box'
            });

            this._label = new St.Label({
                text: '♪ No music',
                y_align: Clutter.ActorAlign.CENTER,
                style_class: 'music-lyrics-label'
            });

            // Enable text clipping with ellipsis
            this._label.clutter_text.ellipsize = 3; // PANGO_ELLIPSIZE_END

            // Info icon button
            this._infoIcon = new St.Icon({
                icon_name: 'dialog-information-symbolic',
                style_class: 'system-status-icon',
                icon_size: 16,
                y_align: Clutter.ActorAlign.CENTER,
                opacity: 0,
                reactive: true
            });

            box.add_child(this._label);
            box.add_child(this._infoIcon);
            this.add_child(box);

            // Show/hide info icon on hover
            this.connect('enter-event', () => {
                this._infoIcon.ease({
                    opacity: 255,
                    duration: 200,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD
                });
                // Update truncation on hover just in case
                this._updateLabelText();
            });

            this.connect('leave-event', () => {
                this._infoIcon.ease({
                    opacity: 0,
                    duration: 200,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD
                });
            });

            this._currentTrack = null;
            this._currentLyrics = null;
            this._currentLine = '';
            this._proxy = null;
            this._propertiesChangedId = null;
            this._lyricsTimeoutId = null;
            this._lyricsProcess = null;
            this._currentBusName = null;
            this._busWatchId = null;

            // Internal state for lyrics - using GSettings for preferences now
            this._showLyrics = true;

            // Connect setting signals
            this._settingsSignalId = this._settings.connect('changed::max-text-length', () => {
                this._updateLabelText();
            });

            this._buildMenu();
            this._setupDBusMonitoring();
        }

        _buildMenu() {
            // Player info section
            this._playerInfoItem = new PopupMenu.PopupMenuItem('No player connected', {
                reactive: false
            });
            this._playerInfoItem.label.style = 'font-size: 0.85em; color: #888;';
            this.menu.addMenuItem(this._playerInfoItem);

            // Track info section
            this._trackInfoItem = new PopupMenu.PopupMenuItem('No track playing', {
                reactive: false
            });
            this.menu.addMenuItem(this._trackInfoItem);

            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            // Playback controls
            const controlsBox = new St.BoxLayout({
                style_class: 'popup-menu-item',
                x_expand: true,
                x_align: Clutter.ActorAlign.CENTER,
                style: 'spacing: 12px;'
            });

            const prevButton = new St.Button({
                style_class: 'button',
                child: new St.Icon({
                    icon_name: 'media-skip-backward-symbolic',
                    icon_size: 20
                })
            });
            prevButton.connect('clicked', () => this._controlPlayback('Previous'));

            const playPauseButton = new St.Button({
                style_class: 'button',
                child: new St.Icon({
                    icon_name: 'media-playback-start-symbolic',
                    icon_size: 20
                })
            });
            this._playPauseButton = playPauseButton;
            playPauseButton.connect('clicked', () => this._controlPlayback('PlayPause'));

            const nextButton = new St.Button({
                style_class: 'button',
                child: new St.Icon({
                    icon_name: 'media-skip-forward-symbolic',
                    icon_size: 20
                })
            });
            nextButton.connect('clicked', () => this._controlPlayback('Next'));

            controlsBox.add_child(prevButton);
            controlsBox.add_child(playPauseButton);
            controlsBox.add_child(nextButton);

            const controlsItem = new PopupMenu.PopupBaseMenuItem({
                reactive: false,
                can_focus: false
            });
            controlsItem.add_child(controlsBox);
            this.menu.addMenuItem(controlsItem);

            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            // Toggle lyrics display
            this._lyricsToggle = new PopupMenu.PopupSwitchMenuItem(
                'Show Lyrics',
                this._showLyrics
            );
            this._lyricsToggle.connect('toggled', (item) => {
                this._showLyrics = item.state;
                if (!item.state) {
                    this._stopLyricsWork();
                }
                this._updateTrackInfo();
            });
            this.menu.addMenuItem(this._lyricsToggle);

            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            // Refresh button
            const refreshItem = new PopupMenu.PopupMenuItem('Refresh Player');
            refreshItem.connect('activate', () => {
                this._queueFindActivePlayer();
            });
            this.menu.addMenuItem(refreshItem);

            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            // Info submenu
            this._infoSubmenu = new PopupMenu.PopupSubMenuMenuItem('About');

            // GitHub link
            const githubItem = new PopupMenu.PopupMenuItem('View on GitHub');
            githubItem.connect('activate', () => {
                Gio.AppInfo.launch_default_for_uri(
                    'https://github.com/achaudhary2304/live_lyrics',
                    null
                );
            });
            this._infoSubmenu.menu.addMenuItem(githubItem);

            // Credits
            const creditsItem = new PopupMenu.PopupMenuItem('Based on Spotline by deosaju', {
                reactive: false
            });
            creditsItem.label.style = 'font-size: 0.9em; color: #888;';
            this._infoSubmenu.menu.addMenuItem(creditsItem);

            this.menu.addMenuItem(this._infoSubmenu);
        }

        _controlPlayback(action) {
            if (!this._playerProxy) {
                return;
            }

            this._playerProxy.call(
                action,
                null,
                Gio.DBusCallFlags.NONE,
                -1,
                null,
                (proxy, result) => {
                    try {
                        proxy.call_finish(result);
                    } catch (e) {
                        logError(e, `Failed to ${action}`);
                    }
                }
            );
        }

        _updatePlayPauseButton() {
            if (!this._playerProxy || !this._playPauseButton) {
                return;
            }

            try {
                const playbackStatus = this._playerProxy.get_cached_property('PlaybackStatus');
                if (playbackStatus) {
                    const status = playbackStatus.unpack();
                    const icon = status === 'Playing' ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic';
                    this._playPauseButton.child.icon_name = icon;
                }
            } catch (e) {
                logError(e, 'Failed to update play/pause button');
            }
        }

        _setupDBusMonitoring() {
            this._dbusSignalId = Gio.DBus.session.signal_subscribe(
                'org.freedesktop.DBus',
                'org.freedesktop.DBus',
                'NameOwnerChanged',
                '/org/freedesktop/DBus',
                null,
                Gio.DBusSignalFlags.NONE,
                () => this._queueFindActivePlayer()
            );

            this._queueFindActivePlayer();
        }

        _queueFindActivePlayer() {
            if (this._findPlayerTimeoutId) {
                GLib.source_remove(this._findPlayerTimeoutId);
            }
            this._findPlayerTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                this._findPlayerTimeoutId = null;
                this._findActivePlayer();
                return GLib.SOURCE_REMOVE;
            });
        }

        async _findActivePlayer() {
            this._findPlayerGen = (this._findPlayerGen || 0) + 1;
            const currentGen = this._findPlayerGen;

            try {
                const reply = await new Promise((resolve, reject) => {
                    Gio.DBus.session.call(
                        'org.freedesktop.DBus',
                        '/org/freedesktop/DBus',
                        'org.freedesktop.DBus',
                        'ListNames',
                        null,
                        null,
                        Gio.DBusCallFlags.NONE,
                        -1,
                        null,
                        (conn, result) => {
                            try {
                                resolve(conn.call_finish(result));
                            } catch (e) {
                                reject(e);
                            }
                        }
                    );
                });

                const names = reply.get_child_value(0).deep_unpack();
                let foundPlayer = null;
                let fallbackPlayer = null;

                for (const name of names) {
                    if (isSupportedPlayer(name)) {
                        if (!fallbackPlayer) fallbackPlayer = name;

                        try {
                            const propReply = await new Promise((resolve, reject) => {
                                Gio.DBus.session.call(
                                    name,
                                    MPRIS_PLAYER_PATH,
                                    'org.freedesktop.DBus.Properties',
                                    'Get',
                                    new GLib.Variant('(ss)', [MPRIS_PLAYER_INTERFACE, 'PlaybackStatus']),
                                    null,
                                    Gio.DBusCallFlags.NONE,
                                    -1,
                                    null,
                                    (conn, result) => {
                                        try {
                                            resolve(conn.call_finish(result));
                                        } catch (e) {
                                            reject(e);
                                        }
                                    }
                                );
                            });

                            const status = propReply.get_child_value(0).get_variant().unpack();
                            if (status === 'Playing') {
                                foundPlayer = name;
                                break;
                            }
                        } catch (e) {
                            // Ignore
                        }
                    }
                }

                if (this._findPlayerGen !== currentGen) return;

                foundPlayer = foundPlayer || fallbackPlayer;

                if (foundPlayer) {
                    await this._tryConnectToPlayer(foundPlayer);
                } else {
                    this._disconnectPlayer();
                    this._updateLabelText('♪ No music');
                    if (this._trackInfoItem) this._trackInfoItem.label.text = 'No track playing';
                    if (this._playerInfoItem) this._playerInfoItem.label.text = 'No player connected';
                    if (this._playPauseButton) this._playPauseButton.child.icon_name = 'media-playback-start-symbolic';
                }
            } catch (e) {
                if (this._findPlayerGen !== currentGen) return;
                logError(e, 'Failed to query DBus');
                this._disconnectPlayer();
                this._updateLabelText('♪ No music');
            }
        }

        async _tryConnectToPlayer(busName) {
            try {
                if (this._currentBusName === busName && this._playerProxy) {
                    this._updateTrackInfo();
                    this._updatePlayPauseButton();
                    return true;
                }

                const currentGen = this._findPlayerGen;

                const proxy = await new Promise((resolve, reject) => {
                    Gio.DBusProxy.new_for_bus(
                        Gio.BusType.SESSION,
                        Gio.DBusProxyFlags.NONE,
                        null,
                        busName,
                        MPRIS_PLAYER_PATH,
                        'org.freedesktop.DBus.Properties',
                        null,
                        (src, result) => {
                            try {
                                resolve(Gio.DBusProxy.new_for_bus_finish(result));
                            } catch (e) {
                                reject(e);
                            }
                        }
                    );
                });

                const playerProxy = await new Promise((resolve, reject) => {
                    Gio.DBusProxy.new_for_bus(
                        Gio.BusType.SESSION,
                        Gio.DBusProxyFlags.NONE,
                        null,
                        busName,
                        MPRIS_PLAYER_PATH,
                        MPRIS_PLAYER_INTERFACE,
                        null,
                        (src, result) => {
                            try {
                                resolve(Gio.DBusProxy.new_for_bus_finish(result));
                            } catch (e) {
                                reject(e);
                            }
                        }
                    );
                });

                if (this._findPlayerGen !== currentGen) {
                    return false;
                }

                this._disconnectPlayer();

                this._proxy = proxy;
                this._playerProxy = playerProxy;
                this._currentBusName = busName;

                this._propertiesChangedId = this._playerProxy.connect(
                    'g-properties-changed',
                    this._onPropertiesChanged.bind(this)
                );

                this._updatePlayerInfo();
                this._updateTrackInfo();
                this._updatePlayPauseButton();
                return true;
            } catch (e) {
                logError(e, 'Failed to connect to player');
                return false;
            }
        }

        _disconnectPlayer() {
            this._stopLyricsWork();

            if (this._propertiesChangedId && this._playerProxy) {
                this._playerProxy.disconnect(this._propertiesChangedId);
                this._propertiesChangedId = null;
            }
            this._proxy = null;
            this._playerProxy = null;
            this._currentBusName = null;
        }

        _updatePlayerInfo() {
            if (!this._currentBusName) {
                this._playerInfoItem.label.text = 'No player connected';
                return;
            }

            let playerName = 'Unknown Player';
            let playerIcon = '♪';

            if (this._currentBusName.includes('spotify')) {
                playerName = 'Spotify';
                playerIcon = '🎵';
            } else if (this._currentBusName.includes('youtube-music')) {
                playerName = 'YouTube Music';
                playerIcon = '🎵';
            } else if (this._currentBusName.includes('chromium')) {
                playerName = 'Chromium';
                playerIcon = '🌐';
            } else if (this._currentBusName.includes('chrome')) {
                playerName = 'Chrome';
                playerIcon = '🌐';
            } else if (this._currentBusName.includes('firefox')) {
                playerName = 'Firefox';
                playerIcon = '🌐';
            } else if (this._currentBusName.includes('brave')) {
                playerName = 'Brave';
                playerIcon = '🌐';
            } else if (this._currentBusName.includes('edge')) {
                playerName = 'Edge';
                playerIcon = '🌐';
            } else if (this._currentBusName.includes('strawberry')) {
                playerName = 'Strawberry';
                playerIcon = '🍓';
            }

            this._playerInfoItem.label.text = `${playerIcon} Playing from ${playerName}`;
        }

        _onPropertiesChanged() {
            this._updateTrackInfo();
            this._updatePlayPauseButton();
        }

        _updateTrackInfo() {
            if (!this._playerProxy) {
                return;
            }

            try {
                const metadata = this._playerProxy.get_cached_property('Metadata');
                if (!metadata) {
                    this._updateLabelText('♪ No music');
                    this._trackInfoItem.label.text = 'No track playing';
                    return;
                }

                const metadataDict = metadata.deep_unpack();
                const title = metadataDict['xesam:title']?.unpack() || null;
                const artist = metadataDict['xesam:artist']?.deep_unpack()[0] || null;
                const album = metadataDict['xesam:album']?.unpack() || null;
                const trackUrl = metadataDict['xesam:url']?.unpack() || null;

                // If both title and artist are missing, show icon or nothing
                if (!title && !artist) {
                    this._updateLabelText('♪');
                    this._trackInfoItem.label.text = 'Unknown track';
                    return;
                }

                this._currentTrack = {
                    title: title || 'Unknown Track',
                    artist: artist || 'Unknown Artist',
                    album: album || 'Unknown Album',
                    url: trackUrl
                };

                // Update menu with track info
                this._trackInfoItem.label.text = `${this._currentTrack.artist} - ${this._currentTrack.title}`;

                // Try to fetch lyrics if enabled
                if (this._showLyrics) {
                    this._fetchLyrics(this._currentTrack.title, this._currentTrack.artist, this._currentTrack.url);
                } else {
                    this._updateLabelText(`${this._currentTrack.artist} - ${this._currentTrack.title}`);
                }
            } catch (e) {
                logError(e, 'Failed to get track info');
            }
        }

        _fetchLyrics(title, artist, trackUrl) {
            this._stopLyricsWork();
            this._currentLyrics = null;
            this._currentLine = '';

            if (!trackUrl?.startsWith('file://')) {
                this._fetchLyricsFromProviders(title, artist);
                return;
            }

            try {
                const [filePath] = GLib.filename_from_uri(trackUrl);
                const commands = [[
                    'ffprobe',
                    '-v', 'quiet',
                    '-show_entries', 'format_tags=lyrics,LYRICS,UNSYNCEDLYRICS',
                    '-of', 'default=noprint_wrappers=1:nokey=1',
                    filePath
                ]];

                if (filePath.toLowerCase().endsWith('.flac')) {
                    commands.push([
                        'metaflac',
                        '--show-tag=LYRICS',
                        '--show-tag=UNSYNCEDLYRICS',
                        filePath
                    ]);
                }

                this._fetchEmbeddedLyrics(commands, title, artist);
            } catch (e) {
                this._fetchLyricsFromProviders(title, artist);
            }
        }

        _fetchEmbeddedLyrics(commands, title, artist) {
            const [command, ...remaining] = commands;
            if (!command) {
                this._fetchLyricsFromProviders(title, artist);
                return;
            }

            this._runLyricsProcess(command, lyrics => {
                if (!this._displayLyrics(lyrics)) {
                    this._fetchEmbeddedLyrics(remaining, title, artist);
                }
            });
        }

        _fetchLyricsFromProviders(title, artist) {
            this._updateLabelText('Searching lyrics…');

            if (!GLib.file_test(SYNCED_LYRICS_PYTHON, GLib.FileTest.IS_EXECUTABLE)) {
                this._updateLabelText('Lyrics helper is not installed');
                return;
            }

            this._runLyricsProcess([
                SYNCED_LYRICS_PYTHON,
                '-c',
                SYNCED_LYRICS_SCRIPT,
                artist,
                title
            ], lyrics => {
                if (!this._displayLyrics(lyrics)) {
                    this._updateLabelText(`Lyrics unavailable · ${artist} - ${title}`);
                }
            });
        }

        _runLyricsProcess(argv, onComplete) {
            let process;
            try {
                process = Gio.Subprocess.new(
                    argv,
                    Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
                );
            } catch (e) {
                onComplete(null);
                return;
            }

            this._lyricsProcess = process;
            process.communicate_utf8_async(null, null, (source, result) => {
                let success;
                let stdout;

                try {
                    [success, stdout] = source.communicate_utf8_finish(result);
                } catch (e) {
                    if (this._lyricsProcess === process) {
                        this._lyricsProcess = null;
                        onComplete(null);
                    }
                    return;
                }

                if (this._lyricsProcess !== process) {
                    return;
                }
                this._lyricsProcess = null;
                onComplete(success ? stdout : null);
            });
        }

        _displayLyrics(rawLyrics) {
            const lyrics = rawLyrics
                ?.trim()
                .replace(/^(UNSYNCEDLYRICS|LYRICS)=/im, '')
                .trim();

            if (!lyrics) {
                return false;
            }

            const synced = this._parseLRC(lyrics);
            if (synced.length > 0) {
                this._currentLyrics = synced;
                this._startLyricsDisplay();
                return true;
            }

            const firstLine = lyrics
                .split('\n')
                .map(line => line.trim())
                .find(line => line &&
                    !/^\[[^\]]+\]$/.test(line) &&
                    !/^\d+\s+contributors?$/i.test(line) &&
                    !/^.+\s+lyrics$/i.test(line) &&
                    !/^(translations?|read more|embed|you might also like)$/i.test(line));

            if (!firstLine) {
                return false;
            }

            this._updateLabelText(firstLine);
            return true;
        }

        _stopLyricsWork() {
            if (this._lyricsTimeoutId) {
                GLib.source_remove(this._lyricsTimeoutId);
                this._lyricsTimeoutId = null;
            }

            if (this._lyricsProcess) {
                try {
                    this._lyricsProcess.force_exit();
                } catch (e) {
                    // The process may already have exited.
                }
                this._lyricsProcess = null;
            }
        }

        _parseLRC(lrcText) {
            // Parse LRC format: [mm:ss.xx]lyrics
            const lines = [];
            const lrcLines = lrcText.split('\n');

            for (const line of lrcLines) {
                const match = line.match(/\[(\d+):(\d+)\.(\d+)\](.*)/);
                if (match) {
                    const minutes = parseInt(match[1]);
                    const seconds = parseInt(match[2]);
                    const milliseconds = parseInt(match[3].padEnd(3, '0').slice(0, 3));
                    const text = match[4].trim();

                    const timeMs = (minutes * 60 + seconds) * 1000 + milliseconds;

                    if (text) {
                        lines.push({ time: timeMs, text: text });
                    }
                }
            }

            return lines.sort((a, b) => a.time - b.time);
        }

        _startLyricsDisplay() {
            if (!this._currentLyrics || this._currentLyrics.length === 0) {
                return;
            }

            // Get current playback position
            this._updateCurrentLyricLine();

            // Update lyrics based on configured interval - use 500ms as default
            this._lyricsTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                this._updateCurrentLyricLine();
                return GLib.SOURCE_CONTINUE;
            });
        }

        _updateCurrentLyricLine() {
            if (!this._proxy || !this._currentLyrics || this._currentLyrics.length === 0) {
                return;
            }

            try {
                // Query position via DBus
                this._proxy.call(
                    'Get',
                    new GLib.Variant('(ss)', [MPRIS_PLAYER_INTERFACE, 'Position']),
                    Gio.DBusCallFlags.NONE,
                    -1,
                    null,
                    (proxy, result) => {
                        try {
                            const reply = proxy.call_finish(result);
                            // Reply is a tuple containing a variant, extract the int64 value
                            const positionUs = reply.get_child_value(0).get_variant().get_int64();
                            const positionMs = positionUs / 1000; // Convert microseconds to milliseconds

                            // Find the current lyric line
                            let currentLine = this._currentLyrics[0].text;

                            for (let i = this._currentLyrics.length - 1; i >= 0; i--) {
                                if (this._currentLyrics[i].time <= positionMs) {
                                    currentLine = this._currentLyrics[i].text;
                                    break;
                                }
                            }

                            if (currentLine !== this._currentLine) {
                                this._currentLine = currentLine;
                                this._updateLabelText(currentLine);
                            }
                        } catch (e) {
                            logError(e, 'Failed to parse position');
                        }
                    }
                );
            } catch (e) {
                logError(e, 'Failed to update lyric line');
            }
        }

        _updateLabelText(text = null) {
            if (text !== null) {
                this._currentText = text;
            }

            const display = this._currentText || '♪ No music';
            const maxLength = this._settings.get_int('max-text-length');
            this._label.set_text(this._truncateText(display, maxLength));
        }

        _truncateText(text, maxLength) {
            if (text.length <= maxLength) {
                return text;
            }
            return text.substring(0, maxLength - 3) + '...';
        }

        destroy() {
            if (this._settingsSignalId) {
                this._settings.disconnect(this._settingsSignalId);
                this._settingsSignalId = null;
            }

            this._stopLyricsWork();

            if (this._findPlayerTimeoutId) {
                GLib.source_remove(this._findPlayerTimeoutId);
                this._findPlayerTimeoutId = null;
            }

            this._disconnectPlayer();

            if (this._dbusSignalId) {
                Gio.DBus.session.signal_unsubscribe(this._dbusSignalId);
                this._dbusSignalId = null;
            }
            super.destroy();
        }
    });

export default class MusicLyricsExtension extends Extension {
    constructor(metadata) {
        super(metadata);
        this._indicator = null;
        this._settings = null;
    }

    enable() {
        this._settings = this.getSettings();
        this._indicator = new MusicLyricsIndicator(this._settings);

        this._updatePosition();

        this._settingsSignalId = this._settings.connect('changed::position-in-panel', () => {
            this._updatePosition();
        });
    }

    disable() {
        if (this._settingsSignalId) {
            this._settings.disconnect(this._settingsSignalId);
            this._settingsSignalId = null;
        }

        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }

        this._settings = null;
    }

    _updatePosition() {
        if (!this._indicator) return;

        // Remove from current parent if applied
        if (this._indicator.get_parent()) {
            this._indicator.get_parent().remove_child(this._indicator);
        }

        const position = this._settings.get_string('position-in-panel');

        if (position === 'left') {
            Main.panel._leftBox.add_child(this._indicator);
        } else if (position === 'center') {
            Main.panel._centerBox.add_child(this._indicator);
        } else {
            // Default to right (status area)
            // We use addToStatusArea but need to handle re-adding carefully
            // addToStatusArea destroys existing indicator with same role, but we handle that

            // Since we manually removed it, we can just add it back using the panel method
            // or just use addToStatusArea again (which is safer for right side)
            Main.panel.addToStatusArea('music-lyrics-indicator', this._indicator);
        }
    }
}
