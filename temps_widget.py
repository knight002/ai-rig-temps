#!/usr/bin/env python3
"""Desktop widget showing ai-rig temps/fans.

Polls the remote JSON endpoint (temps_server.py on ai-rig) every N
seconds and renders a compact always-on-top bar docked to the top or
bottom of the monitor. Keeps the last good reading on transient
failures; shows a red OFFLINE tag after 5 s without a response.

Usage:
    temps_widget.py [--position top|bottom] [--host H] [--port P]
                    [--interval SECONDS]
"""

import argparse
import json
import subprocess
import time
import urllib.request

import gi

gi.require_version("Gdk", "3.0")
gi.require_version("Gtk", "3.0")
from gi.repository import Gdk, GLib, Gtk


def fetch(host, port, timeout=2.5):
    url = f"http://{host}:{port}/temps"
    with urllib.request.urlopen(url, timeout=timeout) as resp:
        return json.loads(resp.read().decode())


def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def temp_color(value):
    if value >= 80:
        return "#e74c3c"
    if value >= 65:
        return "#f39c12"
    return "#7ec699"


def build_markup(data, offline):
    bits = []
    if offline:
        bits.append('<span foreground="#e74c3c"><b>OFFLINE</b></span>')
    for item in data.get("temps", []):
        try:
            val = float(item["value"])
            bits.append(
                '<span foreground="%s">%.0f°</span> <span foreground="#888">%s</span>'
                % (temp_color(val), val, esc(item["label"]))
            )
        except (ValueError, KeyError):
            continue
    for item in data.get("fans", []):
        try:
            val = int(item["value"])
        except (ValueError, KeyError):
            continue
        suffix = "%" if item.get("unit") == "%" else ""
        bits.append(
            '<span foreground="#5dade2">%d%s</span> <span foreground="#888">%s</span>'
            % (val, suffix, esc(item["label"]))
        )
    if not bits:
        bits.append('<span foreground="#888">no data</span>')
    return "   ".join(bits)


class TempsWidget:
    HEIGHT = 40
    BOX_WIDTH = 770
    top_offset = 44  # clear the top bar, sit just below it

    def __init__(self, position, host, port, interval):
        self.position = position
        self.url_host = host
        self.url_port = port
        self.interval = interval
        self.last_good = None
        self.last_good_ts = 0.0
        self.online = True

        self.window = Gtk.Window()
        self.window.set_title("ai-rig temps")
        self.window.set_decorated(False)
        self.window.set_skip_taskbar_hint(True)
        self.window.set_skip_pager_hint(True)
        self.window.set_keep_above(True)
        self.window.set_app_paintable(True)
        self.window.set_resizable(True)

        self.label = Gtk.Label()
        self.label.set_hexpand(True)
        self.label.set_vexpand(True)
        self.label.set_halign(Gtk.Align.END)
        self.label.set_valign(Gtk.Align.CENTER)
        self.label.set_justify(Gtk.Justification.RIGHT)
        self.label.set_xalign(1.0)
        self.window.add(self.label)

        provider = Gtk.CssProvider()
        provider.load_from_data(
            b"""
            window {
                background: rgba(18, 18, 22, 0.94);
            }
            label {
                font-family: monospace;
                font-size: 13px;
                color: #ddd;
                padding: 4px 16px;
            }
            """
        )
        screen = Gdk.Screen.get_default()
        Gtk.StyleContext.add_provider_for_screen(
            screen, provider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION
        )

        self.label.set_markup("<span foreground='#888'>connecting…</span>")
        GLib.timeout_add(int(interval * 1000), self.poll)
        self.poll()

    def poll(self):
        def update():
            now = time.time()
            try:
                data = fetch(self.url_host, self.url_port)
                self.last_good = data
                self.last_good_ts = now
                self.online = True
            except Exception:
                self.online = False
            offline = not self.online and (
                self.last_good is None or now - self.last_good_ts > 5
            )
            data = self.last_good or {"temps": [], "fans": []}
            self.label.set_markup(build_markup(data, offline))
            return False

        GLib.idle_add(update)
        return True

    def _monitor_geom(self):
        """Primary monitor geometry from xrandr (laptop screen), with fallback."""
        x = y = 0
        width = 1920
        height = 1080
        try:
            out = subprocess.run(
                ["xrandr", "--current"], capture_output=True, text=True, timeout=3
            ).stdout
            for line in out.splitlines():
                if "primary" in line and " connected" in line:
                    import re
                    m = re.match(
                        r"\S+ connected primary (\d+)x(\d+)\+(\d+)\+(\d+)", line
                    )
                    if m:
                        width, height = int(m.group(1)), int(m.group(2))
                        x, y = int(m.group(3)), int(m.group(4))
                        break
        except Exception:
            pass
        return x, y, width, height

    def place_with_xdotool(self):
        x, y, width, height = self._monitor_geom()
        # compact box anchored to the top-right corner, just below the top bar
        margin = 10
        bw, bh = self.BOX_WIDTH, self.HEIGHT
        tx = x + width - bw - margin
        ty = y + self.top_offset
        try:
            out = subprocess.run(
                ["xdotool", "search", "--name", "^ai-rig temps$"],
                capture_output=True, text=True, timeout=3,
            ).stdout.split()
            if out:
                wid = out[-1]
                subprocess.run(
                    ["xdotool", "windowsize", wid, str(bw), str(bh)], timeout=3
                )
                subprocess.run(
                    ["xdotool", "windowmove", wid, str(tx), str(ty)], timeout=3
                )
        except Exception:
            pass
        return False

    def run(self):
        self.window.show_all()
        for delay in (300, 1200):
            GLib.timeout_add(delay, self.place_with_xdotool)
        Gtk.main()


def main():
    parser = argparse.ArgumentParser(description="ai-rig temps widget")
    parser.add_argument(
        "--position",
        choices=["top", "bottom"],
        default="bottom",
        help="screen edge to dock to (default: bottom)",
    )
    parser.add_argument("--host", default="192.168.0.74", help="ai-rig host")
    parser.add_argument("--port", type=int, default=8788, help="server port")
    parser.add_argument(
        "--interval", type=float, default=2.0, help="refresh interval seconds"
    )
    args = parser.parse_args()

    TempsWidget(args.position, args.host, args.port, args.interval).run()


if __name__ == "__main__":
    main()
