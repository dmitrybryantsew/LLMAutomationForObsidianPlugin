// prepare-android-build.js
const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');

async function prepareAndroidBuild() {
  const rootDir = path.resolve(__dirname, '..');
  const androidBuildDir = path.join(rootDir, 'android-build');
  const zipPath = path.join(rootDir, 'obsidian-gpt4free-plugin-android.zip');
  
  try {
    // Create build directory if it doesn't exist
    await fs.mkdir(androidBuildDir, { recursive: true });
    
    console.log('Copying files for Android build...');
    
    // Files to copy from root directory to android build
    const filesToCopy = [
      'manifest.json',
      'styles.css',
      // Add any other static files your plugin requires
    ];
    
    // Copy each file
    for (const file of filesToCopy) {
      try {
        await fs.copyFile(
          path.join(rootDir, file),
          path.join(androidBuildDir, file)
        );
        console.log(`Copied ${file} to android build directory`);
      } catch (err) {
        console.error(`Error copying ${file}:`, err);
      }
    }
    
    console.log('All plugin files copied to android build directory');
    
    // Create zip file for Android using PowerShell (Windows)
    if (process.platform === 'win32') {
      const command = `powershell -Command "Compress-Archive -Path '${androidBuildDir}\\*' -DestinationPath '${zipPath}' -Force"`;
      
      exec(command, (error, stdout, stderr) => {
        if (error) {
          console.error(`Error creating zip: ${error.message}`);
          return;
        }
        if (stderr) {
          console.error(`Zip stderr: ${stderr}`);
          return;
        }
        console.log(`Zip created successfully at: ${zipPath}`);
      });
    } else {
      // For Linux/Mac
      const command = `cd "${androidBuildDir}" && zip -r "${zipPath}" .`;
      
      exec(command, (error, stdout, stderr) => {
        if (error) {
          console.error(`Error creating zip: ${error.message}`);
          return;
        }
        console.log(`Zip created successfully at: ${zipPath}`);
      });
    }
    
  } catch (err) {
    console.error('Error preparing Android build:', err);
  }
}

prepareAndroidBuild();