import { useState, useCallback, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, RefreshControl, ActivityIndicator } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { ChevronLeft, Search, TrendingUp, Users, Target, DollarSign, Award, X, ChevronRight, Filter, AlertCircle } from 'lucide-react-native';
import { useAuth } from '@/contexts/auth';
import ColorsObj from '@/constants/colors';
import { trpc } from '@/lib/trpc';
import { canAccessAdminPanel } from '@/constants/app';

const Colors = {
  ...ColorsObj.light,
  textLight: ColorsObj.light.textSecondary,
};

type SortOption = 'total_lead_value_crore' | 'total_leads' | 'lead_to_bill_crore' | 'total_sales_visit';
type FilterOption = 'all' | 'Yes' | 'No';

export default function KamEbGoldReportScreen() {
  const router = useRouter();
  const { employee } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(0);
  const [sortBy, setSortBy] = useState<SortOption>('total_lead_value_crore');
  const [ebExclusiveFilter, setEbExclusiveFilter] = useState<FilterOption>('all');
  const [showFilters, setShowFilters] = useState(false);
  const pageSize = 50;
  
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasAccess = employee?.role && canAccessAdminPanel(employee.role);

  const { data: summary, refetch: refetchSummary, isError: summaryError } = trpc.admin.getKamEbGoldSummary.useQuery(
    { userId: employee?.id || '' },
    { 
      enabled: !!employee?.id && !!hasAccess,
      staleTime: 30000,
      retry: 2,
    }
  );
  
  const { data: reportData, isLoading, refetch, isError: reportError } = trpc.admin.getKamEbGoldReport.useQuery({
    userId: employee?.id || '',
    search: debouncedSearch,
    ebExclusive: ebExclusiveFilter,
    sortBy,
    sortOrder: 'desc',
    limit: pageSize,
    offset: page * pageSize,
  }, { 
    enabled: !!employee?.id && !!hasAccess,
    staleTime: 10000,
    retry: 2,
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

  const formatCrore = (value: number) => {
    if (value >= 100) return `${value.toFixed(0)} Cr`;
    if (value >= 10) return `${value.toFixed(1)} Cr`;
    return `${value.toFixed(2)} Cr`;
  };

  const navigateToProfile = (persNo: string) => {
    router.push(`/kam-eb-gold-profile?persNo=${persNo}` as any);
  };

  if (!hasAccess) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <ChevronLeft size={24} color={Colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>KAM EB Gold Report</Text>
          <View style={{ width: 40 }} />
        </View>
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

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <ChevronLeft size={24} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>KAM EB Gold Report</Text>
        <TouchableOpacity style={styles.filterBtn} onPress={() => setShowFilters(!showFilters)}>
          <Filter size={20} color={showFilters ? Colors.primary : Colors.text} />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      >
        <View style={styles.summaryGrid}>
          <View style={styles.summaryCard}>
            <View style={[styles.summaryIcon, { backgroundColor: '#E3F2FD' }]}>
              <Users size={18} color="#1565C0" />
            </View>
            <Text style={styles.summaryValue}>{summary?.totalPersonnel || 0}</Text>
            <Text style={styles.summaryLabel}>Personnel</Text>
          </View>
          
          <View style={styles.summaryCard}>
            <View style={[styles.summaryIcon, { backgroundColor: '#FFF3E0' }]}>
              <Target size={18} color="#EF6C00" />
            </View>
            <Text style={styles.summaryValue}>{(summary?.totalLeads || 0).toLocaleString()}</Text>
            <Text style={styles.summaryLabel}>Total Leads</Text>
          </View>
          
          <View style={styles.summaryCard}>
            <View style={[styles.summaryIcon, { backgroundColor: '#E8F5E9' }]}>
              <DollarSign size={18} color="#2E7D32" />
            </View>
            <Text style={styles.summaryValue}>{formatCrore(summary?.totalLeadValueCrore || 0)}</Text>
            <Text style={styles.summaryLabel}>Lead Value</Text>
          </View>
          
          <View style={styles.summaryCard}>
            <View style={[styles.summaryIcon, { backgroundColor: '#F3E5F5' }]}>
              <TrendingUp size={18} color="#7B1FA2" />
            </View>
            <Text style={styles.summaryValue}>{formatCrore(summary?.leadToBillCrore || 0)}</Text>
            <Text style={styles.summaryLabel}>Lead to Bill</Text>
          </View>
        </View>

        <View style={styles.searchContainer}>
          <Search size={18} color={Colors.textLight} style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search by Pers No or Name..."
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

        {showFilters && (
          <View style={styles.filtersContainer}>
            <Text style={styles.filterTitle}>EB Exclusive:</Text>
            <View style={styles.filterRow}>
              {(['all', 'Yes', 'No'] as FilterOption[]).map((option) => (
                <TouchableOpacity
                  key={option}
                  style={[styles.filterChip, ebExclusiveFilter === option && styles.filterChipActive]}
                  onPress={() => { setEbExclusiveFilter(option); setPage(0); }}
                >
                  <Text style={[styles.filterChipText, ebExclusiveFilter === option && styles.filterChipTextActive]}>
                    {option === 'all' ? 'All' : option}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            
            <Text style={[styles.filterTitle, { marginTop: 12 }]}>Sort By:</Text>
            <View style={styles.filterRow}>
              <TouchableOpacity
                style={[styles.filterChip, sortBy === 'total_lead_value_crore' && styles.filterChipActive]}
                onPress={() => setSortBy('total_lead_value_crore')}
              >
                <Text style={[styles.filterChipText, sortBy === 'total_lead_value_crore' && styles.filterChipTextActive]}>
                  Lead Value
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.filterChip, sortBy === 'total_leads' && styles.filterChipActive]}
                onPress={() => setSortBy('total_leads')}
              >
                <Text style={[styles.filterChipText, sortBy === 'total_leads' && styles.filterChipTextActive]}>
                  Leads
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.filterChip, sortBy === 'lead_to_bill_crore' && styles.filterChipActive]}
                onPress={() => setSortBy('lead_to_bill_crore')}
              >
                <Text style={[styles.filterChipText, sortBy === 'lead_to_bill_crore' && styles.filterChipTextActive]}>
                  Lead to Bill
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {(summaryError || reportError) ? (
          <View style={styles.errorContainer}>
            <AlertCircle size={48} color="#D32F2F" />
            <Text style={styles.errorText}>Failed to load data</Text>
            <Text style={styles.errorSubtext}>Please check your connection and try again.</Text>
            <TouchableOpacity style={styles.retryButton} onPress={handleRefresh}>
              <Text style={styles.retryButtonText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={Colors.primary} />
            <Text style={styles.loadingText}>Loading...</Text>
          </View>
        ) : !reportData?.records?.length ? (
          <View style={styles.emptyContainer}>
            <Award size={48} color={Colors.textLight} />
            <Text style={styles.emptyText}>No records found</Text>
            {(debouncedSearch || ebExclusiveFilter !== 'all') && (
              <Text style={styles.emptySubtext}>Try adjusting your search or filters.</Text>
            )}
          </View>
        ) : (
          <>
            <Text style={styles.resultCount}>
              Showing {reportData.records.length} of {reportData.total} records
            </Text>
            
            {reportData.records.map((record) => {
              const CardWrapper = record.hasRegisteredEmployee ? TouchableOpacity : View;
              const cardProps = record.hasRegisteredEmployee 
                ? { onPress: () => navigateToProfile(record.persNo) }
                : {};
              
              return (
                <CardWrapper
                  key={record.id}
                  style={[styles.recordCard, !record.hasRegisteredEmployee && styles.recordCardDisabled]}
                  {...cardProps}
                >
                  <View style={styles.recordHeader}>
                    <View style={styles.recordInfo}>
                      <View style={styles.nameRow}>
                        <Text style={styles.persNo}>{record.persNo}</Text>
                        {record.ebExclusive === 'Yes' && (
                          <View style={styles.ebBadge}>
                            <Text style={styles.ebBadgeText}>EB</Text>
                          </View>
                        )}
                      </View>
                      {record.employeeName && (
                        <Text style={styles.employeeName}>{record.employeeName}</Text>
                      )}
                      {record.designation && (
                        <Text style={styles.designation}>{record.designation}</Text>
                      )}
                      {!record.hasRegisteredEmployee && (
                        <Text style={styles.notRegistered}>Not registered</Text>
                      )}
                    </View>
                    {record.hasRegisteredEmployee && (
                      <ChevronRight size={20} color={Colors.textLight} />
                    )}
                  </View>
                  
                  <View style={styles.metricsRow}>
                    <View style={styles.metric}>
                      <Text style={styles.metricValue}>{record.totalLeads}</Text>
                      <Text style={styles.metricLabel}>Leads</Text>
                    </View>
                    <View style={styles.metric}>
                      <Text style={[styles.metricValue, { color: '#2E7D32' }]}>
                        {formatCrore(record.totalLeadValueCrore)}
                      </Text>
                      <Text style={styles.metricLabel}>Value</Text>
                    </View>
                    <View style={styles.metric}>
                      <Text style={[styles.metricValue, { color: '#1565C0' }]}>
                        {formatCrore(record.leadInStageIvCrore)}
                      </Text>
                      <Text style={styles.metricLabel}>Stage IV</Text>
                    </View>
                    <View style={styles.metric}>
                      <Text style={[styles.metricValue, { color: '#7B1FA2' }]}>
                        {formatCrore(record.leadToBillCrore)}
                      </Text>
                      <Text style={styles.metricLabel}>To Bill</Text>
                    </View>
                  </View>
                </CardWrapper>
              );
            })}

            {(reportData?.hasMore || page > 0) && (
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
                  style={[styles.pageBtn, !reportData?.hasMore && styles.pageBtnDisabled]}
                  onPress={() => setPage(page + 1)}
                  disabled={!reportData?.hasMore}
                >
                  <Text style={styles.pageBtnText}>Next</Text>
                </TouchableOpacity>
              </View>
            )}
          </>
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
    flex: 1,
    textAlign: 'center',
  },
  filterBtn: {
    padding: 8,
  },
  content: {
    flex: 1,
    padding: 16,
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 16,
  },
  summaryCard: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  summaryIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  summaryValue: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.text,
  },
  summaryLabel: {
    fontSize: 11,
    color: Colors.textLight,
    marginTop: 2,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 16,
    marginBottom: 12,
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
  filtersContainer: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  filterTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.text,
    marginBottom: 8,
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  filterChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  filterChipText: {
    fontSize: 13,
    color: Colors.text,
  },
  filterChipTextActive: {
    color: '#fff',
    fontWeight: '600',
  },
  loadingContainer: {
    padding: 40,
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    color: Colors.textLight,
  },
  errorContainer: {
    padding: 40,
    alignItems: 'center',
  },
  errorText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#D32F2F',
    marginTop: 16,
  },
  errorSubtext: {
    fontSize: 14,
    color: Colors.textLight,
    textAlign: 'center',
    marginTop: 8,
  },
  retryButton: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
    marginTop: 20,
  },
  retryButtonText: {
    color: '#fff',
    fontWeight: '600',
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
    fontSize: 13,
    color: Colors.textLight,
    textAlign: 'center',
    marginTop: 8,
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
  recordCardDisabled: {
    opacity: 0.7,
    backgroundColor: '#f8f8f8',
  },
  notRegistered: {
    fontSize: 11,
    color: '#999',
    fontStyle: 'italic',
    marginTop: 4,
  },
  recordHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  recordInfo: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  persNo: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.text,
  },
  ebBadge: {
    backgroundColor: '#FFD700',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  ebBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#5D4E00',
  },
  employeeName: {
    fontSize: 14,
    color: Colors.text,
    marginTop: 4,
  },
  designation: {
    fontSize: 13,
    color: Colors.textLight,
    marginTop: 2,
  },
  metricsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  metric: {
    alignItems: 'center',
    flex: 1,
  },
  metricValue: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.text,
  },
  metricLabel: {
    fontSize: 10,
    color: Colors.textLight,
    marginTop: 2,
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
