/**
 * Registers OnnxruntimePackage with React Native.
 *
 * onnxruntime-react-native still ships the legacy `unimodule.json`, so Expo's
 * autolinking claims it: useExpoModules() includes the Gradle project (which is
 * why libonnxruntime.so ships) but the modern Expo path only registers modules
 * declaring `expo-module.config.json`, and this one is a plain ReactPackage.
 * Being claimed also drops it from the React Native CLI config that generates
 * PackageList.java, so nothing ever registers it and NativeModules.Onnxruntime
 * is null. MainApplication's manual-package hook covers that gap.
 *
 * NOTE: this app runs the New Architecture, where legacy modules reach JS via
 * the TurboModule interop layer. Forcing that on with
 * ReactNativeFeatureFlags.override() is NOT possible here: before
 * loadReactNative() the flags class cannot load its native library
 * ("SoLoader.init() not yet called"), and after it React Native has already
 * installed its own override ("Feature flags cannot be overridden more than
 * once"). If interop turns out to be required, it needs a different mechanism
 * than an override from Application.onCreate.
 */
const { withMainApplication } = require('@expo/config-plugins');

const IMPORT = 'import ai.onnxruntime.reactnative.OnnxruntimePackage';
const REGISTER = 'add(OnnxruntimePackage())';
const PACKAGE_ANCHOR = '// add(MyReactNativePackage())';

// Left over from the abandoned interop attempt; stripped so that a prebuild
// without --clean, which keeps the existing MainApplication.kt, cannot leave a
// stale override behind.
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
