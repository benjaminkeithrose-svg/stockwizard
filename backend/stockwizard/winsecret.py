"""Secrets kept encrypted with Windows' own protection (Ben, 18 Nov 2026: one installed program, stage 3).

Windows' data protection (DPAPI) encrypts with a key tied to the Windows user: only
the same person, signed in to the same PC, can read it back. Used for the Supabase
secret key on Ben's PC, which the settings file then holds as
SUPABASE_SECRET_KEY_PROTECTED instead of plain text. No extra library: Windows'
crypt32 through ctypes.
"""

from __future__ import annotations

import base64
import ctypes
import sys
from ctypes import wintypes

PREFIX = "dpapi1."


class _Blob(ctypes.Structure):
    _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_char))]


def _blob(data: bytes) -> _Blob:
    buf = ctypes.create_string_buffer(data, len(data))
    return _Blob(len(data), ctypes.cast(buf, ctypes.POINTER(ctypes.c_char)))


def _run(fn, data: bytes) -> bytes:
    if sys.platform != "win32":
        raise OSError("Windows' data protection is only on Windows")
    out = _Blob()
    ok = fn(ctypes.byref(_blob(data)), None, None, None, None, 0x1, ctypes.byref(out))   # 0x1: no prompts
    if not ok:
        raise OSError("Windows couldn't protect or unprotect that: it can only be read by the same Windows user, on the same PC")
    try:
        return ctypes.string_at(out.pbData, out.cbData)
    finally:
        ctypes.windll.kernel32.LocalFree(out.pbData)


def protect(text: str) -> str:
    """The text encrypted for this Windows user, as one line of text."""
    return PREFIX + base64.b64encode(_run(ctypes.windll.crypt32.CryptProtectData, text.encode("utf-8"))).decode("ascii")


def unprotect(token: str) -> str:
    if not token.startswith(PREFIX):
        raise ValueError("Not a protected value")
    return _run(ctypes.windll.crypt32.CryptUnprotectData, base64.b64decode(token[len(PREFIX):])).decode("utf-8")
