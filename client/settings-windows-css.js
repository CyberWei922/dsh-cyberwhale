'use strict';

/**
 * Windows / WinUI 3 visual extension point. Intentionally empty for now:
 * settings retain the official Harness layout and controls on Windows.
 *
 * Scope every future rule to:
 * body[data-whale-settings-platform="windows"] [data-shortcut-modal="settings"]
 *
 * The controller sets this gate only on a Windows client while appearance is
 * enabled. Use data-ds-dark-theme for dark mode and shared --dsw-* tokens.
 * data-whale-settings-reduced signals the plugin/system transparency preference.
 * Keep host DOM, keyboard behavior and ARIA intact; do not use hashed classes.
 * See docs/windows-ui-development.md for the handoff and validation steps.
 */
const CSS = '';

module.exports = { CSS };
