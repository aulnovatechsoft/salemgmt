import { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { User, Mail, Phone, Briefcase, MapPin, ArrowLeft, AlertTriangle, IndianRupee, Building2 } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { trpc } from '@/lib/trpc';
import { safeNumber, formatINRAmount, formatINRCrore, hasOutstandingAmount, getTotalOutstanding } from '@/lib/currency';
import React from "react";

const getInitials = (name: string) => {
  const parts = name.split(' ').filter(p => p.length > 0);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return name.substring(0, 2).toUpperCase();
};

const getAvatarColor = (name: string) => {
  const colors = ['#1976D2', '#388E3C', '#D32F2F', '#7B1FA2', '#F57C00', '#0097A7', '#5D4037', '#455A64'];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
};

const InfoItem = ({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) => (
  <View style={styles.infoItem}>
    <View style={styles.infoIcon}>{icon}</View>
    <View style={styles.infoContent}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  </View>
);

export default function EmployeeProfileScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const { data: employee, isLoading, error } = trpc.employees.getById.useQuery(
    { id: id || '' },
    { enabled: !!id }
  );

  if (isLoading) {
    return (
      <>
        <Stack.Screen 
          options={{
            title: 'Employee Profile',
            headerStyle: { backgroundColor: Colors.light.primary },
            headerTintColor: Colors.light.background,
            headerTitleStyle: { fontWeight: 'bold' as const },
            headerShown: true,
          }} 
        />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.light.primary} />
          <Text style={styles.loadingText}>Loading employee profile...</Text>
        </View>
      </>
    );
  }

  if (error || !employee) {
    return (
      <>
        <Stack.Screen 
          options={{
            title: 'Employee Profile',
            headerStyle: { backgroundColor: Colors.light.primary },
            headerTintColor: Colors.light.background,
            headerTitleStyle: { fontWeight: 'bold' as const },
            headerShown: true,
          }} 
        />
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>Employee not found</Text>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <ArrowLeft size={20} color={Colors.light.background} />
            <Text style={styles.backButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </>
    );
  }

  const avatarColor = getAvatarColor(employee.name);
  const initials = getInitials(employee.name);

  return (
    <>
      <Stack.Screen 
        options={{
          title: 'Employee Profile',
          headerStyle: { backgroundColor: Colors.light.primary },
          headerTintColor: Colors.light.background,
          headerTitleStyle: { fontWeight: 'bold' as const },
          headerShown: true,
        }} 
      />
      <ScrollView style={styles.container}>
        <View style={[styles.header, { backgroundColor: avatarColor }]}>
          <View style={styles.avatarContainer}>
            <View style={[styles.avatar, { backgroundColor: 'rgba(255,255,255,0.2)' }]}>
              <Text style={styles.avatarText}>{initials}</Text>
            </View>
          </View>
          <Text style={styles.name}>{employee.name}</Text>
          <Text style={styles.designation}>{employee.designation || 'Employee'}</Text>
          <Text style={styles.circle}>{employee.circle}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Personal Information</Text>
          <View style={styles.infoCard}>
            <InfoItem
              icon={<Briefcase size={20} color={Colors.light.primary} />}
              label="Pers Number"
              value={employee.persNo || 'N/A'}
            />
            <InfoItem
              icon={<Mail size={20} color={Colors.light.primary} />}
              label="Email"
              value={employee.email || 'Not set'}
            />
            <InfoItem
              icon={<Phone size={20} color={Colors.light.primary} />}
              label="Phone"
              value={employee.phone || 'Not set'}
            />
            <InfoItem
              icon={<MapPin size={20} color={Colors.light.primary} />}
              label="Circle"
              value={employee.circle || 'N/A'}
            />
            <InfoItem
              icon={<Building2 size={20} color={Colors.light.primary} />}
              label="Role"
              value={employee.role || 'N/A'}
            />
          </View>
        </View>

        {hasOutstandingAmount(employee.outstandingFtth, employee.outstandingLc) && (
          <View style={styles.section}>
            <View style={styles.outstandingHeader}>
              <AlertTriangle size={20} color="#D32F2F" />
              <Text style={styles.outstandingTitle}>Outstanding Dues</Text>
            </View>
            
            <View style={styles.outstandingCard}>
              {safeNumber(employee.outstandingFtth) > 0 && (
                <View style={styles.outstandingItem}>
                  <View style={styles.outstandingLabelRow}>
                    <IndianRupee size={18} color="#D32F2F" />
                    <Text style={styles.outstandingLabel}>FTTH Outstanding</Text>
                  </View>
                  <Text style={styles.outstandingAmount}>
                    {formatINRCrore(employee.outstandingFtth)}
                  </Text>
                  <Text style={styles.outstandingAmountFull}>
                    {formatINRAmount(employee.outstandingFtth)}
                  </Text>
                </View>
              )}
              
              {safeNumber(employee.outstandingFtth) > 0 && safeNumber(employee.outstandingLc) > 0 && (
                <View style={styles.outstandingDivider} />
              )}
              
              {safeNumber(employee.outstandingLc) > 0 && (
                <View style={styles.outstandingItem}>
                  <View style={styles.outstandingLabelRow}>
                    <IndianRupee size={18} color="#D32F2F" />
                    <Text style={styles.outstandingLabel}>LC Outstanding</Text>
                  </View>
                  <Text style={styles.outstandingAmount}>
                    {formatINRCrore(employee.outstandingLc)}
                  </Text>
                  <Text style={styles.outstandingAmountFull}>
                    {formatINRAmount(employee.outstandingLc)}
                  </Text>
                </View>
              )}
              
              <View style={styles.outstandingTotalRow}>
                <View>
                  <Text style={styles.outstandingTotalLabel}>Total Outstanding</Text>
                  <Text style={styles.outstandingTotalAmountFull}>
                    {formatINRAmount(getTotalOutstanding(employee.outstandingFtth, employee.outstandingLc))}
                  </Text>
                </View>
                <Text style={styles.outstandingTotalAmount}>
                  {formatINRCrore(getTotalOutstanding(employee.outstandingFtth, employee.outstandingLc))}
                </Text>
              </View>
            </View>
          </View>
        )}

        <View style={styles.bottomSpacer} />
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.light.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    color: Colors.light.textSecondary,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    gap: 16,
  },
  errorText: {
    fontSize: 16,
    color: Colors.light.error,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.light.primary,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    gap: 8,
  },
  backButtonText: {
    color: Colors.light.background,
    fontWeight: '600',
  },
  header: {
    paddingTop: 30,
    paddingBottom: 24,
    alignItems: 'center',
  },
  avatarContainer: {
    marginBottom: 12,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    fontSize: 28,
    fontWeight: 'bold',
    color: Colors.light.background,
  },
  name: {
    fontSize: 22,
    fontWeight: 'bold',
    color: Colors.light.background,
    marginBottom: 4,
  },
  designation: {
    fontSize: 16,
    color: Colors.light.background,
    opacity: 0.9,
    marginBottom: 2,
  },
  circle: {
    fontSize: 14,
    color: Colors.light.background,
    opacity: 0.8,
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
  outstandingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  outstandingTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#D32F2F',
  },
  outstandingCard: {
    backgroundColor: '#FFF5F5',
    borderRadius: 16,
    padding: 20,
    borderWidth: 2,
    borderColor: '#FFCDD2',
  },
  outstandingItem: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  outstandingLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  outstandingLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#B71C1C',
  },
  outstandingAmount: {
    fontSize: 28,
    fontWeight: '800',
    color: '#D32F2F',
    letterSpacing: 0.5,
  },
  outstandingAmountFull: {
    fontSize: 12,
    color: '#757575',
    marginTop: 4,
  },
  outstandingDivider: {
    height: 1,
    backgroundColor: '#FFCDD2',
    marginVertical: 12,
  },
  outstandingTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#FFEBEE',
    borderRadius: 12,
    padding: 16,
    marginTop: 16,
    borderWidth: 1,
    borderColor: '#FFCDD2',
  },
  outstandingTotalLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: '#B71C1C',
  },
  outstandingTotalAmount: {
    fontSize: 20,
    fontWeight: '800',
    color: '#D32F2F',
  },
  outstandingTotalAmountFull: {
    fontSize: 11,
    color: '#757575',
    marginTop: 2,
  },
  bottomSpacer: {
    height: 40,
  },
});
