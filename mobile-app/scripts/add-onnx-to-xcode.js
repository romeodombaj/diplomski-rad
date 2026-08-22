#!/usr/bin/env node
/**
 * Manually patches project.pbxproj to add the ONNX model as a bundle resource.
 * Uses raw string manipulation to avoid the xcode npm package's group-path bug.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const pbxprojPath = path.join(__dirname, '../ios/mobileapp.xcodeproj/project.pbxproj');
let content = fs.readFileSync(pbxprojPath, 'utf8');

const MODEL = 'siamese_epoch50_int8.onnx';

if (content.includes(MODEL)) {
  console.log('Already in project.pbxproj — nothing to do.');
  process.exit(0);
}

// Generate two deterministic UUIDs (24 hex chars, uppercase)
function uuid(seed) {
  return crypto.createHash('md5').update(seed).digest('hex').slice(0, 24).toUpperCase();
}
const fileRefUUID = uuid('fileref:' + MODEL);
const buildFileUUID = uuid('buildfile:' + MODEL);

// 1. Add PBXFileReference
const fileRef = `\t\t${fileRefUUID} /* ${MODEL} */ = {isa = PBXFileReference; lastKnownFileType = file; name = "${MODEL}"; path = "${MODEL}"; sourceTree = "<group>"; };`;
content = content.replace(
  /\/\* End PBXFileReference section \*\//,
  fileRef + '\n/* End PBXFileReference section */'
);

// 2. Add PBXBuildFile
const buildFile = `\t\t${buildFileUUID} /* ${MODEL} in Resources */ = {isa = PBXBuildFile; fileRef = ${fileRefUUID} /* ${MODEL} */; };`;
content = content.replace(
  /\/\* End PBXBuildFile section \*\//,
  buildFile + '\n/* End PBXBuildFile section */'
);

// 3. Add to PBXResourcesBuildPhase (first one found — the main target's resources)
content = content.replace(
  /(isa = PBXResourcesBuildPhase;[\s\S]*?files = \()([\s\S]*?)(\);[\s\S]*?runOnlyForDeploymentPostprocessing)/,
  (match, before, files, after) => {
    const entry = `\n\t\t\t\t${buildFileUUID} /* ${MODEL} in Resources */,`;
    return before + entry + files + after;
  }
);

// 4. Add to the mobileapp group children
content = content.replace(
  /(name = mobileapp;\s*sourceTree = "<group>";\s*\};[\s\S]{0,200}?children = \()([\s\S]*?)(\);)/,
  (match, before, children, after) => {
    const entry = `\n\t\t\t\t${fileRefUUID} /* ${MODEL} */,`;
    return before + entry + children + after;
  }
);

fs.writeFileSync(pbxprojPath, content);
console.log('Done — added', MODEL, 'to Xcode bundle resources with UUIDs', fileRefUUID, '/', buildFileUUID);
