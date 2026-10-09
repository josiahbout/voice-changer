; Extra steps for the VoicePlay Windows installer (electron-builder NSIS).
; Installs the bundled VB-CABLE if the user doesn't already have it, and on uninstall
; removes it only if VoicePlay was the one that installed it.
;
; Before shipping: VB-CABLE's licence requires VB-Audio's agreement to bundle it.
; See virtual-cable/README.md.

!include LogicLib.nsh

!macro customInstall
  DetailPrint "Setting up VB-CABLE virtual audio cable..."
  nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\vbcable\install-vbcable.ps1" -ZipPath "$INSTDIR\resources\vbcable\VBCABLE_Driver_Pack45.zip"'
  Pop $0
  ${If} $0 == "0"
    SetRegView 64
    WriteRegStr HKLM "Software\VoicePlay" "InstalledVBCable" "1"
    SetRegView lastused
    SetRebootFlag true
  ${ElseIf} $0 == "10"
    DetailPrint "VB-CABLE is already installed; leaving it as is."
  ${Else}
    MessageBox MB_ICONEXCLAMATION|MB_OK "VB-CABLE couldn't be installed (code $0).$\r$\nVoicePlay will still run. You can install VB-CABLE yourself from www.vb-cable.com."
  ${EndIf}
!macroend

!macro customUnInstall
  SetRegView 64
  ReadRegStr $0 HKLM "Software\VoicePlay" "InstalledVBCable"
  ${If} $0 == "1"
    ExpandEnvStrings $1 "%ProgramData%"
    DetailPrint "Removing VB-CABLE..."
    nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$1\VoicePlay\vbcable\uninstall-vbcable.ps1"'
    Pop $2
    DeleteRegKey HKLM "Software\VoicePlay"
    SetRebootFlag true
  ${EndIf}
  SetRegView lastused
!macroend
