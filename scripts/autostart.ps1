[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Medium')]
param(
    [ValidateSet('Install', 'Remove', 'Run', 'Describe')]
    [string] $Action = 'Describe',
    [string] $NodePath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# This wrapper keeps Task Scheduler attached to the supervisor until it exits.
# Install and Remove are opt-in; Describe only reads paths and task metadata.
$projectPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$wrapperPath = [IO.Path]::GetFullPath($PSCommandPath)
$launcherPath = Join-Path $projectPath 'scripts\start.mjs'
$powershellPath = Join-Path ([Environment]::GetFolderPath('Windows')) 'System32\WindowsPowerShell\v1.0\powershell.exe'
$ownerSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$taskPath = '\'
$hashProvider = [Security.Cryptography.SHA256]::Create()
try {
    $projectHash = [BitConverter]::ToString($hashProvider.ComputeHash([Text.Encoding]::UTF8.GetBytes($projectPath.ToLowerInvariant()))).Replace('-', '').ToLowerInvariant()
} finally {
    $hashProvider.Dispose()
}
$taskName = 'RatmirEnglish-' + $projectHash.Substring(0, 12)
$description = 'Ratmir English autostart; Project=' + $projectPath + '; OwnerSID=' + $ownerSid

function Quote-Argument([string] $Value) {
    # Windows filenames cannot contain a quote. Reject control characters too.
    if ([string]::IsNullOrWhiteSpace($Value) -or $Value -match '["\x00-\x1f]') {
        throw 'An argument contains an invalid quote or control character.'
    }
    return '"' + $Value + '"'
}

function Get-RunArguments([string] $Executable) {
    return '-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File ' + (Quote-Argument $wrapperPath) + ' -Action Run -NodePath ' + (Quote-Argument $Executable)
}

function Resolve-NodePath([string] $RequestedPath) {
    if ([string]::IsNullOrWhiteSpace($RequestedPath)) {
        $command = Get-Command node -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($null -eq $command) { return $null }
        $RequestedPath = $command.Source
    }
    $null = Quote-Argument $RequestedPath
    $absolutePath = [IO.Path]::GetFullPath($RequestedPath)
    if ([IO.Path]::GetExtension($absolutePath) -ine '.exe') {
        throw 'NodePath must point to a Windows executable.'
    }
    return $absolutePath
}

function Get-NodeInfo([string] $Executable) {
    $info = [ordered]@{ path = $Executable; exists = $false; version = $null; minimumMajor = 24; meetsMinimum = $false }
    if ([string]::IsNullOrWhiteSpace($Executable)) { return $info }
    $info.exists = Test-Path -LiteralPath $Executable -PathType Leaf
    if (-not $info.exists) { return $info }
    try {
        $versionLines = @(& $Executable --version 2>$null)
        $version = ($versionLines -join '').Trim()
        if ($LASTEXITCODE -eq 0 -and $version -match '^v(\d+)\.\d+\.\d+(?:[-+].*)?$') {
            $info.version = $version
            $info.meetsMinimum = [int]$Matches[1] -ge 24
        }
    } catch {
        # Describe reports an unusable executable without exposing child output.
    }
    return $info
}

function Assert-Node([System.Collections.IDictionary] $Info) {
    if (-not $Info.exists -or -not $Info.meetsMinimum) {
        throw 'Node.js 24 or newer is required. Supply its absolute executable path with -NodePath.'
    }
}

function Get-ProjectTask {
    # Enumerating the root avoids treating a missing task as a service failure.
    $taskMatches = @(Get-ScheduledTask -TaskPath $taskPath -ErrorAction Stop | Where-Object {
        [string]::Equals($_.TaskName, $taskName, [StringComparison]::OrdinalIgnoreCase)
    })
    if ($taskMatches.Count -gt 1) { throw 'More than one task matched the project task name.' }
    if ($taskMatches.Count -eq 0) { return $null }
    return $taskMatches[0]
}

function Resolve-IdentitySid([string] $Identity) {
    if ([string]::IsNullOrWhiteSpace($Identity)) { throw 'A task identity is missing.' }
    if ($Identity -match '^S-\d+(?:-\d+)+$') {
        return ([Security.Principal.SecurityIdentifier]::new($Identity)).Value
    }
    return ([Security.Principal.NTAccount]::new($Identity)).Translate([Security.Principal.SecurityIdentifier]).Value
}

function Assert-OwnedTask($Task) {
    # Never replace, terminate or remove a coincidentally named task.
    if ($Task.Description -cne $description -or $Task.TaskPath -cne $taskPath) {
        throw 'The existing task does not have this project and owner description.'
    }
    $actions = @($Task.Actions)
    if ($actions.Count -ne 1) { throw 'The existing task does not have exactly one action.' }
    $taskAction = $actions[0]
    if (-not [string]::Equals($taskAction.Execute, $powershellPath, [StringComparison]::OrdinalIgnoreCase) -or
        -not [string]::Equals($taskAction.WorkingDirectory, $projectPath, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'The existing task does not use this project wrapper and working directory.'
    }
    $argumentPrefix = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File ' + (Quote-Argument $wrapperPath) + ' -Action Run -NodePath "'
    $argumentPattern = '^' + [regex]::Escape($argumentPrefix) + '(?<node>[^"\x00-\x1f]+)"$'
    $argumentMatch = [regex]::Match([string]$taskAction.Arguments, $argumentPattern)
    if (-not $argumentMatch.Success) { throw 'The existing task has unexpected wrapper arguments.' }
    $configuredNode = $argumentMatch.Groups['node'].Value
    if (-not [IO.Path]::IsPathRooted($configuredNode) -or [IO.Path]::GetExtension($configuredNode) -ine '.exe' -or
        -not [string]::Equals([IO.Path]::GetFullPath($configuredNode), $configuredNode, [StringComparison]::OrdinalIgnoreCase) -or
        $taskAction.Arguments -cne (Get-RunArguments $configuredNode)) {
        throw 'The existing task has an invalid Node executable argument.'
    }
    $principal = $Task.Principal
    if ((Resolve-IdentitySid $principal.UserId) -cne $ownerSid -or
        [string]$principal.LogonType -notin @('Interactive', 'InteractiveToken', '3') -or
        [string]$principal.RunLevel -notin @('Limited', '0')) {
        throw 'The existing task does not use this user with limited interactive logon.'
    }
    $triggers = @($Task.Triggers)
    if ($triggers.Count -ne 1 -or $triggers[0].CimClass.CimClassName -ine 'MSFT_TaskLogonTrigger' -or
        (Resolve-IdentitySid $triggers[0].UserId) -cne $ownerSid) {
        throw 'The existing task does not have this user logon trigger.'
    }
    return $configuredNode
}

function Invoke-Supervisor([string] $Executable, [ValidateSet('--supervise', '--stop')][string] $Flag) {
    if (-not (Test-Path -LiteralPath $launcherPath -PathType Leaf)) {
        throw 'scripts/start.mjs is missing from this project.'
    }
    $arguments = (Quote-Argument $launcherPath) + ' ' + $Flag
    $process = Start-Process -FilePath $Executable -ArgumentList $arguments -WorkingDirectory $projectPath -WindowStyle Hidden -Wait -PassThru -ErrorAction Stop
    return $process.ExitCode
}

try {
    # Run needs no Task Scheduler lookup. It preserves the current user environment.
    if ($Action -eq 'Run') {
        $resolvedNode = Resolve-NodePath $NodePath
        Assert-Node (Get-NodeInfo $resolvedNode)
        if ($PSCmdlet.ShouldProcess($projectPath, 'Run the local Node supervisor')) {
            exit (Invoke-Supervisor $resolvedNode '--supervise')
        }
        exit 0
    }

    $existingTask = $null
    $existingNode = $null
    $ownershipError = $null
    $schedulerAvailable = $null -ne (Get-Command Get-ScheduledTask -ErrorAction SilentlyContinue)
    if ($schedulerAvailable) {
        try {
            $existingTask = Get-ProjectTask
            if ($null -ne $existingTask) { $existingNode = Assert-OwnedTask $existingTask }
        } catch {
            if ($Action -ne 'Describe') { throw }
            $ownershipError = $_.Exception.Message
        }
    } elseif ($Action -ne 'Describe') {
        throw 'The Windows ScheduledTasks module is unavailable.'
    }

    # Removal uses the registered executable when no explicit override is given.
    # This still works after changing PATH and does not require a production build.
    $requestedNode = $NodePath
    if ($Action -eq 'Remove' -and [string]::IsNullOrWhiteSpace($requestedNode) -and $null -ne $existingNode) {
        $requestedNode = $existingNode
    }
    $resolvedNode = Resolve-NodePath $requestedNode
    $nodeInfo = Get-NodeInfo $resolvedNode
    $buildInfo = [ordered]@{
        launcherExists = (Test-Path -LiteralPath $launcherPath -PathType Leaf)
        buildIdExists = (Test-Path -LiteralPath (Join-Path $projectPath '.next\BUILD_ID') -PathType Leaf)
        nextBinaryExists = (Test-Path -LiteralPath (Join-Path $projectPath 'node_modules\next\dist\bin\next') -PathType Leaf)
    }
    $runArguments = $null
    if ($null -ne $resolvedNode) { $runArguments = Get-RunArguments $resolvedNode }
    $plan = [ordered]@{
        action = $Action
        project = $projectPath
        taskName = $taskName
        taskPath = $taskPath
        description = $description
        ownerSid = $ownerSid
        node = $nodeInfo
        wrapper = [ordered]@{ executable = $powershellPath; arguments = $runArguments; workingDirectory = $projectPath }
        trigger = [ordered]@{ type = 'AtLogon'; userSid = $ownerSid }
        principal = [ordered]@{ userSid = $ownerSid; logonType = 'Interactive'; runLevel = 'Limited' }
        settings = [ordered]@{
            multipleInstances = 'IgnoreNew'; executionTimeLimit = 'PT0S'; restartCount = 3
            restartInterval = 'PT1M'; allowStartIfOnBatteries = $true
            dontStopIfGoingOnBatteries = $true; startWhenAvailable = $true
        }
        build = $buildInfo
        existingTask = [ordered]@{
            schedulerAvailable = $schedulerAvailable
            exists = ($null -ne $existingTask)
            verified = ($null -ne $existingTask -and $null -ne $existingNode)
            verificationError = $ownershipError
        }
        removal = 'Graceful supervisor IPC stop; stop and unregister only the verified project task.'
    }
    if ($Action -eq 'Describe') {
        $plan | ConvertTo-Json -Depth 6
        exit 0
    }

    if ($Action -eq 'Install') {
        Assert-Node $nodeInfo
        if (-not $buildInfo.launcherExists -or -not $buildInfo.buildIdExists -or -not $buildInfo.nextBinaryExists) {
            throw 'Build the project first with npm run build; start.mjs, BUILD_ID and the Next binary must exist.'
        }
        if ($PSCmdlet.ShouldProcess($taskName, 'Register current-user logon autostart for ' + $projectPath)) {
            # Recheck immediately before -Force rather than trusting the earlier read.
            $currentTask = Get-ProjectTask
            if ($null -ne $currentTask) { $null = Assert-OwnedTask $currentTask }
            $taskAction = New-ScheduledTaskAction -Execute $powershellPath -Argument $runArguments -WorkingDirectory $projectPath
            $trigger = New-ScheduledTaskTrigger -AtLogon -User $ownerSid
            $principal = New-ScheduledTaskPrincipal -UserId $ownerSid -LogonType Interactive -RunLevel Limited
            $settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
            $definition = New-ScheduledTask -Action $taskAction -Trigger $trigger -Principal $principal -Settings $settings -Description $description
            $null = Register-ScheduledTask -TaskName $taskName -TaskPath $taskPath -InputObject $definition -Force -ErrorAction Stop
            Write-Output ('Installed ' + $taskName + '. It starts at this user''s next logon.')
        }
        exit 0
    }

    if ($Action -eq 'Remove') {
        Assert-Node $nodeInfo
        if ($PSCmdlet.ShouldProcess($taskName, 'Stop the project supervisor and remove current-user autostart for ' + $projectPath)) {
            $currentTask = Get-ProjectTask
            if ($null -ne $currentTask) { $null = Assert-OwnedTask $currentTask }
            $stopCode = Invoke-Supervisor $resolvedNode '--stop'
            if ($stopCode -ne 0) {
                throw ('Graceful supervisor stop failed with exit code ' + $stopCode + '; the scheduled task was preserved.')
            }
            $currentTask = Get-ProjectTask
            if ($null -ne $currentTask) {
                $null = Assert-OwnedTask $currentTask
                # The supervisor has acknowledged graceful shutdown. No PID file is trusted.
                if ([string]$currentTask.State -eq 'Running') {
                    Stop-ScheduledTask -InputObject $currentTask -ErrorAction Stop
                }
                Unregister-ScheduledTask -InputObject $currentTask -Confirm:$false -ErrorAction Stop
            }
            Write-Output ('Removed autostart for ' + $projectPath + '. The project supervisor is stopped.')
        }
        exit 0
    }
} catch {
    Write-Error -Message $_.Exception.Message -ErrorAction Continue
    exit 1
}
