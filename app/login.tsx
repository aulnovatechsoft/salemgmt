import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, Image } from 'react-native';
import { useRouter } from 'expo-router';
import { Mail, Phone, Eye, EyeOff } from 'lucide-react-native';
import { useAuth } from '@/contexts/auth';
import Colors from '@/constants/colors';
import { trpc } from '@/lib/trpc';

export default function LoginScreen() {
  const router = useRouter();
  const { login } = useAuth();
  const [loginType, setLoginType] = useState<'email' | 'mobile'>('email');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const loginMutation = trpc.employees.login.useMutation();
  const getByPhoneQuery = trpc.employees.getByPhone.useQuery(
    { phone: identifier },
    { enabled: false }
  );

  const sendOtp = async () => {
    if (!identifier.trim()) {
      Alert.alert('Error', 'Please enter your mobile number');
      return;
    }

    setIsLoading(true);
    
    setTimeout(() => {
      setOtpSent(true);
      setIsLoading(false);
      Alert.alert('OTP Sent', `OTP sent to ${identifier}\n\nFor demo, use OTP: 123456`);
    }, 1000);
  };

  const loginWithPassword = async () => {
    if (!identifier.trim() || !password.trim()) {
      Alert.alert('Error', 'Please enter both email and password');
      return;
    }

    // Validate email format on client side
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(identifier.trim())) {
      Alert.alert('Invalid Email', 'Please enter a valid email address (e.g., yourname@example.com)');
      return;
    }

    setIsLoading(true);

    const normalizedEmail = identifier.trim().toLowerCase();
    console.log('=== CLIENT LOGIN ATTEMPT ===' );
    console.log('Email:', normalizedEmail);
    console.log('Password length:', password.length);

    loginMutation.mutate(
      {
        email: normalizedEmail,
        password: password,
      },
      {
        onSuccess: async (employee) => {
          console.log('Login mutation success, employee ID:', employee.id);
          try {
            await login({
              id: employee.id,
              name: employee.name,
              email: employee.email,
              phone: employee.phone,
              role: employee.role,
              circle: employee.circle,
              division: employee.zone,
              designation: employee.designation,
              employeeNo: employee.employeeNo || undefined,
              reportingOfficerId: employee.reportingOfficerId || undefined,
              createdAt: employee.createdAt?.toString() || new Date().toISOString(),
            });
            setIsLoading(false);
            router.replace('/(tabs)/dashboard');
          } catch (saveError) {
            console.error('Error saving auth:', saveError);
            setIsLoading(false);
            Alert.alert('Error', 'Login successful but failed to save session. Please try again.');
          }
        },
        onError: (error: any) => {
          setIsLoading(false);
          console.log('=== LOGIN ERROR ===' );
          console.log('Error type:', typeof error);
          console.log('Error name:', error?.name);
          console.log('Error message:', error?.message);
          console.log('Error shape:', error?.shape);
          console.log('Error data:', JSON.stringify(error?.data));
          console.log('Full error:', JSON.stringify(error, null, 2));
          
          let message = 'Login failed. Please try again.';
          
          // Handle tRPC error format
          if (error?.message) {
            message = error.message;
          } else if (error?.shape?.message) {
            message = error.shape.message;
          } else if (error?.data?.message) {
            message = error.data.message;
          } else if (typeof error === 'string') {
            message = error;
          }
          
          // Check for network/connection errors
          if (message.includes('JSON') || message.includes('Unexpected') || message.includes('parse') || message.includes('fetch') || message.includes('network')) {
            console.error('Network or parsing error detected');
            Alert.alert('Connection Error', 'Unable to connect to server. Please check your internet connection and try again.');
            return;
          }
          
          console.log('Final error message:', message);
          
          // Handle Zod validation errors with user-friendly messages
          if (message.toLowerCase().includes('invalid_format') || 
              message.toLowerCase().includes('invalid email') ||
              message.toLowerCase().includes('invalid_string')) {
            Alert.alert('Invalid Email', 'Please enter a valid email address (e.g., yourname@example.com)');
          } else if (message.toLowerCase().includes('not found')) {
            Alert.alert('Error', 'Email not found. Please register first.');
          } else if (message.toLowerCase().includes('deactivated')) {
            Alert.alert('Account Deactivated', 'Your account has been deactivated. Please contact your administrator.');
          } else if (message.toLowerCase().includes('invalid password')) {
            Alert.alert('Error', 'Invalid password. Please try again.');
          } else if (message.toLowerCase().includes('too_small') || message.toLowerCase().includes('required')) {
            Alert.alert('Error', 'Please fill in all required fields.');
          } else {
            Alert.alert('Error', message);
          }
        },
      }
    );
  };

  const verifyOtp = async () => {
    if (otp !== '123456') {
      Alert.alert('Error', 'Invalid OTP. Please use 123456 for demo.');
      return;
    }

    setIsLoading(true);

    try {
      const result = await getByPhoneQuery.refetch();
      const employee = result.data;
      
      if (!employee) {
        setIsLoading(false);
        Alert.alert('Error', 'Phone number not found. Please register first.');
        return;
      }

      await login({
        id: employee.id,
        name: employee.name,
        email: employee.email,
        phone: employee.phone,
        role: employee.role,
        circle: employee.circle,
        division: employee.zone,
        designation: employee.designation,
        employeeNo: employee.employeeNo || undefined,
        reportingOfficerId: employee.reportingOfficerId || undefined,
        createdAt: employee.createdAt?.toString() || new Date().toISOString(),
      });
      setIsLoading(false);
      router.replace('/(tabs)/dashboard');
    } catch {
      setIsLoading(false);
      Alert.alert('Error', 'Login failed. Please try again.');
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Image
          source={{ uri: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3d/BSNL_Logo.svg/1200px-BSNL_Logo.svg.png' }}
          style={styles.logo}
          resizeMode="contain"
        />
        <Text style={styles.subtitle}>Event & Sales Management</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.title}>Login</Text>
        
        <View style={styles.switchContainer}>
          <TouchableOpacity
            style={[styles.switchButton, loginType === 'email' && styles.switchButtonActive]}
            onPress={() => {
              setLoginType('email');
              setOtpSent(false);
              setIdentifier('');
              setPassword('');
              setOtp('');
            }}
          >
            <Mail size={20} color={loginType === 'email' ? Colors.light.background : Colors.light.textSecondary} />
            <Text style={[styles.switchText, loginType === 'email' && styles.switchTextActive]}>Email</Text>
          </TouchableOpacity>
          
          <TouchableOpacity
            style={[styles.switchButton, loginType === 'mobile' && styles.switchButtonActive]}
            onPress={() => {
              setLoginType('mobile');
              setOtpSent(false);
              setIdentifier('');
              setPassword('');
              setOtp('');
            }}
          >
            <Phone size={20} color={loginType === 'mobile' ? Colors.light.background : Colors.light.textSecondary} />
            <Text style={[styles.switchText, loginType === 'mobile' && styles.switchTextActive]}>Mobile</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.inputContainer}>
          <Text style={styles.label}>{loginType === 'email' ? 'Email Address' : 'Mobile Number'}</Text>
          <TextInput
            style={styles.input}
            placeholder={loginType === 'email' ? 'Enter your email' : 'Enter your mobile number'}
            value={identifier}
            onChangeText={setIdentifier}
            keyboardType={loginType === 'email' ? 'email-address' : 'phone-pad'}
            autoCapitalize="none"
            editable={loginType === 'email' || !otpSent}
          />
        </View>

        {loginType === 'email' ? (
          <View style={styles.inputContainer}>
            <Text style={styles.label}>Password</Text>
            <View style={styles.passwordContainer}>
              <TextInput
                style={styles.passwordInput}
                placeholder="Enter your password"
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
              />
              <TouchableOpacity
                style={styles.eyeIcon}
                onPress={() => setShowPassword(!showPassword)}
              >
                {showPassword ? (
                  <EyeOff size={20} color={Colors.light.textSecondary} />
                ) : (
                  <Eye size={20} color={Colors.light.textSecondary} />
                )}
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          otpSent && (
            <View style={styles.inputContainer}>
              <Text style={styles.label}>Enter OTP</Text>
              <TextInput
                style={styles.input}
                placeholder="Enter 6-digit OTP"
                value={otp}
                onChangeText={setOtp}
                keyboardType="number-pad"
                maxLength={6}
              />
              <TouchableOpacity onPress={sendOtp} style={styles.resendButton}>
                <Text style={styles.resendText}>Resend OTP</Text>
              </TouchableOpacity>
            </View>
          )
        )}

        <TouchableOpacity
          style={styles.button}
          onPress={loginType === 'email' ? loginWithPassword : (otpSent ? verifyOtp : sendOtp)}
          disabled={isLoading}
        >
          {isLoading ? (
            <ActivityIndicator color={Colors.light.background} />
          ) : (
            <Text style={styles.buttonText}>
              {loginType === 'email' ? 'Login' : (otpSent ? 'Verify OTP' : 'Send OTP')}
            </Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.registerLink}
          onPress={() => router.push('/register')}
        >
          <Text style={styles.registerLinkText}>
            Don&apos;t have an account? <Text style={styles.registerLinkTextBold}>Register</Text>
          </Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.footer}>BSNL - Connecting India</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.light.primary,
    justifyContent: 'center',
    padding: 20,
  },
  header: {
    alignItems: 'center',
    marginBottom: 40,
  },
  logo: {
    width: 180,
    height: 80,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: Colors.light.background,
    marginTop: 8,
    opacity: 0.9,
  },
  card: {
    backgroundColor: Colors.light.background,
    borderRadius: 16,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold' as const,
    color: Colors.light.text,
    marginBottom: 24,
    textAlign: 'center',
  },
  switchContainer: {
    flexDirection: 'row',
    marginBottom: 24,
    backgroundColor: Colors.light.backgroundSecondary,
    borderRadius: 8,
    padding: 4,
  },
  switchButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 6,
    gap: 8,
  },
  switchButtonActive: {
    backgroundColor: Colors.light.primary,
  },
  switchText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.light.textSecondary,
  },
  switchTextActive: {
    color: Colors.light.background,
  },
  inputContainer: {
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.light.text,
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 8,
    padding: 14,
    fontSize: 16,
    color: Colors.light.text,
    backgroundColor: Colors.light.background,
  },
  passwordContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 8,
    backgroundColor: Colors.light.background,
  },
  passwordInput: {
    flex: 1,
    padding: 14,
    fontSize: 16,
    color: Colors.light.text,
  },
  eyeIcon: {
    padding: 14,
  },
  resendButton: {
    marginTop: 8,
    alignSelf: 'flex-end',
  },
  resendText: {
    fontSize: 14,
    color: Colors.light.primary,
    fontWeight: '600' as const,
  },
  button: {
    backgroundColor: Colors.light.primary,
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonText: {
    color: Colors.light.background,
    fontSize: 16,
    fontWeight: 'bold' as const,
  },
  footer: {
    textAlign: 'center',
    color: Colors.light.background,
    fontSize: 14,
    marginTop: 32,
    opacity: 0.8,
  },
  registerLink: {
    marginTop: 16,
    alignItems: 'center',
  },
  registerLinkText: {
    fontSize: 14,
    color: Colors.light.textSecondary,
  },
  registerLinkTextBold: {
    color: Colors.light.primary,
    fontWeight: '600' as const,
  },
});
