// Apple public AppKit API only. This module owns one decorative view in the
// helper's own window; no other application's native views are accessed.
#import <AppKit/AppKit.h>
#include <node_api.h>
#include <cmath>
#include <cstring>

@interface WhaleGlassSeat : NSView
@end
@implementation WhaleGlassSeat
- (NSView *)hitTest:(NSPoint)point { return nil; }
@end

static WhaleGlassSeat *seat;
static NSView *glass;

static void OnMain(void (^block)(void)) {
  if ([NSThread isMainThread]) block();
  else dispatch_sync(dispatch_get_main_queue(), block);
}
static napi_value Bool(napi_env env, bool value) {
  napi_value result; napi_get_boolean(env, value, &result); return result;
}
static void Remove() {
  [seat removeFromSuperview]; glass = nil; seat = nil;
}
static napi_value Supported(napi_env env, napi_callback_info info) {
  if (@available(macOS 26.0, *)) return Bool(env, NSClassFromString(@"NSGlassEffectView") != Nil);
  return Bool(env, false);
}
static napi_value Reduced(napi_env env, napi_callback_info info) {
  __block bool reduced = false;
  OnMain(^{ reduced = NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceTransparency
    || NSWorkspace.sharedWorkspace.accessibilityDisplayShouldIncreaseContrast; });
  return Bool(env, reduced);
}
static napi_value Attach(napi_env env, napi_callback_info info) {
  size_t count = 1, length = 0; napi_value args[1]; void *bytes = nullptr;
  bool isBuffer = false;
  napi_get_cb_info(env, info, &count, args, nullptr, nullptr);
  if (count != 1 || napi_is_buffer(env, args[0], &isBuffer) != napi_ok || !isBuffer
    || napi_get_buffer_info(env, args[0], &bytes, &length) != napi_ok || length != sizeof(void *)) return Bool(env, false);
  void *pointer = nullptr; std::memcpy(&pointer, bytes, sizeof(pointer));
  if (pointer == nullptr) return Bool(env, false);
  __block bool attached = false;
  OnMain(^{
    if (@available(macOS 26.0, *)) {
      @try {
        Remove();
        NSView *root = (__bridge NSView *)pointer;
        if (root.window == nil) return;
        seat = [[WhaleGlassSeat alloc] initWithFrame:NSZeroRect];
        seat.hidden = YES;
        NSGlassEffectView *effect = [[NSClassFromString(@"NSGlassEffectView") alloc] initWithFrame:NSZeroRect];
        effect.style = NSGlassEffectViewStyleRegular;
        // Let AppKit render its neutral Liquid Glass material without a plugin tint.
        effect.tintColor = nil;
        effect.cornerRadius = 13;
        effect.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
        glass = effect;
        [seat addSubview:effect];
        // Keep Chromium, the text, and the sprite above this decorative seat.
        [root addSubview:seat positioned:NSWindowBelow relativeTo:nil];
        attached = true;
      } @catch (NSException *exception) { Remove(); }
    }
  });
  return Bool(env, attached);
}
static napi_value Update(napi_env env, napi_callback_info info) {
  size_t count = 6; napi_value args[6]; double values[4]; bool visible, dark;
  napi_get_cb_info(env, info, &count, args, nullptr, nullptr);
  if (count != 6) return Bool(env, false);
  for (int i = 0; i < 4; ++i)
    if (napi_get_value_double(env, args[i], &values[i]) != napi_ok || !std::isfinite(values[i])) return Bool(env, false);
  if (values[2] <= 0 || values[3] <= 0
    || napi_get_value_bool(env, args[4], &visible) != napi_ok
    || napi_get_value_bool(env, args[5], &dark) != napi_ok) return Bool(env, false);
  const NSRect incoming = NSMakeRect(values[0], values[1], values[2], values[3]);
  __block bool updated = false;
  OnMain(^{
    if (@available(macOS 26.0, *)) {
      if (seat.superview == nil || glass == nil) return;
      NSView *root = seat.superview;
      CGFloat y = root.isFlipped ? incoming.origin.y : NSHeight(root.bounds) - incoming.origin.y - incoming.size.height;
      seat.frame = NSMakeRect(incoming.origin.x, y, incoming.size.width, incoming.size.height);
      glass.frame = seat.bounds;
      glass.appearance = [NSAppearance appearanceNamed:dark ? NSAppearanceNameDarkAqua : NSAppearanceNameAqua];
      seat.hidden = !visible;
      updated = true;
    }
  });
  return Bool(env, updated);
}
static napi_value Detach(napi_env env, napi_callback_info info) {
  OnMain(^{ Remove(); }); return Bool(env, true);
}
static napi_value Snapshot(napi_env env, napi_callback_info info) {
  __block NSRect frame = NSZeroRect; __block bool attached = false, visible = false;
  OnMain(^{
    NSView *root = seat.superview;
    if (root == nil) return;
    attached = true; visible = !seat.hidden;
    frame = seat.frame;
    if (!root.isFlipped) frame.origin.y = NSHeight(root.bounds) - frame.origin.y - frame.size.height;
  });
  napi_value result, value;
  napi_create_object(env, &result);
  napi_set_named_property(env, result, "attached", Bool(env, attached));
  napi_set_named_property(env, result, "visible", Bool(env, visible));
  const char *keys[] = {"left", "top", "width", "height"};
  const double values[] = {frame.origin.x, frame.origin.y, frame.size.width, frame.size.height};
  for (int i = 0; i < 4; ++i) { napi_create_double(env, values[i], &value); napi_set_named_property(env, result, keys[i], value); }
  napi_create_string_utf8(env, attached ? "NSGlassEffectView" : "none", NAPI_AUTO_LENGTH, &value);
  napi_set_named_property(env, result, "material", value);
  return result;
}
static void Cleanup(void *data) { OnMain(^{ Remove(); }); }
static napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor properties[] = {
    { "supported", nullptr, Supported, nullptr, nullptr, nullptr, napi_default, nullptr },
    { "reducedTransparency", nullptr, Reduced, nullptr, nullptr, nullptr, napi_default, nullptr },
    { "attach", nullptr, Attach, nullptr, nullptr, nullptr, napi_default, nullptr },
    { "update", nullptr, Update, nullptr, nullptr, nullptr, napi_default, nullptr },
    { "detach", nullptr, Detach, nullptr, nullptr, nullptr, napi_default, nullptr },
    { "snapshot", nullptr, Snapshot, nullptr, nullptr, nullptr, napi_default, nullptr },
  };
  napi_define_properties(env, exports, sizeof(properties) / sizeof(properties[0]), properties);
  napi_add_env_cleanup_hook(env, Cleanup, nullptr);
  return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
