import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, TextInput, Modal, RefreshControl } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useState, useMemo, useCallback } from 'react';
import { Check, X, Calendar, MapPin, User, Filter, CheckSquare, Image as ImageIcon, MessageSquare } from 'lucide-react-native';
import { useAuth } from '@/contexts/auth';
import Colors from '@/constants/colors';
import { trpc } from '@/lib/trpc';
import { SalesReportStatus } from '@/types';

type FilterStatus = 'all' | 'pending' | 'approved' | 'rejected';

export default function SalesApprovalScreen() {
  const router = useRouter();
  const { employee } = useAuth();
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('pending');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectRemarks, setRejectRemarks] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const salesQuery = trpc.sales.getAll.useQuery({});
  const approveMutation = trpc.sales.approve.useMutation();
  const rejectMutation = trpc.sales.reject.useMutation();
  const bulkApproveMutation = trpc.sales.bulkApprove.useMutation();

  const filteredReports = useMemo(() => {
    if (!salesQuery.data) return [];
    if (filterStatus === 'all') return salesQuery.data;
    return salesQuery.data.filter(r => r.status === filterStatus);
  }, [salesQuery.data, filterStatus]);

  const pendingCount = useMemo(() => {
    return salesQuery.data?.filter(r => r.status === 'pending').length || 0;
  }, [salesQuery.data]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await salesQuery.refetch();
    setRefreshing(false);
  }, [salesQuery]);

  const handleApprove = useCallback(async (id: string) => {
    if (!employee) return;
    
    Alert.alert(
      'Approve Report',
      'Are you sure you want to approve this sales report?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Approve',
          style: 'default',
          onPress: async () => {
            try {
              await approveMutation.mutateAsync({
                id,
                reviewerId: employee.id,
              });
              salesQuery.refetch();
              Alert.alert('Success', 'Sales report approved successfully');
            } catch (error) {
              console.error('Error approving report:', error);
              Alert.alert('Error', 'Failed to approve sales report');
            }
          },
        },
      ]
    );
  }, [employee, approveMutation, salesQuery]);

  const handleReject = useCallback((id: string) => {
    setRejectingId(id);
    setRejectRemarks('');
    setShowRejectModal(true);
  }, []);

  const confirmReject = useCallback(async () => {
    if (!employee || !rejectingId) return;
    
    if (!rejectRemarks.trim()) {
      Alert.alert('Error', 'Please provide rejection remarks');
      return;
    }

    try {
      await rejectMutation.mutateAsync({
        id: rejectingId,
        reviewerId: employee.id,
        reviewRemarks: rejectRemarks.trim(),
      });
      setShowRejectModal(false);
      setRejectingId(null);
      setRejectRemarks('');
      salesQuery.refetch();
      Alert.alert('Success', 'Sales report rejected');
    } catch (error) {
      console.error('Error rejecting report:', error);
      Alert.alert('Error', 'Failed to reject sales report');
    }
  }, [employee, rejectingId, rejectRemarks, rejectMutation, salesQuery]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => 
      prev.includes(id) 
        ? prev.filter(i => i !== id)
        : [...prev, id]
    );
  }, []);

  const handleBulkApprove = useCallback(async () => {
    if (!employee || selectedIds.length === 0) return;

    Alert.alert(
      'Bulk Approve',
      `Are you sure you want to approve ${selectedIds.length} sales reports?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Approve All',
          style: 'default',
          onPress: async () => {
            try {
              await bulkApproveMutation.mutateAsync({
                ids: selectedIds,
                reviewerId: employee.id,
              });
              setSelectedIds([]);
              salesQuery.refetch();
              Alert.alert('Success', `${selectedIds.length} reports approved successfully`);
            } catch (error) {
              console.error('Error bulk approving:', error);
              Alert.alert('Error', 'Failed to bulk approve reports');
            }
          },
        },
      ]
    );
  }, [employee, selectedIds, bulkApproveMutation, salesQuery]);

  const selectAllPending = useCallback(() => {
    const pendingIds = filteredReports
      .filter(r => r.status === 'pending')
      .map(r => r.id);
    setSelectedIds(pendingIds);
  }, [filteredReports]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'approved':
        return { bg: '#E8F5E9', color: Colors.light.success, text: 'Approved' };
      case 'rejected':
        return { bg: '#FFEBEE', color: Colors.light.error, text: 'Rejected' };
      default:
        return { bg: '#FFF3E0', color: Colors.light.warning, text: 'Pending' };
    }
  };

  const isManager = employee && ['GM', 'CGM', 'DGM', 'AGM', 'SD_JTO'].includes(employee.role);

  if (!isManager) {
    return (
      <>
        <Stack.Screen options={{ title: 'Access Denied' }} />
        <View style={styles.centered}>
          <Text style={styles.errorText}>Only managers can access this page</Text>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <Text style={styles.backButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen 
        options={{ 
          title: 'Sales Approval',
          headerStyle: { backgroundColor: Colors.light.primary },
          headerTintColor: Colors.light.background,
          headerTitleStyle: { fontWeight: 'bold' as const },
        }} 
      />

      <View style={styles.container}>
        <View style={styles.filterContainer}>
          <View style={styles.filterRow}>
            <Filter size={18} color={Colors.light.textSecondary} />
            <Text style={styles.filterLabel}>Filter:</Text>
            {(['pending', 'approved', 'rejected', 'all'] as FilterStatus[]).map((status) => (
              <TouchableOpacity
                key={status}
                style={[
                  styles.filterChip,
                  filterStatus === status && styles.filterChipActive,
                ]}
                onPress={() => setFilterStatus(status)}
              >
                <Text style={[
                  styles.filterChipText,
                  filterStatus === status && styles.filterChipTextActive,
                ]}>
                  {status.charAt(0).toUpperCase() + status.slice(1)}
                  {status === 'pending' && pendingCount > 0 && ` (${pendingCount})`}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {filterStatus === 'pending' && filteredReports.length > 0 && (
            <View style={styles.bulkActions}>
              <TouchableOpacity style={styles.selectAllButton} onPress={selectAllPending}>
                <CheckSquare size={16} color={Colors.light.primary} />
                <Text style={styles.selectAllText}>Select All</Text>
              </TouchableOpacity>
              {selectedIds.length > 0 && (
                <TouchableOpacity 
                  style={styles.bulkApproveButton} 
                  onPress={handleBulkApprove}
                  disabled={bulkApproveMutation.isPending}
                >
                  <Check size={16} color="#fff" />
                  <Text style={styles.bulkApproveText}>
                    Approve {selectedIds.length} Selected
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>

        <ScrollView 
          style={styles.scrollView}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
        >
          {salesQuery.isLoading ? (
            <View style={styles.centered}>
              <Text style={styles.loadingText}>Loading sales reports...</Text>
            </View>
          ) : filteredReports.length === 0 ? (
            <View style={styles.emptyState}>
              <Check size={64} color={Colors.light.textSecondary} />
              <Text style={styles.emptyTitle}>No Reports</Text>
              <Text style={styles.emptySubtitle}>
                {filterStatus === 'pending' 
                  ? 'All sales reports have been reviewed'
                  : `No ${filterStatus} reports found`}
              </Text>
            </View>
          ) : (
            filteredReports.map(report => {
              const statusBadge = getStatusBadge(report.status);
              const isSelected = selectedIds.includes(report.id);

              return (
                <View key={report.id} style={styles.reportCard}>
                  {report.status === 'pending' && (
                    <TouchableOpacity
                      style={[styles.checkbox, isSelected && styles.checkboxSelected]}
                      onPress={() => toggleSelect(report.id)}
                    >
                      {isSelected && <Check size={14} color="#fff" />}
                    </TouchableOpacity>
                  )}

                  <View style={styles.reportContent}>
                    <View style={styles.reportHeader}>
                      <View style={styles.reportHeaderLeft}>
                        <Calendar size={14} color={Colors.light.textSecondary} />
                        <Text style={styles.reportDate}>
                          {new Date(report.createdAt).toLocaleDateString('en-IN', { 
                            day: 'numeric', month: 'short', year: 'numeric' 
                          })}
                        </Text>
                      </View>
                      <View style={[styles.statusBadge, { backgroundColor: statusBadge.bg }]}>
                        <Text style={[styles.statusText, { color: statusBadge.color }]}>
                          {statusBadge.text}
                        </Text>
                      </View>
                    </View>

                    <View style={styles.reportInfo}>
                      <View style={styles.infoRow}>
                        <User size={14} color={Colors.light.textSecondary} />
                        <Text style={styles.infoText}>{report.salesStaffName || 'Unknown Staff'}</Text>
                      </View>
                      <View style={styles.infoRow}>
                        <MapPin size={14} color={Colors.light.textSecondary} />
                        <Text style={styles.infoText}>{report.eventName || 'Unknown Event'}</Text>
                      </View>
                    </View>

                    <View style={styles.salesStats}>
                      <View style={styles.statItem}>
                        <Text style={styles.statLabel}>SIMs</Text>
                        <Text style={styles.statValue}>{report.simsSold}</Text>
                        <Text style={styles.statSub}>{report.simsActivated} activated</Text>
                      </View>
                      <View style={styles.statItem}>
                        <Text style={styles.statLabel}>FTTH</Text>
                        <Text style={styles.statValue}>{report.ftthLeads}</Text>
                        <Text style={styles.statSub}>{report.ftthInstalled} installed</Text>
                      </View>
                      <View style={styles.statItem}>
                        <Text style={styles.statLabel}>Type</Text>
                        <Text style={styles.statValue}>{report.customerType}</Text>
                      </View>
                    </View>

                    {report.photos && (report.photos as string[]).length > 0 && (
                      <View style={styles.photosIndicator}>
                        <ImageIcon size={14} color={Colors.light.info} />
                        <Text style={styles.photosText}>
                          {(report.photos as string[]).length} photo(s) attached
                        </Text>
                      </View>
                    )}

                    {report.remarks && (
                      <View style={styles.remarksRow}>
                        <MessageSquare size={14} color={Colors.light.textSecondary} />
                        <Text style={styles.remarksText} numberOfLines={2}>
                          {report.remarks}
                        </Text>
                      </View>
                    )}

                    {report.reviewRemarks && (
                      <View style={styles.reviewRemarksContainer}>
                        <Text style={styles.reviewRemarksLabel}>Review Remarks:</Text>
                        <Text style={styles.reviewRemarksText}>{report.reviewRemarks}</Text>
                      </View>
                    )}

                    {report.status === 'pending' && (
                      <View style={styles.actionButtons}>
                        <TouchableOpacity
                          style={[styles.actionButton, styles.approveButton]}
                          onPress={() => handleApprove(report.id)}
                          disabled={approveMutation.isPending}
                        >
                          <Check size={18} color="#fff" />
                          <Text style={styles.actionButtonText}>Approve</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.actionButton, styles.rejectButton]}
                          onPress={() => handleReject(report.id)}
                          disabled={rejectMutation.isPending}
                        >
                          <X size={18} color="#fff" />
                          <Text style={styles.actionButtonText}>Reject</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                </View>
              );
            })
          )}
          <View style={styles.bottomSpacer} />
        </ScrollView>
      </View>

      <Modal
        visible={showRejectModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowRejectModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Reject Sales Report</Text>
            <Text style={styles.modalSubtitle}>
              Please provide a reason for rejection
            </Text>
            <TextInput
              style={styles.remarksInput}
              placeholder="Enter rejection remarks..."
              value={rejectRemarks}
              onChangeText={setRejectRemarks}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalCancelButton]}
                onPress={() => setShowRejectModal(false)}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalRejectButton]}
                onPress={confirmReject}
                disabled={rejectMutation.isPending}
              >
                <Text style={styles.modalRejectText}>
                  {rejectMutation.isPending ? 'Rejecting...' : 'Reject'}
                </Text>
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
  scrollView: {
    flex: 1,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  errorText: {
    fontSize: 16,
    color: Colors.light.textSecondary,
    textAlign: 'center',
    marginBottom: 16,
  },
  backButton: {
    backgroundColor: Colors.light.primary,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  backButtonText: {
    color: '#fff',
    fontWeight: '600' as const,
  },
  filterContainer: {
    backgroundColor: Colors.light.card,
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  filterLabel: {
    fontSize: 14,
    color: Colors.light.textSecondary,
    marginRight: 4,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: Colors.light.backgroundSecondary,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  filterChipActive: {
    backgroundColor: Colors.light.primary,
    borderColor: Colors.light.primary,
  },
  filterChipText: {
    fontSize: 13,
    color: Colors.light.textSecondary,
  },
  filterChipTextActive: {
    color: '#fff',
    fontWeight: '600' as const,
  },
  bulkActions: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    gap: 12,
  },
  selectAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.light.primary,
  },
  selectAllText: {
    color: Colors.light.primary,
    fontSize: 13,
    fontWeight: '500' as const,
  },
  bulkApproveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: Colors.light.success,
  },
  bulkApproveText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600' as const,
  },
  loadingText: {
    fontSize: 16,
    color: Colors.light.textSecondary,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    paddingHorizontal: 40,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: 'bold' as const,
    color: Colors.light.text,
    marginTop: 16,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: Colors.light.textSecondary,
    textAlign: 'center',
  },
  reportCard: {
    backgroundColor: Colors.light.card,
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: Colors.light.border,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  checkboxSelected: {
    backgroundColor: Colors.light.primary,
    borderColor: Colors.light.primary,
  },
  reportContent: {
    flex: 1,
  },
  reportHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  reportHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  reportDate: {
    fontSize: 13,
    color: Colors.light.textSecondary,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600' as const,
  },
  reportInfo: {
    marginBottom: 12,
    gap: 6,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  infoText: {
    fontSize: 14,
    color: Colors.light.text,
    flex: 1,
  },
  salesStats: {
    flexDirection: 'row',
    backgroundColor: Colors.light.backgroundSecondary,
    borderRadius: 8,
    padding: 12,
    gap: 12,
  },
  statItem: {
    flex: 1,
  },
  statLabel: {
    fontSize: 11,
    color: Colors.light.textSecondary,
    marginBottom: 2,
  },
  statValue: {
    fontSize: 18,
    fontWeight: 'bold' as const,
    color: Colors.light.text,
  },
  statSub: {
    fontSize: 10,
    color: Colors.light.textSecondary,
  },
  photosIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
  },
  photosText: {
    fontSize: 12,
    color: Colors.light.info,
  },
  remarksRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
  },
  remarksText: {
    fontSize: 13,
    color: Colors.light.text,
    flex: 1,
    lineHeight: 18,
  },
  reviewRemarksContainer: {
    marginTop: 10,
    padding: 10,
    backgroundColor: '#FFF8E1',
    borderRadius: 8,
  },
  reviewRemarksLabel: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: Colors.light.warning,
    marginBottom: 4,
  },
  reviewRemarksText: {
    fontSize: 13,
    color: Colors.light.text,
  },
  actionButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 8,
    gap: 6,
  },
  approveButton: {
    backgroundColor: Colors.light.success,
  },
  rejectButton: {
    backgroundColor: Colors.light.error,
  },
  actionButtonText: {
    color: '#fff',
    fontWeight: '600' as const,
    fontSize: 14,
  },
  bottomSpacer: {
    height: 24,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 400,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold' as const,
    color: Colors.light.text,
    marginBottom: 8,
  },
  modalSubtitle: {
    fontSize: 14,
    color: Colors.light.textSecondary,
    marginBottom: 16,
  },
  remarksInput: {
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    minHeight: 100,
    color: Colors.light.text,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 20,
  },
  modalButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  modalCancelButton: {
    backgroundColor: Colors.light.backgroundSecondary,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  modalCancelText: {
    color: Colors.light.text,
    fontWeight: '500' as const,
  },
  modalRejectButton: {
    backgroundColor: Colors.light.error,
  },
  modalRejectText: {
    color: '#fff',
    fontWeight: '600' as const,
  },
});
