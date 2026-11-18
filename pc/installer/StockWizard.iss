; Stock Wizard installer (Ben, 18 Nov 2026: multi-user, part 2; named Stock Wizard, not Stock Wizard Bot, 19 Nov 2026).
; Built by pc/installer/build.ps1 (on GitHub: .github/workflows/installer.yml) with Inno Setup 6.
;
; Installs for the person only (no administrator rights): its own Python and packages, the
; bot, a Start menu entry, a settings shortcut and (ticked by default) a start when they sign
; in to Windows. It asks nothing it can know (19 Nov 2026): settings start with TWS's paper
; port in %LOCALAPPDATA%\StockWizard\stockwizard.env (kept outside the install folder so an
; update doesn't lose them), and Setup inside Stock Wizard adds the access key and the rest.
; It only ever trades a paper account.
;
; Silent install (for testing): /VERYSILENT /BOTKEY=swbot1.... /PORT=4002 /DELAYED=1

#define AppName "Stock Wizard"
#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef SourceDir
  #define SourceDir "build"
#endif

[Setup]
AppId={{8F2C1E3A-5B7D-4C2E-9A1F-3D6B7E8C9A01}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=Stock Wizard
AppPublisherURL=https://github.com/benjaminkeithrose-svg/stockwizard
; An existing install stays in its folder (Programs\Stock Wizard Bot): same AppId, previous folder kept.
DefaultDirName={localappdata}\Programs\Stock Wizard
DefaultGroupName=Stock Wizard
UsePreviousGroup=no
DisableProgramGroupPage=yes
DisableDirPage=yes
PrivilegesRequired=lowest
OutputDir=..\..\dist
OutputBaseFilename=StockWizardSetup
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
UninstallDisplayName={#AppName}
SetupIconFile={#SourceDir}\stockwizard.ico
UninstallDisplayIcon={app}\stockwizard.ico
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=no

[Tasks]
Name: startup; Description: "Start Stock Wizard when I sign in to Windows (trading runs behind its icon by the clock)"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[InstallDelete]
; Shortcuts from before the app had its own window (stage 1 and earlier).
Type: files; Name: "{group}\Stock Wizard Bot.lnk"
Type: files; Name: "{group}\Stock Wizard Bot settings.lnk"
Type: files; Name: "{group}\Stock Wizard (the app).url"
Type: files; Name: "{userstartup}\Stock Wizard Bot.lnk"
; The Start menu folder was "Stock Wizard Bot" until 19 Nov 2026.
Type: filesandordirs; Name: "{userprograms}\Stock Wizard Bot"

[Icons]
Name: "{group}\Stock Wizard"; Filename: "{app}\python\pythonw.exe"; Parameters: "-m stockwizard.supervisor --show"; WorkingDir: "{app}"; IconFilename: "{app}\stockwizard.ico"; AppUserModelID: "StockWizard.App"
Name: "{group}\Stock Wizard settings"; Filename: "{app}\python\pythonw.exe"; Parameters: "-m stockwizard.supervisor --open-settings"; WorkingDir: "{app}"; IconFilename: "{app}\stockwizard.ico"
Name: "{group}\Stock Wizard setup guide"; Filename: "https://github.com/benjaminkeithrose-svg/stockwizard/blob/main/docs/SETUP.md"
Name: "{userstartup}\Stock Wizard"; Filename: "{app}\python\pythonw.exe"; Parameters: "-m stockwizard.supervisor"; WorkingDir: "{app}"; IconFilename: "{app}\stockwizard.ico"; AppUserModelID: "StockWizard.App"; Tasks: startup

[Run]
Filename: "{app}\python\pythonw.exe"; Parameters: "-m stockwizard.supervisor --show"; WorkingDir: "{app}"; Description: "Open Stock Wizard now"; Flags: postinstall nowait skipifsilent
; An update started from inside Stock Wizard (stage 4, /RESTART=1): open it again when done.
Filename: "{app}\python\pythonw.exe"; Parameters: "-m stockwizard.supervisor"; WorkingDir: "{app}"; Flags: nowait; Check: Reopen

[Code]
function Reopen: Boolean;
begin
  Result := ExpandConstant('{param:RESTART|0}') = '1';
end;

{ Updating: stop a running Stock Wizard (it keeps its files open) before replacing them. }
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Code: Integer;
begin
  Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
    '-NoProfile -Command "Get-Process | Where-Object { $_.Path -like ''' + ExpandConstant('{app}') + '\*'' } | Stop-Process -Force"',
    '', SW_HIDE, ewWaitUntilTerminated, Code);
  Result := '';
end;

function SettingsFile: String;
begin
  Result := ExpandConstant('{localappdata}\StockWizard\stockwizard.env');
end;

{ The installer asks nothing (Ben, 19 Nov 2026): a fresh install starts with TWS's paper port and
  real-time prices, and Setup inside Stock Wizard (Menu, Setup) adds the access key and the rest.
  An update keeps the settings already on this PC. For testing, /BOTKEY=, /PORT= and /DELAYED=
  on the command line still set those lines. }
procedure CurStepChanged(CurStep: TSetupStep);
var
  Old, New: TArrayOfString;
  I, N: Integer;
  Key, Port, Delayed, Line: String;
begin
  if CurStep <> ssPostInstall then Exit;
  Key := Trim(ExpandConstant('{param:BOTKEY|}'));
  Port := Trim(ExpandConstant('{param:PORT|}'));
  Delayed := Trim(ExpandConstant('{param:DELAYED|}'));
  if FileExists(SettingsFile) and (Key = '') and (Port = '') and (Delayed = '') then Exit;
  if not FileExists(SettingsFile) then begin
    if Port = '' then Port := '7497';
    if Delayed = '' then Delayed := '0';
  end;
  N := 0;
  SetArrayLength(New, 0);
  if LoadStringsFromFile(SettingsFile, Old) then
    for I := 0 to GetArrayLength(Old) - 1 do begin
      Line := Old[I];
      if (Trim(Line) <> '') and not ((Key <> '') and (Pos('BOT_KEY=', Line) = 1))
         and not ((Port <> '') and (Pos('IB_PORT=', Line) = 1)) and not ((Delayed <> '') and (Pos('IB_DELAYED=', Line) = 1)) then begin
        SetArrayLength(New, N + 1); New[N] := Line; N := N + 1;
      end;
    end;
  if Key <> '' then begin SetArrayLength(New, N + 1); New[N] := 'BOT_KEY=' + Key; N := N + 1; end;
  if Port <> '' then begin SetArrayLength(New, N + 1); New[N] := 'IB_PORT=' + Port; N := N + 1; end;
  if Delayed <> '' then begin SetArrayLength(New, N + 1); New[N] := 'IB_DELAYED=' + Delayed; N := N + 1; end;
  ForceDirectories(ExtractFileDir(SettingsFile));
  SaveStringsToFile(SettingsFile, New, False);
end;
