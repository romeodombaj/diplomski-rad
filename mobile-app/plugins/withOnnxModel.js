/**
 * Config plugin that copies the ONNX face model into the iOS native bundle
 * as a raw resource (bypasses Metro bundler — Metro can't handle 93MB binaries).
 * The file is then loadable at runtime via FileSystem.bundleDirectory.
 */
const { withXcodeProject } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const MODEL_FILENAME = 'siamese_epoch50_int8.onnx';

module.exports = function withOnnxModel(config) {
  return withXcodeProject(config, (config) => {
    const project = config.modResults;
    const projectRoot = config.modRequest.projectRoot;
    const platformRoot = config.modRequest.platformProjectRoot; // .../ios

    const src = path.join(projectRoot, 'assets', 'models', MODEL_FILENAME);
    // Place next to AppDelegate so it ends up in the main bundle group
    const dest = path.join(platformRoot, 'mobileapp', MODEL_FILENAME);

    if (!fs.existsSync(src)) {
      throw new Error(`[withOnnxModel] Model not found at: ${src}`);
    }

    // Copy the file (skip if already up-to-date)
    if (!fs.existsSync(dest) || fs.statSync(dest).size !== fs.statSync(src).size) {
      fs.copyFileSync(src, dest);
    }

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
};
