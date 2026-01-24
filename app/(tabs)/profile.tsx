import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { User, Mail, Phone, Briefcase, MapPin, LogOut, FileText, Settings } from 'lucide-react-native';
import { useAuth } from '@/contexts/auth';
import { useApp } from '@/contexts/app';
import Colors from '@/constants/colors';
import React from "react";

export default function ProfileScreen() {
  const router = useRouter();
  const { employee, logout } = useAuth();
  const { clearAllData } = useApp();

  const handleLogout = () => {
    Alert.alert(
      'Logout',
      'Are you sure you want to logout?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Logout',
          style: 'destructive',
          onPress: async () => {
            await logout();
            router.replace('/login');
          },
        },
      ]
    );
  };

  const handleClearData = () => {
    Alert.alert(
      'Clear Data',
      'This will delete all events, sales reports, and issues. Are you sure?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            await clearAllData();
            Alert.alert('Success', 'All data cleared successfully');
          },
        },
      ]
    );
  };

  if (!employee) return null;

  return (
    <>
      <Stack.Screen 
        options={{ 
          title: 'Profile',
          headerStyle: {
            backgroundColor: Colors.light.primary,
          },
          headerTintColor: Colors.light.background,
          headerTitleStyle: {
            fontWeight: 'bold' as const,
          },
          headerShown: true,
        }} 
      />
      <ScrollView style={styles.container}>
        <View style={styles.header}>
          <View style={styles.avatarContainer}>
            <User size={48} color={Colors.light.background} />
          </View>
          <Text style={styles.name}>{employee.name}</Text>
          <Text style={styles.designation}>{employee.designation}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Personal Information</Text>
          
          <View style={styles.infoCard}>
            <InfoItem
              icon={<Mail size={20} color={Colors.light.primary} />}
              label="Email"
              value={employee.email}
            />
            <InfoItem
              icon={<Phone size={20} color={Colors.light.primary} />}
              label="Phone"
              value={employee.phone}
            />
            <InfoItem
              icon={<Briefcase size={20} color={Colors.light.primary} />}
              label="Employee Number"
              value={employee.employeeNo || 'N/A'}
            />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Work Information</Text>
          
          <View style={styles.infoCard}>
            <InfoItem
              icon={<User size={20} color={Colors.light.primary} />}
              label="Role"
              value={employee.role}
            />
            <InfoItem
              icon={<MapPin size={20} color={Colors.light.primary} />}
              label="Circle"
              value={employee.circle}
            />
            <InfoItem
              icon={<MapPin size={20} color={Colors.light.primary} />}
              label="Division"
              value={employee.division || 'N/A'}
            />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Actions</Text>
          
          <TouchableOpacity style={styles.actionButton} onPress={() => router.push('/audit-logs')}>
            <FileText size={20} color={Colors.light.text} />
            <Text style={styles.actionButtonText}>View Audit Logs</Text>
          </TouchableOpacity>

          {(employee.role === 'GM' || employee.role === 'CGM') && (
            <TouchableOpacity style={styles.actionButton} onPress={() => router.push('/admin-settings')}>
              <Settings size={20} color={Colors.light.text} />
              <Text style={styles.actionButtonText}>Admin Settings</Text>
            </TouchableOpacity>
          )}

          {employee.role === 'GM' && (
            <TouchableOpacity style={styles.actionButton} onPress={handleClearData}>
              <FileText size={20} color={Colors.light.error} />
              <Text style={[styles.actionButtonText, { color: Colors.light.error }]}>Clear All Data</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity style={[styles.actionButton, styles.logoutButton]} onPress={handleLogout}>
            <LogOut size={20} color={Colors.light.background} />
            <Text style={styles.logoutButtonText}>Logout</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>BSNL Event & Sales Management</Text>
          <Text style={styles.footerVersion}>Version 1.0.0</Text>
        </View>

        <View style={styles.bottomSpacer} />
      </ScrollView>
    </>
  );
}

function InfoItem({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <View style={styles.infoItem}>
      <View style={styles.infoIcon}>{icon}</View>
      <View style={styles.infoContent}>
        <Text style={styles.infoLabel}>{label}</Text>
        <Text style={styles.infoValue}>{value}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.light.backgroundSecondary,
  },
  header: {
    backgroundColor: Colors.light.primary,
    alignItems: 'center',
    paddingVertical: 40,
    paddingHorizontal: 20,
  },
  avatarContainer: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: Colors.light.secondary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  name: {
    fontSize: 24,
    fontWeight: 'bold' as const,
    color: Colors.light.background,
    marginBottom: 4,
  },
  designation: {
    fontSize: 16,
    color: Colors.light.background,
    opacity: 0.9,
  },
  section: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold' as const,
    color: Colors.light.text,
    marginBottom: 12,
  },
  infoCard: {
    backgroundColor: Colors.light.card,
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  infoItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  infoIcon: {
    marginRight: 16,
  },
  infoContent: {
    flex: 1,
  },
  infoLabel: {
    fontSize: 12,
    color: Colors.light.textSecondary,
    marginBottom: 4,
  },
  infoValue: {
    fontSize: 16,
    color: Colors.light.text,
    fontWeight: '600' as const,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.light.card,
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    gap: 12,
  },
  actionButtonText: {
    fontSize: 16,
    color: Colors.light.text,
    fontWeight: '600' as const,
  },
  logoutButton: {
    backgroundColor: Colors.light.error,
  },
  logoutButtonText: {
    fontSize: 16,
    color: Colors.light.background,
    fontWeight: '600' as const,
  },
  footer: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  footerText: {
    fontSize: 14,
    color: Colors.light.textSecondary,
    marginBottom: 4,
  },
  footerVersion: {
    fontSize: 12,
    color: Colors.light.textSecondary,
  },
  bottomSpacer: {
    height: 20,
  },
});
