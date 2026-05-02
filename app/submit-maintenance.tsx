import { useState, useEffect } from 'react';
import { View, Text, TextInput, StyleSheet, ScrollView, TouchableOpacity, Alert, Platform, Image, ActivityIndicator } from 'react-native';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { Camera, MapPin, Trash2, Image as ImageIcon } from 'lucide-react-native';
import { useAuth } from '@/contexts/auth';
import Colors from '@/constants/colors';
import { trpc } from '@/lib/trpc';
import { GeoTaggedPhoto } from '@/types';
import { uploadPhotos } from '@/lib/photoUpload';

type OmTaskType = 'BTS_DOWN' | 'FTTH_DOWN' | 'ROUTE_FAIL' | 'OFC_FAIL';

const TASK_LABEL: Record<OmTaskType, string> = {
  BTS_DOWN: 'BTS Down',
  FTTH_DOWN: 'FTTH Down',
  ROUTE_FAIL: 'Route Fail',
  OFC_FAIL: 'OFC Fail',
};

const SITE_PLACEHOLDER: Record<OmTaskType, string> = {
  BTS_DOWN: 'BTS site code (e.g. BTS-CHN-0231)',
  FTTH_DOWN: 'OLT / FDB ID (e.g. OLT-CHN-12)',
  ROUTE_FAIL: 'Route ID / segment (e.g. RT-NH48-KM142)',
  OFC_FAIL: 'OFC fault location ID',
};

