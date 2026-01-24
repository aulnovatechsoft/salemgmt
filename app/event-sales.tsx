import { useState, useEffect } from 'react';
import { View, Text, TextInput, StyleSheet, ScrollView, TouchableOpacity, Alert, Platform, Image } from 'react-native';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { Camera, MapPin, Trash2, Image as ImageIcon } from 'lucide-react-native';
import { useAuth } from '@/contexts/auth';
import Colors from '@/constants/colors';
import { trpc } from '@/lib/trpc';
import { CUSTOMER_TYPES } from '@/constants/app';
import { GeoTaggedPhoto } from '@/types';

export default function EventSalesScreen() {
  const router = useRouter();
  const { eventId } = useLocalSearchParams<{ eventId: string }>();
  const { employee } = useAuth();
  
  const [simsSold, setSimsSold] = useState('');
  const [simsActivated, setSimsActivated] = useState('');
  const [ftthSold, setFtthSold] = useState('');
  const [ftthActivated, setFtthActivated] = useState('');
  const [customerType, setCustomerType] = useState<'B2C' | 'B2B' | 'Government' | 'Enterprise'>('B2C');
  const [remarks, setRemarks] = useState('');
  const [photos, setPhotos] = useState<GeoTaggedPhoto[]>([]);
  const [currentLocation, setCurrentLocation] = useState<{ latitude: string; longitude: string } | null>(null);
  const [showCustomerTypePicker, setShowCustomerTypePicker] = useState(false);
  const [isCapturingLocation, setIsCapturingLocation] = useState(false);

  const { data: eventData } = trpc.events.getEventWithDetails.useQuery(
    { id: eventId || '' },
    { enabled: !!eventId }
  );

  const submitSalesMutation = trpc.events.submitEventSales.useMutation({
    onSuccess: () => {
      Alert.alert('Success', 'Sales entry submitted successfully', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    },
    onError: (error) => {
      Alert.alert('Error', error.message || 'Failed to submit sales entry');
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
      console.log('Location captured:', location.coords);
    } catch (error) {
      console.error('Error getting location:', error);
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
          console.log('Could not get location for photo');
        }
      }

      const newPhoto: GeoTaggedPhoto = {
        uri: result.assets[0].uri,
        latitude: photoLocation?.latitude,
        longitude: photoLocation?.longitude,
        timestamp: new Date().toISOString(),
      };
      
      setPhotos([...photos, newPhoto]);
      
      if (photoLocation) {
        setCurrentLocation(photoLocation);
      }
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

  const handleSubmit = () => {
    if (!simsSold && !ftthSold) {
      Alert.alert('Error', 'Please enter at least SIMs sold or FTTH sold');
      return;
    }

    if (!employee?.id || !eventId) {
      Alert.alert('Error', 'Invalid session. Please login again.');
      return;
    }

    submitSalesMutation.mutate({
      eventId,
      employeeId: employee.id,
      simsSold: parseInt(simsSold) || 0,
      simsActivated: parseInt(simsActivated) || 0,
      ftthSold: parseInt(ftthSold) || 0,
      ftthActivated: parseInt(ftthActivated) || 0,
      customerType,
      photos: photos.length > 0 ? photos : undefined,
      gpsLatitude: currentLocation?.latitude,
      gpsLongitude: currentLocation?.longitude,
      remarks: remarks.trim() || undefined,
    });
  };

  const myAssignment = eventData?.teamWithAllocations?.find(t => t.employeeId === employee?.id);

  return (
    <>
      <Stack.Screen 
        options={{ 
          title: 'Submit Sales',
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
            {myAssignment && (
              <View style={styles.myTargets}>
                <View style={styles.myTargetItem}>
                  <Text style={styles.myTargetLabel}>My SIM Target</Text>
                  <Text style={styles.myTargetValue}>{myAssignment.actualSimSold} / {myAssignment.simTarget}</Text>
                </View>
                <View style={styles.myTargetItem}>
                  <Text style={styles.myTargetLabel}>My FTTH Target</Text>
                  <Text style={styles.myTargetValue}>{myAssignment.actualFtthSold} / {myAssignment.ftthTarget}</Text>
                </View>
              </View>
            )}
          </View>
        )}

        <View style={styles.form}>
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>SIM Sales</Text>
            <View style={styles.row}>
              <View style={[styles.inputGroup, styles.halfWidth]}>
                <Text style={styles.label}>SIMs Sold *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="0"
                  value={simsSold}
                  onChangeText={setSimsSold}
                  keyboardType="number-pad"
                />
              </View>
              <View style={[styles.inputGroup, styles.halfWidth]}>
                <Text style={styles.label}>SIMs Activated</Text>
                <TextInput
                  style={styles.input}
                  placeholder="0"
                  value={simsActivated}
                  onChangeText={setSimsActivated}
                  keyboardType="number-pad"
                />
              </View>
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>FTTH Sales</Text>
            <View style={styles.row}>
              <View style={[styles.inputGroup, styles.halfWidth]}>
                <Text style={styles.label}>FTTH Sold *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="0"
                  value={ftthSold}
                  onChangeText={setFtthSold}
                  keyboardType="number-pad"
                />
              </View>
              <View style={[styles.inputGroup, styles.halfWidth]}>
                <Text style={styles.label}>FTTH Activated</Text>
                <TextInput
                  style={styles.input}
                  placeholder="0"
                  value={ftthActivated}
                  onChangeText={setFtthActivated}
                  keyboardType="number-pad"
                />
              </View>
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Customer Type *</Text>
            <TouchableOpacity 
              style={styles.picker}
              onPress={() => setShowCustomerTypePicker(!showCustomerTypePicker)}
            >
              <Text style={styles.pickerText}>{customerType}</Text>
            </TouchableOpacity>
            {showCustomerTypePicker && (
              <View style={styles.pickerOptions}>
                {CUSTOMER_TYPES.map((type) => (
                  <TouchableOpacity
                    key={type.value}
                    style={[
                      styles.pickerOption,
                      customerType === type.value && styles.pickerOptionSelected
                    ]}
                    onPress={() => {
                      setCustomerType(type.value as any);
                      setShowCustomerTypePicker(false);
                    }}
                  >
                    <Text style={[
                      styles.pickerOptionText,
                      customerType === type.value && styles.pickerOptionTextSelected
                    ]}>{type.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Photo Evidence</Text>
            <Text style={styles.sectionSubtitle}>Photos will be geo-tagged with your current location</Text>
            
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
                      <TouchableOpacity 
                        style={styles.removePhotoButton}
                        onPress={() => removePhoto(index)}
                      >
                        <Trash2 size={14} color={Colors.light.background} />
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </View>
            )}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>GPS Location</Text>
            <TouchableOpacity 
              style={[styles.locationButton, currentLocation && styles.locationButtonCaptured]}
              onPress={captureCurrentLocation}
              disabled={isCapturingLocation}
            >
              <MapPin size={20} color={currentLocation ? Colors.light.success : Colors.light.primary} />
              <Text style={[styles.locationButtonText, currentLocation && styles.locationButtonTextCaptured]}>
                {isCapturingLocation 
                  ? 'Capturing location...' 
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
            <Text style={styles.label}>Remarks</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="Any additional remarks..."
              value={remarks}
              onChangeText={setRemarks}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />
          </View>

          <TouchableOpacity 
            style={[styles.submitButton, submitSalesMutation.isPending && styles.submitButtonDisabled]}
            onPress={handleSubmit}
            disabled={submitSalesMutation.isPending}
          >
            <Text style={styles.submitButtonText}>
              {submitSalesMutation.isPending ? 'Submitting...' : 'Submit Sales Entry'}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.bottomSpacer} />
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.light.backgroundSecondary,
  },
  eventInfo: {
    backgroundColor: Colors.light.primary,
    padding: 16,
    paddingTop: 8,
  },
  eventName: {
    fontSize: 18,
    fontWeight: 'bold' as const,
    color: Colors.light.background,
  },
  eventLocation: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.8)',
    marginTop: 4,
  },
  myTargets: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 12,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 8,
    padding: 12,
  },
  myTargetItem: {
    flex: 1,
  },
  myTargetLabel: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.7)',
  },
  myTargetValue: {
    fontSize: 16,
    fontWeight: 'bold' as const,
    color: Colors.light.background,
    marginTop: 2,
  },
  form: {
    padding: 16,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold' as const,
    color: Colors.light.text,
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: 12,
    color: Colors.light.textSecondary,
    marginBottom: 12,
  },
  inputGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.light.text,
    marginBottom: 8,
  },
  input: {
    backgroundColor: Colors.light.background,
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 8,
    padding: 14,
    fontSize: 16,
    color: Colors.light.text,
  },
  textArea: {
    minHeight: 80,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  halfWidth: {
    flex: 1,
  },
  picker: {
    backgroundColor: Colors.light.background,
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 8,
    padding: 14,
  },
  pickerText: {
    fontSize: 16,
    color: Colors.light.text,
  },
  pickerOptions: {
    backgroundColor: Colors.light.background,
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 8,
    marginTop: 8,
  },
  pickerOption: {
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  pickerOptionSelected: {
    backgroundColor: Colors.light.lightBlue,
  },
  pickerOptionText: {
    fontSize: 16,
    color: Colors.light.text,
  },
  pickerOptionTextSelected: {
    color: Colors.light.primary,
    fontWeight: '600' as const,
  },
  photoButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  photoButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.light.primary,
    padding: 14,
    borderRadius: 8,
    gap: 8,
  },
  photoButtonSecondary: {
    backgroundColor: Colors.light.background,
    borderWidth: 1,
    borderColor: Colors.light.primary,
  },
  photoButtonText: {
    color: Colors.light.background,
    fontSize: 14,
    fontWeight: '600' as const,
  },
  photoButtonTextSecondary: {
    color: Colors.light.primary,
  },
  photosGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 16,
  },
  photoItem: {
    width: 100,
    height: 100,
    borderRadius: 8,
    overflow: 'hidden',
    position: 'relative',
  },
  photoThumbnail: {
    width: '100%',
    height: '100%',
  },
  photoOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: 6,
  },
  geoTag: {
    backgroundColor: Colors.light.success,
    borderRadius: 10,
    width: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  removePhotoButton: {
    backgroundColor: Colors.light.error,
    borderRadius: 10,
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  locationButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.light.background,
    borderWidth: 1,
    borderColor: Colors.light.primary,
    padding: 14,
    borderRadius: 8,
    gap: 8,
  },
  locationButtonCaptured: {
    borderColor: Colors.light.success,
    backgroundColor: '#E8F5E9',
  },
  locationButtonText: {
    color: Colors.light.primary,
    fontSize: 14,
    fontWeight: '600' as const,
  },
  locationButtonTextCaptured: {
    color: Colors.light.success,
  },
  locationCoords: {
    fontSize: 12,
    color: Colors.light.textSecondary,
    marginTop: 8,
    textAlign: 'center',
  },
  submitButton: {
    backgroundColor: Colors.light.success,
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
    marginTop: 10,
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    color: Colors.light.background,
    fontSize: 16,
    fontWeight: 'bold' as const,
  },
  bottomSpacer: {
    height: 32,
  },
});
