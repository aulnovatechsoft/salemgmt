import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';

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
        base64 = await FileSystem.readAsStringAsync(photo.uri, {
          encoding: 'base64' as any,
        });
      } catch (err) {
        console.error('Failed to read photo file:', err);
        continue;
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

  if (photosWithBase64.length === 0) return [];

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
    throw new Error('Failed to upload photos');
  }

  const result = await response.json();

  return result.photos.map((p: any) => ({
    uri: `${baseUrl}${p.url}`,
    latitude: p.latitude,
    longitude: p.longitude,
    timestamp: new Date().toISOString(),
  }));
}
