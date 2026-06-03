import { rm } from "fs/promises";

const paths = ["build", "coverage", "dist", "android-build", "main.js", "main.js.map"];

for (const target of paths) {
  await rm(target, { recursive: true, force: true });
  console.log(`Removed ${target}`);
}
