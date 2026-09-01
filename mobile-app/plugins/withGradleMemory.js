/**
 * Raises the Gradle daemon heap.
 *
 * The prebuild template ships org.gradle.jvmargs=-Xmx2048m, which is not enough
 * to dex this app once onnxruntime-react-native is part of the build: D8 dies in
 * :app:mergeExtDexRelease with "OutOfMemoryError: Java heap space". It has to
 * live here rather than in ~/.gradle/gradle.properties so that EAS Build gets it
 * too — android/ is generated, so the template value would otherwise come back
 * on every prebuild.
 */
const { withGradleProperties } = require('@expo/config-plugins');

const KEY = 'org.gradle.jvmargs';
const VALUE = '-Xmx6g -XX:MaxMetaspaceSize=1g';

module.exports = function withGradleMemory(config) {
  return withGradleProperties(config, (config) => {
    const existing = config.modResults.find(
      (item) => item.type === 'property' && item.key === KEY
    );

    if (existing) {
      existing.value = VALUE;
    } else {
      config.modResults.push({ type: 'property', key: KEY, value: VALUE });
    }

    return config;
  });
};
