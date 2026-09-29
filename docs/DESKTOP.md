# The desktop app (beta)

> **Beta, for macOS and Windows. Linux: coming soon.** The web version can do
> everything Aeryx can do on your platform; the app is an optional layer on top. It isn't
> code-signed yet (the release checksums are signed), and Windows has had less
> real-machine testing than macOS. Use **Report a bug…** or **Send feedback…**
> in the tray menu; both are one click.

The desktop app is a native window and tray around the same local Aeryx the
web version runs. It does not add abilities to Aeryx — everything he can do
lives in the daemon, and the browser gets all of it. What the app adds:

| | macOS | Windows | Linux |
|---|---|---|---|
| Own window, dock/taskbar icon | ✓ | ✓ | soon |
| Tray / menu-bar icon; closing the window keeps Aeryx running | ✓ | ✓ | soon |
| **Floating orb** that stays on top when the window is closed or minimised | ✓ | ✓ | soon |
| Closed window leaves only the orb and the menu-bar icon (no Dock icon) | ✓ | | |
| **Ctrl+Shift+Space** shows or hides Aeryx from anywhere (changeable) | ✓ | ✓ | soon |
| **Quick ask**: double-click the orb, type, Enter | ✓ | ✓ | soon |
| Notifications when an approval waits or a long task finishes | ✓ | ✓ | soon |
| **F8** push-to-talk (needs the one-time voice setup in the main README, under "What runs where") | | ✓ | |
| Ambient HUD and wallpaper mode | | ✓ | |

The orb shows what Aeryx is doing: it dims when he is offline, stirs while he works, opens its eye when he listens, and closes its clamps with an amber count when the Chain is waiting for your answer. Hover to make it glow. Click it to open Aeryx, double-click it for a quick-ask box, drag it anywhere (it remembers the spot), and right-click for a menu. **Floating orb** in the tray menu, or **Hide the orb** in its own menu, turns it off. The orb only displays; approvals always happen in the Lair.

Notifications appear only while Aeryx's window isn't in front: when the Chain
needs your OK, and when something you asked for took a while and is done. The
approval notice names only the risk class and lane; the full request is in the
Lair. Turn them off with
**Notifications** in the tray menu. To change the shortcut, set for example
`summon=Alt+Shift+A` in `desktop.txt` in Aeryx's config folder
(`~/Library/Application Support/dev.aeryx.desktop` on macOS,
`%APPDATA%\dev.aeryx.desktop` on Windows) and restart the app. If a shortcut is
already taken, the app tells you.

The app loads the same Lair page a browser gets, with no private channel to
the daemon: every action still goes through the Chain.

## Install

The one-line installer can add the app. It checks the download against the
release's `SHA256SUMS` before installing anything.

**macOS** — installs `~/Applications/Aeryx.app`:

```bash
curl -fsSL https://dracoder.github.io/aery-ai/install.sh | sh -s -- --app
```

**Windows** (PowerShell) — installs to `%LOCALAPPDATA%\Aeryx`, Start menu entry
**Aeryx**:

```powershell
$env:AERYX_APP=1; irm https://dracoder.github.io/aery-ai/install.ps1 | iex
```

Already running the web version? Run the same command; it updates Aeryx and
adds the app, keeping your data.

## Direct download, and the unsigned-app warning

The app is also on the [Releases page](https://github.com/dracoder/aery-ai/releases)
as `Aeryx-macos-universal.dmg` and `Aeryx-windows-x64-setup.exe`. It is not
code-signed yet, so a browser download gets a warning the first time:

- **macOS:** "Apple could not verify Aeryx…". Open it once, then go to
  **System Settings → Privacy & Security** and choose **Open Anyway**.
- **Windows:** "Windows protected your PC". Choose **More info → Run anyway**.

The installer route above does not show these warnings. A downloaded file is
flagged only when a browser saves it, and the installer downloads with
`curl` / PowerShell instead. Either way you can check a file yourself against
`SHA256SUMS`:

```bash
shasum -a 256 Aeryx-macos-universal.dmg
```

```powershell
Get-FileHash Aeryx-windows-x64-setup.exe
```

On first launch from a direct download, the app sets up Aeryx itself. It
downloads Aeryx's source from the signed release and Node (both verified)
and builds Aeryx on your machine, which takes a few minutes and needs an
internet connection once.

## Feedback and bug reports

The beta is here to learn from you.

- **Send feedback…** (tray menu, the orb's menu, the Lair footer, or
  `aeryx feedback`) opens an idea thread on GitHub Discussions: what you
  liked, what felt off, what's missing.

## Report a bug

**Report a bug…** is in the tray menu and in the orb's right-click menu. From a
terminal, run `aeryx report`. Either one writes `aeryx-report-<time>.txt` to your
home folder, with keys, paths and your user name masked, and opens a bug form
on GitHub with the version and OS filled in. Read the file, then drop it into
the form.

## Remove it

`aeryx uninstall` removes Aeryx and the app. On Windows you can also use
**Settings → Apps**, which removes only the app and keeps Aeryx.

## Status

Beta. The macOS app is built and tested on Apple Silicon. The Windows app is
built by CI and has had less real-machine testing — please
[report problems](https://github.com/dracoder/aery-ai/issues).
