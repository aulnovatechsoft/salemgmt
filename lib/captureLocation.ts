// Cross-platform GPS capture used by every BSNL submission screen
// (Sales, O&M, Finance). Centralised here so the next screen author
// can't reintroduce the Null Island regression we hit in production
// (an earlier `if (Platform.OS === 'web') setLocation({lat:'0', lon:'0'})`
// shortcut silently lied to users with a "Location Captured ✓" pill while
// every web submission was hard-rejected by the server geo-fence).
//
// Contract:
//   - Returns { ok: true, latitude, longitude } only when the coords are
//     real device GPS values. Never silently falls back to (0,0).
//   - Returns { ok: false, ... } with a human-readable, action-oriented
//     message that the caller can drop straight into an Alert.
//   - On web, detects insecure context FIRST and explains the HTTPS
//     requirement, because Chrome/Safari/Firefox all return a generic
//     PERMISSION_DENIED on http:// origins and the standard "enable
//     in browser settings" guidance is misleading there.
//   - On native, runs the Expo permission prompt before getCurrentPosition
//     so callers don't have to remember the two-step dance.

import { Platform } from 'react-native';
import * as Location from 'expo-location';

export type CaptureResult =
  | { ok: true; latitude: number; longitude: number; capturedAt: number; isTestLocation?: boolean }
  | { ok: false; reason: CaptureFailureReason; title: string; message: string };

// === TEST MODE =============================================================
// Gated by EXPO_PUBLIC_GPS_TEST_MODE. When set to "1" / "true" / "on", web
// captures bypass navigator.geolocation entirely and return a known-good
// Indian coordinate so the QA team can exercise the full submission flow
// without HTTPS / real GPS hardware.
//
// IMPORTANT: This MUST stay disabled in production builds. The
// EXPO_PUBLIC_ prefix means the value is baked into the JS bundle at
// build time, so the production deploy must build with the variable
// unset (or set to "0"). The CaptureResult carries `isTestLocation:true`
// so screens can render an unmissable "TEST MODE" banner — the helper
// will never silently inject test coords without the UI knowing.
//
// Coordinates: Bharat Sanchar Bhawan (BSNL Corporate HQ), Janpath, New Delhi.
const TEST_LOCATION = { latitude: 28.6259, longitude: 77.2088 } as const;
export const TEST_LOCATION_LABEL = 'Bharat Sanchar Bhawan, New Delhi';

export function isGpsTestMode(): boolean {
  // Read from process.env via the EXPO_PUBLIC_ convention. Safe in both
  // Node (server) and the bundled web/native runtimes — Metro inlines
  // EXPO_PUBLIC_* values at build time.
  const raw = (typeof process !== 'undefined' ? process.env?.EXPO_PUBLIC_GPS_TEST_MODE : undefined) ?? '';
  const v = String(raw).toLowerCase().trim();
  return v === '1' || v === 'true' || v === 'on' || v === 'yes';
}
// ===========================================================================

export type CaptureFailureReason =
  | 'INSECURE_ORIGIN'
  | 'UNSUPPORTED'
  | 'PERMISSION_DENIED'
  | 'PERMISSION_NOT_GRANTED_YET' // soft / silent — used by auto-capture on mount
  | 'POSITION_UNAVAILABLE'
  | 'TIMEOUT'
  | 'INVALID_COORDS'
  | 'UNKNOWN';

export interface CaptureOptions {
  // When true (used for auto-capture on screen mount), the helper will
  // NOT trigger the browser/OS permission prompt if the user hasn't
  // already granted permission — it just returns
  // PERMISSION_NOT_GRANTED_YET silently. This avoids the UX anti-pattern
  // of asking for sensitive permissions before the user has expressed
  // intent. Explicit "Capture GPS" button presses should pass false (the
  // default), which DOES trigger the prompt.
  onlyIfAlreadyGranted?: boolean;
}

// Detect whether the current web origin can use the geolocation API.
// Per W3C Secure Contexts spec, navigator.geolocation only works on
// https://, file://, or localhost / 127.0.0.1. Browsers either return
// undefined for the API or a generic permission error otherwise.
function isWebSecureOrigin(): boolean {
  if (typeof window === 'undefined' || !window.location) return false;
  if ((window as any).isSecureContext === true) return true;
  const proto = window.location.protocol;
  const host = window.location.hostname;
  if (proto === 'https:' || proto === 'file:') return true;
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;
  return false;
}

// Reject coordinates that are exactly (0, 0) — Null Island, off the
// coast of Africa. No real BSNL site is anywhere near it, and a (0, 0)
// reading is overwhelmingly likely to be a buggy browser/device, a
// stubbed mock, or a future regression of the original Null Island bug.
// Treating it as INVALID_COORDS keeps the "never silently corrupt
// submissions" invariant true at runtime, on top of the type-level
// shape of CaptureResult.
// Exported so per-photo native refresh paths in takePhoto/pickImage can
// validate freshly-fetched coords before using them as a substitute for
// screen-level currentLocation. Keeps the (0,0)-can-never-leak invariant
// true even on the per-photo refresh shortcut that bypasses captureLocation.
export function isNullIsland(lat: number, lon: number): boolean {
  return Math.abs(lat) < 0.0001 && Math.abs(lon) < 0.0001;
}

