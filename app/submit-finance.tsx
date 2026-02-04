import { useState, useEffect } from 'react';
import { View, Text, TextInput, StyleSheet, ScrollView, TouchableOpacity, Alert, Platform, ActivityIndicator } from 'react-native';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { Camera, MapPin, Trash2, ChevronDown, Check, IndianRupee, CreditCard, FileText } from 'lucide-react-native';
import { useAuth } from '@/contexts/auth';
import { trpc } from '@/lib/trpc';
import Colors from '@/constants/colors';

const FINANCE_TYPES = [
  { id: 'FIN_LC', label: 'LC Outstanding', targetField: 'targetFinLc', collectedField: 'finLcCollected' },
  { id: 'FIN_LL_FTTH', label: 'LL/FTTH Outstanding', targetField: 'targetFinLlFtth', collectedField: 'finLlFtthCollected' },
  { id: 'FIN_TOWER', label: 'Tower Outstanding', targetField: 'targetFinTower', collectedField: 'finTowerCollected' },
  { id: 'FIN_GSM_POSTPAID', label: 'GSM PostPaid', targetField: 'targetFinGsmPostpaid', collectedField: 'finGsmPostpaidCollected' },
  { id: 'FIN_RENT_BUILDING', label: 'Rent Of Building', targetField: 'targetFinRentBuilding', collectedField: 'finRentBuildingCollected' },
];

const PAYMENT_MODES = [
  { id: 'CASH', label: 'Cash' },
  { id: 'CHEQUE', label: 'Cheque' },
  { id: 'NEFT', label: 'NEFT/RTGS' },
  { id: 'UPI', label: 'UPI' },
  { id: 'CARD', label: 'Debit/Credit Card' },
  { id: 'DD', label: 'Demand Draft' },
  { id: 'OTHER', label: 'Other' },
];

