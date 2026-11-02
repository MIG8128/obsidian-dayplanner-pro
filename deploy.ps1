# 1. 최신 코드 빌드
npm run build

# 2. 실제 옵시디언 볼트 경로 지정
$dest = "C:\Users\MIG\Documents\obsidian\mig8128\.obsidian\plugins\obsidian-day-planner-pro"

# 대상 폴더가 없으면 생성
if (!(Test-Path $dest)) {
    New-Item -ItemType Directory -Force -Path $dest | Out-Null
}

# 3. 배포 대상 파일 복사
Copy-Item -Path "main.js", "manifest.json" -Destination $dest -Force

Write-Host "Successfully deployed Day Planner Pro to vault!" -ForegroundColor Green