const NULL_ISLAND_RESULT: CaptureResult = {
  ok: false,
  reason: 'INVALID_COORDS',
  title: 'GPS reading invalid',
  message: 'Your device returned an invalid location (0, 0). This usually means GPS has not yet locked on. Wait a few seconds, move outside if possible, and try again.',
};

export async function captureLocation(opts: CaptureOptions = {}): Promise<CaptureResult> {
  // Test-mode short-circuit (web only — native devices have real GPS).
  // Simulates a brief acquisition delay so loading states behave naturally.
  if (Platform.OS === 'web' && isGpsTestMode()) {
    await new Promise((r) => setTimeout(r, 300));
    return {
      ok: true,
      latitude: TEST_LOCATION.latitude,
      longitude: TEST_LOCATION.longitude,
      capturedAt: Date.now(),
      isTestLocation: true,
    };
  }

  if (Platform.OS === 'web') {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      return {
        ok: false,
        reason: 'UNSUPPORTED',
        title: 'GPS not supported',
        message: 'This browser does not support location access. Please open the app on a device with GPS.',
      };
    }
    if (!isWebSecureOrigin()) {
      return {
        ok: false,
        reason: 'INSECURE_ORIGIN',
        title: 'Secure connection required',
        message: 'GPS only works over HTTPS. Open this site using https:// instead of http://, or use the mobile app, then try again.',
      };
    }
    // Avoid popping a permission prompt during auto-capture-on-mount.
    // The Permissions API tells us whether the user has already granted
    // location for this origin; only then do we call getCurrentPosition
    // (which would otherwise prompt). Browsers that don't support the
    // Permissions API for geolocation (older Safari) fall through and
    // skip auto-capture rather than risk surprising the user.
    if (opts.onlyIfAlreadyGranted) {
      try {
        const perms = (navigator as any).permissions;
        if (!perms || typeof perms.query !== 'function') {
          return {
            ok: false,
            reason: 'PERMISSION_NOT_GRANTED_YET',
            title: 'Location not yet granted',
            message: 'Tap the Capture GPS button to share your location.',
          };
        }
        const status = await perms.query({ name: 'geolocation' as PermissionName });
        if (status.state !== 'granted') {
          return {
            ok: false,
            reason: 'PERMISSION_NOT_GRANTED_YET',
            title: 'Location not yet granted',
            message: 'Tap the Capture GPS button to share your location.',
          };
        }
      } catch {
        return {
          ok: false,
          reason: 'PERMISSION_NOT_GRANTED_YET',
          title: 'Location not yet granted',
          message: 'Tap the Capture GPS button to share your location.',
        };
      }
    }
    try {
      const coords = await new Promise<GeolocationCoordinates>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
          (pos) => resolve(pos.coords),
          (err) => reject(err),
          { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
        );
      });
      if (isNullIsland(coords.latitude, coords.longitude)) return NULL_ISLAND_RESULT;
      return { ok: true, latitude: coords.latitude, longitude: coords.longitude, capturedAt: Date.now() };
    } catch (err: any) {
      const code = err?.code;
      if (code === 1) {
        return {
          ok: false,
          reason: 'PERMISSION_DENIED',
          title: 'Location permission denied',
          message: 'Enable location for this site in your browser (lock icon in the address bar → Permissions → Location), then try again.',
        };
      }
      if (code === 2) {
        return {
          ok: false,
          reason: 'POSITION_UNAVAILABLE',
          title: 'GPS unavailable',
          message: 'Could not determine your location. Make sure GPS / Wi-Fi is on and try again, ideally outdoors with a clear sky view.',
        };
      }
      if (code === 3) {
        return {
          ok: false,
          reason: 'TIMEOUT',
          title: 'GPS timed out',
          message: 'Getting your location took too long. Move to an area with better signal and try again.',
        };
      }
      return {
        ok: false,
        reason: 'UNKNOWN',
        title: 'GPS unavailable',
        message: err?.message ? `Failed to capture GPS: ${err.message}` : 'Failed to capture GPS. Please try again.',
      };
    }
  }

  // Native (iOS / Android)
  try {
    if (opts.onlyIfAlreadyGranted) {
      // Check existing permission state without prompting.
      const existing = await Location.getForegroundPermissionsAsync();
      if (existing.status !== 'granted') {
        return {
          ok: false,
          reason: 'PERMISSION_NOT_GRANTED_YET',
          title: 'Location not yet granted',
          message: 'Tap the Capture GPS button to share your location.',
        };
      }
    } else {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        return {
          ok: false,
          reason: 'PERMISSION_DENIED',
          title: 'Location permission denied',
          message: 'Enable location for this app in your device Settings → Apps → Permissions → Location, then try again.',
        };
      }
    }
    const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    if (isNullIsland(loc.coords.latitude, loc.coords.longitude)) return NULL_ISLAND_RESULT;
    return {
      ok: true,
      latitude: loc.coords.latitude,
      longitude: loc.coords.longitude,
      capturedAt: Date.now(),
    };
  } catch (err: any) {
    return {
      ok: false,
      reason: 'UNKNOWN',
      title: 'GPS unavailable',
      message: err?.message ? `Could not capture GPS: ${err.message}` : 'Could not capture your GPS location. Please make sure location services are enabled and try again.',
    };
  }
}
