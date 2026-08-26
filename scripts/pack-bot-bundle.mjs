import { mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dest = resolve(root, 'release', 'GrokCrew-bot-pack.zip');
mkdirSync(resolve(root, 'release'), { recursive: true });

const python = [
  resolve(root, 'local_studio', '.venv', 'bin', 'python'),
  'python3',
  'python',
];

const code = `
from pathlib import Path
import sys
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass
sys.path.insert(0, ${JSON.stringify(resolve(root, 'local_studio'))})
from bot_pack import write_bot_pack
result = write_bot_pack(Path(sys.argv[1]))
print("packed {bytes} bytes -> {name}".format(bytes=result["bytes"], name=Path(result["path"]).name))
`;

let last = null;
for (const bin of python) {
  last = spawnSync(bin, ['-c', code, dest], { encoding: 'utf8', cwd: root });
  if (last.status === 0) {
    process.stdout.write(last.stdout);
    process.exit(0);
  }
}
process.stderr.write(last?.stderr || 'Could not write the bot pack.\n');
process.exit(last?.status ?? 1);
