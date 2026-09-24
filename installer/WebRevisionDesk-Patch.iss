#define MyAppName "Web Revision Desk"
#define MyAppVersion GetEnv("WEB_REVISION_DESK_VERSION")
#define MyMinimumVersion GetEnv("WEB_REVISION_DESK_MINIMUM_PATCH_VERSION")
#define MyAppPublisher "MZ-Gen-Labs"
#define MyAppExeName "WebRevisionDesk.exe"

[Setup]
AppId={{0D4F9CE2-C8DB-4A38-95A4-AEA5C81D22D1}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={localappdata}\Programs\WebRevisionDesk
UsePreviousAppDir=yes
DisableDirPage=yes
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
OutputDir=..\release-electron
OutputBaseFilename=WebRevisionDesk-{#MyAppVersion}-Patch-from-{#MyMinimumVersion}+-Setup
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayName={#MyAppName}
CloseApplications=force

[Files]
Source: "..\release-electron\WebRevisionDesk\resources\app\*"; DestDir: "{app}\resources\app"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "デスクトップにショートカットを作成"; Flags: unchecked

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{#MyAppName} を起動"; Flags: nowait postinstall skipifsilent

[Code]
function ParseVersion(Version: String; var Major, Minor, Patch: Integer): Boolean;
var
  I: Integer;
  PartIndex: Integer;
  PartText: String;
  PartValue: Integer;
begin
  Result := False;
  PartIndex := 0;
  PartText := '';
  Major := 0;
  Minor := 0;
  Patch := 0;
  for I := 1 to Length(Version) do begin
    if Version[I] = '.' then begin
      if (PartText = '') or (PartIndex > 2) then Exit;
      PartValue := StrToIntDef(PartText, -1);
      if PartValue < 0 then Exit;
      case PartIndex of
        0: Major := PartValue;
        1: Minor := PartValue;
        2: Patch := PartValue;
      end;
      PartText := '';
      PartIndex := PartIndex + 1;
    end else begin
      if (Version[I] < '0') or (Version[I] > '9') then Exit;
      PartText := PartText + Version[I];
    end;
  end;
  if (PartText = '') or (PartIndex > 2) then Exit;
  PartValue := StrToIntDef(PartText, -1);
  if PartValue < 0 then Exit;
  case PartIndex of
    0: Major := PartValue;
    1: Minor := PartValue;
    2: Patch := PartValue;
  end;
  PartIndex := PartIndex + 1;
  Result := PartIndex = 3;
end;

function CompareVersions(LeftVersion, RightVersion: String): Integer;
var
  LeftMajor, LeftMinor, LeftPatch: Integer;
  RightMajor, RightMinor, RightPatch: Integer;
begin
  Result := -1;
  if not ParseVersion(LeftVersion, LeftMajor, LeftMinor, LeftPatch) then Exit;
  if not ParseVersion(RightVersion, RightMajor, RightMinor, RightPatch) then Exit;
  if LeftMajor <> RightMajor then begin
    if LeftMajor > RightMajor then Result := 1 else Result := -1;
  end else if LeftMinor <> RightMinor then begin
    if LeftMinor > RightMinor then Result := 1 else Result := -1;
  end else if LeftPatch <> RightPatch then begin
    if LeftPatch > RightPatch then Result := 1 else Result := -1;
  end else Result := 0;
end;

function ReadInstalledVersion(var InstalledVersion: String): Boolean;
var
  PackagePath: String;
  Content: AnsiString;
  JsonText: String;
  KeyPosition: Integer;
  ValuePosition: Integer;
  ValueEnd: Integer;
begin
  Result := False;
  PackagePath := ExpandConstant('{app}\resources\app\package.json');
  if not FileExists(PackagePath) then Exit;
  if not LoadStringFromFile(PackagePath, Content) then Exit;
  JsonText := String(Content);
  KeyPosition := Pos('"version"', JsonText);
  if KeyPosition = 0 then Exit;
  ValuePosition := KeyPosition + Length('"version"');
  while ValuePosition <= Length(JsonText) do begin
    if not (JsonText[ValuePosition] in [' ', #9, #10, #13]) then Break;
    ValuePosition := ValuePosition + 1;
  end;
  if ValuePosition > Length(JsonText) then Exit;
  if JsonText[ValuePosition] <> ':' then Exit;
  ValuePosition := ValuePosition + 1;
  while ValuePosition <= Length(JsonText) do begin
    if not (JsonText[ValuePosition] in [' ', #9, #10, #13]) then Break;
    ValuePosition := ValuePosition + 1;
  end;
  if ValuePosition > Length(JsonText) then Exit;
  if JsonText[ValuePosition] <> '"' then Exit;
  ValuePosition := ValuePosition + 1;
  ValueEnd := ValuePosition;
  while ValueEnd <= Length(JsonText) do begin
    if JsonText[ValueEnd] = '"' then Break;
    ValueEnd := ValueEnd + 1;
  end;
  if ValueEnd > Length(JsonText) then Exit;
  InstalledVersion := Copy(JsonText, ValuePosition, ValueEnd - ValuePosition);
  Result := True;
end;

function IsWebRevisionDeskRunning: Boolean;
var
  ResultCode: Integer;
  Output: TExecOutput;
  I: Integer;
  Line: String;
begin
  Result := False;
  if not ExecAndCaptureOutput(
    ExpandConstant('{sysnative}\tasklist.exe'),
    '/FI "IMAGENAME eq WebRevisionDesk.exe" /FO CSV /NH',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode, Output) then
    RaiseException('起動中の Web Revision Desk を確認できませんでした。');
  if Output.Error or (ResultCode <> 0) then
    RaiseException('起動中の Web Revision Desk を確認できませんでした。');
  for I := 0 to GetArrayLength(Output.StdOut) - 1 do begin
    Line := Lowercase(Trim(Output.StdOut[I]));
    if Pos('"webrevisiondesk.exe"', Line) = 1 then begin
      Result := True;
      Exit;
    end;
  end;
end;

function StopRunningApplication: Boolean;
var
  ResultCode: Integer;
  Attempt: Integer;
begin
  Result := False;
  if not IsWebRevisionDeskRunning then begin
    Result := True;
    Exit;
  end;
  if not WizardSilent and (MsgBox('Web Revision Desk が起動しています。作業内容を保存してから、差分更新のためアプリを終了しますか？', mbConfirmation, MB_YESNO or MB_DEFBUTTON2) <> IDYES) then Exit;
  if not Exec(ExpandConstant('{sysnative}\taskkill.exe'), '/F /T /IM WebRevisionDesk.exe', '', SW_HIDE, ewWaitUntilTerminated, ResultCode) then begin
    if not IsWebRevisionDeskRunning then begin Result := True; Exit; end;
    if not WizardSilent then MsgBox('Web Revision Desk を終了できませんでした。', mbError, MB_OK);
    Exit;
  end;
  for Attempt := 1 to 40 do begin
    Sleep(250);
    if not IsWebRevisionDeskRunning then begin Result := True; Exit; end;
  end;
  if not WizardSilent then MsgBox('Web Revision Desk の終了を確認できませんでした。差分更新を中止します。', mbError, MB_OK);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  InstalledVersion: String;
  PackagePath: String;
  TargetVersion: String;
  MinimumVersion: String;
  Reason: String;
begin
  NeedsRestart := False;
  Reason := '';
  TargetVersion := '{#MyAppVersion}';
  MinimumVersion := '{#MyMinimumVersion}';
  PackagePath := ExpandConstant('{app}\resources\app\package.json');
  if not FileExists(ExpandConstant('{app}\{#MyAppExeName}')) then
    Reason := '既存のインストール先または WebRevisionDesk.exe が見つかりません。'
  else if not FileExists(ExpandConstant('{app}\resources\app\electron\main.mjs')) then
    Reason := '既存のアプリケーション構成が差分更新に対応していません。'
  else if not ReadInstalledVersion(InstalledVersion) then
    Reason := '既存アプリのバージョンを確認できません。'
  else if CompareVersions(InstalledVersion, MinimumVersion) < 0 then
    Reason := '現在のバージョン v' + InstalledVersion + ' は差分更新の対象外です。'
  else if CompareVersions(InstalledVersion, TargetVersion) >= 0 then
    Reason := '現在のバージョン v' + InstalledVersion + ' は更新対象より新しいか、既に同じです。'
  else if not FileExists(PackagePath) then
    Reason := '既存アプリのバージョン情報を確認できません。';

  if Reason <> '' then begin
    Result := Reason + #13#10#13#10 +
      'この差分インストーラーは v' + MinimumVersion + ' 以降、v' + TargetVersion + ' 未満が対象です。' + #13#10 +
      '新規インストールまたはフル版インストーラー（WebRevisionDesk-' + TargetVersion + '-Setup.exe）をご利用ください。';
    Exit;
  end;
  if not StopRunningApplication then begin
    Result := '差分更新を開始できませんでした。';
    Exit;
  end;
  Result := '';
end;
