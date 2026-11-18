; Stock Wizard installer (Ben, 18 Nov 2026: multi-user, part 2; named Stock Wizard, not Stock Wizard Bot, 19 Nov 2026).
; Built by pc/installer/build.ps1 (on GitHub: .github/workflows/installer.yml) with Inno Setup 6.
;
; Installs for the person only (no administrator rights): its own Python and packages, the
; bot, a Start menu entry, a settings shortcut and (ticked by default) a start when they sign
; in to Windows. While installing it asks for their bot key, TWS or IB Gateway, and whether
; their account has real-time data, and writes them to
; %LOCALAPPDATA%\StockWizard\stockwizard.env, kept outside the install folder so an update
; doesn't lose them. The bot only ever trades a paper account.
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
Name: "{group}\Stock Wizard"; Filename: "{app}\python\pythonw.exe"; Parameters: "-m stockwizard.supervisor --show"; WorkingDir: "{app}"
Name: "{group}\Stock Wizard settings"; Filename: "{app}\python\pythonw.exe"; Parameters: "-m stockwizard.supervisor --open-settings"; WorkingDir: "{app}"
Name: "{group}\Stock Wizard setup guide"; Filename: "https://github.com/benjaminkeithrose-svg/stockwizard/blob/main/docs/SETUP.md"
Name: "{userstartup}\Stock Wizard"; Filename: "{app}\python\pythonw.exe"; Parameters: "-m stockwizard.supervisor"; WorkingDir: "{app}"; Tasks: startup

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

var
  KeyPage: TInputQueryWizardPage;
  ConnPage: TInputOptionWizardPage;
  DataPage: TInputOptionWizardPage;

function SettingsFile: String;
begin
  Result := ExpandConstant('{localappdata}\StockWizard\stockwizard.env');
end;

{ A setting already saved on this PC (an update), or Default. }
function Existing(Name, Default: String): String;
var
  Lines: TArrayOfString;
  I: Integer;
begin
  Result := Default;
  if LoadStringsFromFile(SettingsFile, Lines) then
    for I := 0 to GetArrayLength(Lines) - 1 do
      if Pos(Name + '=', Lines[I]) = 1 then Result := Trim(Copy(Lines[I], Length(Name) + 2, MaxInt));
end;

procedure InitializeWizard;
var
  Port, Delayed: String;
begin
  { On an update, start from the person's own choices; the command line can still override them. }
  Port := ExpandConstant('{param:PORT|' + Existing('IB_PORT', '7497') + '}');
  Delayed := ExpandConstant('{param:DELAYED|' + Existing('IB_DELAYED', '0') + '}');
  KeyPage := CreateInputQueryPage(wpWelcome, 'Your access key',
    'Paste the access key from Stock Wizard.',
    'In the Stock Wizard app, open Menu at the top right, choose Access key, make a key and copy it. ' +
    'Paste it below. Updating and already set up? Leave it empty to keep the key you have.');
  KeyPage.Add('Access key:', False);
  KeyPage.Values[0] := ExpandConstant('{param:BOTKEY|}');

  ConnPage := CreateInputOptionPage(KeyPage.ID, 'Interactive Brokers',
    'Which Interactive Brokers program do you log in to?',
    'Stock Wizard connects to it on this PC. Log in to Paper Trading, and turn on its API (the setup guide shows how).',
    True, False);
  ConnPage.Add('TWS (Trader Workstation): paper port 7497');
  ConnPage.Add('IB Gateway: paper port 4002');
  if Port = '4002' then ConnPage.SelectedValueIndex := 1 else ConnPage.SelectedValueIndex := 0;

  DataPage := CreateInputOptionPage(ConnPage.ID, 'Market data',
    'Does your Interactive Brokers account have real-time US options data?',
    'Without a subscription, Interactive Brokers sends prices about 15 minutes late. Tick the box so Stock Wizard knows; ' +
    'you can change it later in Stock Wizard settings.',
    False, False);
  DataPage.Add('No real-time options data: use delayed prices');
  DataPage.Values[0] := (Delayed = '1') or (LowerCase(Delayed) = 'yes') or (LowerCase(Delayed) = 'true');
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var
  Key: String;
begin
  Result := True;
  if CurPageID = KeyPage.ID then begin
    Key := Trim(KeyPage.Values[0]);
    if (Key = '') and not FileExists(SettingsFile) then begin
      MsgBox('Paste your bot key first. Make one in the Stock Wizard app: menu (three dots), Bot key.', mbError, MB_OK);
      Result := False;
    end else if (Key <> '') and (Copy(Key, 1, 7) <> 'swbot1.') then begin
      MsgBox('That isn''t a Stock Wizard bot key. Copy the whole key from the app''s Bot key screen; it starts with swbot1.', mbError, MB_OK);
      Result := False;
    end;
  end;
end;

{ Write the settings: the three answered here, plus any other lines already there (for example NTFY_TOPIC). }
procedure CurStepChanged(CurStep: TSetupStep);
var
  Old, New: TArrayOfString;
  I, N: Integer;
  Key, Line, OldKey: String;
begin
  if CurStep <> ssPostInstall then Exit;
  Key := Trim(KeyPage.Values[0]);
  OldKey := '';
  N := 0;
  SetArrayLength(New, 0);
  if LoadStringsFromFile(SettingsFile, Old) then
    for I := 0 to GetArrayLength(Old) - 1 do begin
      Line := Old[I];
      if Pos('BOT_KEY=', Line) = 1 then OldKey := Line
      else if (Pos('IB_PORT=', Line) <> 1) and (Pos('IB_DELAYED=', Line) <> 1) and (Trim(Line) <> '') then begin
        SetArrayLength(New, N + 1); New[N] := Line; N := N + 1;
      end;
    end;
  SetArrayLength(New, N + 3);
  if Key <> '' then New[N] := 'BOT_KEY=' + Key else New[N] := OldKey;
  if ConnPage.SelectedValueIndex = 1 then New[N + 1] := 'IB_PORT=4002' else New[N + 1] := 'IB_PORT=7497';
  if DataPage.Values[0] then New[N + 2] := 'IB_DELAYED=1' else New[N + 2] := 'IB_DELAYED=0';
  ForceDirectories(ExtractFileDir(SettingsFile));
  SaveStringsToFile(SettingsFile, New, False);
end;
