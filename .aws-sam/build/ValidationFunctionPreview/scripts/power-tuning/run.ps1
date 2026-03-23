<#
.SYNOPSIS
    Run AWS Lambda Power Tuning for greenwatt-validation and display results.

.PARAMETER AwsProfile
    AWS CLI profile to use. Defaults to "greenwatt".

.PARAMETER StateMachineArn
    ARN of the lambda-power-tuning state machine. Resolved automatically from
    the "lambda-power-tuning" CloudFormation stack if omitted.

.PARAMETER LambdaArn
    Full ARN of the greenwatt-validation Lambda. Resolved from the account and
    region of the profile if omitted.

.PARAMETER PollIntervalSec
    Seconds between status polls while waiting for execution to finish. Default: 10.
#>

param(
    [string]$AwsProfile      = "greenwatt",
    [string]$StateMachineArn = "",
    [string]$LambdaArn       = "",
    [int]   $PollIntervalSec = 10
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptDir    = $PSScriptRoot
$inputFile    = Join-Path $scriptDir "input.json"
$stackName    = "serverlessrepo-lambda-power-tuning"
$functionName = "greenwatt-validation"

Write-Host ""
Write-Host "=== AWS Lambda Power Tuning - greenwatt-validation ===" -ForegroundColor Cyan
Write-Host ""

if (-not (Get-Command aws -ErrorAction SilentlyContinue)) {
    Write-Error "AWS CLI is not installed or not in PATH."
}
if (-not (Test-Path $inputFile)) {
    Write-Error "input.json not found at: $inputFile"
}

# Resolve AWS identity
$identity = aws sts get-caller-identity --profile $AwsProfile --output json | ConvertFrom-Json
$account  = $identity.Account
$region = aws configure get region --profile $AwsProfile
if (-not $region) { $region = $env:AWS_DEFAULT_REGION }
if (-not $region) { $region = "us-east-1" }

Write-Host "Profile : $AwsProfile"
Write-Host "Account : $account"
Write-Host "Region  : $region"
Write-Host ""

# Resolve Lambda ARN
if (-not $LambdaArn) {
    $LambdaArn = "arn:aws:lambda:${region}:${account}:function:${functionName}"
}
Write-Host "Lambda  : $LambdaArn" -ForegroundColor White

# Resolve state machine ARN
if (-not $StateMachineArn) {
    Write-Host "Resolving state machine ARN from stack '$stackName'..."
    $outputs = aws cloudformation describe-stacks --stack-name $stackName --profile $AwsProfile --region $region --query "Stacks[0].Outputs" --output json 2>$null | ConvertFrom-Json

    if (-not $outputs) {
        Write-Error "Stack '$stackName' not found. Run 'npm run tune:deploy' first."
    }

    $StateMachineArn = ($outputs | Where-Object { $_.OutputKey -eq "StateMachineARN" }).OutputValue
    if (-not $StateMachineArn) {
        Write-Error "Could not find StateMachineARN in stack outputs. Check the CloudFormation console."
    }
}
Write-Host "SM ARN  : $StateMachineArn" -ForegroundColor White
Write-Host ""

# Build execution input
$inputObj = Get-Content $inputFile -Raw | ConvertFrom-Json
$inputObj.lambdaARN = $LambdaArn
$executionInput = $inputObj | ConvertTo-Json -Depth 10 -Compress

$powerValues    = $inputObj.powerValues -join ", "
$numInvocations = $inputObj.num
$totalInvokes   = $inputObj.powerValues.Count * $numInvocations

Write-Host "Memory configs : $powerValues MB"
Write-Host "Invocations ea : $numInvocations  (total: $totalInvokes)"
Write-Host "Strategy       : $($inputObj.strategy)"
Write-Host ""

# Start execution — write input to a temp file to avoid shell word-splitting
$execName    = "greenwatt-tune-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
$tmpInput    = [System.IO.Path]::GetTempFileName()
[System.IO.File]::WriteAllText($tmpInput, $executionInput, [System.Text.UTF8Encoding]::new($false))

Write-Host "Starting execution: $execName" -ForegroundColor Green
$startResult = aws stepfunctions start-execution --state-machine-arn $StateMachineArn --name $execName --input "file://$tmpInput" --profile $AwsProfile --region $region --output json | ConvertFrom-Json

Remove-Item $tmpInput -ErrorAction SilentlyContinue

if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to start Step Functions execution."
}

$execArn = $startResult.executionArn
Write-Host "Execution ARN: $execArn" -ForegroundColor DarkGray
Write-Host ""
Write-Host "Polling for results (every ${PollIntervalSec}s)..." -ForegroundColor Yellow

