const { withMainApplication } = require('@expo/config-plugins');

const IMPORT = 'import ai.onnxruntime.reactnative.OnnxruntimePackage';
const REGISTER = 'add(OnnxruntimePackage())';
const PACKAGE_ANCHOR = '// add(MyReactNativePackage())';

const STALE_INTEROP = /\n\s*ReactNativeFeatureFlags\.override\(\n(?:.*\n)*?\s*\}\)/;
const STALE_IMPORTS = /\nimport com\.facebook\.react\.internal\.featureflags\.[A-Za-z]+\n/g;

module.exports = function withOnnxPackage(config) {
  return withMainApplication(config, (config) => {
    if (config.modResults.language !== 'kt') {
      throw new Error(`[withOnnxPackage] expected a Kotlin MainApplication, got ${config.modResults.language}`);
    }

    let src = config.modResults.contents;

    src = src.replace(STALE_INTEROP, '');
    src = src.replace(STALE_IMPORTS, '\n');

    if (!src.includes(IMPORT)) {
      src = src.replace(/^(package .+\n)/m, `$1\n${IMPORT}\n`);
    }

    if (!src.includes(REGISTER)) {
      if (!src.includes(PACKAGE_ANCHOR)) {
        throw new Error('[withOnnxPackage] could not find the manual-package anchor in MainApplication');
      }
      src = src.replace(PACKAGE_ANCHOR, `${PACKAGE_ANCHOR}\n              ${REGISTER}`);
    }

    if (src.includes('useTurboModuleInterop')) {
      throw new Error('[withOnnxPackage] stale feature-flag override survived in MainApplication');
    }

    config.modResults.contents = src;
    return config;
  });
};
