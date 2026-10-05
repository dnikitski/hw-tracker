# Registers a Windows scheduled task that runs a sync every 4 hours.
# Run once, from PowerShell, on the machine that stays on:  .\scripts\register-task.ps1
# The task runs as you, only while you are logged in, which is what lets it
# decrypt secrets.json and show the browser window.

$project = Split-Path $PSScriptRoot -Parent
$node = (Get-Command node).Source

$action = New-ScheduledTaskAction -Execute $node -Argument 'src/run.js' -WorkingDirectory $project
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).Date.AddHours(7) -RepetitionInterval (New-TimeSpan -Hours 4)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 20)

Register-ScheduledTask -TaskName 'hw-tracker' -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Write-Host "Registered 'hw-tracker'. It runs every 4 hours; output goes to $project\logs."
