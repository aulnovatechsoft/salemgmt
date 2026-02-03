import { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator, RefreshControl, Modal, TextInput } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { User, Mail, Phone, Briefcase, MapPin, LogOut, FileText, Settings, ChevronRight, Users, Building2, Edit2, X, Lock, AlertTriangle, IndianRupee } from 'lucide-react-native';
import { useAuth } from '@/contexts/auth';
import { useApp } from '@/contexts/app';
import Colors from '@/constants/colors';
import { trpc } from '@/lib/trpc';
import { safeNumber, formatINRAmount, formatINRCrore, hasOutstandingAmount, getTotalOutstanding } from '@/lib/currency';
import { dangerShadow } from '@/lib/styles';
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

const MiniOrgNode = ({ name, designation, isYou = false }: { name: string; designation?: string | null; isYou?: boolean }) => (
  <View style={[styles.miniNode, isYou && styles.miniNodeYou]}>
    <View style={[styles.miniAvatar, { backgroundColor: getAvatarColor(name) }]}>
      <Text style={styles.miniAvatarText}>{getInitials(name)}</Text>
    </View>
    <View style={styles.miniNodeInfo}>
      <Text style={styles.miniNodeName} numberOfLines={1}>{name}</Text>
      {designation && <Text style={styles.miniNodeDesig} numberOfLines={1}>{designation}</Text>}
    </View>
    {isYou && (
      <View style={styles.youBadge}>
        <Text style={styles.youBadgeText}>You</Text>
      </View>
    )}
  </View>
);

const TreeLine = () => (
  <View style={styles.treeLine}>
    <View style={styles.treeLineVertical} />
  </View>
);