# Poll until complete
$startTime = Get-Date
$status    = "RUNNING"
$dotCount  = 0
$describe  = $null

while ($status -eq "RUNNING") {
    Start-Sleep -Seconds $PollIntervalSec

    $describe  = aws stepfunctions describe-execution --execution-arn $execArn --profile $AwsProfile --region $region --output json | ConvertFrom-Json
    $status    = $describe.status
    $elapsed   = [int]((Get-Date) - $startTime).TotalSeconds
    $dotCount++

    Write-Host -NoNewline "."
    if ($dotCount % 6 -eq 0) {
        Write-Host " [${elapsed}s]"
    }
}

Write-Host ""
Write-Host ""

# Handle failure
if ($status -ne "SUCCEEDED") {
    Write-Host "Execution ended with status: $status" -ForegroundColor Red
    if ($describe.cause) {
        Write-Host "Cause: $($describe.cause)" -ForegroundColor Red
    }
    Write-Host ""
    Write-Host "Execution ARN for debugging:"
    Write-Host "  $execArn"
    exit 1
}

$elapsedTotal = [int]((Get-Date) - $startTime).TotalSeconds
Write-Host "Execution SUCCEEDED in ${elapsedTotal}s" -ForegroundColor Green
Write-Host ""

# Parse and display results
# Power Tuning v4 returns the winning result at the top level; full table is
# encoded in the visualization URL as three semicolon-separated base64 arrays:
# #memoryValues(uint16);avgDurations(float32);avgCosts(float32)
$output = $describe.output | ConvertFrom-Json

$vizUrl = if ($output.PSObject.Properties.Name -contains "stateMachine") { $output.stateMachine.visualization } else { $null }

if ($vizUrl) {
    $hash  = $vizUrl.Split("#")[1]
    $parts = $hash.Split(";")

    $memBytes  = [Convert]::FromBase64String($parts[0])
    $durBytes  = [Convert]::FromBase64String($parts[1])
    $costBytes = [Convert]::FromBase64String($parts[2])

    $memories  = for ($i = 0; $i -lt $memBytes.Length;  $i += 2) { [BitConverter]::ToUInt16($memBytes,  $i) }
    $durations = for ($i = 0; $i -lt $durBytes.Length;  $i += 4) { [BitConverter]::ToSingle($durBytes,  $i) }
    $costs     = for ($i = 0; $i -lt $costBytes.Length; $i += 4) { [BitConverter]::ToSingle($costBytes, $i) }

    # Build result objects and sort by duration
    $results = for ($i = 0; $i -lt $memories.Count; $i++) {
        [PSCustomObject]@{ power = $memories[$i]; duration = $durations[$i]; cost = $costs[$i] }
    }
    $sorted      = $results | Sort-Object duration
    $minDuration = ($results | Measure-Object -Property duration -Minimum).Minimum

    Write-Host ("-" * 65) -ForegroundColor DarkGray
    Write-Host ("{0,-12} {1,-18} {2,-20}" -f "Memory (MB)", "Avg Duration (ms)", "Avg Cost (USD/inv)")
    Write-Host ("-" * 65) -ForegroundColor DarkGray

    foreach ($r in $sorted) {
        $mem    = $r.power
        $dur    = [math]::Round($r.duration, 1)
        $cost   = "{0:N8}" -f $r.cost
        $marker = if ($r.duration -eq $minDuration) { "  <-- fastest" } else { "" }
        $color  = if ($r.duration -eq $minDuration) { "Green" } else { "White" }

        Write-Host ("{0,-12} {1,-18} {2,-20}{3}" -f $mem, $dur, $cost, $marker) -ForegroundColor $color
    }

    Write-Host ("-" * 65) -ForegroundColor DarkGray
    Write-Host ""

    $optimal = $sorted | Select-Object -First 1
    Write-Host "Optimal memory : $($optimal.power) MB" -ForegroundColor Cyan
    Write-Host "Avg duration   : $([math]::Round($optimal.duration, 1)) ms" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "To apply: update MemorySize in infrastructure/template.yaml to $($optimal.power)" -ForegroundColor Yellow
    Write-Host "          then run: sam build && sam deploy --profile $AwsProfile" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Interactive visualization:" -ForegroundColor Cyan
    Write-Host "  $vizUrl" -ForegroundColor White
} else {
    Write-Host "Raw execution output:" -ForegroundColor Yellow
    $output | ConvertTo-Json -Depth 10
}

Write-Host ""
Write-Host "Done." -ForegroundColor Green
