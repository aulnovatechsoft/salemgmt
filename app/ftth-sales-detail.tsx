import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { ArrowLeft, Wifi, User, MapPin, Calendar, TrendingUp, CheckCircle, Building, AlertTriangle, RefreshCw, Target } from 'lucide-react-native';
import { useAuth } from '@/contexts/auth';
import Colors from '@/constants/colors';
import { trpc } from '@/lib/trpc';
import { useState, useCallback, useMemo } from 'react';

export default function FtthSalesDetailScreen() {
  const router = useRouter();
  const { employee } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  
  const salesQuery = trpc.sales.getByType.useQuery({ 
    type: 'ftth',
    employeeId: employee?.id || '',
    limit: 200
  }, {
    enabled: !!employee?.id
  });
  
  const salesData = salesQuery.data || [];

  const totals = useMemo(() => {
    return {
      leads: salesData.reduce((sum, r) => sum + (r.ftthLeads || 0), 0),
      installed: salesData.reduce((sum, r) => sum + (r.ftthInstalled || 0), 0),
      target: salesData.reduce((sum, r) => sum + (r.ftthTarget || 0), 0)
    };
  }, [salesData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await salesQuery.refetch();
    setRefreshing(false);
  }, [salesQuery]);

  const formatDate = (date: string | Date | null) => {
    if (!date) return '-';
    return new Date(date).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });
  };

  const getStatusColor = (status: string | null) => {
    switch (status) {
      case 'approved': return { bg: '#E8F5E9', text: '#2E7D32' };
      case 'rejected': return { bg: '#FFEBEE', text: '#C62828' };
      case 'submitted': return { bg: '#E3F2FD', text: '#1565C0' };
      default: return { bg: '#FFF3E0', text: '#E65100' };
    }
  };

  return (
    <>
      <Stack.Screen 
        options={{ 
          title: 'FTTH Sales Details',
          headerStyle: { backgroundColor: Colors.light.primary },
          headerTintColor: Colors.light.background,
          headerTitleStyle: { fontWeight: 'bold' as const },
          headerLeft: () => (
            <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
              <ArrowLeft size={24} color={Colors.light.background} />
            </TouchableOpacity>
          ),
        }} 
      />
      
      <ScrollView 
        style={styles.container}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        <View style={styles.summaryCard}>
          <View style={styles.summaryRow}>
            <View style={styles.summaryItem}>
              <View style={[styles.summaryIcon, { backgroundColor: '#E8F5E9' }]}>
                <TrendingUp size={24} color="#2E7D32" />
              </View>
              <Text style={styles.summaryValue}>{totals.leads}</Text>
              <Text style={styles.summaryLabel}>Total Leads</Text>
            </View>
            <View style={styles.summaryDivider} />
            <View style={styles.summaryItem}>
              <View style={[styles.summaryIcon, { backgroundColor: '#E3F2FD' }]}>
                <CheckCircle size={24} color="#1565C0" />
              </View>
              <Text style={styles.summaryValue}>{totals.installed}</Text>
              <Text style={styles.summaryLabel}>Installed</Text>
            </View>
          </View>
          {totals.target > 0 && (
            <View style={styles.targetRow}>
              <Target size={16} color={Colors.light.textSecondary} />
              <Text style={styles.targetText}>Target: {totals.target} | Progress: {totals.target > 0 ? Math.round((totals.leads / totals.target) * 100) : 0}%</Text>
            </View>
          )}
        </View>

        {salesQuery.isLoading && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={Colors.light.primary} />
            <Text style={styles.loadingText}>Loading FTTH data...</Text>
          </View>
        )}

        {salesQuery.isError && (
          <View style={styles.errorState}>
            <AlertTriangle size={48} color={Colors.light.error} />
            <Text style={styles.errorTitle}>Failed to Load Data</Text>
            <Text style={styles.errorSubtitle}>
              {salesQuery.error?.message || 'Something went wrong. Please try again.'}
            </Text>
            <TouchableOpacity style={styles.retryButton} onPress={() => salesQuery.refetch()}>
              <RefreshCw size={18} color={Colors.light.background} />
              <Text style={styles.retryButtonText}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}

        {!salesQuery.isLoading && !salesQuery.isError && salesData.length === 0 && (
          <View style={styles.emptyState}>
            <Wifi size={64} color={Colors.light.textSecondary} />
            <Text style={styles.emptyTitle}>No FTTH Leads Yet</Text>
            <Text style={styles.emptySubtitle}>
              FTTH lead entries will appear here once submitted
            </Text>
          </View>
        )}

        {salesData.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>FTTH Entries ({salesData.length})</Text>
            {salesData.map((sale) => {
              const statusColor = getStatusColor(sale.status);
              const progress = (sale.ftthTarget || 0) > 0 ? Math.round(((sale.ftthLeads || 0) / (sale.ftthTarget || 1)) * 100) : 0;
              return (
                <View key={sale.id} style={styles.saleCard}>
                  <View style={styles.saleHeader}>
                    <View style={styles.saleHeaderLeft}>
                      <View style={styles.quantityBadge}>
                        <Text style={styles.quantityText}>{sale.ftthLeads || 0}</Text>
                        <Text style={styles.quantityLabel}>Leads</Text>
                      </View>
                      {(sale.ftthTarget || 0) > 0 && (
                        <View style={styles.targetBadge}>
                          <Target size={14} color="#1565C0" />
                          <Text style={styles.targetBadgeText}>{sale.ftthTarget} target</Text>
                        </View>
                      )}
                    </View>
                    <View style={[styles.statusBadge, { backgroundColor: statusColor.bg }]}>
                      <Text style={[styles.statusText, { color: statusColor.text }]}>
                        {sale.status || 'Pending'}
                      </Text>
                    </View>
                  </View>

                  {(sale.ftthTarget || 0) > 0 && (
                    <View style={styles.progressContainer}>
                      <View style={styles.progressBar}>
                        <View style={[styles.progressFill, { width: `${Math.min(progress, 100)}%` }]} />
                      </View>
                      <Text style={styles.progressText}>{progress}%</Text>
                    </View>
                  )}

                  <View style={styles.saleDetails}>
                    <View style={styles.detailRow}>
                      <User size={16} color={Colors.light.textSecondary} />
                      <Text style={styles.detailText}>
                        {sale.salesStaffName || 'Unknown'} 
                        {sale.salesStaffDesignation && ` (${sale.salesStaffDesignation})`}
                      </Text>
                    </View>
                    
                    {sale.eventName && (
                      <View style={styles.detailRow}>
                        <Building size={16} color={Colors.light.textSecondary} />
                        <Text style={styles.detailText}>{sale.eventName}</Text>
                      </View>
                    )}
                    
                    {sale.eventLocation && (
                      <View style={styles.detailRow}>
                        <MapPin size={16} color={Colors.light.textSecondary} />
                        <Text style={styles.detailText}>{sale.eventLocation}</Text>
                      </View>
                    )}
                    
                    <View style={styles.detailRow}>
                      <Calendar size={16} color={Colors.light.textSecondary} />
                      <Text style={styles.detailText}>
                        {sale.eventStartDate && sale.eventEndDate 
                          ? `${formatDate(sale.eventStartDate)} - ${formatDate(sale.eventEndDate)}`
                          : formatDate(sale.createdAt)}
                      </Text>
                    </View>

                    {sale.salesStaffCircle && (
                      <View style={styles.circleBadge}>
                        <Text style={styles.circleText}>{sale.salesStaffCircle.replace(/_/g, ' ')}</Text>
                      </View>
                    )}
                  </View>

                  {sale.activatedFtthIds && (sale.activatedFtthIds as string[]).length > 0 && (
                    <View style={styles.ftthIdsSection}>
                      <Text style={styles.ftthIdsTitle}>Installed FTTH IDs:</Text>
                      <View style={styles.ftthIdsGrid}>
                        {(sale.activatedFtthIds as string[]).slice(0, 5).map((id, idx) => (
                          <View key={idx} style={styles.ftthIdChip}>
                            <Wifi size={12} color="#2E7D32" />
                            <Text style={styles.ftthIdText}>{id}</Text>
                          </View>
                        ))}
                        {(sale.activatedFtthIds as string[]).length > 5 && (
                          <View style={styles.ftthIdChip}>
                            <Text style={styles.ftthIdText}>
                              +{(sale.activatedFtthIds as string[]).length - 5} more
                            </Text>
                          </View>
                        )}
                      </View>
                    </View>
                  )}

                  {sale.remarks && (
                    <View style={styles.remarksSection}>
                      <Text style={styles.remarksLabel}>Remarks:</Text>
                      <Text style={styles.remarksText}>{sale.remarks}</Text>
                    </View>
                  )}
                </View>
              );
            })}
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
  backButton: {
    marginLeft: 8,
    padding: 4,
  },
  summaryCard: {
    backgroundColor: Colors.light.card,
    margin: 16,
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  summaryItem: {
    flex: 1,
    alignItems: 'center',
  },
  summaryDivider: {
    width: 1,
    height: 60,
    backgroundColor: '#E0E0E0',
  },
  summaryIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  summaryValue: {
    fontSize: 28,
    fontWeight: 'bold',
    color: Colors.light.text,
  },
  summaryLabel: {
    fontSize: 14,
    color: Colors.light.textSecondary,
    marginTop: 4,
  },
  targetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#E0E0E0',
  },
  targetText: {
    fontSize: 14,
    color: Colors.light.textSecondary,
  },
  loadingContainer: {
    padding: 40,
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    color: Colors.light.textSecondary,
  },
  emptyState: {
    padding: 40,
    alignItems: 'center',
  },
  errorState: {
    padding: 40,
    alignItems: 'center',
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.light.error,
    marginTop: 16,
  },
  errorSubtitle: {
    fontSize: 14,
    color: Colors.light.textSecondary,
    marginTop: 8,
    textAlign: 'center',
    marginBottom: 16,
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.light.primary,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
  },
  retryButtonText: {
    color: Colors.light.background,
    fontSize: 14,
    fontWeight: '600',
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.light.text,
    marginTop: 16,
  },
  emptySubtitle: {
    fontSize: 14,
    color: Colors.light.textSecondary,
    marginTop: 8,
    textAlign: 'center',
  },
  section: {
    padding: 16,
    paddingTop: 0,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.light.text,
    marginBottom: 12,
  },
  saleCard: {
    backgroundColor: Colors.light.card,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  saleHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  saleHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  quantityBadge: {
    backgroundColor: '#E8F5E9',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  quantityText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#2E7D32',
  },
  quantityLabel: {
    fontSize: 11,
    color: '#2E7D32',
    fontWeight: '500',
  },
  targetBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#E3F2FD',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  targetBadgeText: {
    fontSize: 12,
    color: '#1565C0',
    fontWeight: '500',
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  progressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  progressBar: {
    flex: 1,
    height: 8,
    backgroundColor: '#E0E0E0',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#2E7D32',
    borderRadius: 4,
  },
  progressText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#2E7D32',
    width: 40,
  },
  saleDetails: {
    gap: 8,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  detailText: {
    fontSize: 14,
    color: Colors.light.text,
    flex: 1,
  },
  circleBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#FFF3E0',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    marginTop: 4,
  },
  circleText: {
    fontSize: 12,
    color: '#E65100',
    fontWeight: '500',
  },
  ftthIdsSection: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  ftthIdsTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.light.textSecondary,
    marginBottom: 8,
  },
  ftthIdsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  ftthIdChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#E8F5E9',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
  },
  ftthIdText: {
    fontSize: 12,
    color: '#2E7D32',
    fontWeight: '500',
  },
  remarksSection: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  remarksLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.light.textSecondary,
    marginBottom: 4,
  },
  remarksText: {
    fontSize: 14,
    color: Colors.light.text,
    lineHeight: 20,
  },
  bottomSpacer: {
    height: 40,
  },
});
