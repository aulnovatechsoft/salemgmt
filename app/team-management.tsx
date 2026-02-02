import { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator, RefreshControl, TextInput, Modal } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Users, Search, Key, ChevronRight, X, AlertTriangle, CheckCircle, User } from 'lucide-react-native';
import { useAuth } from '@/contexts/auth';
import Colors from '@/constants/colors';
import { trpc } from '@/lib/trpc';

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

const getRoleBadgeColor = (role: string) => {
  switch (role) {
    case 'GM': return '#D32F2F';
    case 'CGM': return '#7B1FA2';
    case 'DGM': return '#1976D2';
    case 'AGM': return '#388E3C';
    case 'SD_JTO': return '#F57C00';
    default: return '#455A64';
  }
};

interface Subordinate {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: string;
  circle: string;
  zone: string | null;
  persNo: string | null;
  designation: string | null;
  isActive: boolean | null;
  needsPasswordChange: boolean | null;
}

const ROLE_OPTIONS = ['All', 'CGM', 'DGM', 'AGM', 'SD_JTO', 'SALES_STAFF'];

export default function TeamManagementScreen() {
  const router = useRouter();
  const { employee } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRole, setSelectedRole] = useState('All');
  const [refreshing, setRefreshing] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<Subordinate | null>(null);
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetting, setResetting] = useState(false);

  const { 
    data: subordinates, 
    isLoading, 
    refetch 
  } = trpc.employees.getSubordinates.useQuery(
    { managerId: employee?.id || '' },
    { enabled: !!employee?.id }
  );

  const resetPasswordMutation = trpc.employees.resetPasswordByManager.useMutation({
    onSuccess: (result: { message: string; passwordHint: string; remainingResets?: number }) => {
      setResetting(false);
      setShowResetModal(false);
      setSelectedEmployee(null);
      const remainingMsg = result.remainingResets !== undefined 
        ? `\n\nResets remaining this hour: ${result.remainingResets}` 
        : '';
      Alert.alert(
        'Password Reset Successful',
        `${result.message}\n\n${result.passwordHint}${remainingMsg}`,
        [{ text: 'OK' }]
      );
      refetch();
    },
    onError: (error) => {
      setResetting(false);
      Alert.alert('Error', error.message);
    },
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const handleResetPassword = (emp: Subordinate) => {
    setSelectedEmployee(emp);
    setShowResetModal(true);
  };

  const confirmResetPassword = () => {
    if (!employee?.id || !selectedEmployee?.id) return;
    
    setResetting(true);
    resetPasswordMutation.mutate({
      managerId: employee.id,
      employeeId: selectedEmployee.id,
    });
  };

  const availableRoles = ROLE_OPTIONS.filter(role => {
    if (role === 'All') return true;
    const roleHierarchy: Record<string, number> = { 'GM': 6, 'CGM': 5, 'DGM': 4, 'AGM': 3, 'SD_JTO': 2, 'SALES_STAFF': 1 };
    const managerLevel = roleHierarchy[employee?.role || ''] || 0;
    const filterLevel = roleHierarchy[role] || 0;
    return filterLevel < managerLevel;
  });

  const filteredSubordinates = (subordinates || []).filter((sub: Subordinate) => {
    if (selectedRole !== 'All' && sub.role !== selectedRole) return false;
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    return (
      sub.name.toLowerCase().includes(query) ||
      sub.persNo?.toLowerCase().includes(query) ||
      sub.email?.toLowerCase().includes(query) ||
      sub.designation?.toLowerCase().includes(query)
    );
  });

  if (!employee) {
    return (
      <View style={styles.container}>
        <Text>Please login to access this page</Text>
      </View>
    );
  }

  return (
    <>
      <Stack.Screen 
        options={{ 
          title: 'Team Management',
          headerStyle: { backgroundColor: Colors.light.primary },
          headerTintColor: Colors.light.background,
          headerTitleStyle: { fontWeight: 'bold' },
        }} 
      />
      
      <View style={styles.container}>
        <View style={styles.header}>
          <View style={styles.headerIcon}>
            <Users size={24} color={Colors.light.primary} />
          </View>
          <View style={styles.headerContent}>
            <Text style={styles.headerTitle}>Manage Your Team</Text>
            <Text style={styles.headerSubtitle}>
              Reset passwords for team members who forgot their credentials
            </Text>
          </View>
        </View>

        <View style={styles.searchContainer}>
          <Search size={20} color={Colors.light.textSecondary} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search by name, Pers No, or email..."
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholderTextColor={Colors.light.textSecondary}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <X size={18} color={Colors.light.textSecondary} />
            </TouchableOpacity>
          )}
        </View>

        <ScrollView 
          horizontal 
          showsHorizontalScrollIndicator={false} 
          style={styles.roleFilterContainer}
          contentContainerStyle={styles.roleFilterContent}
        >
          {availableRoles.map((role) => (
            <TouchableOpacity
              key={role}
              style={[
                styles.roleFilterChip,
                selectedRole === role && styles.roleFilterChipActive,
              ]}
              onPress={() => setSelectedRole(role)}
            >
              <Text style={[
                styles.roleFilterText,
                selectedRole === role && styles.roleFilterTextActive,
              ]}>
                {role === 'All' ? 'All Roles' : role.replace('_', ' ')}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{subordinates?.length || 0}</Text>
            <Text style={styles.statLabel}>Total Team</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={[styles.statValue, { color: Colors.light.warning }]}>
              {subordinates?.filter((s: Subordinate) => s.needsPasswordChange).length || 0}
            </Text>
            <Text style={styles.statLabel}>Pending Password Change</Text>
          </View>
        </View>

        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={Colors.light.primary} />
            <Text style={styles.loadingText}>Loading team members...</Text>
          </View>
        ) : (
          <ScrollView 
            style={styles.list}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
            }
          >
            {filteredSubordinates.length === 0 ? (
              <View style={styles.emptyContainer}>
                <Users size={48} color={Colors.light.textSecondary} />
                <Text style={styles.emptyTitle}>
                  {searchQuery ? 'No Results Found' : 'No Team Members'}
                </Text>
                <Text style={styles.emptyText}>
                  {searchQuery 
                    ? 'Try adjusting your search query'
                    : 'You don\'t have any subordinates to manage'}
                </Text>
              </View>
            ) : (
              filteredSubordinates.map((sub: Subordinate) => (
                <View key={sub.id} style={styles.employeeCard}>
                  <View style={styles.employeeInfo}>
                    <View style={[styles.avatar, { backgroundColor: getAvatarColor(sub.name) }]}>
                      <Text style={styles.avatarText}>{getInitials(sub.name)}</Text>
                    </View>
                    <View style={styles.employeeDetails}>
                      <View style={styles.nameRow}>
                        <Text style={styles.employeeName} numberOfLines={1}>{sub.name}</Text>
                        {sub.needsPasswordChange && (
                          <View style={styles.pendingBadge}>
                            <Text style={styles.pendingBadgeText}>Pending</Text>
                          </View>
                        )}
                      </View>
                      <Text style={styles.employeePersNo}>{sub.persNo || 'No Pers No'}</Text>
                      <View style={styles.roleRow}>
                        <View style={[styles.roleBadge, { backgroundColor: getRoleBadgeColor(sub.role) }]}>
                          <Text style={styles.roleBadgeText}>{sub.role}</Text>
                        </View>
                        <Text style={styles.designation} numberOfLines={1}>
                          {sub.designation || sub.role}
                        </Text>
                      </View>
                    </View>
                  </View>
                  
                  <TouchableOpacity 
                    style={styles.resetButton}
                    onPress={() => handleResetPassword(sub)}
                  >
                    <Key size={16} color={Colors.light.primary} />
                    <Text style={styles.resetButtonText}>Reset Password</Text>
                  </TouchableOpacity>
                </View>
              ))
            )}
            <View style={{ height: 40 }} />
          </ScrollView>
        )}
      </View>

      <Modal
        visible={showResetModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowResetModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalIconContainer}>
              <AlertTriangle size={40} color={Colors.light.warning} />
            </View>
            
            <Text style={styles.modalTitle}>Reset Password?</Text>
            
            <Text style={styles.modalText}>
              You are about to reset the password for:
            </Text>
            
            {selectedEmployee && (
              <View style={styles.selectedEmployeeCard}>
                <View style={[styles.selectedAvatar, { backgroundColor: getAvatarColor(selectedEmployee.name) }]}>
                  <Text style={styles.selectedAvatarText}>{getInitials(selectedEmployee.name)}</Text>
                </View>
                <View>
                  <Text style={styles.selectedName}>{selectedEmployee.name}</Text>
                  <Text style={styles.selectedPersNo}>{selectedEmployee.persNo}</Text>
                </View>
              </View>
            )}
            
            <View style={styles.infoBox}>
              <CheckCircle size={16} color={Colors.light.success} />
              <Text style={styles.infoText}>
                Password will be reset to: BSNL@ + last 4 digits of Pers Number
              </Text>
            </View>
            
            <View style={styles.infoBox}>
              <User size={16} color={Colors.light.info} />
              <Text style={styles.infoText}>
                Employee will be required to change password on next login
              </Text>
            </View>
            
            <View style={styles.modalButtons}>
              <TouchableOpacity 
                style={styles.cancelButton}
                onPress={() => {
                  setShowResetModal(false);
                  setSelectedEmployee(null);
                }}
                disabled={resetting}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              
              <TouchableOpacity 
                style={[styles.confirmButton, resetting && styles.buttonDisabled]}
                onPress={confirmResetPassword}
                disabled={resetting}
              >
                {resetting ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Key size={16} color="#fff" />
                    <Text style={styles.confirmButtonText}>Reset Password</Text>
                  </>
                )}
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
    backgroundColor: Colors.light.backgroundSecondary,
  },
  header: {
    flexDirection: 'row',
    backgroundColor: Colors.light.background,
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
    gap: 12,
  },
  headerIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.light.backgroundSecondary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerContent: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: Colors.light.text,
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 13,
    color: Colors.light.textSecondary,
    lineHeight: 18,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.light.background,
    marginHorizontal: 16,
    marginVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.light.border,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 15,
    color: Colors.light.text,
  },
  roleFilterContainer: {
    marginBottom: 8,
  },
  roleFilterContent: {
    paddingHorizontal: 16,
    gap: 8,
  },
  roleFilterChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Colors.light.background,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  roleFilterChipActive: {
    backgroundColor: Colors.light.primary,
    borderColor: Colors.light.primary,
  },
  roleFilterText: {
    fontSize: 13,
    fontWeight: '500',
    color: Colors.light.textSecondary,
  },
  roleFilterTextActive: {
    color: '#fff',
  },
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 12,
    marginBottom: 12,
  },
  statCard: {
    flex: 1,
    backgroundColor: Colors.light.background,
    padding: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: Colors.light.primary,
  },
  statLabel: {
    fontSize: 12,
    color: Colors.light.textSecondary,
    marginTop: 4,
    textAlign: 'center',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    color: Colors.light.textSecondary,
    fontSize: 14,
  },
  list: {
    flex: 1,
    paddingHorizontal: 16,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.light.text,
    marginTop: 16,
  },
  emptyText: {
    fontSize: 14,
    color: Colors.light.textSecondary,
    marginTop: 8,
    textAlign: 'center',
  },
  employeeCard: {
    backgroundColor: Colors.light.background,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  employeeInfo: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
  },
  employeeDetails: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  employeeName: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.light.text,
    flex: 1,
  },
  pendingBadge: {
    backgroundColor: '#FFF3E0',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  pendingBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: Colors.light.warning,
  },
  employeePersNo: {
    fontSize: 13,
    color: Colors.light.textSecondary,
    marginTop: 2,
  },
  roleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    gap: 8,
  },
  roleBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  roleBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#fff',
  },
  designation: {
    fontSize: 12,
    color: Colors.light.textSecondary,
    flex: 1,
  },
  resetButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E3F2FD',
    paddingVertical: 10,
    borderRadius: 8,
    gap: 6,
  },
  resetButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.light.primary,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalContent: {
    backgroundColor: Colors.light.background,
    borderRadius: 20,
    padding: 24,
    width: '100%',
    maxWidth: 360,
  },
  modalIconContainer: {
    alignSelf: 'center',
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#FFF8E1',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: Colors.light.text,
    textAlign: 'center',
    marginBottom: 12,
  },
  modalText: {
    fontSize: 14,
    color: Colors.light.textSecondary,
    textAlign: 'center',
    marginBottom: 16,
  },
  selectedEmployeeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.light.backgroundSecondary,
    padding: 12,
    borderRadius: 12,
    marginBottom: 16,
    gap: 12,
  },
  selectedAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  selectedAvatarText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#fff',
  },
  selectedName: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.light.text,
  },
  selectedPersNo: {
    fontSize: 13,
    color: Colors.light.textSecondary,
    marginTop: 2,
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: Colors.light.backgroundSecondary,
    padding: 12,
    borderRadius: 8,
    marginBottom: 10,
    gap: 10,
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    color: Colors.light.text,
    lineHeight: 18,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.light.border,
    alignItems: 'center',
  },
  cancelButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.light.textSecondary,
  },
  confirmButton: {
    flex: 1,
    flexDirection: 'row',
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: Colors.light.primary,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  confirmButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
  buttonDisabled: {
    opacity: 0.7,
  },
});
