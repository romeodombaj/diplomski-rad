const { withAndroidManifest, AndroidConfig } = require('@expo/config-plugins');

module.exports = function withCleartextTraffic(config) {
  return withAndroidManifest(config, (config) => {
    const apiUrl = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:5001';
    if (!apiUrl.startsWith('http://')) return config;

    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(config.modResults);
    application.$['android:usesCleartextTraffic'] = 'true';
    console.log(`[withCleartextTraffic] enabled — API URL is cleartext: ${apiUrl}`);
    return config;
  });
};
