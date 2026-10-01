[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Medium')]
param(
    [ValidateSet('Install', 'Launch', 'Remove', 'Describe')]
    [string] $Action = 'Describe',
    [string] $NodePath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# NSIS owns the desktop and Start menu shortcuts (including AppUserModelID for
# native notifications). This script owns only the current user's Startup link.
# Remove disables that launch; it does not uninstall or stop the local server.
$projectPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$launcherPath = Join-Path $projectPath 'scripts\start.mjs'
$installerPath = Join-Path $projectPath '.runtime\desktop-dist\Ratmir English Setup.exe'
# NSIS oneClick per-user derives its directory from the desktop package name.
$installDirectory = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Programs\ratmir-english-desktop'
$installedExe = Join-Path $installDirectory 'Ratmir English.exe'
$settingsDirectory = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'Ratmir English'
$configPath = Join-Path $settingsDirectory 'desktop-config.json'
$ownerSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$hashProvider = [Security.Cryptography.SHA256]::Create()
try {
    $projectHash = [BitConverter]::ToString($hashProvider.ComputeHash([Text.Encoding]::UTF8.GetBytes($projectPath.ToLowerInvariant()))).Replace('-', '').ToLowerInvariant().Substring(0, 12)
} finally { $hashProvider.Dispose() }

function Quote-DesktopArgument([string] $Value) {
    if ([string]::IsNullOrWhiteSpace($Value) -or $Value -match '["\x00-\x1f]') { throw 'An argument contains an invalid quote or control character.' }
    # Preserve paths ending in a slash in a Windows command-line argument.
    return '"' + $Value + [regex]::Match($Value, '\\+$').Value + '"'
}

function Resolve-DesktopNode([string] $RequestedPath) {
    if ([string]::IsNullOrWhiteSpace($RequestedPath)) {
        $command = Get-Command node -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($null -eq $command) { return $null }
        $RequestedPath = $command.Source
    }
    $null = Quote-DesktopArgument $RequestedPath
    $absolutePath = [IO.Path]::GetFullPath($RequestedPath)
    if ([IO.Path]::GetExtension($absolutePath) -ine '.exe') { throw 'NodePath must point to a Windows executable.' }
    return $absolutePath
}

function Get-DesktopNodeInfo([string] $Executable) {
    $info = [ordered]@{ path = $Executable; exists = $false; version = $null; minimumMajor = 24; meetsMinimum = $false }
    if ([string]::IsNullOrWhiteSpace($Executable)) { return $info }
    $info.exists = Test-Path -LiteralPath $Executable -PathType Leaf
    if (-not $info.exists) { return $info }
    try {
        $version = (@(& $Executable --version 2>$null) -join '').Trim()
        if ($LASTEXITCODE -eq 0 -and $version -match '^v(\d+)\.\d+\.\d+(?:[-+].*)?$') {
            $info.version = $version
            $info.meetsMinimum = [int]$Matches[1] -ge 24
        }
    } catch { }
    return $info
}

function Assert-DesktopNode([System.Collections.IDictionary] $Info) {
    if (-not $Info.exists -or -not $Info.meetsMinimum) { throw 'Node.js 24 or newer is required. Supply its absolute executable path with -NodePath.' }
}

function Assert-DesktopBuild {
    if (-not (Test-Path -LiteralPath $launcherPath -PathType Leaf) -or
        -not (Test-Path -LiteralPath (Join-Path $projectPath '.next\BUILD_ID') -PathType Leaf) -or
        -not (Test-Path -LiteralPath (Join-Path $projectPath 'node_modules\next\dist\bin\next') -PathType Leaf)) {
        throw 'Build the project with npm run build before installing its desktop shell.'
    }
}

function Test-DesktopExecutable([string] $File) {
    if (-not (Test-Path -LiteralPath $File -PathType Leaf)) { return $false }
    $stream = [IO.File]::OpenRead($File)
    try { return $stream.Length -gt 64 -and $stream.ReadByte() -eq 77 -and $stream.ReadByte() -eq 90 }
    finally { $stream.Dispose() }
}

function Get-DesktopShortcutDefinitions {
    $startupDirectory = [Environment]::GetFolderPath('Startup')
    if ([string]::IsNullOrWhiteSpace($startupDirectory)) { throw 'The current-user Windows Startup folder is unavailable.' }
    [pscustomobject]@{
        kind = 'startup'
        path = [IO.Path]::GetFullPath((Join-Path $startupDirectory ('Ratmir English-' + $projectHash + '.lnk')))
        description = 'Ratmir English desktop v2; Project=' + $projectPath + '; OwnerSID=' + $ownerSid + '; Shortcut=startup'
    }
}

function Assert-OwnedDesktopShortcut($Shell, $Definition) {
    if (-not (Test-Path -LiteralPath $Definition.path -PathType Leaf)) { throw 'A shortcut name is occupied by a directory or unsupported file.' }
    $shortcut = $Shell.CreateShortcut($Definition.path)
    try {
        if ($shortcut.Description -cne $Definition.description -or $shortcut.Arguments -cne '' -or
            -not [string]::Equals($shortcut.TargetPath, $installedExe, [StringComparison]::OrdinalIgnoreCase) -or
            -not [string]::Equals($shortcut.WorkingDirectory, $installDirectory, [StringComparison]::OrdinalIgnoreCase)) {
            throw 'The Startup shortcut belongs to another application or has changed. It was left untouched.'
        }
        return $true
    } finally {
        if ([Runtime.InteropServices.Marshal]::IsComObject($shortcut)) { $null = [Runtime.InteropServices.Marshal]::FinalReleaseComObject($shortcut) }
    }
}

function Get-DesktopShortcutStatus($Shell, $Definition) {
    $info = [ordered]@{ kind = $Definition.kind; path = $Definition.path; exists = (Test-Path -LiteralPath $Definition.path); verified = $false; verificationError = $null }
    if ($info.exists) {
        try { $null = Assert-OwnedDesktopShortcut $Shell $Definition; $info.verified = $true }
        catch { $info.verificationError = 'Existing shortcut did not pass this project ownership verification; left untouched.' }
    }
    return $info
}

function Write-DesktopShortcut($Shell, $Definition) {
    if (Test-Path -LiteralPath $Definition.path) { $null = Assert-OwnedDesktopShortcut $Shell $Definition }
    $shortcut = $Shell.CreateShortcut($Definition.path)
    try {
        $shortcut.TargetPath = $installedExe
        $shortcut.Arguments = ''
        $shortcut.WorkingDirectory = $installDirectory
        $shortcut.Description = $Definition.description
        $shortcut.WindowStyle = 1
        $shortcut.IconLocation = $installedExe + ',0'
        if (Test-Path -LiteralPath $Definition.path) { $null = Assert-OwnedDesktopShortcut $Shell $Definition }
        $shortcut.Save()
    } finally {
        if ([Runtime.InteropServices.Marshal]::IsComObject($shortcut)) { $null = [Runtime.InteropServices.Marshal]::FinalReleaseComObject($shortcut) }
    }
    $null = Assert-OwnedDesktopShortcut $Shell $Definition
}

function Remove-DesktopShortcut($Shell, $Definition) {
    if (-not (Test-Path -LiteralPath $Definition.path)) { return }
    $null = Assert-OwnedDesktopShortcut $Shell $Definition
    Remove-Item -LiteralPath $Definition.path -ErrorAction Stop
}

function Test-DesktopRemoteOrigin($Origin) {
    # Match runtime.cjs: one canonical public DNS HTTPS origin, standard TLS port,
    # no path, credentials, alternate IP notation, local aliases or normalization.
    if ($Origin -isnot [string] -or $Origin.Length -gt 2048 -or $Origin -cnotmatch '^https://(?<Hostname>[a-z0-9.-]+)$') { return $false }
    $hostname = $Matches.Hostname
    if ($hostname.Length -gt 253 -or -not $hostname.Contains('.') -or $hostname.EndsWith('.') -or
        $hostname -cmatch '(?:^|\.)(?:localhost|localdomain|local|internal|home|lan|onion)$' -or $hostname.EndsWith('.home.arpa')) { return $false }
    $labels = $hostname.Split('.')
    foreach ($label in $labels) {
        if ($label -cnotmatch '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$') { return $false }
    }
    if ($labels[-1] -cnotmatch '^(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$') { return $false }
    try {
        $uri = [Uri]::new($Origin, [UriKind]::Absolute)
        return $uri.Scheme -ceq 'https' -and $uri.HostNameType -eq [UriHostNameType]::Dns -and
            $uri.GetLeftPart([UriPartial]::Authority) -ceq $Origin
    } catch { return $false }
}

function Get-DesktopConfigStatus {
    $info = [ordered]@{ path = $configPath; exists = (Test-Path -LiteralPath $configPath); verified = $false; mode = $null }
    if (-not $info.exists) { return $info }
    try {
        $file = Get-Item -LiteralPath $configPath -ErrorAction Stop
        if ($file.PSIsContainer -or $file.Length -gt 8192 -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint)) { return $info }
        $config = [IO.File]::ReadAllText($configPath) | ConvertFrom-Json
        $propertyNames = @($config.PSObject.Properties.Name | Sort-Object)
        if (($propertyNames -join ',') -ceq 'mode,origin') {
            if ($config.mode -ceq 'remote' -and (Test-DesktopRemoteOrigin $config.origin)) {
                $info.verified = $true
                $info.mode = 'remote'
            }
            return $info
        }
        if (($propertyNames -join ',') -cne 'nodePath,workspace' -or $config.workspace -isnot [string] -or $config.nodePath -isnot [string] -or
            -not [string]::Equals($config.workspace, $projectPath, [StringComparison]::OrdinalIgnoreCase) -or
            -not [IO.Path]::IsPathRooted($config.nodePath) -or [IO.Path]::GetExtension($config.nodePath) -ine '.exe' -or
            $config.nodePath -match '["\x00-\x1f]') { return $info }
        $info.verified = [string]::Equals([IO.Path]::GetFullPath($config.nodePath), $config.nodePath, [StringComparison]::OrdinalIgnoreCase)
        if ($info.verified) { $info.mode = 'local' }
    } catch { }
    return $info
}

function Get-DesktopRuntimeInfo($ConfigurationStatus, [string] $RequestedPath) {
    if ($ConfigurationStatus.verified -and $ConfigurationStatus.mode -ceq 'remote') {
        $info = Get-DesktopNodeInfo $null
        $info['required'] = $false
        return $info
    }
    $resolved = Resolve-DesktopNode $RequestedPath
    $info = Get-DesktopNodeInfo $resolved
    $info['required'] = $true
    return $info
}

function Write-DesktopConfig([string] $Executable) {
    $existing = Get-DesktopConfigStatus
    if ($existing.exists -and -not $existing.verified) { throw 'Existing desktop configuration does not belong to this workspace. It was left untouched.' }
    if ($existing.verified -and $existing.mode -ceq 'remote') { return }
    if (-not (Test-Path -LiteralPath $settingsDirectory -PathType Container)) { $null = New-Item -ItemType Directory -Path $settingsDirectory }
    $temporaryPath = [IO.Path]::GetFullPath((Join-Path $settingsDirectory ('desktop-config.' + [Guid]::NewGuid().ToString('N') + '.tmp')))
    $resolvedDirectory = [IO.Path]::GetFullPath($settingsDirectory).TrimEnd('\') + '\'
    if (-not $temporaryPath.StartsWith($resolvedDirectory, [StringComparison]::OrdinalIgnoreCase) -or
        -not [IO.Path]::GetFullPath($configPath).StartsWith($resolvedDirectory, [StringComparison]::OrdinalIgnoreCase)) { throw 'Configuration paths leave the application settings directory.' }
    $json = [ordered]@{ workspace = $projectPath; nodePath = $Executable } | ConvertTo-Json
    [IO.File]::WriteAllText($temporaryPath, $json, [Text.UTF8Encoding]::new($false))
    try {
        $latest = Get-DesktopConfigStatus
        if ($latest.exists -and -not $latest.verified) { throw 'Desktop configuration ownership changed during installation.' }
        if ($latest.verified -and $latest.mode -ceq 'remote') { return }
        Move-Item -LiteralPath $temporaryPath -Destination $configPath -Force -ErrorAction Stop
    } finally {
        if (Test-Path -LiteralPath $temporaryPath -PathType Leaf) { Remove-Item -LiteralPath $temporaryPath }
    }
}

$shell = $null
try {
    $configStatus = Get-DesktopConfigStatus
    if ($Action -eq 'Launch') {
        if (-not (Test-DesktopExecutable $installedExe) -or -not $configStatus.verified) { throw 'Run Install Desktop.cmd first to install and configure Ratmir English.' }
        if ($PSCmdlet.ShouldProcess($installedExe, 'Open the installed desktop application')) {
            $null = Start-Process -FilePath $installedExe -WorkingDirectory $installDirectory -PassThru -ErrorAction Stop
        }
        exit 0
    }
    $nodeInfo = Get-DesktopRuntimeInfo $configStatus $NodePath
    $resolvedNode = $nodeInfo.path
    $shell = New-Object -ComObject WScript.Shell
    $definitions = @(Get-DesktopShortcutDefinitions)
    $statuses = @($definitions | ForEach-Object { Get-DesktopShortcutStatus $shell $_ })
    $plan = [ordered]@{
        action = $Action; project = $projectPath; node = $nodeInfo
        installer = [ordered]@{ path = $installerPath; exists = (Test-DesktopExecutable $installerPath); mode = 'Per-user NSIS; silent install; does not automatically run after installation.' }
        application = [ordered]@{ path = $installedExe; exists = (Test-DesktopExecutable $installedExe); appUserModelId = 'com.ratmir.english' }
        configuration = $configStatus; shortcuts = $statuses
        managedByInstaller = 'Desktop and Start menu shortcuts, notification registration and uninstall entry are managed by NSIS.'
        startup = 'One app launch when this Windows user signs in. Closing its window hides it to the tray.'
        removal = 'Only the verified Startup link; application, configuration, server and personal data are preserved.'
    }
    if ($Action -eq 'Describe') { $plan | ConvertTo-Json -Depth 6; exit 0 }
    # Check before invoking NSIS or changing any application configuration.
    if (@($statuses | Where-Object { $_.exists -and -not $_.verified }).Count -gt 0) { throw 'The Startup shortcut did not pass ownership verification. Nothing was changed.' }
    if ($Action -eq 'Install') {
        if ($configStatus.exists -and -not $configStatus.verified) { throw 'Existing desktop configuration belongs to another workspace or is invalid. Nothing was changed.' }
        if ($nodeInfo.required) {
            Assert-DesktopNode $nodeInfo
            Assert-DesktopBuild
        }
        if (-not (Test-DesktopExecutable $installerPath)) { throw 'Build the Windows desktop installer first; Ratmir English Setup.exe is missing.' }
        if ($PSCmdlet.ShouldProcess($installedExe, 'Install the per-user desktop application, configure it and enable current-user Startup')) {
            $installation = Start-Process -FilePath $installerPath -ArgumentList '/S' -WorkingDirectory $projectPath -WindowStyle Hidden -Wait -PassThru -ErrorAction Stop
            if ($installation.ExitCode -ne 0 -or -not (Test-DesktopExecutable $installedExe)) { throw 'The per-user desktop installer did not complete successfully.' }
            Write-DesktopConfig $resolvedNode
            foreach ($definition in $definitions) { Write-DesktopShortcut $shell $definition }
        }
    } elseif ($Action -eq 'Remove') {
        foreach ($definition in $definitions) {
            if ((Test-Path -LiteralPath $definition.path) -and $PSCmdlet.ShouldProcess($definition.path, 'Disable this verified current-user app Startup shortcut')) { Remove-DesktopShortcut $shell $definition }
        }
    }
    [ordered]@{ action = $Action; configuration = (Get-DesktopConfigStatus); shortcuts = @($definitions | ForEach-Object { Get-DesktopShortcutStatus $shell $_ }) } | ConvertTo-Json -Depth 5
} catch {
    Write-Error -Message $_.Exception.Message -ErrorAction Continue
    exit 1
} finally {
    if ($null -ne $shell -and [Runtime.InteropServices.Marshal]::IsComObject($shell)) { $null = [Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell) }
}
