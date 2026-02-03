import { useState, useCallback, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, RefreshControl, Modal, Alert, ActivityIndicator } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { ChevronLeft, Search, Upload, Server, Users, Wifi, X, ChevronDown, ChevronUp } from 'lucide-react-native';
import { useAuth } from '@/contexts/auth';
import ColorsObj from '@/constants/colors';
import { trpc } from '@/lib/trpc';
import { canAccessAdminPanel } from '@/constants/app';

const Colors = {
  ...ColorsObj.light,
  textLight: ColorsObj.light.textSecondary,
};

interface OltRecord {
  id: string;
  pers_no: string;
  olt_ip: string;
  created_at: string;
  employee_name: string | null;
  designation: string | null;
  circle: string | null;
}

interface GroupedRecord {
  persNo: string;
  employeeName: string | null;
  designation: string | null;
  circle: string | null;
  oltIps: string[];
}

export default function OltReportScreen() {
  const router = useRouter();
  const { employee } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [csvText, setCsvText] = useState('');
  const [importing, setImporting] = useState(false);
  const [expandedPersNo, setExpandedPersNo] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const pageSize = 100;
  
  const trpcUtils = trpc.useUtils();
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  const { data: summary, refetch: refetchSummary } = trpc.admin.getOltSummary.useQuery(
    { userId: employee?.id || '' },
    { enabled: !!employee?.id }
  );
  
  const { data: reportData, isLoading, refetch } = trpc.admin.getOltReport.useQuery({
    userId: employee?.id || '',
    search: debouncedSearch,
    limit: pageSize,
    offset: page * pageSize,
  }, { enabled: !!employee?.id });
  
  const importMutation = trpc.admin.bulkImportOlt.useMutation({
    onSuccess: (result) => {
      Alert.alert(
        'Import Complete',
        `Imported: ${result.imported}\nSkipped (duplicates): ${result.skipped}\nTotal: ${result.total}${result.errors.length > 0 ? '\n\nErrors:\n' + result.errors.join('\n') : ''}`,
        [{ text: 'OK' }]
      );
      setCsvText('');
      setShowUploadModal(false);
      refetch();
      refetchSummary();
    },
    onError: (error) => {
      Alert.alert('Import Error', error.message);
    },
  });

  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, []);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refetch(), refetchSummary()]);
    setRefreshing(false);
  }, [refetch, refetchSummary]);

  const handleSearch = useCallback((text: string) => {
    setSearchQuery(text);
    setPage(0);
    
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    
    searchTimeoutRef.current = setTimeout(() => {
      setDebouncedSearch(text);
    }, 300);
  }, []);

  const handleImport = async () => {
    if (!csvText.trim()) {
      Alert.alert('Error', 'Please paste CSV data');
      return;
    }
    
    if (!employee?.id) {
      Alert.alert('Error', 'Please login first');
      return;
    }
    
    setImporting(true);
    
    try {
      const lines = csvText.trim().split('\n').filter(line => line.trim());
      if (lines.length < 2) {
        Alert.alert('Error', 'CSV must have at least a header and one data row');
        setImporting(false);
        return;
      }
      
      const header = lines[0].toLowerCase();
      const hasHeader = header.includes('per_no') || header.includes('pers_no') || header.includes('olt_ip');
      const dataLines = hasHeader ? lines.slice(1) : lines;
      
      const data = dataLines.map(line => {
        const parts = line.split(',').map(p => p.trim().replace(/"/g, ''));
        return {
          persNo: parts[0] || '',
          oltIp: parts[1] || '',
        };
      }).filter(d => d.persNo && d.oltIp);
      
      if (data.length === 0) {
        Alert.alert('Error', 'No valid data found in CSV');
        setImporting(false);
        return;
      }
      
      await importMutation.mutateAsync({
        data,
        uploadedBy: employee.id,
      });
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to parse CSV');
    }
    
    setImporting(false);
  };

  const groupRecordsByPersNo = (records: OltRecord[]): GroupedRecord[] => {
    const grouped = new Map<string, GroupedRecord>();
    
    for (const record of records) {
      const existing = grouped.get(record.pers_no);
      if (existing) {
        existing.oltIps.push(record.olt_ip);
      } else {
        grouped.set(record.pers_no, {
          persNo: record.pers_no,
          employeeName: record.employee_name,
          designation: record.designation,
          circle: record.circle,
          oltIps: [record.olt_ip],
        });
      }
    }
    
    return Array.from(grouped.values());
  };

  if (!employee?.role || !canAccessAdminPanel(employee.role)) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.accessDenied}>
          <Text style={styles.accessDeniedText}>Access Denied</Text>
          <Text style={styles.accessDeniedSubtext}>You don't have permission to view this report.</Text>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <Text style={styles.backButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const groupedRecords = reportData?.records ? groupRecordsByPersNo(reportData.records) : [];

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <ChevronLeft size={24} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>BBM Wise OLT Report</Text>
        <TouchableOpacity style={styles.uploadBtn} onPress={() => setShowUploadModal(true)}>
          <Upload size={20} color={Colors.primary} />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      >
        <View style={styles.summaryRow}>
          <View style={styles.summaryCard}>
            <View style={[styles.summaryIcon, { backgroundColor: '#E3F2FD' }]}>
              <Server size={20} color="#1565C0" />
            </View>
            <Text style={styles.summaryValue}>{summary?.totalRecords || 0}</Text>
            <Text style={styles.summaryLabel}>Total Records</Text>
          </View>
          
          <View style={styles.summaryCard}>
            <View style={[styles.summaryIcon, { backgroundColor: '#E8F5E9' }]}>
              <Users size={20} color="#2E7D32" />
            </View>
            <Text style={styles.summaryValue}>{summary?.uniquePersonnel || 0}</Text>
            <Text style={styles.summaryLabel}>Personnel</Text>
          </View>
          
          <View style={styles.summaryCard}>
            <View style={[styles.summaryIcon, { backgroundColor: '#FFF3E0' }]}>
              <Wifi size={20} color="#EF6C00" />
            </View>
            <Text style={styles.summaryValue}>{summary?.uniqueOltIps || 0}</Text>
            <Text style={styles.summaryLabel}>Unique IPs</Text>
          </View>
        </View>

        <View style={styles.searchContainer}>
          <Search size={18} color={Colors.textLight} style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search by Pers No or OLT IP..."
            value={searchQuery}
            onChangeText={handleSearch}
            placeholderTextColor={Colors.textLight}
          />
          {searchQuery ? (
            <TouchableOpacity onPress={() => handleSearch('')}>
              <X size={18} color={Colors.textLight} />
            </TouchableOpacity>
          ) : null}
        </View>

        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={Colors.primary} />
            <Text style={styles.loadingText}>Loading...</Text>
          </View>
        ) : groupedRecords.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Server size={48} color={Colors.textLight} />
            <Text style={styles.emptyText}>No OLT records found</Text>
            <Text style={styles.emptySubtext}>Import data using the upload button</Text>
          </View>
        ) : (
          <>
            <Text style={styles.resultCount}>
              Showing {groupedRecords.length} personnel ({reportData?.total || 0} total records)
            </Text>
            
            {groupedRecords.map((group) => (
              <View key={group.persNo} style={styles.recordCard}>
                <TouchableOpacity
                  style={styles.recordHeader}
                  onPress={() => router.push(`/employee-olt-profile?persNo=${group.persNo}` as any)}
                >
                  <View style={styles.recordInfo}>
                    <Text style={styles.persNo}>{group.persNo}</Text>
                    {group.employeeName && (
                      <Text style={styles.employeeName}>{group.employeeName}</Text>
                    )}
                    {group.designation && (
                      <Text style={styles.designation}>{group.designation}</Text>
                    )}
                    {group.circle && (
                      <Text style={styles.circle}>{group.circle}</Text>
                    )}
                  </View>
                  <View style={styles.recordMeta}>
                    <View style={styles.ipCountBadge}>
                      <Text style={styles.ipCountText}>{group.oltIps.length} IPs</Text>
                    </View>
                    <ChevronDown size={20} color={Colors.textLight} />
                  </View>
                </TouchableOpacity>
                
                <TouchableOpacity 
                  style={styles.expandToggle}
                  onPress={() => setExpandedPersNo(expandedPersNo === group.persNo ? null : group.persNo)}
                >
                  <Text style={styles.expandToggleText}>
                    {expandedPersNo === group.persNo ? 'Hide IPs' : 'Show IPs'}
                  </Text>
                  {expandedPersNo === group.persNo ? (
                    <ChevronUp size={16} color={Colors.primary} />
                  ) : (
                    <ChevronDown size={16} color={Colors.primary} />
                  )}
                </TouchableOpacity>
                
                {expandedPersNo === group.persNo && (
                  <View style={styles.ipList}>
                    {group.oltIps.map((ip, index) => (
                      <View key={index} style={styles.ipItem}>
                        <Wifi size={14} color={Colors.primary} />
                        <Text style={styles.ipText}>{ip}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            ))}

            {reportData?.hasMore && (
              <View style={styles.paginationRow}>
                <TouchableOpacity
                  style={[styles.pageBtn, page === 0 && styles.pageBtnDisabled]}
                  onPress={() => setPage(Math.max(0, page - 1))}
                  disabled={page === 0}
                >
                  <Text style={styles.pageBtnText}>Previous</Text>
                </TouchableOpacity>
                <Text style={styles.pageInfo}>Page {page + 1}</Text>
                <TouchableOpacity
                  style={styles.pageBtn}
                  onPress={() => setPage(page + 1)}
                >
                  <Text style={styles.pageBtnText}>Next</Text>
                </TouchableOpacity>
              </View>
            )}
          </>
        )}
      </ScrollView>

      <Modal visible={showUploadModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Import OLT Data</Text>
              <TouchableOpacity onPress={() => setShowUploadModal(false)}>
                <X size={24} color={Colors.text} />
              </TouchableOpacity>
            </View>
            
            <Text style={styles.modalSubtext}>
              Paste CSV with columns: PER_NO, OLT_IP
            </Text>
            
            <TextInput
              style={styles.csvInput}
              placeholder="PER_NO,OLT_IP&#10;99800619,10.215.223.100&#10;01003446,10.215.223.89"
              value={csvText}
              onChangeText={setCsvText}
              multiline
              numberOfLines={10}
              placeholderTextColor={Colors.textLight}
            />
            
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => setShowUploadModal(false)}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.importBtn, importing && styles.importBtnDisabled]}
                onPress={handleImport}
                disabled={importing}
              >
                {importing ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.importBtnText}>Import</Text>
                )}
              </TouchableOpacity>
            </View>
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
    flex: 1,
    textAlign: 'center',
  },
  uploadBtn: {
    padding: 8,
  },
  content: {
    flex: 1,
    padding: 16,
  },
  summaryRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  summaryCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  summaryIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  summaryValue: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.text,
  },
  summaryLabel: {
    fontSize: 11,
    color: Colors.textLight,
    marginTop: 4,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  searchIcon: {
    marginRight: 12,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 14,
    fontSize: 15,
    color: Colors.text,
  },
  loadingContainer: {
    padding: 40,
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    color: Colors.textLight,
  },
  emptyContainer: {
    padding: 40,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.text,
    marginTop: 16,
  },
  emptySubtext: {
    fontSize: 14,
    color: Colors.textLight,
    marginTop: 4,
  },
  resultCount: {
    fontSize: 13,
    color: Colors.textLight,
    marginBottom: 12,
  },
  recordCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  recordHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  recordInfo: {
    flex: 1,
  },
  persNo: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 4,
  },
  employeeName: {
    fontSize: 14,
    color: Colors.text,
    marginBottom: 2,
  },
  designation: {
    fontSize: 13,
    color: Colors.textLight,
  },
  circle: {
    fontSize: 12,
    color: Colors.primary,
    marginTop: 4,
  },
  recordMeta: {
    alignItems: 'flex-end',
    gap: 8,
  },
  ipCountBadge: {
    backgroundColor: '#E3F2FD',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  ipCountText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1565C0',
  },
  ipList: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    gap: 8,
  },
  ipItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.background,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  ipText: {
    fontSize: 14,
    color: Colors.text,
    fontFamily: 'monospace',
  },
  expandToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    marginTop: 12,
  },
  expandToggleText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.primary,
  },
  paginationRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
    marginTop: 16,
    marginBottom: 32,
  },
  pageBtn: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  pageBtnDisabled: {
    backgroundColor: Colors.textLight,
  },
  pageBtnText: {
    color: '#fff',
    fontWeight: '600',
  },
  pageInfo: {
    fontSize: 14,
    color: Colors.textLight,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
  },
  modalSubtext: {
    fontSize: 14,
    color: Colors.textLight,
    marginBottom: 16,
  },
  csvInput: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    padding: 16,
    fontSize: 14,
    color: Colors.text,
    height: 200,
    textAlignVertical: 'top',
    fontFamily: 'monospace',
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 20,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: Colors.background,
    alignItems: 'center',
  },
  cancelBtnText: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.textLight,
  },
  importBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: Colors.primary,
    alignItems: 'center',
  },
  importBtnDisabled: {
    opacity: 0.6,
  },
  importBtnText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  accessDenied: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  accessDeniedText: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 8,
  },
  accessDeniedSubtext: {
    fontSize: 14,
    color: Colors.textLight,
    textAlign: 'center',
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
});
