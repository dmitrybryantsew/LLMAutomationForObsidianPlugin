// prepare-android-build.js (ES Module)
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function prepareAndroidBuild() {
  const rootDir = path.resolve(__dirname, '..');
  const androidSourceDir = path.join(rootDir, 'build', 'android');
  const zipPath = path.join(rootDir, 'obsidian-gpt4free-plugin-android.zip');

  try {
    const requiredFiles = ['main.js', 'manifest.json', 'styles.css', 'sql-wasm.wasm'];
    for (const file of requiredFiles) {
      try {
        await fs.access(path.join(androidSourceDir, file));
      } catch {
        throw new Error(`Required file missing from android build directory: ${file}`);
      }
    }

    console.log('All required files verified in build/android directory.');

    // Create zip file for Android
    if (process.platform === 'win32') {
      const command = `powershell -NoProfile -Command "Compress-Archive -Path '${androidSourceDir}\\*' -DestinationPath '${zipPath}' -Force"`;
      console.log(`Creating Android zip at: ${zipPath}`);
      await execAsync(command);
    } else {
      const command = `cd "${androidSourceDir}" && zip -r "${zipPath}" .`;
      console.log(`Creating Android zip at: ${zipPath}`);
      await execAsync(command);
    }

    console.log(`Android plugin package created successfully at: ${zipPath}`);
  } catch (err) {
    console.error('Error preparing Android build:', err);
    process.exit(1);
  }
}

prepareAndroidBuild();