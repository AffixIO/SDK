import { chmod, cp, mkdir, readdir, readFile } from "node:fs/promises";

await mkdir("dist/runtime", { recursive: true });
await cp("src/runtime", "dist/runtime", { recursive: true });
await chmod("dist/runtime/cli.js", 0o755);
for (const name of await readdir("dist/runtime")) {
  if (!name.endsWith(".js") || name === "cli.js") continue;
  await import(new URL(`../dist/runtime/${name}`, import.meta.url));
}
const pkg = JSON.parse(await readFile("package.json", "utf8"));
for (const entry of Object.values(pkg.exports)) {
  for (const path of Object.values(entry)) await readFile(path);
}
console.log(`AffixIO ${pkg.version}: runtime built and export paths checked`);
