import { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert, RefreshControl, Modal } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { User, Link, ChevronLeft, ChevronRight, Users, Building, MapPin, Phone, Mail, UserCheck, UserX, X, CheckCircle, Settings, LogOut } from 'lucide-react-native';
import { useAuth } from '@/contexts/auth';
import Colors from '@/constants/colors';
import { trpc } from '@/lib/trpc';
import { canCreateEvents } from '@/constants/app';

export default function ProfileScreen() {
  const router = useRouter();
  const { employee, logout } = useAuth();
  
  const [refreshing, setRefreshing] = useState(false);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [purseId, setPurseId] = useState('');
  const [linking, setLinking] = useState(false);
  
  const trpcUtils = trpc.useUtils();
  
  const { data: hierarchy, isLoading, refetch } = trpc.admin.getMyHierarchy.useQuery(
    { employeeId: employee?.id || '' },
    { enabled: !!employee?.id }
  );
  
  const linkMutation = trpc.admin.linkEmployeeProfile.useMutation({
    onSuccess: (result) => {
      Alert.alert('Success', `Your profile has been linked to Purse ID: ${result.masterData.purseId}`);
      setShowLinkModal(false);
      setPurseId('');
      refetch();
      trpcUtils.employees.getById.invalidate();
    },
    onError: (error) => {
      Alert.alert('Error', error.message);
    },
  });
  
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);
  
  const handleLinkProfile = () => {
    if (!purseId.trim()) {
      Alert.alert('Error', 'Please enter your Purse ID');
      return;
    }
    
    if (!employee?.id) return;
    
    setLinking(true);
    linkMutation.mutate({ purseId: purseId.trim(), employeeId: employee.id }, {
      onSettled: () => setLinking(false),
    });
  };
  
  const handleLogout = () => {
    Alert.alert(
      'Logout',
      'Are you sure you want to logout?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Logout',
          style: 'destructive',
          onPress: () => {
            logout();
            router.replace('/login');
          },
        },
      ]
    );
  };
  
  const isAdmin = canCreateEvents(employee?.role || 'SALES_STAFF');

  return (
    <>
      <Stack.Screen 
        options={{ 
          title: 'My Profile',
          headerStyle: { backgroundColor: Colors.light.primary },
          headerTintColor: Colors.light.background,
          headerLeft: () => (
            <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn}>
              <ChevronLeft size={24} color={Colors.light.background} />
            </TouchableOpacity>
          ),
        }} 
      />
      <ScrollView 
        style={styles.container}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.profileSection}>
          <View style={styles.avatarCircle}>
            <User size={40} color={Colors.light.primary} />
          </View>
          <Text style={styles.userName}>{employee?.name}</Text>
          <Text style={styles.userRole}>{employee?.designation || employee?.role}</Text>
          
          <View style={styles.profileDetails}>
            <View style={styles.detailRow}>
              <Mail size={16} color={Colors.light.textSecondary} />
              <Text style={styles.detailText}>{employee?.email}</Text>
            </View>
            <View style={styles.detailRow}>
              <Phone size={16} color={Colors.light.textSecondary} />
              <Text style={styles.detailText}>{employee?.phone}</Text>
            </View>
            <View style={styles.detailRow}>
              <Building size={16} color={Colors.light.textSecondary} />
              <Text style={styles.detailText}>{employee?.circle?.replace(/_/g, ' ')}</Text>
            </View>
            <View style={styles.detailRow}>
              <MapPin size={16} color={Colors.light.textSecondary} />
              <Text style={styles.detailText}>{(employee as any)?.zone || 'N/A'}</Text>
            </View>
          </View>
        </View>

        <View style={styles.linkSection}>
          <View style={styles.linkHeader}>
            <View>
              <Text style={styles.sectionTitle}>Employee ID Linking</Text>
              <Text style={styles.sectionSubtitle}>Link your profile to official records</Text>
            </View>
            {hierarchy?.isLinked ? (
              <View style={styles.linkedBadge}>
                <CheckCircle size={14} color={Colors.light.success} />
                <Text style={styles.linkedBadgeText}>Linked</Text>
              </View>
            ) : (
              <View style={styles.unlinkedBadge}>
                <UserX size={14} color={Colors.light.warning} />
                <Text style={styles.unlinkedBadgeText}>Not Linked</Text>
              </View>
            )}
          </View>
          
          {hierarchy?.isLinked ? (
            <View style={styles.linkedInfo}>
              <Text style={styles.linkedLabel}>Purse ID</Text>
              <Text style={styles.linkedValue}>{hierarchy.masterData?.purseId}</Text>
              {hierarchy.masterData?.designation && (
                <>
                  <Text style={styles.linkedLabel}>Official Designation</Text>
                  <Text style={styles.linkedValue}>{hierarchy.masterData.designation}</Text>
                </>
              )}
            </View>
          ) : (
            <TouchableOpacity 
              style={styles.linkButton}
              onPress={() => setShowLinkModal(true)}
            >
              <Link size={20} color={Colors.light.background} />
              <Text style={styles.linkButtonText}>Link My Purse ID</Text>
            </TouchableOpacity>
          )}
        </View>

        {hierarchy?.isLinked && (
          <>
            {hierarchy.manager && (
              <View style={styles.hierarchySection}>
                <Text style={styles.sectionTitle}>My Reporting Manager</Text>
                <View style={styles.personCard}>
                  <View style={styles.personAvatar}>
                    <User size={24} color={Colors.light.primary} />
                  </View>
                  <View style={styles.personInfo}>
                    <Text style={styles.personName}>{hierarchy.manager.name}</Text>
                    <Text style={styles.personDetail}>Purse ID: {hierarchy.manager.purseId}</Text>
                    {hierarchy.manager.designation && (
                      <Text style={styles.personDetail}>{hierarchy.manager.designation}</Text>
                    )}
                    {hierarchy.manager.employee ? (
                      <View style={styles.registeredBadge}>
                        <UserCheck size={12} color={Colors.light.success} />
                        <Text style={styles.registeredText}>Registered</Text>
                      </View>
                    ) : (
                      <View style={styles.notRegisteredBadge}>
                        <UserX size={12} color={Colors.light.textSecondary} />
                        <Text style={styles.notRegisteredText}>Not Registered</Text>
                      </View>
                    )}
                  </View>
                </View>
              </View>
            )}

            <View style={styles.hierarchySection}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>My Team ({hierarchy.subordinates?.length || 0})</Text>
              </View>
              
              {hierarchy.subordinates?.length === 0 ? (
                <View style={styles.emptyTeam}>
                  <Users size={32} color={Colors.light.textSecondary} />
                  <Text style={styles.emptyText}>No team members report to you</Text>
                </View>
              ) : (
                hierarchy.subordinates?.map((sub: any) => (
                  <View key={sub.id} style={styles.personCard}>
                    <View style={styles.personAvatar}>
                      <User size={24} color={Colors.light.primary} />
                    </View>
                    <View style={styles.personInfo}>
                      <Text style={styles.personName}>{sub.name}</Text>
                      <Text style={styles.personDetail}>Purse ID: {sub.purseId}</Text>
                      {sub.designation && (
                        <Text style={styles.personDetail}>{sub.designation}</Text>
                      )}
                      {sub.employee ? (
                        <View style={styles.registeredBadge}>
                          <UserCheck size={12} color={Colors.light.success} />
                          <Text style={styles.registeredText}>Registered</Text>
                        </View>
                      ) : (
                        <View style={styles.notRegisteredBadge}>
                          <UserX size={12} color={Colors.light.textSecondary} />
                          <Text style={styles.notRegisteredText}>Not Registered</Text>
                        </View>
                      )}
                    </View>
                  </View>
                ))
              )}
            </View>
          </>
        )}

        <View style={styles.actionsSection}>
          {isAdmin && (
            <TouchableOpacity 
              style={styles.actionRow}
              onPress={() => router.push('/admin' as any)}
            >
              <View style={styles.actionLeft}>
                <Settings size={20} color={Colors.light.primary} />
                <Text style={styles.actionText}>Admin Panel</Text>
              </View>
              <ChevronRight size={20} color={Colors.light.textSecondary} />
            </TouchableOpacity>
          )}
          
          <TouchableOpacity 
            style={[styles.actionRow, styles.logoutRow]}
            onPress={handleLogout}
          >
            <View style={styles.actionLeft}>
              <LogOut size={20} color={Colors.light.error} />
              <Text style={[styles.actionText, styles.logoutText]}>Logout</Text>
            </View>
            <ChevronRight size={20} color={Colors.light.error} />
          </TouchableOpacity>
        </View>

        <View style={styles.bottomSpacer} />
      </ScrollView>

      <Modal visible={showLinkModal} animationType="slide" transparent={true} onRequestClose={() => setShowLinkModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Link Your Purse ID</Text>
              <TouchableOpacity onPress={() => setShowLinkModal(false)}>
                <X size={24} color={Colors.light.text} />
              </TouchableOpacity>
            </View>
            
            <View style={styles.modalBody}>
              <Text style={styles.inputLabel}>Enter your Purse ID</Text>
              <Text style={styles.inputHint}>This is your official BSNL employee ID from HR records</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g., 101"
                value={purseId}
                onChangeText={setPurseId}
                autoCapitalize="characters"
              />
              
              <Text style={styles.noteText}>
                Linking your Purse ID will connect your profile to the official employee hierarchy, 
                allowing you to see your reporting manager and team members.
              </Text>
            </View>
            
            <View style={styles.modalFooter}>
              <TouchableOpacity style={styles.cancelButton} onPress={() => { setShowLinkModal(false); setPurseId(''); }}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.submitButton, linking && styles.buttonDisabled]} 
                onPress={handleLinkProfile}
                disabled={linking}
              >
                <Text style={styles.submitButtonText}>{linking ? 'Linking...' : 'Link Profile'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.light.background,
  },
  headerBtn: {
    padding: 8,
  },
  profileSection: {
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#fff',
    marginBottom: 8,
  },
  avatarCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#E3F2FD',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  userName: {
    fontSize: 22,
    fontWeight: 'bold',
    color: Colors.light.text,
  },
  userRole: {
    fontSize: 14,
    color: Colors.light.primary,
    marginTop: 4,
  },
  profileDetails: {
    marginTop: 20,
    width: '100%',
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
    gap: 12,
  },
  detailText: {
    fontSize: 14,
    color: Colors.light.text,
    flex: 1,
  },
  linkSection: {
    padding: 16,
    backgroundColor: '#fff',
    marginBottom: 8,
  },
  linkHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.light.text,
  },
  sectionSubtitle: {
    fontSize: 12,
    color: Colors.light.textSecondary,
    marginTop: 2,
  },
  linkedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E8F5E9',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    gap: 4,
  },
  linkedBadgeText: {
    fontSize: 12,
    fontWeight: '500',
    color: Colors.light.success,
  },
  unlinkedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF3E0',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    gap: 4,
  },
  unlinkedBadgeText: {
    fontSize: 12,
    fontWeight: '500',
    color: Colors.light.warning,
  },
  linkedInfo: {
    backgroundColor: '#F5F5F5',
    padding: 16,
    borderRadius: 10,
  },
  linkedLabel: {
    fontSize: 12,
    color: Colors.light.textSecondary,
    marginBottom: 4,
  },
  linkedValue: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.light.text,
    marginBottom: 12,
  },
  linkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.light.primary,
    padding: 14,
    borderRadius: 10,
    gap: 8,
  },
  linkButtonText: {
    color: Colors.light.background,
    fontWeight: '600',
    fontSize: 16,
  },
  hierarchySection: {
    padding: 16,
    backgroundColor: '#fff',
    marginBottom: 8,
  },
  sectionHeader: {
    marginBottom: 12,
  },
  personCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#FAFAFA',
    borderRadius: 10,
    marginBottom: 8,
  },
  personAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#E3F2FD',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  personInfo: {
    flex: 1,
  },
  personName: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.light.text,
  },
  personDetail: {
    fontSize: 12,
    color: Colors.light.textSecondary,
    marginTop: 2,
  },
  registeredBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    gap: 4,
  },
  registeredText: {
    fontSize: 11,
    color: Colors.light.success,
  },
  notRegisteredBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    gap: 4,
  },
  notRegisteredText: {
    fontSize: 11,
    color: Colors.light.textSecondary,
  },
  emptyTeam: {
    alignItems: 'center',
    padding: 24,
  },
  emptyText: {
    fontSize: 14,
    color: Colors.light.textSecondary,
    marginTop: 8,
  },
  actionsSection: {
    padding: 16,
    backgroundColor: '#fff',
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  actionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  actionText: {
    fontSize: 16,
    color: Colors.light.text,
  },
  logoutRow: {
    borderBottomWidth: 0,
  },
  logoutText: {
    color: Colors.light.error,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: Colors.light.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.light.text,
  },
  modalBody: {
    padding: 16,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.light.text,
    marginBottom: 4,
  },
  inputHint: {
    fontSize: 12,
    color: Colors.light.textSecondary,
    marginBottom: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 10,
    padding: 14,
    fontSize: 16,
    backgroundColor: '#FAFAFA',
  },
  noteText: {
    fontSize: 12,
    color: Colors.light.textSecondary,
    marginTop: 16,
    lineHeight: 18,
  },
  modalFooter: {
    flexDirection: 'row',
    padding: 16,
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
  },
  cancelButton: {
    flex: 1,
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.light.border,
    alignItems: 'center',
  },
  cancelButtonText: {
    color: Colors.light.textSecondary,
    fontWeight: '600',
  },
  submitButton: {
    flex: 1,
    padding: 14,
    borderRadius: 10,
    backgroundColor: Colors.light.primary,
    alignItems: 'center',
  },
  submitButtonText: {
    color: Colors.light.background,
    fontWeight: '600',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  bottomSpacer: {
    height: 40,
  },
});
