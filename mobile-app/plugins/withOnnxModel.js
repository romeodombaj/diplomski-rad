/**
 * Config plugin that ships the ONNX face model as a raw native resource on both
 * platforms (bypasses Metro bundler — Metro can't handle 93MB binaries).
 *
 * iOS:     copied into the .app bundle, loadable via FileSystem.bundleDirectory.
 * Android: copied into the APK's assets/, readable via the "asset:///" scheme.
 */
const { withXcodeProject, withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const MODEL_FILENAME = 'siamese_epoch50_int8.onnx';

function sourceModel(projectRoot) {
  const src = path.join(projectRoot, 'assets', 'models', MODEL_FILENAME);
  if (!fs.existsSync(src)) {
    throw new Error(`[withOnnxModel] Model not found at: ${src}`);
  }
  return src;
}

/** Copy only when missing or stale — the file is 93MB, so this is worth checking. */
function copyIfChanged(src, dest) {
  if (!fs.existsSync(dest) || fs.statSync(dest).size !== fs.statSync(src).size) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

function withOnnxModelIos(config) {
  return withXcodeProject(config, (config) => {
    const project = config.modResults;
    const projectRoot = config.modRequest.projectRoot;
    const platformRoot = config.modRequest.platformProjectRoot; // .../ios

    const src = sourceModel(projectRoot);
    // Place next to AppDelegate so it ends up in the main bundle group
    const dest = path.join(platformRoot, 'mobileapp', MODEL_FILENAME);
    copyIfChanged(src, dest);

    // Add to the Xcode project — idempotent via xcode's built-in duplicate check
    const targetName = 'mobileapp';
    const groupName = 'mobileapp';
    const fileRef = project.addFile(MODEL_FILENAME, project.pbxGroupByName(groupName).uuid, {
      lastKnownFileType: 'file',
      defaultEncoding: 4,
      sourceTree: '"<group>"',
    });

    if (fileRef) {
      const target = project.pbxTargetByName(targetName);
      if (target) {
        project.addBuildPhaseObj(
          { fileRef: fileRef.fileRef, settings: {} },
          'PBXResourcesBuildPhase',
          'Resources',
          target.uuid
        );
      }
    }

    return config;
  });
}

function withOnnxModelAndroid(config) {
  return withDangerousMod(config, [
    'android',
    (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const platformRoot = config.modRequest.platformProjectRoot; // .../android

      const src = sourceModel(projectRoot);
      // Anything under src/main/assets is packaged into the APK verbatim and is
      // reachable at runtime as asset:///<filename>.
      const dest = path.join(platformRoot, 'app', 'src', 'main', 'assets', MODEL_FILENAME);
      copyIfChanged(src, dest);

      return config;
    },
  ]);
}

module.exports = function withOnnxModel(config) {
  return withOnnxModelAndroid(withOnnxModelIos(config));
};
