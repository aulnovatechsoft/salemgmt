import { useState, useCallback, useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, Alert, TextInput, Modal, ActivityIndicator } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { ChevronLeft, Check, X, Clock, User, CreditCard, FileText, MapPin, Calendar, DollarSign, ShieldX, Filter, Building } from 'lucide-react-native';
import { useAuth } from '@/contexts/auth';
import ColorsObj from '@/constants/colors';
import { trpc } from '@/lib/trpc';

const Colors = {
  ...ColorsObj.light,
  textLight: ColorsObj.light.textSecondary,
};

const MANAGEMENT_ROLES = ['ADMIN', 'GM', 'CGM', 'DGM', 'AGM'];

const FINANCE_TYPES = [
  { value: '', label: 'All Types' },
  { value: 'FIN_LC', label: 'Lease Circuit' },
  { value: 'FIN_LL_FTTH', label: 'LL/FTTH Outstanding' },
  { value: 'FIN_TOWER', label: 'Tower Rental' },
  { value: 'FIN_GSM_POSTPAID', label: 'GSM Postpaid' },
  { value: 'FIN_RENT_BUILDING', label: 'Building Rent' },
];

export default function FinanceReviewScreen() {
  const router = useRouter();
  const { employee } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [processing, setProcessing] = useState<string | null>(null);
  const [selectedFilter, setSelectedFilter] = useState('');

  const isManagement = employee?.role && MANAGEMENT_ROLES.includes(employee.role);

  const trpcUtils = trpc.useUtils();

  const { data: pendingEntries, isLoading, isError, error, refetch } = trpc.events.getPendingFinanceCollections.useQuery(
    { reviewerId: employee?.id || '', financeType: selectedFilter || undefined },
    { enabled: !!employee?.id && isManagement }
  );

  const totalAmount = useMemo(() => {
    if (!pendingEntries) return 0;
    return pendingEntries.reduce((sum, entry) => sum + (entry.amountCollected || 0), 0);
  }, [pendingEntries]);

  const approveMutation = trpc.events.approveFinanceCollection.useMutation({
    onSuccess: () => {
      Alert.alert('Success', 'Collection approved successfully');
      trpcUtils.events.getPendingFinanceCollections.invalidate();
      refetch();
    },
    onError: (error) => {
      Alert.alert('Error', error.message);
    },
  });

  const rejectMutation = trpc.events.rejectFinanceCollection.useMutation({
    onSuccess: () => {
      Alert.alert('Success', 'Collection rejected');
      setShowRejectModal(false);
      setRejectReason('');
      setSelectedEntryId(null);
      trpcUtils.events.getPendingFinanceCollections.invalidate();
      refetch();
    },
    onError: (error) => {
      Alert.alert('Error', error.message);
    },
  });

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const handleApprove = async (entryId: string) => {
    if (!employee?.id) return;
    
    Alert.alert(
      'Approve Collection',
      'Are you sure you want to approve this collection? The amount will be added to the event total.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Approve',
          onPress: async () => {
            setProcessing(entryId);
            try {
              await approveMutation.mutateAsync({
                entryId,
                reviewerId: employee.id,
              });
            } catch (error) {
              // Error already handled by mutation onError
            } finally {
              setProcessing(null);
            }
          },
        },
      ]
    );
  };

  const handleRejectPress = (entryId: string) => {
    setSelectedEntryId(entryId);
    setShowRejectModal(true);
  };

  const handleRejectConfirm = async () => {
    if (!employee?.id || !selectedEntryId || !rejectReason.trim()) {
      Alert.alert('Error', 'Please provide a reason for rejection');
      return;
    }

    setProcessing(selectedEntryId);
    try {
      await rejectMutation.mutateAsync({
        entryId: selectedEntryId,
        reviewerId: employee.id,
        remarks: rejectReason.trim(),
      });
    } catch (error) {
      // Error already handled by mutation onError
    } finally {
      setProcessing(null);
    }
  };

  const formatAmount = (amount: number) => {
    return `₹${amount.toLocaleString('en-IN')}`;
  };

  const formatDate = (date: Date | string) => {
    return new Date(date).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getFinanceTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      FIN_LC: 'Lease Circuit',
      FIN_LL_FTTH: 'LL/FTTH Outstanding',
      FIN_TOWER: 'Tower Rental',
      FIN_GSM_POSTPAID: 'GSM Postpaid',
      FIN_RENT_BUILDING: 'Building Rent',
    };
    return labels[type] || type;
  };

  if (!isManagement) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <ChevronLeft size={24} color={Colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Access Denied</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.emptyContainer}>
          <ShieldX size={48} color="#EF5350" />
          <Text style={styles.emptyText}>Access Restricted</Text>
          <Text style={styles.emptySubtext}>Only management users can access this screen.</Text>
          <TouchableOpacity style={styles.goBackBtn} onPress={() => router.back()}>
            <Text style={styles.goBackBtnText}>Go Back</Text>
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
          <Text style={styles.headerTitle}>Pending Reviews</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>Loading pending reviews...</Text>
        </View>
      </View>
    );
  }

  if (isError) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <ChevronLeft size={24} color={Colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Pending Reviews</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.emptyContainer}>
          <X size={48} color="#EF5350" />
          <Text style={styles.emptyText}>Error Loading Data</Text>
          <Text style={styles.emptySubtext}>{error?.message || 'Failed to load pending reviews.'}</Text>
          <TouchableOpacity style={styles.goBackBtn} onPress={() => refetch()}>
            <Text style={styles.goBackBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <ChevronLeft size={24} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Pending Reviews</Text>
        <TouchableOpacity 
          style={[styles.filterBtn, selectedFilter ? styles.filterBtnActive : null]} 
          onPress={() => setShowFilterModal(true)}
        >
          <Filter size={18} color={selectedFilter ? '#fff' : Colors.primary} />
        </TouchableOpacity>
      </View>

      {pendingEntries && pendingEntries.length > 0 && (
        <View style={styles.summaryBar}>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryLabel}>Pending</Text>
            <Text style={styles.summaryValue}>{pendingEntries.length}</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}>
            <Text style={styles.summaryLabel}>Total Amount</Text>
            <Text style={styles.summaryValue}>{formatAmount(totalAmount)}</Text>
          </View>
        </View>
      )}

      <ScrollView
        style={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      >
        {!pendingEntries || pendingEntries.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Check size={48} color={Colors.textLight} />
            <Text style={styles.emptyText}>All caught up!</Text>
            <Text style={styles.emptySubtext}>
              {selectedFilter 
                ? `No pending ${getFinanceTypeLabel(selectedFilter)} collections to review.`
                : 'No pending finance collections to review.'
              }
            </Text>
            {selectedFilter && (
              <TouchableOpacity style={styles.clearFilterBtn} onPress={() => setSelectedFilter('')}>
                <Text style={styles.clearFilterBtnText}>Clear Filter</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          pendingEntries.map((entry) => (
            <View key={entry.id} style={styles.entryCard}>
              <View style={styles.entryHeader}>
                <View style={styles.statusBadge}>
                  <Clock size={14} color="#F57C00" />
                  <Text style={styles.statusText}>Pending Review</Text>
                </View>
                <Text style={styles.dateText}>{formatDate(entry.createdAt)}</Text>
              </View>

              <Text style={styles.eventTitle}>{entry.eventTitle}</Text>
              
              <View style={styles.amountRow}>
                <DollarSign size={20} color={Colors.primary} />
                <Text style={styles.amountText}>{formatAmount(entry.amountCollected)}</Text>
              </View>

              <View style={styles.detailsGrid}>
                <View style={styles.detailItem}>
                  <FileText size={16} color={Colors.textLight} />
                  <Text style={styles.detailLabel}>Type</Text>
                  <Text style={styles.detailValue}>{getFinanceTypeLabel(entry.financeType)}</Text>
                </View>
                <View style={styles.detailItem}>
                  <CreditCard size={16} color={Colors.textLight} />
                  <Text style={styles.detailLabel}>Payment</Text>
                  <Text style={styles.detailValue}>{entry.paymentMode}</Text>
                </View>
              </View>

              <View style={styles.submitterRow}>
                <User size={16} color={Colors.textLight} />
                <Text style={styles.submitterText}>
                  {entry.submitterName || 'Unknown'} {entry.submitterDesignation ? `(${entry.submitterDesignation})` : ''}
                </Text>
              </View>
              
              {entry.submitterCircle && (
                <View style={styles.circleRow}>
                  <Building size={14} color={Colors.textLight} />
                  <Text style={styles.circleText}>{entry.submitterCircle}</Text>
                </View>
              )}

              {entry.customerName && (
                <View style={styles.customerRow}>
                  <Text style={styles.customerLabel}>Customer:</Text>
                  <Text style={styles.customerValue}>{entry.customerName}</Text>
                </View>
              )}

              {entry.transactionReference && (
                <View style={styles.customerRow}>
                  <Text style={styles.customerLabel}>Ref:</Text>
                  <Text style={styles.customerValue}>{entry.transactionReference}</Text>
                </View>
              )}

              {entry.remarks && (
                <View style={styles.remarksBox}>
                  <Text style={styles.remarksLabel}>Remarks:</Text>
                  <Text style={styles.remarksText}>{entry.remarks}</Text>
                </View>
              )}

              {entry.gpsLatitude && entry.gpsLongitude && (
                <View style={styles.gpsRow}>
                  <MapPin size={14} color={Colors.textLight} />
                  <Text style={styles.gpsText}>GPS: {entry.gpsLatitude}, {entry.gpsLongitude}</Text>
                </View>
              )}

              <View style={styles.actionButtons}>
                <TouchableOpacity
                  style={[styles.actionBtn, styles.rejectBtn]}
                  onPress={() => handleRejectPress(entry.id)}
                  disabled={processing === entry.id}
                >
                  {processing === entry.id ? (
                    <ActivityIndicator size="small" color="#EF5350" />
                  ) : (
                    <>
                      <X size={18} color="#EF5350" />
                      <Text style={styles.rejectBtnText}>Reject</Text>
                    </>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionBtn, styles.approveBtn]}
                  onPress={() => handleApprove(entry.id)}
                  disabled={processing === entry.id}
                >
                  {processing === entry.id ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <>
                      <Check size={18} color="#fff" />
                      <Text style={styles.approveBtnText}>Approve</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          ))
        )}
        <View style={{ height: 40 }} />
      </ScrollView>

      <Modal visible={showRejectModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Reject Collection</Text>
            <Text style={styles.modalSubtitle}>Please provide a reason for rejection:</Text>
            <TextInput
              style={styles.rejectInput}
              placeholder="Enter rejection reason..."
              value={rejectReason}
              onChangeText={setRejectReason}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => {
                  setShowRejectModal(false);
                  setRejectReason('');
                  setSelectedEntryId(null);
                }}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalConfirmBtn, !rejectReason.trim() && styles.modalBtnDisabled]}
                onPress={handleRejectConfirm}
                disabled={!rejectReason.trim() || rejectMutation.isPending}
              >
                {rejectMutation.isPending ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.modalConfirmText}>Confirm Reject</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={showFilterModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Filter by Type</Text>
            <View style={styles.filterOptions}>
              {FINANCE_TYPES.map((type) => (
                <TouchableOpacity
                  key={type.value}
                  style={[
                    styles.filterOption,
                    selectedFilter === type.value && styles.filterOptionActive,
                  ]}
                  onPress={() => {
                    setSelectedFilter(type.value);
                    setShowFilterModal(false);
                  }}
                >
                  <Text
                    style={[
                      styles.filterOptionText,
                      selectedFilter === type.value && styles.filterOptionTextActive,
                    ]}
                  >
                    {type.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity
              style={styles.modalCancelBtn}
              onPress={() => setShowFilterModal(false)}
            >
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
    paddingTop: 50,
    paddingBottom: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.text,
  },
  countBadge: {
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    minWidth: 40,
    alignItems: 'center',
  },
  countText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  filterBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  filterBtnActive: {
    backgroundColor: Colors.primary,
  },
  summaryBar: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  summaryItem: {
    flex: 1,
    alignItems: 'center',
  },
  summaryDivider: {
    width: 1,
    backgroundColor: Colors.border,
  },
  summaryLabel: {
    fontSize: 12,
    color: Colors.textLight,
    marginBottom: 4,
  },
  summaryValue: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.text,
  },
  clearFilterBtn: {
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  clearFilterBtnText: {
    color: Colors.primary,
    fontWeight: '500',
    fontSize: 14,
  },
  content: {
    flex: 1,
    padding: 16,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 12,
    color: Colors.textLight,
    fontSize: 14,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 80,
  },
  emptyText: {
    fontSize: 20,
    fontWeight: '600',
    color: Colors.text,
    marginTop: 16,
  },
  emptySubtext: {
    fontSize: 14,
    color: Colors.textLight,
    marginTop: 8,
  },
  goBackBtn: {
    marginTop: 20,
    backgroundColor: Colors.primary,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  goBackBtnText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  entryCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  entryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF3E0',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  statusText: {
    color: '#F57C00',
    fontSize: 12,
    fontWeight: '500',
  },
  dateText: {
    fontSize: 12,
    color: Colors.textLight,
  },
  eventTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.text,
    marginBottom: 12,
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  amountText: {
    fontSize: 24,
    fontWeight: '700',
    color: Colors.primary,
  },
  detailsGrid: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 12,
  },
  detailItem: {
    flex: 1,
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 4,
  },
  detailLabel: {
    fontSize: 12,
    color: Colors.textLight,
  },
  detailValue: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.text,
  },
  submitterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  submitterText: {
    fontSize: 14,
    color: Colors.text,
  },
  circleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  circleText: {
    fontSize: 13,
    color: Colors.textLight,
  },
  filterOptions: {
    marginBottom: 16,
  },
  filterOption: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginBottom: 8,
    backgroundColor: Colors.background,
  },
  filterOptionActive: {
    backgroundColor: Colors.primary,
  },
  filterOptionText: {
    fontSize: 14,
    color: Colors.text,
    textAlign: 'center',
  },
  filterOptionTextActive: {
    color: '#fff',
    fontWeight: '600',
  },
  customerRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  customerLabel: {
    fontSize: 13,
    color: Colors.textLight,
  },
  customerValue: {
    fontSize: 13,
    color: Colors.text,
    flex: 1,
  },
  remarksBox: {
    backgroundColor: Colors.background,
    padding: 10,
    borderRadius: 8,
    marginTop: 8,
  },
  remarksLabel: {
    fontSize: 12,
    color: Colors.textLight,
    marginBottom: 4,
  },
  remarksText: {
    fontSize: 13,
    color: Colors.text,
  },
  gpsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
  },
  gpsText: {
    fontSize: 12,
    color: Colors.textLight,
  },
  actionButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 8,
    gap: 6,
  },
  rejectBtn: {
    backgroundColor: '#FFEBEE',
    borderWidth: 1,
    borderColor: '#EF5350',
  },
  rejectBtnText: {
    color: '#EF5350',
    fontWeight: '600',
    fontSize: 14,
  },
  approveBtn: {
    backgroundColor: '#4CAF50',
  },
  approveBtnText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
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
    fontWeight: '600',
    color: Colors.text,
    marginBottom: 8,
  },
  modalSubtitle: {
    fontSize: 14,
    color: Colors.textLight,
    marginBottom: 16,
  },
  rejectInput: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    padding: 12,
    minHeight: 100,
    fontSize: 14,
    marginBottom: 16,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  modalCancelBtn: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 8,
    backgroundColor: Colors.background,
  },
  modalCancelText: {
    color: Colors.text,
    fontWeight: '500',
  },
  modalConfirmBtn: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 8,
    backgroundColor: '#EF5350',
  },
  modalConfirmText: {
    color: '#fff',
    fontWeight: '600',
  },
  modalBtnDisabled: {
    opacity: 0.5,
  },
});
