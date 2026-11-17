import GLib from 'gi://GLib'
import St from 'gi://St'
import Clutter from 'gi://Clutter'

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js'
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js'
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js'

const HOST = '192.168.0.74';
const PORT = 8788;
const INTERVAL_MS = 2000;

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

function fetchTemps() {
    try {
        let cmd = 'curl -s --max-time 3 http://' + HOST + ':' + PORT + '/temps';
        let result = GLib.spawn_command_line_sync(cmd);
        if (result[0] && result[3] === 0) {
            let text = new TextDecoder().decode(new Uint8Array(result[1]));
            return JSON.parse(text);
        }
    } catch (e) {
        return null;
    }
    return null;
}

function rebuildMenu(menu, data) {
    menu.removeAll();
    function row(markup) {
        let item = new PopupMenu.PopupMenuItem('');
        item.label.x_align = Clutter.ActorAlign.START;
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

        // insert as the first (leftmost) item in the right box
        // => "widget | system icons"
        rightBox.insert_child_at_index(this._indicator.container, 0);

        this._tick();
        this._timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, INTERVAL_MS, () => { this._tick(); return true; });
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
            if (this._barLabel.clutter_text)
                this._barLabel.clutter_text.set_markup(markup);
            else if (this._barLabel.get_clutter_text)
                this._barLabel.get_clutter_text().set_markup(markup);
            else
                this._barLabel.set_text(markup.replace(/<[^>]*>/g, ''));
        } catch (e) {
            log('ai-rigtemps _setBarText failed: ' + e.message);
        }
    }

    _tick() {
        let data = null;
        try {
            data = fetchTemps();
        } catch (e) {
            log('ai-rigtemps fetchTemps error: ' + e.message);
        }
        if (!data) {
            this._setBarText('<span foreground="#e74c3c"><b>ai-rig OFFLINE</b></span>');
            return;
        }
        this._setBarText(compactMarkup(data));
        try {
            if (this._indicator && this._indicator.menu)
                rebuildMenu(this._indicator.menu, data);
        } catch (e) {
            log('ai-rigtemps rebuildMenu error: ' + e.message);
        }
    }
}