export default function SubmitMaintenanceScreen() {
  const router = useRouter();
  const { eventId, taskType, memberId } = useLocalSearchParams<{
    eventId: string;
    taskType: OmTaskType;
    memberId?: string;
  }>();
  const { employee } = useAuth();
  const utils = trpc.useUtils();

  const [siteId, setSiteId] = useState('');
  const [remarks, setRemarks] = useState('');
  const [photos, setPhotos] = useState<GeoTaggedPhoto[]>([]);
  const [currentLocation, setCurrentLocation] = useState<{ latitude: string; longitude: string } | null>(null);
  const [isCapturingLocation, setIsCapturingLocation] = useState(false);
  const [isUploadingPhotos, setIsUploadingPhotos] = useState(false);
  // Sticky flag: once submission succeeds we keep the button disabled until
  // navigation. Avoids the "did I press it?" flash on web where Alert.alert
  // ignores onPress callbacks, and on fast networks where isPending flips
  // back before router.back() resolves.
  const [hasSubmitted, setHasSubmitted] = useState(false);

  const isValidTaskType = taskType === 'BTS_DOWN' || taskType === 'FTTH_DOWN' || taskType === 'ROUTE_FAIL' || taskType === 'OFC_FAIL';

  const { data: eventData } = trpc.events.getEventWithDetails.useQuery(
    { id: eventId || '' },
    { enabled: !!eventId }
  );

  const submitMutation = trpc.events.submitMaintenanceEntry.useMutation({
    onSuccess: (res) => {
      setHasSubmitted(true);
      utils.events.getEventWithDetails.invalidate();
      utils.events.getMyEvents.invalidate();
      utils.events.getAll.invalidate();
      utils.events.getMyAssignedTasks.invalidate();
      const warn = (res as any)?.geoWarning ? `\n\nNote: ${(res as any).geoWarning}` : '';
      Alert.alert('Submitted', `Maintenance entry recorded.${warn}`, [
        { text: 'OK', onPress: () => router.back() },
      ]);
      // Web fallback: Alert.alert ignores onPress on the web, so navigate
      // back ourselves on the next tick. On native the Alert is non-blocking
      // and this just queues right behind the user's OK tap.
      setTimeout(() => {
        if (router.canGoBack()) router.back();
      }, 50);
    },
    onError: (error) => {
      Alert.alert('Error', error.message || 'Failed to submit maintenance entry');
    },
  });

  useEffect(() => {
    requestLocationPermission();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const requestLocationPermission = async () => {
    if (Platform.OS === 'web') return;
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status === 'granted') {
      captureCurrentLocation();
    }
  };

  const captureCurrentLocation = async () => {
    if (Platform.OS === 'web') {
      setCurrentLocation({ latitude: '0', longitude: '0' });
      return;
    }
    setIsCapturingLocation(true);
    try {
      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      setCurrentLocation({
        latitude: location.coords.latitude.toString(),
        longitude: location.coords.longitude.toString(),
      });
    } catch (error) {
      console.error('Error getting location:', error);
      Alert.alert('GPS Error', 'Could not capture location. Please ensure GPS is on and try again.');
    } finally {
      setIsCapturingLocation(false);
    }
  };

  const takePhoto = async () => {
    const permissionResult = await ImagePicker.requestCameraPermissionsAsync();
    if (permissionResult.granted === false) {
      Alert.alert('Permission Required', 'Permission to access camera is required!');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: false,
      aspect: [4, 3],
      quality: 0.7,
    });
    if (!result.canceled && result.assets[0]) {
      let photoLocation = currentLocation;
      if (Platform.OS !== 'web') {
        try {
          const location = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.High,
          });
          photoLocation = {
            latitude: location.coords.latitude.toString(),
            longitude: location.coords.longitude.toString(),
          };
        } catch {
          // fall back to current capture
        }
      }
      const newPhoto: GeoTaggedPhoto = {
        uri: result.assets[0].uri,
        latitude: photoLocation?.latitude,
        longitude: photoLocation?.longitude,
        timestamp: new Date().toISOString(),
      };
      setPhotos([...photos, newPhoto]);
      if (photoLocation) setCurrentLocation(photoLocation);
    }
  };

  const pickImage = async () => {
    const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (permissionResult.granted === false) {
      Alert.alert('Permission Required', 'Permission to access gallery is required!');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.7,
    });
    if (!result.canceled && result.assets[0]) {
      const newPhoto: GeoTaggedPhoto = {
        uri: result.assets[0].uri,
        latitude: currentLocation?.latitude,
        longitude: currentLocation?.longitude,
        timestamp: new Date().toISOString(),
      };
      setPhotos([...photos, newPhoto]);
    }
  };

  const removePhoto = (index: number) => {
    setPhotos(photos.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    if (!employee?.id || !eventId || !isValidTaskType) {
      Alert.alert('Error', 'Invalid session or missing parameters.');
      return;
    }
    if (!siteId.trim()) {
      Alert.alert('Site ID required', 'Please enter the Site / Location ID for this fault.');
      return;
    }
    if (photos.length === 0) {
      Alert.alert('Photo required', 'Please add at least one geo-tagged photo before submitting.');
      return;
    }
    if (!currentLocation?.latitude || !currentLocation?.longitude) {
      Alert.alert('GPS required', 'Please tap "Capture GPS Location" before submitting.');
      return;
    }

    let uploadedPhotoResults: GeoTaggedPhoto[];
    try {
      setIsUploadingPhotos(true);
      uploadedPhotoResults = await uploadPhotos(
        photos,
        employee.id,
        'maintenance_entry',
        eventId
      );
    } catch (err) {
      console.error('Photo upload failed:', err);
      Alert.alert('Upload Error', 'Failed to upload photos. Please try again.');
      setIsUploadingPhotos(false);
      return;
    }
    setIsUploadingPhotos(false);

    if (uploadedPhotoResults.length === 0) {
      Alert.alert('Upload Error', 'No photos uploaded. Please try again.');
      return;
    }

    submitMutation.mutate({
      eventId,
      taskType: taskType as OmTaskType,
      targetEmployeeId: memberId || undefined,
      photos: uploadedPhotoResults,
      gpsLatitude: currentLocation.latitude,
      gpsLongitude: currentLocation.longitude,
      siteId: siteId.trim(),
      remarks: remarks.trim() || undefined,
    });
  };

  if (!isValidTaskType) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>Invalid task type. Expected one of BTS_DOWN, FTTH_DOWN, ROUTE_FAIL, OFC_FAIL.</Text>
      </View>
    );
  }

  const taskLabel = TASK_LABEL[taskType as OmTaskType];
  const sitePlaceholder = SITE_PLACEHOLDER[taskType as OmTaskType];

  const targetMember = memberId
    ? eventData?.teamWithAllocations?.find((t: any) => t.employeeId === memberId)
    : eventData?.teamWithAllocations?.find((t: any) => t.employeeId === employee?.id);

  return (
    <>
      <Stack.Screen
        options={{
          title: `Submit ${taskLabel}`,
          headerStyle: { backgroundColor: Colors.light.primary },
          headerTintColor: Colors.light.background,
          headerTitleStyle: { fontWeight: 'bold' as const },
        }}
      />
      <ScrollView style={styles.container}>
        {eventData && (
          <View style={styles.eventInfo}>
            <Text style={styles.eventName}>{eventData.name}</Text>
            <Text style={styles.eventLocation}>{eventData.location}</Text>
            <View style={styles.taskTypeBadge}>
              <Text style={styles.taskTypeBadgeText}>{taskLabel}</Text>
            </View>
            {targetMember && memberId && memberId !== employee?.id && (
              <Text style={styles.targetNote}>
                Recording on behalf of: {(targetMember as any).employee?.name || memberId}
              </Text>
            )}
          </View>
        )}

        <View style={styles.form}>
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Site / Location ID *</Text>
            <TextInput
              style={styles.input}
              placeholder={sitePlaceholder}
              value={siteId}
              onChangeText={setSiteId}
              autoCapitalize="characters"
              maxLength={100}
            />
            <Text style={styles.hint}>The site code, OLT/FDB ID, route segment, or fault location identifier.</Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Photo Evidence *</Text>
            <Text style={styles.sectionSubtitle}>At least one geo-tagged photo of the faulty equipment / site is required.</Text>
            <View style={styles.photoButtons}>
              <TouchableOpacity style={styles.photoButton} onPress={takePhoto}>
                <Camera size={20} color={Colors.light.background} />
                <Text style={styles.photoButtonText}>Take Photo</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.photoButton, styles.photoButtonSecondary]} onPress={pickImage}>
                <ImageIcon size={20} color={Colors.light.primary} />
                <Text style={[styles.photoButtonText, styles.photoButtonTextSecondary]}>Gallery</Text>
              </TouchableOpacity>
            </View>
            {photos.length > 0 && (
              <View style={styles.photosGrid}>
                {photos.map((photo, index) => (
                  <View key={index} style={styles.photoItem}>
                    <Image source={{ uri: photo.uri }} style={styles.photoThumbnail} />
                    <View style={styles.photoOverlay}>
                      {photo.latitude && (
                        <View style={styles.geoTag}>
                          <MapPin size={10} color={Colors.light.background} />
                        </View>
                      )}
                      <TouchableOpacity style={styles.removePhotoButton} onPress={() => removePhoto(index)}>
                        <Trash2 size={14} color={Colors.light.background} />
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </View>
            )}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>GPS Location *</Text>
            <TouchableOpacity
              style={[styles.locationButton, currentLocation && styles.locationButtonCaptured]}
              onPress={captureCurrentLocation}
              disabled={isCapturingLocation}
            >
              <MapPin size={20} color={currentLocation ? Colors.light.success : Colors.light.primary} />
              <Text style={[styles.locationButtonText, currentLocation && styles.locationButtonTextCaptured]}>
                {isCapturingLocation
                  ? 'Capturing location…'
                  : currentLocation
                    ? 'Location Captured ✓'
                    : 'Capture GPS Location'}
              </Text>
            </TouchableOpacity>
            {currentLocation && (
              <Text style={styles.locationCoords}>
                Lat: {parseFloat(currentLocation.latitude).toFixed(6)}, Long: {parseFloat(currentLocation.longitude).toFixed(6)}
              </Text>
            )}
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Remarks (optional)</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="Fault description, root cause, action taken…"
              value={remarks}
              onChangeText={setRemarks}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
              maxLength={2000}
            />
          </View>

          {(photos.length === 0 || !currentLocation || !siteId.trim()) && (
            <Text style={styles.warningText}>
              {!siteId.trim() && photos.length === 0 && !currentLocation
                ? 'Site ID, photo, and GPS location are all required to submit.'
                : !siteId.trim()
                  ? 'Site / Location ID is required to submit.'
                  : photos.length === 0 && !currentLocation
                    ? 'Photo and GPS location are required to submit.'
                    : photos.length === 0
                      ? 'At least one photo is required to submit.'
                      : 'GPS location is required to submit.'}
            </Text>
          )}

          <TouchableOpacity
            style={[
              styles.submitButton,
              (hasSubmitted || submitMutation.isPending || isUploadingPhotos || photos.length === 0 || !currentLocation || !siteId.trim()) && styles.submitButtonDisabled,
            ]}
            onPress={handleSubmit}
            disabled={hasSubmitted || submitMutation.isPending || isUploadingPhotos || photos.length === 0 || !currentLocation || !siteId.trim()}
          >
            {(isUploadingPhotos || submitMutation.isPending) && <ActivityIndicator color="#fff" style={{ marginRight: 8 }} />}
            <Text style={styles.submitButtonText}>
              {hasSubmitted
                ? 'Submitted ✓'
                : isUploadingPhotos
                  ? 'Uploading Photos…'
                  : submitMutation.isPending
                    ? 'Submitting…'
                    : `Submit ${taskLabel} Entry`}
            </Text>
          </TouchableOpacity>
        </View>
        <View style={{ height: 40 }} />
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.backgroundSecondary },
  errorContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  errorText: { fontSize: 15, color: Colors.light.error, textAlign: 'center' },
  eventInfo: { backgroundColor: Colors.light.primary, padding: 16, paddingTop: 8 },
  eventName: { fontSize: 18, fontWeight: 'bold' as const, color: Colors.light.background },
  eventLocation: { fontSize: 14, color: 'rgba(255,255,255,0.8)', marginTop: 4 },
  taskTypeBadge: { alignSelf: 'flex-start', backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, marginTop: 10 },
  taskTypeBadgeText: { color: Colors.light.background, fontSize: 13, fontWeight: '700' as const, letterSpacing: 0.5 },
  targetNote: { fontSize: 12, color: 'rgba(255,255,255,0.85)', marginTop: 8, fontStyle: 'italic' as const },
  form: { padding: 16 },
  section: { marginBottom: 20 },
  sectionTitle: { fontSize: 16, fontWeight: 'bold' as const, color: Colors.light.text, marginBottom: 4 },
  sectionSubtitle: { fontSize: 12, color: Colors.light.textSecondary, marginBottom: 12 },
  inputGroup: { marginBottom: 16 },
  label: { fontSize: 14, fontWeight: '600' as const, color: Colors.light.text, marginBottom: 8 },
  input: { backgroundColor: Colors.light.background, borderWidth: 1, borderColor: Colors.light.border, borderRadius: 8, padding: 14, fontSize: 16, color: Colors.light.text },
  textArea: { minHeight: 90, textAlignVertical: 'top' as const, paddingTop: 12 },
  hint: { fontSize: 12, color: Colors.light.textSecondary, marginTop: 6 },
  photoButtons: { flexDirection: 'row', gap: 12 },
  photoButton: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.light.primary, padding: 14, borderRadius: 8, gap: 8 },
  photoButtonSecondary: { backgroundColor: Colors.light.background, borderWidth: 1, borderColor: Colors.light.primary },
  photoButtonText: { color: Colors.light.background, fontSize: 14, fontWeight: '600' as const },
  photoButtonTextSecondary: { color: Colors.light.primary },
  photosGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 16 },
  photoItem: { width: 100, height: 100, borderRadius: 8, overflow: 'hidden', position: 'relative' as const },
  photoThumbnail: { width: '100%', height: '100%' },
  photoOverlay: { position: 'absolute' as const, top: 0, left: 0, right: 0, bottom: 0, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', padding: 6 },
  geoTag: { backgroundColor: Colors.light.success, borderRadius: 10, width: 20, height: 20, justifyContent: 'center', alignItems: 'center' },
  removePhotoButton: { backgroundColor: Colors.light.error, borderRadius: 10, width: 24, height: 24, justifyContent: 'center', alignItems: 'center' },
  locationButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.light.background, borderWidth: 1, borderColor: Colors.light.primary, padding: 14, borderRadius: 8, gap: 8 },
  locationButtonCaptured: { borderColor: Colors.light.success, backgroundColor: '#E8F5E9' },
  locationButtonText: { color: Colors.light.primary, fontSize: 14, fontWeight: '600' as const },
  locationButtonTextCaptured: { color: Colors.light.success },
  locationCoords: { fontSize: 12, color: Colors.light.textSecondary, textAlign: 'center' as const, marginTop: 8 },
  warningText: { color: '#C62828', fontSize: 13, textAlign: 'center' as const, marginBottom: 8 },
  submitButton: { backgroundColor: Colors.light.primary, padding: 16, borderRadius: 8, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', marginTop: 8 },
  submitButtonDisabled: { backgroundColor: '#BDBDBD' },
  submitButtonText: { color: Colors.light.background, fontSize: 16, fontWeight: '600' as const },
});