export default function ProfileScreen() {
  const router = useRouter();
  const { employee, logout, updateEmployee } = useAuth();
  const { clearAllData } = useApp();
  const [refreshing, setRefreshing] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editForm, setEditForm] = useState({
    email: '',
    phone: '',
  });
  const [saving, setSaving] = useState(false);

  const { 
    data: hierarchy, 
    isLoading: hierarchyLoading, 
    refetch: refetchHierarchy,
  } = trpc.admin.getMyHierarchy.useQuery(
    { employeeId: employee?.id || '' },
    { enabled: !!employee?.id, retry: 2 }
  );

  const updateMutation = trpc.employees.update.useMutation({
    onSuccess: async (updatedData) => {
      Alert.alert('Success', 'Profile updated successfully');
      setShowEditModal(false);
      if (updateEmployee && updatedData) {
        await updateEmployee({
          email: updatedData.email,
          phone: updatedData.phone,
        });
      }
    },
    onError: (error) => {
      Alert.alert('Error', error.message);
    },
  });

  const handleOpenEditModal = () => {
    setEditForm({
      email: employee?.email || '',
      phone: employee?.phone || '',
    });
    setShowEditModal(true);
  };

  const handleSaveProfile = async () => {
    if (!employee?.id) return;
    
    const updateData: any = { id: employee.id };
    
    if (editForm.email.trim()) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(editForm.email.trim())) {
        Alert.alert('Error', 'Please enter a valid email address');
        return;
      }
      updateData.email = editForm.email.trim();
    }
    
    if (editForm.phone.trim()) {
      if (editForm.phone.trim().length < 10) {
        Alert.alert('Error', 'Phone number must be at least 10 digits');
        return;
      }
      updateData.phone = editForm.phone.trim();
    }
    
    setSaving(true);
    try {
      await updateMutation.mutateAsync(updateData);
    } finally {
      setSaving(false);
    }
  };

  const userPersNo = hierarchy?.masterData?.persNo;
  const isLinked = hierarchy?.isLinked;

  const { 
    data: fullHierarchy, 
    isLoading: fullHierarchyLoading, 
    refetch: refetchFullHierarchy,
  } = trpc.admin.getFullHierarchy.useQuery(
    { persNo: userPersNo || '' },
    { enabled: !!userPersNo && isLinked, retry: 2, staleTime: 30000 }
  );

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

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refetchHierarchy(), refetchFullHierarchy()]);
    setRefreshing(false);
  }, [refetchHierarchy, refetchFullHierarchy]);

  if (!employee) return null;

  const topManager = fullHierarchy?.managers?.[fullHierarchy.managers.length - 1];
  const immediateManager = fullHierarchy?.managers?.[0];
  const currentUser = fullHierarchy?.currentUser;
  const topSubordinates = fullHierarchy?.subordinates?.slice(0, 2) || [];
  const totalSubordinates = currentUser?.directReportsCount || fullHierarchy?.subordinates?.length || 0;
  const totalManagers = fullHierarchy?.managers?.length || 0;

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
      <ScrollView 
        style={styles.container}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[Colors.light.primary]} />
        }
      >
        <View style={styles.header}>
          <View style={styles.avatarContainer}>
            <User size={48} color={Colors.light.background} />
          </View>
          <Text style={styles.name}>{employee.name}</Text>
          <Text style={styles.designation}>{employee.designation}</Text>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Personal Information</Text>
            <TouchableOpacity style={styles.editButton} onPress={handleOpenEditModal}>
              <Edit2 size={16} color={Colors.light.primary} />
              <Text style={styles.editButtonText}>Edit</Text>
            </TouchableOpacity>
          </View>
          
          <View style={styles.infoCard}>
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
              icon={<Briefcase size={20} color={Colors.light.primary} />}
              label="Pers Number"
              value={employee.persNo || 'N/A'}
            />
          </View>
        </View>

        {hasOutstandingAmount(employee.outstandingFtth, employee.outstandingLc) && (
          <View style={styles.section}>
            <View style={styles.outstandingHeader}>
              <AlertTriangle size={20} color="#D32F2F" />
              <Text style={styles.outstandingTitle}>Outstanding Dues</Text>
            </View>
            
            <View style={[styles.outstandingCard, dangerShadow]}>
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

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Task Information</Text>
          
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

        {isLinked && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>My Organization</Text>
            
            <TouchableOpacity 
              style={styles.orgCard}
              onPress={() => router.push('/hierarchy')}
              activeOpacity={0.8}
            >
              {hierarchyLoading || fullHierarchyLoading ? (
                <View style={styles.orgLoadingContainer}>
                  <ActivityIndicator color={Colors.light.primary} />
                  <Text style={styles.orgLoadingText}>Loading hierarchy...</Text>
                </View>
              ) : (
                <>
                  <View style={styles.orgPreviewHeader}>
                    <View style={styles.orgHeaderLeft}>
                      <Building2 size={20} color={Colors.light.primary} />
                      <Text style={styles.orgHeaderTitle}>Organization Tree</Text>
                    </View>
                    <ChevronRight size={20} color={Colors.light.textSecondary} />
                  </View>
                  
                  <View style={styles.orgStats}>
                    <View style={styles.orgStat}>
                      <Text style={styles.orgStatValue}>{totalManagers}</Text>
                      <Text style={styles.orgStatLabel}>Levels Up</Text>
                    </View>
                    <View style={styles.orgStatDivider} />
                    <View style={styles.orgStat}>
                      <Text style={styles.orgStatValue}>{totalSubordinates}</Text>
                      <Text style={styles.orgStatLabel}>Direct Reports</Text>
                    </View>
                  </View>
                  
                  <View style={styles.orgTreePreview}>
                    {immediateManager && (
                      <>
                        <MiniOrgNode 
                          name={immediateManager.name} 
                          designation={immediateManager.designation}
                        />
                        <TreeLine />
                      </>
                    )}
                    
                    {currentUser && (
                      <MiniOrgNode 
                        name={currentUser.name} 
                        designation={currentUser.designation}
                        isYou={true}
                      />
                    )}
                    
                    {topSubordinates.length > 0 && (
                      <>
                        <TreeLine />
                        <View style={styles.subordinatesPreview}>
                          {topSubordinates.map((sub, index) => (
                            <View key={sub.id} style={styles.subPreviewItem}>
                              <View style={[styles.subPreviewAvatar, { backgroundColor: getAvatarColor(sub.name) }]}>
                                <Text style={styles.subPreviewAvatarText}>{getInitials(sub.name)}</Text>
                              </View>
                            </View>
                          ))}
                          {totalSubordinates > 2 && (
                            <View style={styles.moreIndicator}>
                              <Text style={styles.moreText}>+{totalSubordinates - 2}</Text>
                            </View>
                          )}
                        </View>
                      </>
                    )}
                  </View>
                  
                  <View style={styles.viewFullBtn}>
                    <Users size={16} color={Colors.light.primary} />
                    <Text style={styles.viewFullText}>View Full Hierarchy</Text>
                    <ChevronRight size={16} color={Colors.light.primary} />
                  </View>
                </>
              )}
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Actions</Text>
          
          <TouchableOpacity style={styles.actionButton} onPress={() => router.push('/audit-logs')}>
            <FileText size={20} color={Colors.light.text} />
            <Text style={styles.actionButtonText}>View Audit Logs</Text>
          </TouchableOpacity>

          {['GM', 'CGM', 'DGM', 'AGM'].includes(employee.role) && (
            <TouchableOpacity style={styles.actionButton} onPress={() => router.push('/team-management')}>
              <Users size={20} color={Colors.light.primary} />
              <Text style={[styles.actionButtonText, { color: Colors.light.primary }]}>Team Management</Text>
            </TouchableOpacity>
          )}


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

      <Modal
        visible={showEditModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowEditModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Edit Profile</Text>
              <TouchableOpacity onPress={() => setShowEditModal(false)}>
                <X size={24} color={Colors.light.text} />
              </TouchableOpacity>
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Pers Number</Text>
              <View style={styles.readOnlyInput}>
                <Lock size={16} color={Colors.light.textSecondary} />
                <Text style={styles.readOnlyText}>{employee?.persNo || 'N/A'}</Text>
              </View>
              <Text style={styles.formHint}>Pers Number cannot be changed</Text>
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Email</Text>
              <TextInput
                style={styles.formInput}
                value={editForm.email}
                onChangeText={(text) => setEditForm(prev => ({ ...prev, email: text }))}
                placeholder="Enter email address"
                keyboardType="email-address"
                autoCapitalize="none"
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Phone</Text>
              <TextInput
                style={styles.formInput}
                value={editForm.phone}
                onChangeText={(text) => setEditForm(prev => ({ ...prev, phone: text }))}
                placeholder="Enter phone number"
                keyboardType="phone-pad"
              />
            </View>

            <View style={styles.modalButtons}>
              <TouchableOpacity 
                style={styles.cancelModalButton} 
                onPress={() => setShowEditModal(false)}
              >
                <Text style={styles.cancelModalButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.saveButton, saving && styles.saveButtonDisabled]} 
                onPress={handleSaveProfile}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator size="small" color={Colors.light.background} />
                ) : (
                  <Text style={styles.saveButtonText}>Save Changes</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
  orgCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    shadowColor: Colors.light.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 6,
    borderWidth: 1,
    borderColor: '#E3F2FD',
  },
  orgLoadingContainer: {
    alignItems: 'center',
    padding: 32,
    gap: 12,
  },
  orgLoadingText: {
    fontSize: 14,
    color: Colors.light.textSecondary,
  },
  orgPreviewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  orgHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  orgHeaderTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.light.text,
  },
  orgStats: {
    flexDirection: 'row',
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
  },
  orgStat: {
    flex: 1,
    alignItems: 'center',
  },
  orgStatValue: {
    fontSize: 28,
    fontWeight: 'bold',
    color: Colors.light.primary,
  },
  orgStatLabel: {
    fontSize: 12,
    color: Colors.light.textSecondary,
    marginTop: 2,
  },
  orgStatDivider: {
    width: 1,
    backgroundColor: '#E0E0E0',
    marginHorizontal: 16,
  },
  orgTreePreview: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  miniNode: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 10,
    paddingRight: 16,
    width: '100%',
    maxWidth: 280,
  },
  miniNodeYou: {
    backgroundColor: '#E3F2FD',
    borderWidth: 2,
    borderColor: Colors.light.primary,
  },
  miniAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  miniAvatarText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 13,
  },
  miniNodeInfo: {
    flex: 1,
  },
  miniNodeName: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.light.text,
  },
  miniNodeDesig: {
    fontSize: 11,
    color: Colors.light.textSecondary,
  },
  youBadge: {
    backgroundColor: Colors.light.primary,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  youBadgeText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#fff',
  },
  treeLine: {
    alignItems: 'center',
    height: 24,
    justifyContent: 'center',
  },
  treeLineVertical: {
    width: 2,
    height: '100%',
    backgroundColor: '#CBD5E1',
  },
  subordinatesPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  subPreviewItem: {
    alignItems: 'center',
  },
  subPreviewAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  subPreviewAvatarText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 12,
  },
  moreIndicator: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#E0E0E0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  moreText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: Colors.light.textSecondary,
  },
  viewFullBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingTop: 16,
    marginTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#E0E0E0',
  },
  viewFullText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.light.primary,
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
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  editButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: Colors.light.primary + '15',
  },
  editButtonText: {
    fontSize: 14,
    color: Colors.light.primary,
    fontWeight: '500' as const,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: Colors.light.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold' as const,
    color: Colors.light.text,
  },
  formGroup: {
    marginBottom: 20,
  },
  formLabel: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.light.text,
    marginBottom: 8,
  },
  formInput: {
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: Colors.light.text,
  },
  readOnlyInput: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 8,
    padding: 12,
    backgroundColor: Colors.light.backgroundSecondary,
  },
  readOnlyText: {
    fontSize: 16,
    color: Colors.light.textSecondary,
  },
  formHint: {
    fontSize: 12,
    color: Colors.light.textSecondary,
    marginTop: 4,
    fontStyle: 'italic',
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
  },
  cancelModalButton: {
    flex: 1,
    padding: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.light.border,
    alignItems: 'center',
  },
  cancelModalButtonText: {
    fontSize: 16,
    color: Colors.light.text,
    fontWeight: '600' as const,
  },
  saveButton: {
    flex: 1,
    padding: 14,
    borderRadius: 8,
    backgroundColor: Colors.light.primary,
    alignItems: 'center',
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  saveButtonText: {
    fontSize: 16,
    color: Colors.light.background,
    fontWeight: '600' as const,
  },
});
