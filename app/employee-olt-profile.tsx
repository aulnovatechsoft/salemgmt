import { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, Linking, ActivityIndicator } from 'react-native';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import { ChevronLeft, User, Phone, Mail, MapPin, Building2, Wifi, Users, ChevronRight, Briefcase, ShieldX } from 'lucide-react-native';
import { useAuth } from '@/contexts/auth';
import ColorsObj from '@/constants/colors';
import { trpc } from '@/lib/trpc';
import { canAccessAdminPanel } from '@/constants/app';

const Colors = {
  ...ColorsObj.light,
  textLight: ColorsObj.light.textSecondary,
};

export default function EmployeeOltProfileScreen() {
  const router = useRouter();
  const { persNo } = useLocalSearchParams<{ persNo: string }>();
  const { employee } = useAuth();
  const [refreshing, setRefreshing] = useState(false);

  const hasAccess = employee?.role && canAccessAdminPanel(employee.role);

  const { data, isLoading, error, refetch } = trpc.admin.getEmployeeProfileWithOlt.useQuery(
    { userId: employee?.id || '', persNo: persNo || '' },
    { enabled: !!employee?.id && !!persNo && !!hasAccess }
  );

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const handleCall = (mobile: string) => {
    Linking.openURL(`tel:${mobile}`);
  };

  const handleEmail = (email: string) => {
    Linking.openURL(`mailto:${email}`);
  };

  const navigateToProfile = (targetPersNo: string) => {
    router.push(`/employee-olt-profile?persNo=${targetPersNo}` as any);
  };

  if (!hasAccess) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <ChevronLeft size={24} color={Colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Employee Profile</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.errorContainer}>
          <ShieldX size={48} color={Colors.textLight} />
          <Text style={styles.errorText}>Access Denied</Text>
          <Text style={styles.errorSubtext}>You don't have permission to view employee profiles.</Text>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <Text style={styles.backButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (isLoading) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <ChevronLeft size={24} color={Colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Employee Profile</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>Loading profile...</Text>
        </View>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <ChevronLeft size={24} color={Colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Employee Profile</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.errorContainer}>
          <ShieldX size={48} color="#EF5350" />
          <Text style={styles.errorText}>Error Loading Profile</Text>
          <Text style={styles.errorSubtext}>{error.message}</Text>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <Text style={styles.backButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (!data) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <ChevronLeft size={24} color={Colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Employee Profile</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.errorContainer}>
          <User size={48} color={Colors.textLight} />
          <Text style={styles.errorText}>Employee not found</Text>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <Text style={styles.backButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const { employee: emp, oltIps, reportingManager, subordinates } = data;

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <ChevronLeft size={24} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Employee Profile</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      >
        <View style={styles.profileCard}>
          <View style={styles.avatarContainer}>
            <View style={styles.avatar}>
              <User size={40} color="#fff" />
            </View>
          </View>
          <Text style={styles.employeeName}>{emp.name}</Text>
          <Text style={styles.persNo}>Pers No: {emp.persNo}</Text>
          {emp.designation && (
            <View style={styles.designationBadge}>
              <Text style={styles.designationText}>{emp.designation}</Text>
            </View>
          )}
          {emp.role && (
            <View style={[styles.roleBadge, { backgroundColor: '#E8F5E9' }]}>
              <Text style={[styles.roleText, { color: '#2E7D32' }]}>{emp.role}</Text>
            </View>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Contact Information</Text>
          <View style={styles.infoCard}>
            {emp.mobile && (
              <TouchableOpacity style={styles.infoRow} onPress={() => handleCall(emp.mobile!)}>
                <View style={[styles.infoIcon, { backgroundColor: '#E3F2FD' }]}>
                  <Phone size={18} color="#1565C0" />
                </View>
                <View style={styles.infoContent}>
                  <Text style={styles.infoLabel}>Mobile</Text>
                  <Text style={styles.infoValue}>{emp.mobile}</Text>
                </View>
                <ChevronRight size={18} color={Colors.textLight} />
              </TouchableOpacity>
            )}
            {emp.email && (
              <TouchableOpacity style={styles.infoRow} onPress={() => handleEmail(emp.email!)}>
                <View style={[styles.infoIcon, { backgroundColor: '#FFF3E0' }]}>
                  <Mail size={18} color="#EF6C00" />
                </View>
                <View style={styles.infoContent}>
                  <Text style={styles.infoLabel}>Email</Text>
                  <Text style={styles.infoValue}>{emp.email}</Text>
                </View>
                <ChevronRight size={18} color={Colors.textLight} />
              </TouchableOpacity>
            )}
            {emp.circle && (
              <View style={styles.infoRow}>
                <View style={[styles.infoIcon, { backgroundColor: '#E8F5E9' }]}>
                  <MapPin size={18} color="#2E7D32" />
                </View>
                <View style={styles.infoContent}>
                  <Text style={styles.infoLabel}>Circle</Text>
                  <Text style={styles.infoValue}>{emp.circle}</Text>
                </View>
              </View>
            )}
            {emp.zone && (
              <View style={styles.infoRow}>
                <View style={[styles.infoIcon, { backgroundColor: '#F3E5F5' }]}>
                  <Building2 size={18} color="#7B1FA2" />
                </View>
                <View style={styles.infoContent}>
                  <Text style={styles.infoLabel}>Zone/SSA</Text>
                  <Text style={styles.infoValue}>{emp.zone}</Text>
                </View>
              </View>
            )}
            {emp.division && (
              <View style={styles.infoRow}>
                <View style={[styles.infoIcon, { backgroundColor: '#E0F2F1' }]}>
                  <Briefcase size={18} color="#00796B" />
                </View>
                <View style={styles.infoContent}>
                  <Text style={styles.infoLabel}>Division</Text>
                  <Text style={styles.infoValue}>{emp.division}</Text>
                </View>
              </View>
            )}
            {emp.officeName && (
              <View style={styles.infoRow}>
                <View style={[styles.infoIcon, { backgroundColor: '#FFECB3' }]}>
                  <Building2 size={18} color="#FF8F00" />
                </View>
                <View style={styles.infoContent}>
                  <Text style={styles.infoLabel}>Office</Text>
                  <Text style={styles.infoValue}>{emp.officeName}</Text>
                </View>
              </View>
            )}
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>OLT IP Assignments</Text>
            <View style={styles.countBadge}>
              <Text style={styles.countText}>{oltIps.length}</Text>
            </View>
          </View>
          {oltIps.length === 0 ? (
            <View style={styles.emptyCard}>
              <Wifi size={32} color={Colors.textLight} />
              <Text style={styles.emptyText}>No OLT IPs assigned</Text>
            </View>
          ) : (
            <View style={styles.oltCard}>
              {oltIps.map((olt, index) => (
                <View key={olt.id} style={[styles.oltRow, index < oltIps.length - 1 && styles.oltRowBorder]}>
                  <View style={[styles.oltIcon, { backgroundColor: '#E3F2FD' }]}>
                    <Wifi size={16} color="#1565C0" />
                  </View>
                  <Text style={styles.oltIp}>{olt.oltIp}</Text>
                </View>
              ))}
            </View>
          )}
        </View>

        {reportingManager && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Reporting Manager</Text>
            <TouchableOpacity 
              style={styles.personCard}
              onPress={() => navigateToProfile(reportingManager.persNo)}
            >
              <View style={styles.personAvatar}>
                <User size={20} color="#fff" />
              </View>
              <View style={styles.personInfo}>
                <Text style={styles.personName}>{reportingManager.name}</Text>
                <Text style={styles.personMeta}>
                  {reportingManager.designation} {reportingManager.circle ? `• ${reportingManager.circle}` : ''}
                </Text>
                <Text style={styles.personPersNo}>Pers No: {reportingManager.persNo}</Text>
              </View>
              <ChevronRight size={20} color={Colors.textLight} />
            </TouchableOpacity>
          </View>
        )}

        {subordinates.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Subordinates</Text>
              <View style={styles.countBadge}>
                <Text style={styles.countText}>{subordinates.length}</Text>
              </View>
            </View>
            {subordinates.map((sub) => (
              <TouchableOpacity 
                key={sub.persNo}
                style={styles.personCard}
                onPress={() => navigateToProfile(sub.persNo)}
              >
                <View style={[styles.personAvatar, { backgroundColor: '#4CAF50' }]}>
                  <User size={20} color="#fff" />
                </View>
                <View style={styles.personInfo}>
                  <Text style={styles.personName}>{sub.name}</Text>
                  <Text style={styles.personMeta}>
                    {sub.designation} {sub.circle ? `• ${sub.circle}` : ''}
                  </Text>
                  <Text style={styles.personPersNo}>Pers No: {sub.persNo}</Text>
                </View>
                <ChevronRight size={20} color={Colors.textLight} />
              </TouchableOpacity>
            ))}
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 60,
    paddingBottom: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backBtn: {
    padding: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.text,
  },
  content: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 12,
    color: Colors.textLight,
  },
  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  errorText: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.text,
    marginTop: 16,
  },
  errorSubtext: {
    fontSize: 14,
    color: Colors.textLight,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 24,
  },
  backButton: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  backButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  profileCard: {
    backgroundColor: Colors.primary,
    padding: 24,
    alignItems: 'center',
  },
  avatarContainer: {
    marginBottom: 16,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  employeeName: {
    fontSize: 22,
    fontWeight: '700',
    color: '#fff',
    textAlign: 'center',
  },
  persNo: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.8)',
    marginTop: 4,
  },
  designationBadge: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
    marginTop: 12,
  },
  designationText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
  },
  roleBadge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    marginTop: 8,
  },
  roleText: {
    fontSize: 12,
    fontWeight: '600',
  },
  section: {
    padding: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 12,
  },
  countBadge: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 10,
    paddingVertical: 2,
    borderRadius: 12,
    marginBottom: 12,
  },
  countText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#fff',
  },
  infoCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    overflow: 'hidden',
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  infoIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoContent: {
    flex: 1,
    marginLeft: 12,
  },
  infoLabel: {
    fontSize: 12,
    color: Colors.textLight,
  },
  infoValue: {
    fontSize: 15,
    color: Colors.text,
    fontWeight: '500',
    marginTop: 2,
  },
  emptyCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 32,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: Colors.textLight,
    marginTop: 12,
  },
  oltCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    overflow: 'hidden',
  },
  oltRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    gap: 12,
  },
  oltRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  oltIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  oltIp: {
    fontSize: 15,
    fontWeight: '500',
    color: Colors.text,
    fontFamily: 'monospace',
  },
  personCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 8,
  },
  personAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  personInfo: {
    flex: 1,
    marginLeft: 12,
  },
  personName: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.text,
  },
  personMeta: {
    fontSize: 13,
    color: Colors.textLight,
    marginTop: 2,
  },
  personPersNo: {
    fontSize: 12,
    color: Colors.primary,
    marginTop: 2,
  },
});
