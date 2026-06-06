import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';

// Base URL for the photo upload endpoint. Photo uploads carry sensitive
// geo-tagged evidence (photo + lat/long), so plain HTTP is REJECTED on
// production native builds — fail-closed rather than transmit insecurely.
//
// Resolution order:
//   1) `EXPO_PUBLIC_API_BASE_URL` env var (must be HTTPS in production).
//   2) Web: `window.location.origin` (HTTPS under Replit deploys).
//   3) Otherwise (native, no env var): throw — caller surfaces a clear
//      configuration error instead of silently downgrading transport.
//
// Dev-only exemptions allow `http://` for `localhost` and `127.0.0.1` so
// local Expo Go / simulators keep working against a dev server.
const isHttps = (url: string): boolean => {
  try { return new URL(url).protocol === 'https:'; } catch { return false; }
};

const isDevLocalhost = (url: string): boolean => {
  try {
    const u = new URL(url);
    return (u.hostname === 'localhost' || u.hostname === '127.0.0.1');
  } catch { return false; }
};

const getBaseUrl = (): string => {
  const envUrl = (process.env.EXPO_PUBLIC_API_BASE_URL as string | undefined)?.trim();
  if (envUrl) {
    const cleaned = envUrl.replace(/\/+$/, '');
    if (!isHttps(cleaned) && !(__DEV__ && isDevLocalhost(cleaned))) {
      throw new Error(
        '[photoUpload] EXPO_PUBLIC_API_BASE_URL must use HTTPS in production. ' +
        'Plain HTTP is only allowed for localhost/127.0.0.1 in development.'
      );
    }
    return cleaned;
  }

  if (typeof window !== 'undefined' && window.location?.origin) {
    const origin = window.location.origin;
    if (!isHttps(origin) && !(__DEV__ && isDevLocalhost(origin))) {
      throw new Error(
        '[photoUpload] Refusing to upload over plain HTTP. ' +
        'Open the app over HTTPS or set EXPO_PUBLIC_API_BASE_URL to an HTTPS URL.'
      );
    }
    return origin;
  }

  // Native build with no configured endpoint — fail closed.
  throw new Error(
    '[photoUpload] EXPO_PUBLIC_API_BASE_URL is not set. ' +
    'Native builds must be configured with an HTTPS upload endpoint before submitting evidence.'
  );
};

interface PhotoToUpload {
  uri: string;
  latitude?: string;
  longitude?: string;
  timestamp: string;
}

interface UploadedPhotoResult {
  uri: string;
  latitude?: string;
  longitude?: string;
  timestamp: string;
}

export async function uploadPhotos(
  photos: PhotoToUpload[],
  uploadedBy?: string,
  entityType?: string,
  entityId?: string
): Promise<UploadedPhotoResult[]> {
  if (!photos || photos.length === 0) return [];

  // Resolve the upload host up front so any transport-config error throws
  // BEFORE we burn time reading photos into base64.
  const baseUrl = getBaseUrl();

  const photosWithBase64 = [];

  for (const photo of photos) {
    let base64: string;

    if (photo.uri.startsWith('data:')) {
      const parts = photo.uri.split(',');
      base64 = parts[1] || parts[0];
    } else if (Platform.OS === 'web') {
      try {
        const response = await fetch(photo.uri);
        const blob = await response.blob();
        base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            const result = reader.result as string;
            const b64 = result.split(',')[1] || result;
            resolve(b64);
          };
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      } catch (err) {
        console.error('Failed to read photo on web:', err);
        continue;
      }
    } else {
      try {
        // On Android, content:// URIs from the gallery need to be copied to a
        // cache file first before expo-file-system can read them as base64.
        let readUri = photo.uri;
        if (photo.uri.startsWith('content://')) {
          const ext = photo.uri.split('.').pop()?.split('?')[0] || 'jpg';
          const dest = `${FileSystem.cacheDirectory}upload_${Date.now()}.${ext}`;
          await FileSystem.copyAsync({ from: photo.uri, to: dest });
          readUri = dest;
        }
        base64 = await FileSystem.readAsStringAsync(readUri, {
          encoding: 'base64' as any,
        });
      } catch (err) {
        console.error('Failed to read photo file:', err);
        throw new Error(
          `Could not read photo from device storage. Please try taking the photo again. (${err instanceof Error ? err.message : 'unknown error'})`
        );
      }
    }

    photosWithBase64.push({
      base64,
      mimeType: 'image/jpeg',
      fileName: `photo_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.jpg`,
      latitude: photo.latitude,
      longitude: photo.longitude,
    });
  }

  if (photosWithBase64.length === 0) {
    throw new Error('No photos could be prepared for upload. Please try taking the photos again.');
  }

  const response = await fetch(`${baseUrl}/api/photos/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      photos: photosWithBase64,
      uploadedBy,
      entityType,
      entityId,
    }),
  });

  if (!response.ok) {
    if (response.status === 413) {
      throw new Error(
        'Photo is too large for the server (HTTP 413). Please retake with lower resolution or ask admin to increase nginx client_max_body_size.'
      );
    }
    throw new Error(`Upload failed (HTTP ${response.status})`);
  }

  const result = await response.json();

  return result.photos.map((p: any) => ({
    uri: `${baseUrl}${p.url}`,
    latitude: p.latitude,
    longitude: p.longitude,
    timestamp: new Date().toISOString(),
  }));
}

// Per-photo size cap. Capped at 0.7 MB so that after base64 encoding (~33%
// overhead) the full request body stays under nginx's 1 MB client_max_body_size.
// Once nginx is updated to allow larger bodies (client_max_body_size 15M),
// raise this back to 5 and re-sync with MAX_PHOTO_SIZE in server.ts.
export const MAX_PHOTO_SIZE_MB = 0.7;
export const MAX_PHOTO_SIZE_BYTES = MAX_PHOTO_SIZE_MB * 1024 * 1024;

// Best-effort cross-platform byte-size measurement for a photo URI.
// Returns null when the size can't be determined; callers should treat
// "unknown" as acceptable so a measurement failure never blocks a submit —
// the server-side MAX_PHOTO_SIZE check remains the backstop.
export async function getPhotoSizeBytes(uri: string): Promise<number | null> {
  try {
    if (uri.startsWith('data:')) {
      const base64 = uri.split(',')[1] || '';
      const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
      return Math.floor((base64.length * 3) / 4) - padding;
    }
    if (Platform.OS === 'web') {
      const response = await fetch(uri);
      const blob = await response.blob();
      return blob.size;
    }
    const info = await FileSystem.getInfoAsync(uri, { size: true } as any);
    if (info.exists && typeof (info as { size?: number }).size === 'number') {
      return (info as { size: number }).size;
    }
    return null;
  } catch {
    return null;
  }
}

export interface PhotoSizeViolation {
  index: number;
  sizeBytes: number;
}

// Returns the photos (by index) that exceed `maxBytes`. Photos whose size
// can't be measured are NOT reported as violations (fail-open client-side).
export async function findOversizedPhotos(
  photos: { uri: string }[],
  maxBytes: number = MAX_PHOTO_SIZE_BYTES
): Promise<PhotoSizeViolation[]> {
  const violations: PhotoSizeViolation[] = [];
  for (let i = 0; i < photos.length; i++) {
    const size = await getPhotoSizeBytes(photos[i].uri);
    if (size != null && size > maxBytes) {
      violations.push({ index: i, sizeBytes: size });
    }
  }
  return violations;
}
