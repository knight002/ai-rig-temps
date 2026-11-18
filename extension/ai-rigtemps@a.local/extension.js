import GLib from 'gi://GLib'
import St from 'gi://St'
import Clutter from 'gi://Clutter'

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js'
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js'
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js'

const INTERVAL_MS = 2000;
// data older than this (ms) => OFFLINE
const STALE_MS = 6000;
const DATA_PATH = `${GLib.get_user_cache_dir()}/ai-rigtemps/data.json`;
function tempColor(val) {
    if (val >= 80) return '#e74c3c';
    if (val >= 65) return '#f39c12';
    return '#7ec699';
}

function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function compactMarkup(data) {
    let pick = {};
    if (data.temps) {
        for (let t of data.temps) {
            let v = parseFloat(t.value);
            if (!isNaN(v)) pick[t.label] = v;
        }
    }
    let parts = [];
    for (let k of ['CPU', 'GPU'])
        if (pick[k] !== undefined)
            parts.push('<span foreground="' + tempColor(pick[k]) + '">' +
                       esc(k) + ' ' + pick[k].toFixed(0) + '\u00b0</span>');
    if (pick.VRM_E !== undefined || pick.VRM_W !== undefined) {
        let vrm = Math.max(pick.VRM_E ?? 0, pick.VRM_W ?? 0);
        parts.push('<span foreground="' + tempColor(vrm) + '">VRM ' +
                   vrm.toFixed(0) + '\u00b0</span>');
    }
    if (!parts.length) parts.push('<span foreground="#888">ai-rig</span>');
    return parts.join(' ');
}

// read the cache file the background poller writes; returns data or null
function readData() {
    try {
        let [ok, contents] = GLib.file_get_contents(DATA_PATH);
        if (!ok || !contents) return null;
        return JSON.parse(contents);
    } catch (e) {
        return null;
    }
}

// epoch seconds -> ms, using the JS clock (matches the poller's time.time())
function nowEpochMs() {
    return Date.now();
}

function rebuildMenu(menu, data) {
    try {
        menu.removeAll();
    } catch (e) {
        return;
    }
    function row(markup) {
        let item = new PopupMenu.PopupMenuItem('');
        try { item.label.x_align = Clutter.ActorAlign.START; } catch (e) {}
        item.label.clutter_text.set_markup(markup);
        item.sensitive = false;
        menu.addMenuItem(item);
    }
    if (data.temps) {
        for (let t of data.temps) {
            let v = parseFloat(t.value);
            if (isNaN(v)) continue;
            row('<span foreground="' + tempColor(v) + '">' +
                esc(t.label).padEnd(7) + v.toFixed(1) + '\u00b0C</span>');
        }
    }
    menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
    if (data.fans) {
        for (let f of data.fans) {
            let suffix = f.unit === '%' ? '%' : ' RPM';
            row('<span foreground="#5dade2">' +
                esc(f.label).padEnd(7) + f.value + suffix + '</span>');
        }
    }
}

export default class AIRigTemps extends Extension {
    constructor(metadata) {
        super(metadata);
        this._indicator = null;
        this._barLabel = null;
        this._timerId = null;
        this._lastGoodTs = 0;
    }

    enable() {
        this._install();
    }

    disable() {
        this._uninstall();
    }

    _install() {
        let rightBox = null;
        let panel = Main.panel;
        if (panel) rightBox = panel._rightBox || panel.rightBox || null;
        if (!rightBox) return;

        this._indicator = new PanelMenu.Button(1.0, 'AI-Rig Temps');
        this._indicator.tooltip_text = 'ai-rig temperatures & fans';

        this._barLabel = new St.Label({
            text: '\u2026',
            y_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._indicator.add_child(this._barLabel);

        // first (leftmost) item in the right box => "widget | system icons"
        rightBox.insert_child_at_index(this._indicator.container, 0);

        this._tick();
        this._timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, INTERVAL_MS,
            () => { this._tick(); return true; });
    }

    _uninstall() {
        if (this._timerId !== null) {
            GLib.source_remove(this._timerId);
            this._timerId = null;
        }
        if (this._indicator) {
            try { if (this._indicator.menu) this._indicator.menu.removeAll(); } catch (e) {}
            this._indicator.destroy();
            this._indicator = null;
        }
        this._barLabel = null;
    }

    _setBarText(markup) {
        if (!this._barLabel) return;
        try {
            this._barLabel.clutter_text.set_markup(markup);
        } catch (e) {
            log('ai-rigtemps _setBarText failed: ' + e.message);
        }
    }

    _tick() {
        let data = readData();
        let now = nowEpochMs();
        let fresh = data && (now - (data.ts * 1000)) < STALE_MS;

        if (!fresh) {
            this._setBarText('<span foreground="#e74c3c"><b>ai-rig OFFLINE</b></span>');
            return;
        }

        this._lastGoodTs = now;
        this._setBarText(compactMarkup(data));
        try {
            if (this._indicator && this._indicator.menu)
                rebuildMenu(this._indicator.menu, data);
        } catch (e) {
            log('ai-rigtemps rebuildMenu error: ' + e.message);
        }
    }
}
