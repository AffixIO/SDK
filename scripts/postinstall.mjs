import { chmodSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const binDir = join(process.cwd(), "node_modules", ".bin");
if (!existsSync(binDir)) {
  process.exit(0);
}

for (const name of readdirSync(binDir)) {
  const path = join(binDir, name);
  try {
    const mode = statSync(path).mode;
  if ((mode & 0o111) === 0) {
      chmodSync(path, mode | 0o755);
    }
  } catch {
    // ignore broken symlinks
  }
}
