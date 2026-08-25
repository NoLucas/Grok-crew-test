$studioRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$venvPython = Join-Path $studioRoot '.venv\Scripts\python.exe'

if (-not (Test-Path -LiteralPath $venvPython)) {
  python -m venv (Join-Path $studioRoot '.venv')
}

& $venvPython -m pip install -r (Join-Path $studioRoot 'requirements.txt')
& $venvPython (Join-Path $studioRoot 'studio_server.py') --port 7214 @args
