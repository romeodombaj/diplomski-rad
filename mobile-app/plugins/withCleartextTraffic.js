/**
 * Android blocks cleartext HTTP by default from targetSdkVersion 28 on, so a
 * release APK talking to the backend over http:// on the LAN gets every request
 * refused. Debug builds are unaffected — React Native's own debug manifest opts
 * in — which is why this only shows up once you install a real build on a phone.
 *
 * The opt-in is derived from the API URL rather than hardcoded, so pointing
 * EXPO_PUBLIC_API_URL at an https:// backend drops the exemption automatically.
 * Mirrors the fallback in src/lib/apiFetch.ts so the two can't disagree.
 */
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
