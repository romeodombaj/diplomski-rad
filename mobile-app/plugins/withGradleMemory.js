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
