'use strict';

/**
 * Harness preload marks the CLIENT document with Node's platform name.
 * The plugin host may run remotely on another OS, so never use its platform.
 * Missing/unknown markers retain the official settings appearance.
 */
function getSettingsPlatform(doc) {
  switch (doc.documentElement?.getAttribute('data-platform')) {
    case 'darwin': return 'macos';
    case 'win32': return 'windows';
    default: return 'default';
  }
}

function clearSettingsPlatform(doc) {
  doc.body?.removeAttribute('data-whale-settings-platform');
  doc.body?.removeAttribute('data-whale-settings-reduced');
  doc.body?.removeAttribute('data-whale-mac-settings');
  doc.body?.removeAttribute('data-whale-mac-settings-reduced');
}

function applySettingsPlatform(doc, { enabled, reduced }) {
  const platform = enabled ? getSettingsPlatform(doc) : 'default';
  if (!doc.body) return 'default';
  if (platform === 'default') clearSettingsPlatform(doc);
  else {
    doc.body.setAttribute('data-whale-settings-platform', platform);
    doc.body.toggleAttribute('data-whale-settings-reduced', !!reduced);
    // Keep the accepted macOS stylesheet and its material fallback unchanged.
    doc.body.toggleAttribute('data-whale-mac-settings', platform === 'macos');
    doc.body.toggleAttribute('data-whale-mac-settings-reduced', platform === 'macos' && !!reduced);
  }
  return platform;
}

module.exports = { getSettingsPlatform, applySettingsPlatform, clearSettingsPlatform };
