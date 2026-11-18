"""Stock Wizard's own icon on Windows (Ben, 19 Nov 2026): the Start menu, the taskbar, the installer.

The same icon as the phone's (web/public/icon-512.png: candles on navy), as Ben asked.
Without this, Windows shows Python's icon, since the program runs on its bundled Python.

- `draw(colour, size)`: the small S in a circle by the clock, in its state colour.
- `write_ico(path, source)`: the .ico file the installer and the shortcuts use, made from the
  phone's icon (build.ps1 writes it).
- `claim_taskbar()`: an app id of our own, so the taskbar groups Stock Wizard's windows under
  its shortcut's icon rather than under Python's.
- `set_window_icons(path)`: puts the icon on this program's open windows (title bar and taskbar
  button), which pywebview can't do on Windows by itself.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

NAVY = "#00287B"
APP_ID = "StockWizard.App"
SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256]


def draw(colour: str = NAVY, size: int = 64):
    """A filled circle with a white rim and a bold white S, readable at 16 pixels."""
    from PIL import Image, ImageDraw, ImageFont  # noqa: PLC0415
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.ellipse((1, 1, size - 2, size - 2), fill=colour, outline="white", width=max(2, size // 22))
    font = None
    for name in ("segoeuib.ttf", "arialbd.ttf", "DejaVuSans-Bold.ttf"):   # bold faces; a plain default elsewhere
        try:
            font = ImageFont.truetype(name, int(size * 0.72))
            break
        except OSError:
            continue
    font = font or ImageFont.load_default(size=int(size * 0.72))
    x0, y0, x1, y1 = d.textbbox((0, 0), "S", font=font)
    d.text(((size - (x1 - x0)) / 2 - x0, (size - (y1 - y0)) / 2 - y0), "S", fill="white", font=font)
    return img


#: The phone's icon, in the repository (a development run; the installed program has its .ico already).
PHONE_ICON = Path(__file__).resolve().parents[2] / "web" / "public" / "icon-512.png"


def write_ico(path: Path | str, source: Path | str = PHONE_ICON) -> Path:
    """The phone's icon at every size Windows asks for, each scaled down smoothly from the 512-pixel picture."""
    from PIL import Image  # noqa: PLC0415
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    src = Image.open(source).convert("RGBA")
    sized = [src.resize((s, s), Image.LANCZOS) for s in SIZES]
    sized[-1].save(path, format="ICO", sizes=[(s, s) for s in SIZES], append_images=sized[:-1])
    return path


def icon_path() -> Path:
    """The installed icon ({app}\\stockwizard.ico, beside the app folder), or one made now beside the settings."""
    here = Path(__file__).resolve().parents[2] / "stockwizard.ico"
    if here.exists():
        return here
    made = Path(os.environ.get("LOCALAPPDATA") or Path.home()) / "StockWizard" / "stockwizard.ico"
    return made if made.exists() or not PHONE_ICON.exists() else write_ico(made)


def claim_taskbar() -> None:
    if sys.platform == "win32":
        try:
            import ctypes  # noqa: PLC0415
            ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID(APP_ID)
        except Exception:  # noqa: BLE001 - only how the taskbar groups the windows
            pass


def set_window_icons(path: Path | str, title_prefix: str = "Stock Wizard") -> int:
    """The icon on each of this program's visible windows whose title starts with `title_prefix`; returns how many."""
    if sys.platform != "win32":
        return 0
    import ctypes  # noqa: PLC0415
    from ctypes import wintypes  # noqa: PLC0415
    user32 = ctypes.windll.user32
    user32.LoadImageW.restype = wintypes.HANDLE
    big = user32.LoadImageW(None, str(path), 1, 32, 32, 0x10)     # IMAGE_ICON, LR_LOADFROMFILE
    small = user32.LoadImageW(None, str(path), 1, 16, 16, 0x10)
    me, done = os.getpid(), []

    @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    def each(hwnd, _):
        pid = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        if pid.value == me and user32.IsWindowVisible(hwnd):
            buf = ctypes.create_unicode_buffer(256)
            user32.GetWindowTextW(hwnd, buf, 256)
            if buf.value.startswith(title_prefix):
                user32.SendMessageW(hwnd, 0x80, 1, big)    # WM_SETICON, ICON_BIG
                user32.SendMessageW(hwnd, 0x80, 0, small)  # ICON_SMALL
                done.append(hwnd)
        return True

    user32.EnumWindows(each, 0)
    return len(done)


if __name__ == "__main__":   # build.ps1: python -m stockwizard.appicon OUT.ico web\public\icon-512.png
    print(write_ico(sys.argv[1] if len(sys.argv) > 1 else "stockwizard.ico", *sys.argv[2:3]))
