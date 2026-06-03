import { copyFile, mkdir, readdir, stat } from "fs/promises";
import path from "path";
import process from "process";

const pluginId = "gpt4free-text-generator-plugin";
const rootDir = process.cwd();
const buildDir = path.join(rootDir, "build", pluginId);

function getArgValue(name) {
  const prefix = `--${name}=`;
  const arg = process.argv.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : undefined;
}

const targetDir = getArgValue("target") || process.env.OBSIDIAN_PLUGIN_DIR;

if (!targetDir) {
  console.error("Missing deploy target. Set OBSIDIAN_PLUGIN_DIR or pass --target=...");
  process.exit(1);
}

async function copyDirectory(from, to) {
  await mkdir(to, { recursive: true });
  for (const entry of await readdir(from)) {
    const sourcePath = path.join(from, entry);
    const targetPath = path.join(to, entry);
    const info = await stat(sourcePath);
    if (info.isDirectory()) {
      await copyDirectory(sourcePath, targetPath);
    } else {
      await copyFile(sourcePath, targetPath);
    }
  }
}

await copyDirectory(buildDir, targetDir);
console.log(`Deployed ${buildDir} -> ${targetDir}`);
console.log("Runtime files such as data.json and transcripts.db are intentionally left untouched.");
