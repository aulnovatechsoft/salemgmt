import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';

const getBaseUrl = () => {
  if (Platform.OS === 'ios' || Platform.OS === 'android') {
    return 'http://117.251.72.195';
  }
  if (typeof window !== 'undefined' && window.location) {
    return window.location.origin;
  }
  return 'http://117.251.72.195';
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

  const baseUrl = getBaseUrl();
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
