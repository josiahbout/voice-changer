# VoicePlay virtual cable

**Status:** VB-CABLE bundling is written but untested. Our own driver is a scaffold only.

Games and chat apps can only pick a *microphone*. To get our converted voice into them,
VoicePlay needs a virtual audio device pair:

```
VoicePlay app ──plays into──▶ "VoicePlay Output" (virtual speaker)
                                     │  driver copies audio across
Discord / game ◀──records from── "VoicePlay Mic" (virtual microphone)
```

Today users install a third-party cable (VB-Cable) for this. The goal is to ship our own
so it's set up by the VoicePlay installer.

## Current plan: bundle VB-CABLE

Until we have our own signed driver, the VoicePlay installer sets up
[VB-CABLE](https://vb-cable.com) (VB-Audio, donationware):

1. `vendor/VBCABLE_Driver_Pack45.zip` is the official pack from vb-cable.com, committed
   unmodified (its licence allows sharing it as-is). To update it, replace it with a newer
   pack and update the file name in `package.json` and `build/installer.nsh`.
2. `npm run dist` puts the zip and `scripts/install-vbcable.ps1` / `uninstall-vbcable.ps1`
   into the installer.
3. On install, `build/installer.nsh` runs `install-vbcable.ps1`. It skips machines that
   already have VB-CABLE, otherwise unzips the pack to `%ProgramData%\VoicePlay\vbcable` and
   runs `VBCABLE_Setup_x64.exe -i -h`. Windows still asks the user to approve the driver,
   and a reboot finishes the install.
4. On uninstall, VB-CABLE is removed only if VoicePlay installed it (tracked in
   `HKLM\Software\VoicePlay\InstalledVBCable`).

The app then plays into **"CABLE Input"** and users pick **"CABLE Output"** as their mic.

**Before shipping:** the licence inside the pack says it may not be integrated into another
installer "without Author agreement". VB-Audio's licensing page allows it for donationware
use with credit, but get their agreement in writing first
([contact](https://vb-audio.com/Services/contact.htm)). Credit them in the installer and
the app: *"Includes VB-CABLE by VB-Audio (www.vb-cable.com). VB-CABLE is donationware, all
participations are welcome."*

Not yet verified: the `-i -h` (install) and `-u -h` (uninstall) switches come from VB-Audio's
forum, not official docs. Test both in a VM.

## Later: our own driver

### Which driver

| Project | License | Speaker → mic loopback | Signed build | Last update |
|---|---|---|---|---|
| [JannesP/AudioMirror](https://github.com/JannesP/AudioMirror) | MIT | **Yes** | No | 2022 |
| [VirtualDrivers/Virtual-Audio-Driver](https://github.com/VirtualDrivers/Virtual-Audio-Driver) | MIT | No (mic plays a test tone, [issue #5](https://github.com/VirtualDrivers/Virtual-Audio-Driver/issues/5)) | Yes | 2026 |
| [syams86/Virtual-Audio-Pipeline](https://github.com/syams86/Virtual-Audio-Pipeline) | GPL-2.0 | Yes | No | 2015 |
| [microsoft/Windows-driver-samples `audio/sysvad`](https://github.com/microsoft/Windows-driver-samples/tree/main/audio/sysvad) | MS-PL | No (placeholder sine tone) | No | Active |

**Chosen: AudioMirror.** It's the only one that already does the loopback, and its MIT
license lets us modify and ship it. Its author describes it as unfinished and only tested on
Windows 10 x64, so expect work to harden it. If Virtual-Audio-Driver gains loopback, it's
worth re-evaluating because it's maintained and already signed.

macOS: [BlackHole](https://github.com/ExistentialAudio/BlackHole) is the standard choice, but
it is GPL-3.0 and needs a paid license for non-GPL apps. Linux needs no driver:
PipeWire/PulseAudio can create a null sink + virtual source at runtime.

### Layout

```
virtual-cable/
  vendor/                     VB-CABLE driver pack zip (official, unmodified) + credit
  driver/                     our own driver source (fetched, see below)
  scripts/
    fetch-driver-source.ps1   downloads AudioMirror at the pinned commit into driver/
    check-cable.ps1           reports whether a cable is installed (safe, read-only)
    install-vbcable.ps1       installs bundled VB-CABLE (run by the installer)
    uninstall-vbcable.ps1     removes it again
    install-cable.ps1         installs our built driver (admin; scaffold)
    uninstall-cable.ps1       removes it (admin; scaffold)
../cable.js                   browser side: finds the cable and routes audio into it
```

### Road to working

1. **Get the source:** run `scripts/fetch-driver-source.ps1`. It pins commit
   `a9618d1ab4114e3e35e8e50ae804a4205315d1f2` and keeps upstream's `LICENSE.md`.
2. **Rebrand:** in `driver/AudioMirror/AudioMirror.inf`, change the `[Strings]` section
   (organization, device and endpoint names) and the hardware ID `Root\AudioMirror` to
   `Root\VoicePlayCable`. Keep `cable.js`'s `CABLE_NAMES` and the scripts' `$HardwareId` in sync.
3. **Build:** Visual Studio 2022 + Windows Driver Kit (WDK). Open `driver/AudioMirror.sln`,
   build Release x64. Test only in a VM with test signing on
   (`bcdedit /set testsigning on`). A kernel driver bug blue-screens the machine.
4. **Sign:** Windows 10/11 only loads drivers signed through Microsoft's attestation
   signing in Partner Center. That needs an EV code-signing certificate (a yearly cost).
   [SignPath Foundation](https://signpath.org) signs some open-source projects for free.
   Without this, users would need test-signing mode, which isn't acceptable to ship.
5. **Ship:** the app has to become a desktop app (e.g. Electron or Tauri) with an installer
   that runs `install-cable.ps1` elevated. A web page can't install drivers.
6. **Route audio:** once installed, `cable.js` sends the converted voice to
   "VoicePlay Output", and users pick "VoicePlay Mic" in their game.
