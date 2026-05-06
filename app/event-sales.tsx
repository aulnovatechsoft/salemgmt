import { useState, useEffect } from 'react';
import { View, Text, TextInput, StyleSheet, ScrollView, TouchableOpacity, Alert, Platform, Image, ActivityIndicator } from 'react-native';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { Camera, MapPin, Trash2, Image as ImageIcon, Plus, X } from 'lucide-react-native';
import { useAuth } from '@/contexts/auth';
import Colors from '@/constants/colors';
import { trpc } from '@/lib/trpc';
import { CUSTOMER_TYPES } from '@/constants/app';
import { GeoTaggedPhoto } from '@/types';
import { uploadPhotos } from '@/lib/photoUpload';
import { captureLocation, isNullIsland, isGpsTestMode, TEST_LOCATION_LABEL } from '@/lib/captureLocation';

type LcLine = { circuitId: string; customerName: string; bandwidth: string };
type EbLine = { connectionId: string; customerName: string; meterNumber: string };

const MOBILE_RE = /^[6-9]\d{9}$/;

function parseLines(text: string): string[] {
  return text
    .split(/[\n,;]/)
    .map(s => s.trim())
    .filter(Boolean);
}

export default function EventSalesScreen() {
  const router = useRouter();
  const { eventId } = useLocalSearchParams<{ eventId: string }>();
  const { employee } = useAuth();
  const utils = trpc.useUtils();
  
  const [simsSold, setSimsSold] = useState('');
  const [simsActivated, setSimsActivated] = useState('');
  const [simMobileNumbersText, setSimMobileNumbersText] = useState('');
  const [ftthSold, setFtthSold] = useState('');
  const [ftthActivated, setFtthActivated] = useState('');
  const [ftthIdsText, setFtthIdsText] = useState('');
  const [lcLines, setLcLines] = useState<LcLine[]>([{ circuitId: '', customerName: '', bandwidth: '' }]);
  const [ebLines, setEbLines] = useState<EbLine[]>([{ connectionId: '', customerName: '', meterNumber: '' }]);
  const [customerType, setCustomerType] = useState<'B2C' | 'B2B' | 'Government' | 'Enterprise'>('B2C');
  const [remarks, setRemarks] = useState('');
  const [photos, setPhotos] = useState<GeoTaggedPhoto[]>([]);
  const [currentLocation, setCurrentLocation] = useState<{ latitude: string; longitude: string } | null>(null);
  const [showCustomerTypePicker, setShowCustomerTypePicker] = useState(false);
  const [isCapturingLocation, setIsCapturingLocation] = useState(false);
  const [isUploadingPhotos, setIsUploadingPhotos] = useState(false);
  // Sticky flag: once a submission succeeds we keep the button disabled
  // until the screen unmounts. This avoids the "did I press it or not?"
  // flash on web (where Alert.alert ignores onPress callbacks) and on fast
  // backends (where mutation.isPending flips back before navigation lands).
  const [hasSubmitted, setHasSubmitted] = useState(false);

  const { data: eventData } = trpc.events.getEventWithDetails.useQuery(
    { id: eventId || '' },
    { enabled: !!eventId }
  );

  const submitSalesMutation = trpc.events.submitEventSales.useMutation({
    onSuccess: () => {
      setHasSubmitted(true);
      utils.events.getEventWithDetails.invalidate();
      utils.events.getMyEvents.invalidate();
      utils.events.getAll.invalidate();
      utils.events.getMyAssignedTasks.invalidate();
      // Navigate back unconditionally on the next tick so web (where
      // Alert.alert ignores onPress) still returns to the previous screen.
      // On native the Alert is non-blocking from JS's perspective, so the
      // back navigation queues right behind the alert dismissal.
      Alert.alert('Success', 'Sales entry submitted successfully', [
        { text: 'OK', onPress: () => router.back() },
      ]);
      setTimeout(() => {
        if (router.canGoBack()) router.back();
      }, 50);
    },
    onError: (error) => {
      Alert.alert('Error', error.message || 'Failed to submit sales entry');
    },
  });

  useEffect(() => {
    requestLocationPermission();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // GPS capture is centralised in lib/captureLocation.ts so all three
  // submission screens (Sales, O&M, Finance) share one well-tested
  // implementation that handles HTTPS-required errors, permission
  // denials, and platform-specific quirks. It NEVER silently falls back
  // to (0,0) — see the Gotchas section in replit.md for the production
  // regression that motivated this contract.
  const requestLocationPermission = async () => {
    // Auto-capture on mount runs in {onlyIfAlreadyGranted:true} mode so
    // we don't pop the OS / browser permission prompt before the user
    // has expressed intent. If they've already granted location for this
    // origin (web) or app (native), we capture immediately; otherwise we
    // stay silent and wait for them to tap the explicit Capture GPS
    // button. This avoids the dark-pattern of preemptive permission
    // requests on screen mount.
    setIsCapturingLocation(true);
    const result = await captureLocation({ onlyIfAlreadyGranted: true });
    setIsCapturingLocation(false);
    if (result.ok) {
      setCurrentLocation({
        latitude: result.latitude.toString(),
        longitude: result.longitude.toString(),
      });
    }
  };

  const captureCurrentLocation = async () => {
    setIsCapturingLocation(true);
    const result = await captureLocation();
    setIsCapturingLocation(false);
    if (result.ok) {
      setCurrentLocation({
        latitude: result.latitude.toString(),
        longitude: result.longitude.toString(),
      });
    } else {
      Alert.alert(result.title, result.message);
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
      
      // Native-only per-photo GPS refresh — gives a fresher geo-tag on
      // the photo than the screen's currentLocation might be. NEVER
      // accept (0,0): if the fresh read is Null Island (GPS not locked
      // yet, mock, etc.) we discard it and keep the already-validated
      // currentLocation. This preserves the helper's invariant that
      // (0,0) cannot reach screen state or the backend submission.
      if (Platform.OS !== 'web') {
        try {
          const location = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.High,
          });
          if (!isNullIsland(location.coords.latitude, location.coords.longitude)) {
            photoLocation = {
              latitude: location.coords.latitude.toString(),
              longitude: location.coords.longitude.toString(),
            };
          } else {
            console.warn('Per-photo GPS refresh returned (0,0); keeping prior location');
          }
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

  const handleSubmit = async () => {
    if (!employee?.id || !eventId) {
      Alert.alert('Error', 'Invalid session. Please login again.');
      return;
    }

    const simsSoldNum = parseInt(simsSold) || 0;
    const simsActivatedNum = parseInt(simsActivated) || 0;
    const ftthSoldNum = parseInt(ftthSold) || 0;
    const ftthActivatedNum = parseInt(ftthActivated) || 0;

    // Parse activated SIM mobile numbers
    const simMobileNumbers = parseLines(simMobileNumbersText);
    if (simMobileNumbers.length > 0) {
      const invalid = simMobileNumbers.filter(n => !MOBILE_RE.test(n));
      if (invalid.length > 0) {
        Alert.alert('Invalid Mobile Numbers', `These are not valid 10-digit Indian mobile numbers:\n${invalid.join(', ')}`);
        return;
      }
      const dupes = simMobileNumbers.filter((n, i) => simMobileNumbers.indexOf(n) !== i);
      if (dupes.length > 0) {
        Alert.alert('Duplicate Mobile Numbers', `Duplicate entries: ${[...new Set(dupes)].join(', ')}`);
        return;
      }
      // Auto-set activated count from line count
      if (simsActivatedNum && simsActivatedNum !== simMobileNumbers.length) {
        Alert.alert('Mismatch', `You entered ${simMobileNumbers.length} mobile numbers but said ${simsActivatedNum} activated. They must match.`);
        return;
      }
    }

    // Parse FTTH IDs
    const ftthIds = parseLines(ftthIdsText);
    if (ftthIds.length > 0) {
      const dupes = ftthIds.filter((n, i) => ftthIds.indexOf(n) !== i);
      if (dupes.length > 0) {
        Alert.alert('Duplicate FTTH IDs', `Duplicate entries: ${[...new Set(dupes)].join(', ')}`);
        return;
      }
      if (ftthActivatedNum && ftthActivatedNum !== ftthIds.length) {
        Alert.alert('Mismatch', `You entered ${ftthIds.length} FTTH IDs but said ${ftthActivatedNum} activated. They must match.`);
        return;
      }
    }

    // Build LC line items (only non-empty rows)
    const lcLinesClean = lcLines
      .filter(l => l.circuitId.trim() || l.customerName.trim())
      .map(l => ({
        circuitId: l.circuitId.trim(),
        customerName: l.customerName.trim(),
        bandwidth: l.bandwidth.trim() || undefined,
      }));
    if (showLcSection && lcLinesClean.length > 0) {
      for (const l of lcLinesClean) {
        if (!l.circuitId) { Alert.alert('Missing', 'Each Lease Circuit row needs a Circuit ID.'); return; }
        if (!l.customerName) { Alert.alert('Missing', 'Each Lease Circuit row needs a Customer Name.'); return; }
      }
      const ids = lcLinesClean.map(l => l.circuitId);
      const dupes = ids.filter((n, i) => ids.indexOf(n) !== i);
      if (dupes.length > 0) { Alert.alert('Duplicate Circuit IDs', `Duplicate: ${[...new Set(dupes)].join(', ')}`); return; }
    }

    // Build EB line items
    const ebLinesClean = ebLines
      .filter(l => l.connectionId.trim() || l.customerName.trim())
      .map(l => ({
        connectionId: l.connectionId.trim(),
        customerName: l.customerName.trim(),
        meterNumber: l.meterNumber.trim() || undefined,
      }));
    if (showEbSection && ebLinesClean.length > 0) {
      for (const l of ebLinesClean) {
        if (!l.connectionId) { Alert.alert('Missing', 'Each EB row needs a Connection ID.'); return; }
        if (!l.customerName) { Alert.alert('Missing', 'Each EB row needs a Customer Name.'); return; }
      }
      const ids = ebLinesClean.map(l => l.connectionId);
      const dupes = ids.filter((n, i) => ids.indexOf(n) !== i);
      if (dupes.length > 0) { Alert.alert('Duplicate Connection IDs', `Duplicate: ${[...new Set(dupes)].join(', ')}`); return; }
    }

    const totalEntries =
      simsSoldNum + ftthSoldNum + lcLinesClean.length + ebLinesClean.length;
    if (totalEntries === 0) {
      Alert.alert('Error', 'Please enter at least one sales entry');
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

    let uploadedPhotoResults: GeoTaggedPhoto[] | undefined;

    if (photos.length > 0) {
      try {
        setIsUploadingPhotos(true);
        uploadedPhotoResults = await uploadPhotos(
          photos,
          employee.id,
          'sales_entry',
          eventId
        );
      } catch (err) {
        console.error('Photo upload failed:', err);
        Alert.alert('Upload Error', 'Failed to upload photos. Please try again.');
        setIsUploadingPhotos(false);
        return;
      }
      setIsUploadingPhotos(false);
    }

    submitSalesMutation.mutate({
      eventId,
      employeeId: employee.id,
      simsSold: simsSoldNum,
      simsActivated: simMobileNumbers.length > 0 ? simMobileNumbers.length : simsActivatedNum,
      ftthSold: ftthSoldNum,
      ftthActivated: ftthIds.length > 0 ? ftthIds.length : ftthActivatedNum,
      leaseSold: lcLinesClean.length || 0,
      ebSold: ebLinesClean.length || 0,
      customerType,
      simLines: simMobileNumbers.map(n => ({ mobileNumber: n, isActivated: true })),
      ftthLines: ftthIds.map(id => ({ ftthId: id, isActivated: true })),
      lcLines: lcLinesClean,
      ebLines: ebLinesClean,
      photos: uploadedPhotoResults && uploadedPhotoResults.length > 0 ? uploadedPhotoResults : undefined,
      gpsLatitude: currentLocation?.latitude,
      gpsLongitude: currentLocation?.longitude,
      remarks: remarks.trim() || undefined,
    });
  };

  const myAssignment = eventData?.teamWithAllocations?.find(t => t.employeeId === employee?.id);
  const myAssignedTypes: string[] = (myAssignment as any)?.assignedTaskTypes || [];
  const hasSpecificAssignment = myAssignedTypes.length > 0;
  
  const categories = eventData?.category ? eventData.category.split(',').map((c: string) => c.trim()) : [];
  const hasSIM = categories.includes('SIM') && (!hasSpecificAssignment || myAssignedTypes.includes('SIM'));
  const hasFTTH = categories.includes('FTTH') && (!hasSpecificAssignment || myAssignedTypes.includes('FTTH'));
  const hasLC = (categories.includes('LEASE_CIRCUIT') || categories.includes('Lease Circuit')) && (!hasSpecificAssignment || myAssignedTypes.includes('LEASE_CIRCUIT'));
  const hasEB = categories.includes('EB') && (!hasSpecificAssignment || myAssignedTypes.includes('EB'));
  // FIX: don't gate visibility on target>0; user is assigned to subtype = show the section
  const showLcSection = hasLC;
  const showEbSection = hasEB;
  const hasMaintenanceCategories = categories.some((c: string) => 
    ['BTS-Down', 'Route-Fail', 'FTTH-Down', 'OFC-Fail'].includes(c)
  );

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
            {myAssignment && (hasSIM || hasFTTH || hasLC || hasEB) && (
              <View style={styles.myTargets}>
                {hasSIM && (
                  <View style={styles.myTargetItem}>
                    <Text style={styles.myTargetLabel}>My SIM Target</Text>
                    <Text style={styles.myTargetValue}>{myAssignment.actualSimSold} / {myAssignment.simTarget}</Text>
                  </View>
                )}
                {hasFTTH && (
                  <View style={styles.myTargetItem}>
                    <Text style={styles.myTargetLabel}>My FTTH Target</Text>
                    <Text style={styles.myTargetValue}>{myAssignment.actualFtthSold} / {myAssignment.ftthTarget}</Text>
                  </View>
                )}
                {hasLC && (
                  <View style={styles.myTargetItem}>
                    <Text style={styles.myTargetLabel}>My LC Target</Text>
                    <Text style={styles.myTargetValue}>{myAssignment.leaseCompleted || 0} / {myAssignment.leaseTarget || 0}</Text>
                  </View>
                )}
                {hasEB && (
                  <View style={styles.myTargetItem}>
                    <Text style={styles.myTargetLabel}>My EB Target</Text>
                    <Text style={styles.myTargetValue}>{myAssignment.ebCompleted || 0} / {myAssignment.ebTarget || 0}</Text>
                  </View>
                )}
              </View>
            )}
          </View>
        )}

        <View style={styles.form}>
          {hasSIM && (
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
              <View style={styles.inputGroup}>
                <Text style={styles.label}>
                  Activated Mobile Numbers {simMobileNumbersText.trim() ? `(${parseLines(simMobileNumbersText).length})` : ''}
                </Text>
                <TextInput
                  style={[styles.input, styles.textarea]}
                  placeholder={'9876543210\n9123456789\n...one per line'}
                  value={simMobileNumbersText}
                  onChangeText={setSimMobileNumbersText}
                  multiline
                  numberOfLines={4}
                  autoCapitalize="none"
                />
                <Text style={styles.hint}>Enter each activated mobile number on a new line. 10 digits, starting with 6-9.</Text>
              </View>
            </View>
          )}

          {hasFTTH && (
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
              <View style={styles.inputGroup}>
                <Text style={styles.label}>
                  Activated FTTH IDs {ftthIdsText.trim() ? `(${parseLines(ftthIdsText).length})` : ''}
                </Text>
                <TextInput
                  style={[styles.input, styles.textarea]}
                  placeholder={'FTTH-12345\nFTTH-12346\n...one per line'}
                  value={ftthIdsText}
                  onChangeText={setFtthIdsText}
                  multiline
                  numberOfLines={4}
                  autoCapitalize="none"
                />
                <Text style={styles.hint}>Enter each activated FTTH ID on a new line.</Text>
              </View>
            </View>
          )}

          {showLcSection && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Lease Circuit Sales</Text>
                <TouchableOpacity
                  style={styles.addButton}
                  onPress={() => setLcLines([...lcLines, { circuitId: '', customerName: '', bandwidth: '' }])}
                >
                  <Plus size={16} color={Colors.light.primary} />
                  <Text style={styles.addButtonText}>Add Circuit</Text>
                </TouchableOpacity>
              </View>
              {myAssignment && (
                <Text style={styles.hint}>
                  My Target: {myAssignment.leaseCompleted || 0} / {myAssignment.leaseTarget || 0}
                  {myAssignment.leaseTarget > 0 && ` (Remaining: ${(myAssignment.leaseTarget || 0) - (myAssignment.leaseCompleted || 0)})`}
                </Text>
              )}
              {lcLines.map((line, idx) => (
                <View key={idx} style={styles.lineRow}>
                  <View style={styles.lineRowHeader}>
                    <Text style={styles.lineRowLabel}>Circuit #{idx + 1}</Text>
                    {lcLines.length > 1 && (
                      <TouchableOpacity onPress={() => setLcLines(lcLines.filter((_, i) => i !== idx))}>
                        <X size={18} color={Colors.light.error} />
                      </TouchableOpacity>
                    )}
                  </View>
                  <TextInput
                    style={styles.input}
                    placeholder="Circuit ID *"
                    value={line.circuitId}
                    onChangeText={(v) => setLcLines(lcLines.map((l, i) => i === idx ? { ...l, circuitId: v } : l))}
                    autoCapitalize="characters"
                  />
                  <TextInput
                    style={[styles.input, { marginTop: 8 }]}
                    placeholder="Customer Name *"
                    value={line.customerName}
                    onChangeText={(v) => setLcLines(lcLines.map((l, i) => i === idx ? { ...l, customerName: v } : l))}
                  />
                  <TextInput
                    style={[styles.input, { marginTop: 8 }]}
                    placeholder="Bandwidth (e.g. 100 Mbps)"
                    value={line.bandwidth}
                    onChangeText={(v) => setLcLines(lcLines.map((l, i) => i === idx ? { ...l, bandwidth: v } : l))}
                  />
                </View>
              ))}
            </View>
          )}

          {showEbSection && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>EB Connection Sales</Text>
                <TouchableOpacity
                  style={styles.addButton}
                  onPress={() => setEbLines([...ebLines, { connectionId: '', customerName: '', meterNumber: '' }])}
                >
                  <Plus size={16} color={Colors.light.primary} />
                  <Text style={styles.addButtonText}>Add Connection</Text>
                </TouchableOpacity>
              </View>
              {myAssignment && (
                <Text style={styles.hint}>
                  My Target: {myAssignment.ebCompleted || 0} / {myAssignment.ebTarget || 0}
                  {myAssignment.ebTarget > 0 && ` (Remaining: ${(myAssignment.ebTarget || 0) - (myAssignment.ebCompleted || 0)})`}
                </Text>
              )}
              {ebLines.map((line, idx) => (
                <View key={idx} style={styles.lineRow}>
                  <View style={styles.lineRowHeader}>
                    <Text style={styles.lineRowLabel}>Connection #{idx + 1}</Text>
                    {ebLines.length > 1 && (
                      <TouchableOpacity onPress={() => setEbLines(ebLines.filter((_, i) => i !== idx))}>
                        <X size={18} color={Colors.light.error} />
                      </TouchableOpacity>
                    )}
                  </View>
                  <TextInput
                    style={styles.input}
                    placeholder="Connection ID *"
                    value={line.connectionId}
                    onChangeText={(v) => setEbLines(ebLines.map((l, i) => i === idx ? { ...l, connectionId: v } : l))}
                    autoCapitalize="characters"
                  />
                  <TextInput
                    style={[styles.input, { marginTop: 8 }]}
                    placeholder="Customer Name *"
                    value={line.customerName}
                    onChangeText={(v) => setEbLines(ebLines.map((l, i) => i === idx ? { ...l, customerName: v } : l))}
                  />
                  <TextInput
                    style={[styles.input, { marginTop: 8 }]}
                    placeholder="Meter Number"
                    value={line.meterNumber}
                    onChangeText={(v) => setEbLines(ebLines.map((l, i) => i === idx ? { ...l, meterNumber: v } : l))}
                  />
                </View>
              ))}
            </View>
          )}

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
            {Platform.OS === 'web' && isGpsTestMode() && (
              <View style={{ marginTop: 8, padding: 10, backgroundColor: '#FEF3C7', borderColor: '#F59E0B', borderWidth: 1, borderRadius: 6 }}>
                <Text style={{ color: '#92400E', fontWeight: '700', fontSize: 12 }}>⚠️ TEST MODE — GPS is mocked</Text>
                <Text style={{ color: '#92400E', fontSize: 11, marginTop: 2 }}>Using {TEST_LOCATION_LABEL} (28.6259, 77.2088). Disable EXPO_PUBLIC_GPS_TEST_MODE for production.</Text>
              </View>
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

          {(photos.length === 0 || !currentLocation) && (
            <Text style={{ color: '#C62828', fontSize: 13, textAlign: 'center', marginBottom: 8 }}>
              {photos.length === 0 && !currentLocation
                ? 'Photo and GPS location are required to submit.'
                : photos.length === 0
                  ? 'At least one photo is required to submit.'
                  : 'GPS location is required to submit.'}
            </Text>
          )}
          <TouchableOpacity 
            style={[
              styles.submitButton,
              (hasSubmitted || submitSalesMutation.isPending || isUploadingPhotos || photos.length === 0 || !currentLocation) && styles.submitButtonDisabled,
            ]}
            onPress={handleSubmit}
            disabled={hasSubmitted || submitSalesMutation.isPending || isUploadingPhotos || photos.length === 0 || !currentLocation}
          >
            {(isUploadingPhotos || submitSalesMutation.isPending) && <ActivityIndicator color="#fff" style={{ marginRight: 8 }} />}
            <Text style={styles.submitButtonText}>
              {hasSubmitted
                ? 'Submitted ✓'
                : isUploadingPhotos
                  ? 'Uploading Photos...'
                  : submitSalesMutation.isPending
                    ? 'Submitting...'
                    : 'Submit Sales Entry'}
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
  textarea: {
    minHeight: 90,
    textAlignVertical: 'top',
    paddingTop: 12,
  },
  hint: {
    fontSize: 12,
    color: Colors.light.textSecondary,
    marginTop: 6,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Colors.light.primary,
    backgroundColor: Colors.light.lightBlue,
  },
  addButtonText: {
    color: Colors.light.primary,
    fontSize: 13,
    fontWeight: '600' as const,
  },
  lineRow: {
    backgroundColor: Colors.light.backgroundSecondary,
    borderRadius: 8,
    padding: 12,
    marginTop: 10,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  lineRowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  lineRowLabel: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.light.textSecondary,
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