export default function SubmitFinanceScreen() {
  const router = useRouter();
  const { eventId } = useLocalSearchParams<{ eventId: string }>();
  const { employee } = useAuth();
  const utils = trpc.useUtils();

  const { data: eventData, isLoading: loadingEvent } = trpc.events.getEventWithDetails.useQuery(
    { id: eventId || '' },
    { enabled: !!eventId }
  );

  const submitFinanceMutation = trpc.events.submitFinanceCollection.useMutation({
    onSuccess: () => {
      utils.events.getEventWithDetails.invalidate({ id: eventId });
      utils.events.getMyEvents.invalidate();
      utils.events.getAll.invalidate();
      utils.events.getMyAssignedTasks.invalidate();
      Alert.alert('Success', 'Collection entry submitted successfully!', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    },
    onError: (error) => {
      Alert.alert('Error', error.message || 'Failed to submit collection entry');
    },
  });

  const [financeType, setFinanceType] = useState('');
  const [amountCollected, setAmountCollected] = useState('');
  const [paymentMode, setPaymentMode] = useState('');
  const [transactionReference, setTransactionReference] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerContact, setCustomerContact] = useState('');
  const [remarks, setRemarks] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [location, setLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showFinanceTypePicker, setShowFinanceTypePicker] = useState(false);
  const [showPaymentModePicker, setShowPaymentModePicker] = useState(false);

  const availableFinanceTypes = FINANCE_TYPES.filter(ft => 
    eventData?.category?.includes(ft.id)
  );

  useEffect(() => {
    if (availableFinanceTypes.length === 1 && !financeType) {
      setFinanceType(availableFinanceTypes[0].id);
    }
  }, [availableFinanceTypes, financeType]);

  const selectedFinanceType = FINANCE_TYPES.find(ft => ft.id === financeType);
  const currentTarget = selectedFinanceType ? (eventData as any)?.[selectedFinanceType.targetField] || 0 : 0;
  const currentCollected = selectedFinanceType ? (eventData as any)?.[selectedFinanceType.collectedField] || 0 : 0;
  const remainingAmount = Math.max(0, currentTarget - currentCollected);

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
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      setPhotos([...photos, result.assets[0].uri]);
    }
  };

  const takePhoto = async () => {
    const permissionResult = await ImagePicker.requestCameraPermissionsAsync();
    if (permissionResult.granted === false) {
      Alert.alert('Permission Required', 'Permission to access camera is required!');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      setPhotos([...photos, result.assets[0].uri]);
    }
  };

  const removePhoto = (index: number) => {
    setPhotos(photos.filter((_, i) => i !== index));
  };

  const getLocation = async () => {
    if (Platform.OS === 'web') {
      Alert.alert('Info', 'GPS location is not available on web');
      return;
    }

    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Permission to access location is required!');
        return;
      }
      const loc = await Location.getCurrentPositionAsync({});
      setLocation({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
      Alert.alert('Success', 'Location captured successfully');
    } catch (error) {
      Alert.alert('Error', 'Failed to get location');
    }
  };

  const formatCurrency = (amount: number) => {
    if (amount >= 10000000) {
      return `${(amount / 10000000).toFixed(2)} Cr`;
    } else if (amount >= 100000) {
      return `${(amount / 100000).toFixed(2)} L`;
    } else if (amount >= 1000) {
      return `${(amount / 1000).toFixed(2)} K`;
    }
    return amount.toLocaleString('en-IN');
  };

  const handleSubmit = async () => {
    if (!financeType) {
      Alert.alert('Error', 'Please select a collection type');
      return;
    }
    const amount = parseInt(amountCollected);
    if (!amountCollected || isNaN(amount) || amount <= 0) {
      Alert.alert('Error', 'Please enter a valid amount');
      return;
    }
    if (!paymentMode) {
      Alert.alert('Error', 'Please select a payment mode');
      return;
    }
    if (paymentMode !== 'CASH' && !transactionReference) {
      Alert.alert('Error', 'Please enter transaction/receipt reference for non-cash payments');
      return;
    }

    setIsSubmitting(true);
    try {
      await submitFinanceMutation.mutateAsync({
        eventId: eventId || '',
        employeeId: employee?.id || '',
        financeType,
        amountCollected: amount,
        paymentMode,
        transactionReference: transactionReference || undefined,
        customerName: customerName || undefined,
        customerContact: customerContact || undefined,
        remarks: remarks || undefined,
        photos: photos.map(uri => ({
          uri,
          latitude: location?.latitude?.toString(),
          longitude: location?.longitude?.toString(),
          timestamp: new Date().toISOString(),
        })),
        gpsLatitude: location?.latitude?.toString(),
        gpsLongitude: location?.longitude?.toString(),
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loadingEvent) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.light.primary} />
        <Text style={styles.loadingText}>Loading task details...</Text>
      </View>
    );
  }

  return (
    <>
      <Stack.Screen 
        options={{ 
          title: 'Submit Collection Entry',
          headerStyle: { backgroundColor: Colors.light.primary },
          headerTintColor: Colors.light.background,
        }} 
      />
      
      <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
        <View style={styles.form}>
          <View style={styles.taskCard}>
            <Text style={styles.taskName} numberOfLines={2}>{eventData?.name}</Text>
            <Text style={styles.taskCircle}>{eventData?.circle}</Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Collection Details</Text>
            
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Collection Type *</Text>
              <TouchableOpacity 
                style={styles.picker}
                onPress={() => setShowFinanceTypePicker(!showFinanceTypePicker)}
              >
                <Text style={[styles.pickerText, !financeType && { color: Colors.light.textSecondary }]}>
                  {financeType ? FINANCE_TYPES.find(ft => ft.id === financeType)?.label : 'Select collection type'}
                </Text>
                <ChevronDown size={20} color={Colors.light.textSecondary} />
              </TouchableOpacity>
              {showFinanceTypePicker && (
                <View style={styles.pickerOptions}>
                  <ScrollView nestedScrollEnabled={true} showsVerticalScrollIndicator={true}>
                    {availableFinanceTypes.map(ft => (
                      <TouchableOpacity 
                        key={ft.id}
                        style={[styles.pickerOption, financeType === ft.id && styles.pickerOptionSelected]}
                        onPress={() => { setFinanceType(ft.id); setShowFinanceTypePicker(false); }}
                      >
                        <Text style={[styles.pickerOptionText, financeType === ft.id && styles.pickerOptionTextSelected]}>{ft.label}</Text>
                        {financeType === ft.id && <Check size={18} color={Colors.light.primary} />}
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              )}
            </View>

            {financeType && (
              <View style={styles.targetCard}>
                <View style={styles.targetRow}>
                  <View style={styles.targetItem}>
                    <Text style={styles.targetLabel}>Target</Text>
                    <Text style={styles.targetValue}>{formatCurrency(currentTarget)}</Text>
                  </View>
                  <View style={styles.targetDivider} />
                  <View style={styles.targetItem}>
                    <Text style={styles.targetLabel}>Collected</Text>
                    <Text style={[styles.targetValue, { color: '#2E7D32' }]}>{formatCurrency(currentCollected)}</Text>
                  </View>
                  <View style={styles.targetDivider} />
                  <View style={styles.targetItem}>
                    <Text style={styles.targetLabel}>Remaining</Text>
                    <Text style={[styles.targetValue, { color: '#EF6C00' }]}>{formatCurrency(remainingAmount)}</Text>
                  </View>
                </View>
              </View>
            )}

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Amount Collected (Rs) *</Text>
              <View style={styles.amountInputContainer}>
                <Text style={styles.currencySymbol}>Rs</Text>
                <TextInput
                  style={styles.amountInput}
                  placeholder="Enter amount"
                  value={amountCollected}
                  onChangeText={setAmountCollected}
                  keyboardType="number-pad"
                />
              </View>
              {amountCollected && parseInt(amountCollected) > 0 && (
                <Text style={styles.amountHelper}>
                  {formatCurrency(parseInt(amountCollected))}
                </Text>
              )}
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Payment Mode *</Text>
              <TouchableOpacity 
                style={styles.picker}
                onPress={() => setShowPaymentModePicker(!showPaymentModePicker)}
              >
                <Text style={[styles.pickerText, !paymentMode && { color: Colors.light.textSecondary }]}>
                  {paymentMode ? PAYMENT_MODES.find(pm => pm.id === paymentMode)?.label : 'Select payment mode'}
                </Text>
                <ChevronDown size={20} color={Colors.light.textSecondary} />
              </TouchableOpacity>
              {showPaymentModePicker && (
                <View style={styles.pickerOptions}>
                  <ScrollView nestedScrollEnabled={true} showsVerticalScrollIndicator={true}>
                    {PAYMENT_MODES.map(pm => (
                      <TouchableOpacity 
                        key={pm.id}
                        style={[styles.pickerOption, paymentMode === pm.id && styles.pickerOptionSelected]}
                        onPress={() => { setPaymentMode(pm.id); setShowPaymentModePicker(false); }}
                      >
                        <Text style={[styles.pickerOptionText, paymentMode === pm.id && styles.pickerOptionTextSelected]}>{pm.label}</Text>
                        {paymentMode === pm.id && <Check size={18} color={Colors.light.primary} />}
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              )}
            </View>

            {paymentMode && paymentMode !== 'CASH' && (
              <View style={styles.inputGroup}>
                <Text style={styles.label}>
                  {paymentMode === 'CHEQUE' ? 'Cheque Number' : 
                   paymentMode === 'DD' ? 'DD Number' : 
                   paymentMode === 'UPI' ? 'UPI Transaction ID' : 
                   'Transaction Reference'} *
                </Text>
                <TextInput
                  style={styles.input}
                  placeholder={
                    paymentMode === 'CHEQUE' ? 'Enter cheque number' : 
                    paymentMode === 'DD' ? 'Enter DD number' : 
                    paymentMode === 'UPI' ? 'Enter UPI transaction ID' : 
                    'Enter transaction/receipt reference'
                  }
                  value={transactionReference}
                  onChangeText={setTransactionReference}
                />
              </View>
            )}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Customer Information</Text>
            
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Customer Name</Text>
              <TextInput
                style={styles.input}
                placeholder="Enter customer/organization name"
                value={customerName}
                onChangeText={setCustomerName}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Customer Contact</Text>
              <TextInput
                style={styles.input}
                placeholder="Enter phone number"
                value={customerContact}
                onChangeText={setCustomerContact}
                keyboardType="phone-pad"
                maxLength={10}
              />
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Photos</Text>
            <Text style={styles.helperText}>Attach receipt/cheque images for verification</Text>
            <View style={styles.photoButtons}>
              <TouchableOpacity style={styles.photoButton} onPress={takePhoto}>
                <Camera size={20} color={Colors.light.background} />
                <Text style={styles.photoButtonText}>Take Photo</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.photoButton} onPress={pickImage}>
                <Camera size={20} color={Colors.light.background} />
                <Text style={styles.photoButtonText}>Choose Photo</Text>
              </TouchableOpacity>
            </View>
            {photos.length > 0 && (
              <View style={styles.photosContainer}>
                {photos.map((photo, index) => (
                  <View key={index} style={styles.photoItem}>
                    <FileText size={16} color={Colors.light.primary} />
                    <Text style={styles.photoName}>Photo {index + 1}</Text>
                    <TouchableOpacity onPress={() => removePhoto(index)} style={styles.removePhotoBtn}>
                      <Trash2 size={18} color={Colors.light.error} />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Location</Text>
            <TouchableOpacity style={styles.locationButton} onPress={getLocation}>
              <MapPin size={20} color={Colors.light.background} />
              <Text style={styles.locationButtonText}>
                {location ? 'Location Captured' : 'Capture GPS Location'}
              </Text>
            </TouchableOpacity>
            {location && (
              <Text style={styles.locationText}>
                Lat: {location.latitude.toFixed(6)}, Long: {location.longitude.toFixed(6)}
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
              numberOfLines={4}
              textAlignVertical="top"
            />
          </View>

          <TouchableOpacity 
            style={[styles.submitButton, isSubmitting && styles.submitButtonDisabled]}
            onPress={handleSubmit}
            disabled={isSubmitting}
          >
            <Text style={styles.submitButtonText}>
              {isSubmitting ? 'Submitting...' : 'Submit Collection Entry'}
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
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.light.background,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: Colors.light.textSecondary,
  },
  form: {
    padding: 16,
  },
  taskCard: {
    backgroundColor: Colors.light.primary,
    padding: 16,
    borderRadius: 12,
    marginBottom: 20,
  },
  taskName: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.light.background,
    marginBottom: 4,
  },
  taskCircle: {
    fontSize: 13,
    color: Colors.light.background,
    opacity: 0.8,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold' as const,
    color: Colors.light.text,
    marginBottom: 12,
  },
  helperText: {
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
    minHeight: 100,
    textAlignVertical: 'top',
  },
  amountInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.light.background,
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 8,
    overflow: 'hidden',
  },
  currencySymbol: {
    paddingHorizontal: 14,
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.light.textSecondary,
    backgroundColor: '#F3F4F6',
    paddingVertical: 14,
  },
  amountInput: {
    flex: 1,
    padding: 14,
    fontSize: 16,
    color: Colors.light.text,
  },
  amountHelper: {
    fontSize: 12,
    color: Colors.light.primary,
    fontWeight: '600' as const,
    marginTop: 4,
  },
  targetCard: {
    backgroundColor: '#F0F9FF',
    borderRadius: 10,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  targetRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  targetItem: {
    flex: 1,
    alignItems: 'center',
  },
  targetDivider: {
    width: 1,
    height: 36,
    backgroundColor: '#BFDBFE',
  },
  targetLabel: {
    fontSize: 11,
    color: Colors.light.textSecondary,
    marginBottom: 4,
  },
  targetValue: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: Colors.light.text,
  },
  picker: {
    backgroundColor: Colors.light.background,
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 8,
    padding: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
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
    marginTop: 4,
    maxHeight: 200,
  },
  pickerOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  pickerOptionSelected: {
    backgroundColor: Colors.light.primary + '10',
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
    gap: 8,
    backgroundColor: Colors.light.primary,
    paddingVertical: 12,
    borderRadius: 8,
  },
  photoButtonText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.light.background,
  },
  photosContainer: {
    marginTop: 12,
  },
  photoItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.light.background,
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  photoName: {
    flex: 1,
    marginLeft: 10,
    fontSize: 14,
    color: Colors.light.text,
  },
  removePhotoBtn: {
    padding: 4,
  },
  locationButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.light.primary,
    paddingVertical: 12,
    borderRadius: 8,
  },
  locationButtonText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.light.background,
  },
  locationText: {
    marginTop: 8,
    fontSize: 12,
    color: Colors.light.textSecondary,
    textAlign: 'center',
  },
  submitButton: {
    backgroundColor: '#00838F',
    paddingVertical: 16,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 8,
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.light.background,
  },
  bottomSpacer: {
    height: 40,
  },
});
