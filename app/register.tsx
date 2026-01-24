import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Alert, ActivityIndicator, Image } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft, CheckCircle, Search, User, Building, MapPin } from 'lucide-react-native';
import { useAuth } from '@/contexts/auth';
import { useApp } from '@/contexts/app';
import Colors from '@/constants/colors';
import { UserRole, Circle } from '@/types';
import { trpc } from '@/lib/trpc';

type MasterRecord = {
  id: string;
  purseId: string;
  name: string;
  circle: string | null;
  zone: string | null;
  designation: string | null;
  empGroup: string | null;
  reportingPurseId: string | null;
  reportingOfficerName: string | null;
  reportingOfficerDesignation: string | null;
  division: string | null;
  buildingName: string | null;
  officeName: string | null;
  isLinked: boolean;
  manager?: {
    name: string;
    designation: string | null;
    purseId: string;
  } | null;
};

export default function RegisterScreen() {
  const router = useRouter();
  const { login } = useAuth();
  const { addEmployees } = useApp();
  
  const [step, setStep] = useState<'verify' | 'register'>('verify');
  const [purseId, setPurseId] = useState('');
  const [masterData, setMasterData] = useState<MasterRecord | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  
  const [formData, setFormData] = useState({
    email: '',
    phone: '',
    password: '',
    confirmPassword: '',
  });
  
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(false);

  const trpcUtils = trpc.useUtils();

  const verifyPurseId = async () => {
    if (!purseId.trim()) {
      Alert.alert('Error', 'Please enter your Employee Pers No');
      return;
    }
    
    setIsVerifying(true);
    try {
      const result = await trpcUtils.admin.getEmployeeMasterByPurseId.fetch({ purseId: purseId.trim() });
      
      if (!result) {
        Alert.alert(
          'Not Found',
          'Employee Pers No not found in our records. Please contact your admin to import employee data.',
          [{ text: 'OK' }]
        );
        setIsVerifying(false);
        return;
      }
      
      if (result.isLinked) {
        Alert.alert(
          'Already Registered',
          'This Employee Pers No is already linked to an account. Please login instead.',
          [
            { text: 'Go to Login', onPress: () => router.back() },
            { text: 'Cancel', style: 'cancel' },
          ]
        );
        setIsVerifying(false);
        return;
      }
      
      setMasterData(result as MasterRecord);
      setStep('register');
      setIsVerifying(false);
    } catch (error: any) {
      console.error('Verify error:', error);
      Alert.alert('Error', error.message || 'Failed to verify. Please try again.');
      setIsVerifying(false);
    }
  };

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.email.trim()) {
      newErrors.email = 'Email is required';
    } else if (!/\S+@\S+\.\S+/.test(formData.email)) {
      newErrors.email = 'Invalid email format';
    }

    if (!formData.phone.trim()) {
      newErrors.phone = 'Phone number is required';
    } else if (!/^\d{10}$/.test(formData.phone.replace(/\D/g, ''))) {
      newErrors.phone = 'Phone must be 10 digits';
    }

    if (!formData.password) {
      newErrors.password = 'Password is required';
    } else if (formData.password.length < 6) {
      newErrors.password = 'Password must be at least 6 characters';
    }

    if (formData.password !== formData.confirmPassword) {
      newErrors.confirmPassword = 'Passwords do not match';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const linkMutation = trpc.admin.linkEmployeeProfile.useMutation();
  
  const createEmployeeMutation = trpc.employees.create.useMutation({
    onSuccess: async (data) => {
      console.log('Employee created:', data.id);
      
      try {
        await linkMutation.mutateAsync({
          purseId: masterData!.purseId,
          employeeId: data.id,
        });
        console.log('Employee linked to master record');
      } catch (linkError: any) {
        console.error('Failed to link employee:', linkError);
        setIsLoading(false);
        Alert.alert(
          'Linking Failed',
          'Your account was created but could not be linked to the employee record. Please contact admin or try linking from your profile.',
          [{ text: 'OK', onPress: () => router.replace('/(tabs)/dashboard') }]
        );
        return;
      }
      
      const employeeData = {
        id: data.id,
        name: data.name,
        email: data.email,
        phone: data.phone,
        password: formData.password,
        role: data.role as UserRole,
        circle: data.circle as Circle,
        division: masterData?.zone || '',
        buildingName: masterData?.buildingName || undefined,
        officeName: masterData?.officeName || undefined,
        reportingOfficerId: data.reportingOfficerId || undefined,
        employeeNo: data.employeeNo || '',
        designation: data.designation,
        createdAt: data.createdAt?.toISOString() || new Date().toISOString(),
      };
      await addEmployees([employeeData]);
      await login(employeeData);
      setIsLoading(false);
      Alert.alert('Success', 'Registration successful! Your account is now linked to your official employee record.', [
        {
          text: 'OK',
          onPress: () => router.replace('/(tabs)/dashboard'),
        },
      ]);
    },
    onError: (error) => {
      console.error('Failed to create employee:', error);
      setIsLoading(false);
      Alert.alert('Error', error.message || 'Registration failed. Please try again.');
    },
  });

  const handleRegister = async () => {
    if (!validateForm() || !masterData) {
      Alert.alert('Validation Error', 'Please fix the errors in the form');
      return;
    }

    setIsLoading(true);

    const roleMapping: Record<string, UserRole> = {
      'GM': 'GM',
      'CGM': 'CGM',
      'DGM': 'DGM',
      'AGM': 'AGM',
      'SD_JTO': 'SD_JTO',
      'JTO': 'SD_JTO',
      'SDE': 'SD_JTO',
      'SALES_STAFF': 'SALES_STAFF',
    };
    
    const designationUpper = (masterData.designation || '').toUpperCase();
    let role: UserRole = 'SALES_STAFF';
    
    // Auto-admin: Specific purse IDs get full admin (GM) role
    const adminPurseIds = ['60010032']; // SURESH KUMAR - OSD to CMD
    if (adminPurseIds.includes(masterData.purseId)) {
      role = 'GM';
    } 
    // Auto-admin: High-level designations get GM role
    else if (designationUpper.includes('CMD') || 
             designationUpper.includes('OSD') ||
             designationUpper.includes('DIRECTOR') ||
             designationUpper.includes('ED') ||
             designationUpper.includes('EXECUTIVE DIRECTOR')) {
      role = 'GM';
    }
    else {
      for (const [key, value] of Object.entries(roleMapping)) {
        if (designationUpper.includes(key)) {
          role = value;
          break;
        }
      }
    }

    const circleMapping: Record<string, Circle> = {
      'ANDAMAN': 'ANDAMAN_NICOBAR',
      'ANDHRA': 'ANDHRA_PRADESH',
      'ASSAM': 'ASSAM',
      'BIHAR': 'BIHAR',
      'CHHATTISGARH': 'CHHATTISGARH',
      'GUJARAT': 'GUJARAT',
      'HARYANA': 'HARYANA',
      'HIMACHAL': 'HIMACHAL_PRADESH',
      'JAMMU': 'JAMMU_KASHMIR',
      'JHARKHAND': 'JHARKHAND',
      'KARNATAKA': 'KARNATAKA',
      'KERALA': 'KERALA',
      'MADHYA': 'MADHYA_PRADESH',
      'MAHARASHTRA': 'MAHARASHTRA',
      'NORTH_EAST': 'NORTH_EAST_I',
      'ODISHA': 'ODISHA',
      'PUNJAB': 'PUNJAB',
      'RAJASTHAN': 'RAJASTHAN',
      'TAMIL': 'TAMIL_NADU',
      'TELANGANA': 'TELANGANA',
      'UTTARAKHAND': 'UTTARAKHAND',
      'UTTAR_PRADESH_EAST': 'UTTAR_PRADESH_EAST',
      'UP_EAST': 'UTTAR_PRADESH_EAST',
      'UTTAR_PRADESH_WEST': 'UTTAR_PRADESH_WEST',
      'UP_WEST': 'UTTAR_PRADESH_WEST',
      'WEST_BENGAL': 'WEST_BENGAL',
    };
    
    const circleUpper = (masterData.circle || 'MAHARASHTRA').toUpperCase().replace(/\s+/g, '_');
    let circle: Circle = 'MAHARASHTRA';
    for (const [key, value] of Object.entries(circleMapping)) {
      if (circleUpper.includes(key)) {
        circle = value;
        break;
      }
    }

    try {
      createEmployeeMutation.mutate({
        name: masterData.name,
        email: formData.email.trim().toLowerCase(),
        phone: formData.phone.trim(),
        password: formData.password,
        role: role,
        circle: circle,
        zone: masterData.zone || masterData.division || '',
        employeeNo: masterData.purseId,
        designation: masterData.designation || 'Staff',
      });
    } catch (error) {
      console.error('Registration error:', error);
      setIsLoading(false);
      Alert.alert('Error', 'Registration failed. Please try again.');
    }
  };

  const resetToVerify = () => {
    setStep('verify');
    setMasterData(null);
    setFormData({ email: '', phone: '', password: '', confirmPassword: '' });
    setErrors({});
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => step === 'verify' ? router.back() : resetToVerify()} style={styles.backButton}>
          <ChevronLeft size={24} color={Colors.light.background} />
        </TouchableOpacity>
        <Image
          source={{ uri: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3d/BSNL_Logo.svg/1200px-BSNL_Logo.svg.png' }}
          style={styles.logo}
          resizeMode="contain"
        />
      </View>

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        <View style={styles.card}>
          {step === 'verify' ? (
            <>
              <Text style={styles.title}>Employee Registration</Text>
              <Text style={styles.subtitle}>Enter your Employee Pers No to get started</Text>

              <View style={styles.section}>
                <View style={styles.inputContainer}>
                  <Text style={styles.label}>Employee Pers No *</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="Enter your Employee Pers No"
                    value={purseId}
                    onChangeText={setPurseId}
                    autoCapitalize="none"
                  />
                  <Text style={styles.hint}>This is your official BSNL employee personnel number</Text>
                </View>

                <TouchableOpacity
                  style={styles.verifyButton}
                  onPress={verifyPurseId}
                  disabled={isVerifying}
                >
                  {isVerifying ? (
                    <ActivityIndicator color={Colors.light.background} />
                  ) : (
                    <>
                      <Search size={20} color={Colors.light.background} />
                      <Text style={styles.verifyButtonText}>Verify & Continue</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>

              <View style={styles.infoBox}>
                <Text style={styles.infoTitle}>How it works:</Text>
                <Text style={styles.infoText}>1. Enter your Employee Pers No</Text>
                <Text style={styles.infoText}>2. We'll fetch your details from official records</Text>
                <Text style={styles.infoText}>3. Just add email, phone & password to complete</Text>
              </View>

              <TouchableOpacity
                style={styles.loginLink}
                onPress={() => router.back()}
              >
                <Text style={styles.loginLinkText}>
                  Already have an account? <Text style={styles.loginLinkTextBold}>Login</Text>
                </Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <View style={styles.verifiedHeader}>
                <CheckCircle size={24} color="#10B981" />
                <Text style={styles.verifiedText}>Employee Verified</Text>
              </View>

              <View style={styles.employeeCard}>
                <View style={styles.employeeCardHeader}>
                  <User size={20} color={Colors.light.primary} />
                  <Text style={styles.employeeCardTitle}>Your Details</Text>
                </View>
                <View style={styles.employeeDetail}>
                  <Text style={styles.detailLabel}>Name</Text>
                  <Text style={styles.detailValue}>{masterData?.name}</Text>
                </View>
                <View style={styles.employeeDetail}>
                  <Text style={styles.detailLabel}>Employee Pers No</Text>
                  <Text style={styles.detailValue}>{masterData?.purseId}</Text>
                </View>
                <View style={styles.employeeDetail}>
                  <Text style={styles.detailLabel}>Designation</Text>
                  <Text style={styles.detailValue}>{masterData?.designation || 'N/A'}</Text>
                </View>
                <View style={styles.row}>
                  <View style={[styles.employeeDetail, { flex: 1 }]}>
                    <Text style={styles.detailLabel}>Circle</Text>
                    <Text style={styles.detailValue}>{masterData?.circle || 'N/A'}</Text>
                  </View>
                  <View style={[styles.employeeDetail, { flex: 1 }]}>
                    <Text style={styles.detailLabel}>Zone</Text>
                    <Text style={styles.detailValue}>{masterData?.zone || 'N/A'}</Text>
                  </View>
                </View>
                {masterData?.division && (
                  <View style={styles.employeeDetail}>
                    <Text style={styles.detailLabel}>Division</Text>
                    <Text style={styles.detailValue}>{masterData.division}</Text>
                  </View>
                )}
                {masterData?.officeName && (
                  <View style={styles.employeeDetail}>
                    <Text style={styles.detailLabel}>Office</Text>
                    <Text style={styles.detailValue}>{masterData.officeName}</Text>
                  </View>
                )}
                {masterData?.reportingOfficerName && (
                  <View style={styles.employeeDetail}>
                    <Text style={styles.detailLabel}>Reporting Officer</Text>
                    <Text style={styles.detailValue}>
                      {masterData.reportingOfficerName}
                      {masterData.reportingOfficerDesignation ? ` (${masterData.reportingOfficerDesignation})` : ''}
                    </Text>
                  </View>
                )}
                <TouchableOpacity onPress={resetToVerify} style={styles.changeLink}>
                  <Text style={styles.changeLinkText}>Not you? Change Employee Pers No</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Complete Your Registration</Text>

                <View style={styles.inputContainer}>
                  <Text style={styles.label}>Email Address *</Text>
                  <TextInput
                    style={[styles.input, errors.email && styles.inputError]}
                    placeholder="your.email@bsnl.in"
                    value={formData.email}
                    onChangeText={(text) => {
                      setFormData({ ...formData, email: text });
                      if (errors.email) setErrors({ ...errors, email: '' });
                    }}
                    keyboardType="email-address"
                    autoCapitalize="none"
                  />
                  {errors.email ? <Text style={styles.errorText}>{errors.email}</Text> : null}
                </View>

                <View style={styles.inputContainer}>
                  <Text style={styles.label}>Mobile Number *</Text>
                  <TextInput
                    style={[styles.input, errors.phone && styles.inputError]}
                    placeholder="10-digit mobile number"
                    value={formData.phone}
                    onChangeText={(text) => {
                      setFormData({ ...formData, phone: text });
                      if (errors.phone) setErrors({ ...errors, phone: '' });
                    }}
                    keyboardType="phone-pad"
                    maxLength={10}
                  />
                  {errors.phone ? <Text style={styles.errorText}>{errors.phone}</Text> : null}
                </View>

                <View style={styles.inputContainer}>
                  <Text style={styles.label}>Password *</Text>
                  <TextInput
                    style={[styles.input, errors.password && styles.inputError]}
                    placeholder="Minimum 6 characters"
                    value={formData.password}
                    onChangeText={(text) => {
                      setFormData({ ...formData, password: text });
                      if (errors.password) setErrors({ ...errors, password: '' });
                    }}
                    secureTextEntry
                    autoCapitalize="none"
                  />
                  {errors.password ? <Text style={styles.errorText}>{errors.password}</Text> : null}
                </View>

                <View style={styles.inputContainer}>
                  <Text style={styles.label}>Confirm Password *</Text>
                  <TextInput
                    style={[styles.input, errors.confirmPassword && styles.inputError]}
                    placeholder="Re-enter your password"
                    value={formData.confirmPassword}
                    onChangeText={(text) => {
                      setFormData({ ...formData, confirmPassword: text });
                      if (errors.confirmPassword) setErrors({ ...errors, confirmPassword: '' });
                    }}
                    secureTextEntry
                    autoCapitalize="none"
                  />
                  {errors.confirmPassword ? <Text style={styles.errorText}>{errors.confirmPassword}</Text> : null}
                </View>
              </View>

              <TouchableOpacity
                style={styles.button}
                onPress={handleRegister}
                disabled={isLoading}
              >
                {isLoading ? (
                  <ActivityIndicator color={Colors.light.background} />
                ) : (
                  <Text style={styles.buttonText}>Complete Registration</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.loginLink}
                onPress={() => router.back()}
              >
                <Text style={styles.loginLinkText}>
                  Already have an account? <Text style={styles.loginLinkTextBold}>Login</Text>
                </Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.light.primary,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: Colors.light.primary,
  },
  backButton: {
    marginRight: 12,
  },
  logo: {
    width: 120,
    height: 50,
  },
  scrollView: {
    flex: 1,
  },
  card: {
    backgroundColor: Colors.light.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 32,
    paddingBottom: 40,
    minHeight: '100%',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: Colors.light.text,
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: Colors.light.textSecondary,
    marginBottom: 24,
    textAlign: 'center',
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.light.text,
    marginBottom: 16,
  },
  inputContainer: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.light.text,
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    backgroundColor: '#FAFAFA',
  },
  inputError: {
    borderColor: '#EF4444',
  },
  errorText: {
    color: '#EF4444',
    fontSize: 12,
    marginTop: 4,
  },
  hint: {
    fontSize: 12,
    color: Colors.light.textSecondary,
    marginTop: 6,
  },
  verifyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.light.primary,
    paddingVertical: 16,
    borderRadius: 12,
    marginTop: 8,
  },
  verifyButtonText: {
    color: Colors.light.background,
    fontSize: 16,
    fontWeight: '600',
  },
  infoBox: {
    backgroundColor: '#F0F7FF',
    padding: 16,
    borderRadius: 12,
    marginBottom: 24,
  },
  infoTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.light.primary,
    marginBottom: 8,
  },
  infoText: {
    fontSize: 13,
    color: Colors.light.text,
    marginBottom: 4,
  },
  verifiedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 16,
  },
  verifiedText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#10B981',
  },
  employeeCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  employeeCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  employeeCardTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.light.primary,
  },
  employeeDetail: {
    marginBottom: 10,
  },
  detailLabel: {
    fontSize: 12,
    color: Colors.light.textSecondary,
    marginBottom: 2,
  },
  detailValue: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.light.text,
  },
  row: {
    flexDirection: 'row',
    gap: 16,
  },
  changeLink: {
    marginTop: 8,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
  },
  changeLinkText: {
    fontSize: 13,
    color: Colors.light.primary,
    textAlign: 'center',
  },
  button: {
    backgroundColor: Colors.light.primary,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 16,
  },
  buttonText: {
    color: Colors.light.background,
    fontSize: 16,
    fontWeight: '600',
  },
  loginLink: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  loginLinkText: {
    fontSize: 14,
    color: Colors.light.textSecondary,
  },
  loginLinkTextBold: {
    fontWeight: '600',
    color: Colors.light.primary,
  },
});
