<#
.SYNOPSIS
    One-time deployment of the AWS Lambda Power Tuning SAR app.
    Run this once per AWS account/region before using run.ps1.

.PARAMETER AwsProfile
    AWS CLI profile to use. Defaults to "greenwatt".

.LINK
    https://github.com/alexcasalboni/aws-lambda-power-tuning
#>

param(
    [string]$AwsProfile = "greenwatt"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$STACK_NAME  = "serverlessrepo-lambda-power-tuning"
$SAR_APP_ARN = "arn:aws:serverlessrepo:us-east-1:451282441545:applications/aws-lambda-power-tuning"

Write-Host ""
Write-Host "=== AWS Lambda Power Tuning - One-Time Deployment ===" -ForegroundColor Cyan
Write-Host ""

if (-not (Get-Command aws -ErrorAction SilentlyContinue)) {
    Write-Error "AWS CLI is not installed or not in PATH."
}

$IDENTITY = aws sts get-caller-identity --profile $AwsProfile --output json | ConvertFrom-Json
$REGION = aws configure get region --profile $AwsProfile
if (-not $REGION) { $REGION = $env:AWS_DEFAULT_REGION }
if (-not $REGION) { $REGION = "us-east-1" }

Write-Host "Profile : $AwsProfile"
Write-Host "Account : $($IDENTITY.Account)"
Write-Host "Region  : $REGION"
Write-Host "Stack   : $STACK_NAME"
Write-Host ""

$stackExists = $false
try {
    $existingRaw = aws cloudformation describe-stacks --stack-name $STACK_NAME --profile $AwsProfile --region $REGION --output json 2>&1
    if ($LASTEXITCODE -eq 0) {
        $stackExists = $true
        $stackStatus = ($existingRaw | ConvertFrom-Json).Stacks[0].StackStatus
        Write-Host "Stack already exists with status: $stackStatus" -ForegroundColor Yellow
        Write-Host "Retrieving existing state machine ARN..." -ForegroundColor Green
    }
} catch { $stackExists = $false }

if (-not $stackExists) {
    Write-Host "Deploying AWS Lambda Power Tuning from SAR..." -ForegroundColor Green
    Write-Host "(This takes ~2 minutes)" -ForegroundColor DarkGray
    Write-Host ""

    $sarResult = aws serverlessrepo create-cloud-formation-change-set --application-id $SAR_APP_ARN --stack-name $STACK_NAME --capabilities CAPABILITY_IAM CAPABILITY_RESOURCE_POLICY --profile $AwsProfile --region $REGION --output json | ConvertFrom-Json

    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to create CloudFormation change set from SAR."
    }

    $changeSetId = $sarResult.ChangeSetId
    Write-Host "Change set ID: $changeSetId"
    Write-Host "Waiting for change set to be ready..."
    aws cloudformation wait change-set-create-complete --change-set-name $changeSetId --profile $AwsProfile --region $REGION

    Write-Host "Executing change set (deploying stack)..."
    aws cloudformation execute-change-set --change-set-name $changeSetId --profile $AwsProfile --region $REGION | Out-Null

    Write-Host "Waiting for stack creation to complete..."
    aws cloudformation wait stack-create-complete --stack-name $STACK_NAME --profile $AwsProfile --region $REGION

    if ($LASTEXITCODE -ne 0) {
        Write-Error "Stack creation failed. Check the AWS CloudFormation console for details."
    }

    Write-Host ""
    Write-Host "Deployment complete!" -ForegroundColor Green
}

$outputs = aws cloudformation describe-stacks --stack-name $STACK_NAME --profile $AwsProfile --region $REGION --query "Stacks[0].Outputs" --output json | ConvertFrom-Json

$stateMachineArn = ($outputs | Where-Object { $_.OutputKey -eq "StateMachineARN" }).OutputValue

if ($stateMachineArn) {
    Write-Host ""
    Write-Host "State Machine ARN:" -ForegroundColor Cyan
    Write-Host "  $stateMachineArn" -ForegroundColor White
    Write-Host ""
    Write-Host "You can now run the optimizer with:" -ForegroundColor Green
    Write-Host "  npm run tune:run" -ForegroundColor White
} else {
    Write-Host "Could not retrieve state machine ARN from stack outputs." -ForegroundColor Yellow
    Write-Host "Check the CloudFormation console for stack outputs." -ForegroundColor Yellow
}
