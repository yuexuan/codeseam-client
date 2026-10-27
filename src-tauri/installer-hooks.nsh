!macro NSIS_HOOK_PREUNINSTALL
  ExecWait '"$INSTDIR\z-switch.exe" --codeseam-uninstall' $0
  ${If} $0 != 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "CodeSeam could not safely restore Claude settings. Close Claude, restore the original configuration in CodeSeam Settings, then uninstall again. Your encrypted backup has been preserved." /SD IDOK
    Abort
  ${EndIf}
!macroend
