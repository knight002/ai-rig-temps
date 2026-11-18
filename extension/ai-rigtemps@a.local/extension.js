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

// color by utilization percent (0..100)
function pctColor(p) {
    if (p >= 85) return '#e74c3c';
    if (p >= 65) return '#f39c12';
    return '#7ec699';
}

function usedTotalGib(used, total) {
    if (used == null || total == null) return null;
    let u = used.toFixed(1);
    let t = Math.round(total).toString();
    return u + '/' + t + 'G';
}

// Build the bar as a list of {text,color} segments (CPU group | GPU group).
// Colors are applied via per-label CSS `style`, which is the reliable way to
// color text on GNOME Shell (Pango span markup on St.Label is unreliable).
function barSegments(data) {
    let pick = {};
    if (data.temps) {
        for (let t of data.temps) {
            let v = parseFloat(t.value);
            if (!isNaN(v)) pick[t.label] = v;
        }
    }
    let cpu = [];
    let gpu = [];

    // CPU group: busy %, temp, VRM, system RAM
    if (typeof data.cpu_percent === 'number')
        cpu.push({ text: 'CPU ' + data.cpu_percent.toFixed(0) + '%', color: pctColor(data.cpu_percent) });
    if (pick.CPU !== undefined)
        cpu.push({ text: pick.CPU.toFixed(0) + '\u00b0', color: tempColor(pick.CPU) });
    if (pick.VRM_E !== undefined || pick.VRM_W !== undefined) {
        let vrm = Math.max(pick.VRM_E ?? 0, pick.VRM_W ?? 0);
        cpu.push({ text: 'VRM ' + vrm.toFixed(0) + '\u00b0', color: tempColor(vrm) });
    }
    let ram = usedTotalGib(data.ram_used_gib, data.ram_total_gib);
    if (ram) {
        let p = data.ram_total_gib ? 100 * data.ram_used_gib / data.ram_total_gib : 0;
        cpu.push({ text: 'RAM ' + ram, color: pctColor(p) });
    }

    // GPU group: busy %, temp, VRAM
    if (typeof data.gpu_percent === 'number')
        gpu.push({ text: 'GPU ' + data.gpu_percent.toFixed(0) + '%', color: pctColor(data.gpu_percent) });
    if (pick.GPU !== undefined)
        gpu.push({ text: pick.GPU.toFixed(0) + '\u00b0', color: tempColor(pick.GPU) });
    let vram = usedTotalGib(data.vram_used_gib, data.vram_total_gib);
    if (vram) {
        let p = data.vram_total_gib ? 100 * data.vram_used_gib / data.vram_total_gib : 0;
        gpu.push({ text: 'VRAM ' + vram, color: pctColor(p) });
    }

    let groups = [];
    if (cpu.length) groups.push(cpu);
    if (gpu.length) groups.push(gpu);
    if (!groups.length) return [{ text: 'ai-rig', color: '#888888' }];

    let segs = [];
    for (let gi = 0; gi < groups.length; gi++) {
        if (gi > 0) segs.push({ text: ' | ', color: '#666666' });
        for (let seg of groups[gi]) segs.push({ text: seg.text + ' ', color: seg.color });
    }
    return segs;
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
    // usage block first
    let usage = [];
    if (typeof data.cpu_percent === 'number')
        usage.push('<span foreground="' + pctColor(data.cpu_percent) + '">' +
                   'CPU      ' + data.cpu_percent.toFixed(1) + '%</span>');
    if (typeof data.gpu_percent === 'number')
        usage.push('<span foreground="' + pctColor(data.gpu_percent) + '">' +
                   'GPU      ' + data.gpu_percent.toFixed(1) + '%</span>');
    let ram = usedTotalGib(data.ram_used_gib, data.ram_total_gib);
    if (ram)
        usage.push('<span foreground="' +
                   (data.ram_total_gib ? pctColor(100 * data.ram_used_gib / data.ram_total_gib) : '#5dade2') +
                   '">RAM      ' + ram + '</span>');
    let vram = usedTotalGib(data.vram_used_gib, data.vram_total_gib);
    if (vram)
        usage.push('<span foreground="' +
                   (data.vram_total_gib ? pctColor(100 * data.vram_used_gib / data.vram_total_gib) : '#5dade2') +
                   '">VRAM     ' + vram + '</span>');
    if (usage.length) {
        for (let u of usage) row(u);
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
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
        this._barBox = null;
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

        this._barBox = new St.BoxLayout({
            // HORIZONTAL is the St.BoxLayout default (St.Orientation is
            // unavailable in this GNOME build).
            y_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style: 'padding: 0 2px;',
        });
        this._indicator.add_child(this._barBox);

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
        this._barBox = null;
    }

    // Rebuild the bar from a list of {text,color} segments, each its own
    // St.Label colored via CSS `style`.
    _setBar(segs) {
        if (!this._barBox) return;
        try {
            if (this._barBox.destroy_all_children)
                this._barBox.destroy_all_children();
            let add = (c) => {
                if (this._barBox.add) this._barBox.add(c);
                else this._barBox.add_child(c);
            };
            for (let seg of segs) {
                let lbl = new St.Label({
                    text: seg.text,
                    y_align: Clutter.ActorAlign.CENTER,
                });
                lbl.style = 'color: ' + seg.color + ';';
                add(lbl);
            }
        } catch (e) {
            log('ai-rigtemps _setBar failed: ' + e.message);
        }
    }

    _tick() {
        let data = readData();
        let now = nowEpochMs();
        let fresh = data && (now - (data.ts * 1000)) < STALE_MS;

        if (!fresh) {
            this._setBar([{ text: 'ai-rig OFFLINE', color: '#e74c3c' }]);
            return;
        }

        this._lastGoodTs = now;
        this._setBar(barSegments(data));
        try {
            if (this._indicator && this._indicator.menu)
                rebuildMenu(this._indicator.menu, data);
        } catch (e) {
            log('ai-rigtemps rebuildMenu error: ' + e.message);
        }
    }
}
