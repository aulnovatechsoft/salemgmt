import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, Image } from 'react-native';
import { useRouter } from 'expo-router';
import { User, Eye, EyeOff, Phone, MessageSquare } from 'lucide-react-native';
import { useAuth } from '@/contexts/auth';
import Colors from '@/constants/colors';
import { trpc } from '@/lib/trpc';

type LoginMethod = 'password' | 'otp';

export default function LoginScreen() {
  const router = useRouter();
  const { login } = useAuth();
  const [loginMethod, setLoginMethod] = useState<LoginMethod>('password');
  
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const loginMutation = trpc.employees.login.useMutation();
  const changePasswordMutation = trpc.employees.changePassword.useMutation();

  const [showChangePassword, setShowChangePassword] = useState(false);
  const [pendingEmployee, setPendingEmployee] = useState<any>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const handleLogin = async () => {
    if (!username.trim() || !password.trim()) {
      Alert.alert('Error', 'Please enter both username and password');
      return;
    }

    setIsLoading(true);

    loginMutation.mutate(
      {
        username: username.trim(),
        password: password,
      },
      {
        onSuccess: async (employee) => {
          console.log('Login success, employee ID:', employee.id);
          
          if (employee.needsPasswordChange) {
            setIsLoading(false);
            setPendingEmployee(employee);
            setShowChangePassword(true);
            return;
          }
          
          try {
            await login({
              id: employee.id,
              name: employee.name,
              email: employee.email || '',
              phone: employee.phone || '',
              role: employee.role,
              circle: employee.circle,
              division: employee.zone,
              designation: employee.designation,
              persNo: employee.persNo || undefined,
              reportingPersNo: employee.reportingPersNo || undefined,
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
          console.log('Login error:', error?.message);
          
          let message = 'Login failed. Please try again.';
          
          if (error?.message) {
            message = error.message;
          }
          
          if (message.includes('JSON') || message.includes('fetch') || message.includes('network')) {
            Alert.alert('Connection Error', 'Unable to connect to server. Please check your internet connection.');
            return;
          }
          
          Alert.alert('Error', message);
        },
      }
    );
  };

  const handleChangePassword = async () => {
    if (!newPassword || !confirmPassword) {
      Alert.alert('Error', 'Please fill in both password fields');
      return;
    }

    if (newPassword.length < 6) {
      Alert.alert('Error', 'Password must be at least 6 characters');
      return;
    }

    if (newPassword !== confirmPassword) {
      Alert.alert('Error', 'Passwords do not match');
      return;
    }

    if (newPassword === password) {
      Alert.alert('Error', 'New password must be different from current password');
      return;
    }

    setIsLoading(true);

    changePasswordMutation.mutate(
      {
        employeeId: pendingEmployee.id,
        currentPassword: password,
        newPassword: newPassword,
      },
      {
        onSuccess: async () => {
          try {
            await login({
              id: pendingEmployee.id,
              name: pendingEmployee.name,
              email: pendingEmployee.email || '',
              phone: pendingEmployee.phone || '',
              role: pendingEmployee.role,
              circle: pendingEmployee.circle,
              division: pendingEmployee.zone,
              designation: pendingEmployee.designation,
              persNo: pendingEmployee.persNo || undefined,
              reportingPersNo: pendingEmployee.reportingPersNo || undefined,
              createdAt: pendingEmployee.createdAt?.toString() || new Date().toISOString(),
            });
            setIsLoading(false);
            Alert.alert('Success', 'Password changed successfully!', [
              { text: 'OK', onPress: () => router.replace('/(tabs)/dashboard') }
            ]);
          } catch (error) {
            setIsLoading(false);
            Alert.alert('Error', 'Failed to complete login. Please try again.');
          }
        },
        onError: (error: any) => {
          setIsLoading(false);
          Alert.alert('Error', error?.message || 'Failed to change password');
        },
      }
    );
  };

  if (showChangePassword) {
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
          <Text style={styles.title}>Change Password</Text>
          <Text style={styles.changePasswordInfo}>
            Welcome {pendingEmployee?.name}! Please set a new password to continue.
          </Text>
          
          <View style={styles.inputContainer}>
            <Text style={styles.label}>New Password</Text>
            <View style={styles.passwordContainer}>
              <TextInput
                style={styles.passwordInput}
                placeholder="Enter new password (min 6 chars)"
                value={newPassword}
                onChangeText={setNewPassword}
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

          <View style={styles.inputContainer}>
            <Text style={styles.label}>Confirm Password</Text>
            <TextInput
              style={styles.input}
              placeholder="Re-enter new password"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
            />
          </View>

          <TouchableOpacity
            style={styles.button}
            onPress={handleChangePassword}
            disabled={isLoading}
          >
            {isLoading ? (
              <ActivityIndicator color={Colors.light.background} />
            ) : (
              <Text style={styles.buttonText}>Set Password & Login</Text>
            )}
          </TouchableOpacity>
        </View>

        <Text style={styles.footer}>BSNL - Connecting India</Text>
      </View>
    );
  }

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
        
        <View style={styles.tabContainer}>
          <TouchableOpacity
            style={[styles.tab, loginMethod === 'password' && styles.activeTab]}
            onPress={() => setLoginMethod('password')}
          >
            <User size={16} color={loginMethod === 'password' ? Colors.light.primary : Colors.light.textSecondary} />
            <Text style={[styles.tabText, loginMethod === 'password' && styles.activeTabText]}>Password</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, loginMethod === 'otp' && styles.activeTab]}
            onPress={() => setLoginMethod('otp')}
          >
            <Phone size={16} color={loginMethod === 'otp' ? Colors.light.primary : Colors.light.textSecondary} />
            <Text style={[styles.tabText, loginMethod === 'otp' && styles.activeTabText]}>OTP</Text>
          </TouchableOpacity>
        </View>

        {loginMethod === 'password' ? (
          <>
            <View style={styles.loginHint}>
              <User size={16} color={Colors.light.primary} />
              <Text style={styles.loginHintText}>Use Email or Pers Number</Text>
            </View>

            <View style={styles.inputContainer}>
              <Text style={styles.label}>Email / Pers Number</Text>
              <TextInput
                style={styles.input}
                placeholder="Enter email or Pers Number"
                value={username}
                onChangeText={setUsername}
                autoCapitalize="none"
              />
            </View>

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

            <TouchableOpacity
              style={styles.button}
              onPress={handleLogin}
              disabled={isLoading}
            >
              {isLoading ? (
                <ActivityIndicator color={Colors.light.background} />
              ) : (
                <Text style={styles.buttonText}>Login</Text>
              )}
            </TouchableOpacity>
          </>
        ) : (
          <View style={styles.otpNotImplemented}>
            <MessageSquare size={48} color={Colors.light.textSecondary} />
            <Text style={styles.otpNotImplementedTitle}>OTP Login</Text>
            <Text style={styles.otpNotImplementedText}>
              OTP functionality not yet implemented.
            </Text>
            <Text style={styles.otpNotImplementedSubtext}>
              SMS gateway integration is pending. Please use Password login for now.
            </Text>
          </View>
        )}

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
    marginBottom: 16,
    textAlign: 'center',
  },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: Colors.light.backgroundSecondary,
    borderRadius: 8,
    padding: 4,
    marginBottom: 20,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 6,
    gap: 6,
  },
  activeTab: {
    backgroundColor: Colors.light.background,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  tabText: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.light.textSecondary,
  },
  activeTabText: {
    color: Colors.light.primary,
  },
  loginHint: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.light.backgroundSecondary,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginBottom: 20,
    gap: 8,
  },
  loginHintText: {
    fontSize: 14,
    color: Colors.light.primary,
    fontWeight: '500',
  },
  changePasswordInfo: {
    fontSize: 14,
    color: Colors.light.textSecondary,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
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
  resendContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 16,
  },
  countdownText: {
    fontSize: 14,
    color: Colors.light.textSecondary,
  },
  resendText: {
    fontSize: 14,
    color: Colors.light.primary,
    fontWeight: '600',
  },
  changeNumberText: {
    fontSize: 14,
    color: Colors.light.textSecondary,
    textDecorationLine: 'underline',
  },
  otpNotImplemented: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  otpNotImplementedTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.light.text,
    marginTop: 16,
    marginBottom: 8,
  },
  otpNotImplementedText: {
    fontSize: 15,
    fontWeight: '500',
    color: Colors.light.warning,
    textAlign: 'center',
  },
  otpNotImplementedSubtext: {
    fontSize: 13,
    color: Colors.light.textSecondary,
    textAlign: 'center',
    marginTop: 8,
    paddingHorizontal: 16,
    lineHeight: 18,
  },
});
