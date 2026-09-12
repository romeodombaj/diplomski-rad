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
    const platformRoot = config.modRequest.platformProjectRoot;

    const src = sourceModel(projectRoot);
    const dest = path.join(platformRoot, 'mobileapp', MODEL_FILENAME);
    copyIfChanged(src, dest);

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
      const platformRoot = config.modRequest.platformProjectRoot;

      const src = sourceModel(projectRoot);
      const dest = path.join(platformRoot, 'app', 'src', 'main', 'assets', MODEL_FILENAME);
      copyIfChanged(src, dest);

      return config;
    },
  ]);
}

module.exports = function withOnnxModel(config) {
  return withOnnxModelAndroid(withOnnxModelIos(config));
};
