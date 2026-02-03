import { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, Linking, ActivityIndicator } from 'react-native';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import { ChevronLeft, User, Phone, Mail, MapPin, Building2, Target, TrendingUp, DollarSign, Award, Users, Calendar, ShieldX, ChevronRight } from 'lucide-react-native';
import { useAuth } from '@/contexts/auth';
import ColorsObj from '@/constants/colors';
import { trpc } from '@/lib/trpc';
import { canAccessAdminPanel } from '@/constants/app';

const Colors = {
  ...ColorsObj.light,
  textLight: ColorsObj.light.textSecondary,
};

export default function KamEbGoldProfileScreen() {
  const router = useRouter();
  const { persNo } = useLocalSearchParams<{ persNo: string }>();
  const { employee } = useAuth();
  const [refreshing, setRefreshing] = useState(false);

  const hasAccess = employee?.role && canAccessAdminPanel(employee.role);

  const { data: kamData, isLoading: kamLoading, error: kamError, refetch: refetchKam } = trpc.admin.getKamEbGoldByPersNo.useQuery(
    { userId: employee?.id || '', persNo: persNo || '' },
    { enabled: !!employee?.id && !!persNo && !!hasAccess }
  );

  const { data: profileData, isLoading: profileLoading, refetch: refetchProfile } = trpc.admin.getEmployeeProfileWithOlt.useQuery(
    { userId: employee?.id || '', persNo: persNo || '' },
    { enabled: !!employee?.id && !!persNo && !!hasAccess }
  );

  const isLoading = kamLoading || profileLoading;

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refetchKam(), refetchProfile()]);
    setRefreshing(false);
  }, [refetchKam, refetchProfile]);

  const handleCall = (mobile: string) => {
    Linking.openURL(`tel:${mobile}`);
  };

  const handleEmail = (email: string) => {
    Linking.openURL(`mailto:${email}`);
  };

  const formatCrore = (value: number) => {
    if (value >= 100) return `₹${value.toFixed(0)} Cr`;
    if (value >= 10) return `₹${value.toFixed(1)} Cr`;
    return `₹${value.toFixed(2)} Cr`;
  };

  const navigateToProfile = (targetPersNo: string) => {
    router.push(`/kam-eb-gold-profile?persNo=${targetPersNo}` as any);
  };

  if (!hasAccess) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <ChevronLeft size={24} color={Colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>KAM Profile</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.errorContainer}>
          <ShieldX size={48} color={Colors.textLight} />
          <Text style={styles.errorText}>Access Denied</Text>
          <Text style={styles.errorSubtext}>You don't have permission to view this profile.</Text>
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
          <Text style={styles.headerTitle}>KAM Profile</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>Loading profile...</Text>
        </View>
      </View>
    );
  }

  if (kamError || !kamData) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <ChevronLeft size={24} color={Colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>KAM Profile</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.errorContainer}>
          <User size={48} color={Colors.textLight} />
          <Text style={styles.errorText}>Profile Not Found</Text>
          <Text style={styles.errorSubtext}>No KAM EB Gold data found for this personnel.</Text>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <Text style={styles.backButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const emp = profileData?.employee;

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <ChevronLeft size={24} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>KAM Profile</Text>
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
            {kamData.ebExclusive === 'Yes' && (
              <View style={styles.ebBadgeLarge}>
                <Award size={14} color="#5D4E00" />
                <Text style={styles.ebBadgeLargeText}>EB Exclusive</Text>
              </View>
            )}
          </View>
          <Text style={styles.employeeName}>{emp?.name || 'Unknown'}</Text>
          <Text style={styles.persNo}>Pers No: {kamData.persNo}</Text>
          {emp?.designation && (
            <View style={styles.designationBadge}>
              <Text style={styles.designationText}>{emp.designation}</Text>
            </View>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Lead Performance</Text>
          <View style={styles.metricsGrid}>
            <View style={styles.metricCard}>
              <View style={[styles.metricIcon, { backgroundColor: '#E3F2FD' }]}>
                <Target size={20} color="#1565C0" />
              </View>
              <Text style={styles.metricValue}>{kamData.totalLeads}</Text>
              <Text style={styles.metricLabel}>Total Leads</Text>
            </View>
            
            <View style={styles.metricCard}>
              <View style={[styles.metricIcon, { backgroundColor: '#E8F5E9' }]}>
                <DollarSign size={20} color="#2E7D32" />
              </View>
              <Text style={styles.metricValue}>{formatCrore(kamData.totalLeadValueCrore)}</Text>
              <Text style={styles.metricLabel}>Total Value</Text>
            </View>
            
            <View style={styles.metricCard}>
              <View style={[styles.metricIcon, { backgroundColor: '#FFF3E0' }]}>
                <TrendingUp size={20} color="#EF6C00" />
              </View>
              <Text style={styles.metricValue}>{formatCrore(kamData.leadInStageIvCrore)}</Text>
              <Text style={styles.metricLabel}>Stage IV</Text>
            </View>
            
            <View style={styles.metricCard}>
              <View style={[styles.metricIcon, { backgroundColor: '#F3E5F5' }]}>
                <Award size={20} color="#7B1FA2" />
              </View>
              <Text style={styles.metricValue}>{formatCrore(kamData.leadToBillCrore)}</Text>
              <Text style={styles.metricLabel}>Lead to Bill</Text>
            </View>
          </View>
          
          <View style={styles.visitCard}>
            <View style={[styles.visitIcon, { backgroundColor: '#E0F7FA' }]}>
              <Calendar size={20} color="#00838F" />
            </View>
            <View style={styles.visitInfo}>
              <Text style={styles.visitValue}>{kamData.totalSalesVisit}</Text>
              <Text style={styles.visitLabel}>Total Sales Visits</Text>
            </View>
          </View>
        </View>

        {emp && (
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
              {emp.ssa && (
                <View style={styles.infoRow}>
                  <View style={[styles.infoIcon, { backgroundColor: '#F3E5F5' }]}>
                    <Building2 size={18} color="#7B1FA2" />
                  </View>
                  <View style={styles.infoContent}>
                    <Text style={styles.infoLabel}>SSA</Text>
                    <Text style={styles.infoValue}>{emp.ssa}</Text>
                  </View>
                </View>
              )}
            </View>
          </View>
        )}

        {profileData?.reportingManager && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Reporting Manager</Text>
            <TouchableOpacity 
              style={styles.personCard}
              onPress={() => navigateToProfile(profileData.reportingManager!.persNo)}
            >
              <View style={styles.personAvatar}>
                <User size={20} color="#fff" />
              </View>
              <View style={styles.personInfo}>
                <Text style={styles.personName}>{profileData.reportingManager.name}</Text>
                <Text style={styles.personMeta}>
                  {profileData.reportingManager.designation} {profileData.reportingManager.circle ? `• ${profileData.reportingManager.circle}` : ''}
                </Text>
                <Text style={styles.personPersNo}>Pers No: {profileData.reportingManager.persNo}</Text>
              </View>
              <ChevronRight size={20} color={Colors.textLight} />
            </TouchableOpacity>
          </View>
        )}

        {profileData?.subordinates && profileData.subordinates.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Team Members</Text>
              <View style={styles.countBadge}>
                <Text style={styles.countText}>{profileData.subordinates.length}</Text>
              </View>
            </View>
            {profileData.subordinates.slice(0, 10).map((sub) => (
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
                </View>
                <ChevronRight size={20} color={Colors.textLight} />
              </TouchableOpacity>
            ))}
            {profileData.subordinates.length > 10 && (
              <Text style={styles.moreText}>
                +{profileData.subordinates.length - 10} more team members
              </Text>
            )}
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
    alignItems: 'center',
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ebBadgeLarge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFD700',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    marginTop: 12,
    gap: 6,
  },
  ebBadgeLargeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#5D4E00',
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
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  metricCard: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  metricIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  metricValue: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
  },
  metricLabel: {
    fontSize: 12,
    color: Colors.textLight,
    marginTop: 4,
  },
  visitCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginTop: 10,
    gap: 16,
  },
  visitIcon: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
  },
  visitInfo: {
    flex: 1,
  },
  visitValue: {
    fontSize: 24,
    fontWeight: '700',
    color: Colors.text,
  },
  visitLabel: {
    fontSize: 14,
    color: Colors.textLight,
    marginTop: 2,
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
  moreText: {
    fontSize: 13,
    color: Colors.primary,
    textAlign: 'center',
    marginTop: 8,
  },
});
