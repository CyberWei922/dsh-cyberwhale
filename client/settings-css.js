'use strict';

// Both stylesheets are bundled once. The appearance controller selects the
// client platform with body attributes; each platform owns its scoped rules.
const { CSS: MACOS_CSS } = require('./settings-macos-css.js');
const { CSS: WINDOWS_CSS } = require('./settings-windows-css.js');

module.exports = { CSS: `${MACOS_CSS}\n${WINDOWS_CSS}` };
