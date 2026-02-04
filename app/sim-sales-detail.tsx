import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { ArrowLeft, Phone, User, MapPin, Calendar, TrendingUp, CheckCircle, Building, AlertTriangle, RefreshCw, Target } from 'lucide-react-native';
import { useAuth } from '@/contexts/auth';
import Colors from '@/constants/colors';
import { trpc } from '@/lib/trpc';
import { useState, useCallback, useMemo } from 'react';

export default function SimSalesDetailScreen() {
  const router = useRouter();
  const { employee } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  
  const salesQuery = trpc.sales.getByType.useQuery({ 
    type: 'sim',
    employeeId: employee?.id || '',
    limit: 200
  }, {
    enabled: !!employee?.id
  });
  
  const salesData = salesQuery.data || [];

  const totals = useMemo(() => {
    return {
      sold: salesData.reduce((sum, r) => sum + (r.simsSold || 0), 0),
      activated: salesData.reduce((sum, r) => sum + (r.simsActivated || 0), 0),
      target: salesData.reduce((sum, r) => sum + (r.simTarget || 0), 0)
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
      default: return { bg: '#FFF3E0', text: '#E65100' };
    }
  };

  return (
    <>
      <Stack.Screen 
        options={{ 
          title: 'SIM Sales Details',
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
              <View style={[styles.summaryIcon, { backgroundColor: '#E3F2FD' }]}>
                <TrendingUp size={24} color="#1976D2" />
              </View>
              <Text style={styles.summaryValue}>{totals.sold}</Text>
              <Text style={styles.summaryLabel}>Total Sold</Text>
            </View>
            <View style={styles.summaryDivider} />
            <View style={styles.summaryItem}>
              <View style={[styles.summaryIcon, { backgroundColor: '#E8F5E9' }]}>
                <Target size={24} color="#2E7D32" />
              </View>
              <Text style={styles.summaryValue}>{totals.target}</Text>
              <Text style={styles.summaryLabel}>Target</Text>
            </View>
          </View>
          {totals.target > 0 && (
            <View style={styles.targetRow}>
              <View style={styles.overallProgressContainer}>
                <View style={styles.overallProgressBar}>
                  <View style={[styles.overallProgressFill, { width: `${Math.min(Math.round((totals.sold / totals.target) * 100), 100)}%` }]} />
                </View>
                <Text style={styles.overallProgressText}>
                  {Math.round((totals.sold / totals.target) * 100)}% achieved
                </Text>
              </View>
            </View>
          )}
        </View>

        {salesQuery.isLoading && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={Colors.light.primary} />
            <Text style={styles.loadingText}>Loading sales data...</Text>
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
            <Phone size={64} color={Colors.light.textSecondary} />
            <Text style={styles.emptyTitle}>No SIM Sales Yet</Text>
            <Text style={styles.emptySubtitle}>
              SIM sales entries will appear here once submitted
            </Text>
          </View>
        )}

        {salesData.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Sales Entries ({salesData.length})</Text>
            {salesData.map((sale) => {
              const statusColor = getStatusColor(sale.status);
              const progress = (sale.simTarget || 0) > 0 ? Math.round(((sale.simsSold || 0) / (sale.simTarget || 1)) * 100) : 0;
              return (
                <View key={sale.id} style={styles.saleCard}>
                  <View style={styles.saleHeader}>
                    <View style={styles.saleHeaderLeft}>
                      <View style={styles.quantityBadge}>
                        <Text style={styles.quantityText}>{sale.simsSold}</Text>
                        <Text style={styles.quantityLabel}>SIMs Sold</Text>
                      </View>
                      {(sale.simTarget || 0) > 0 && (
                        <View style={styles.targetBadge}>
                          <Target size={14} color="#1565C0" />
                          <Text style={styles.targetBadgeText}>{sale.simTarget} target</Text>
                        </View>
                      )}
                    </View>
                    <View style={[styles.statusBadge, { backgroundColor: statusColor.bg }]}>
                      <Text style={[styles.statusText, { color: statusColor.text }]}>
                        {sale.status || 'Pending'}
                      </Text>
                    </View>
                  </View>

                  {(sale.simTarget || 0) > 0 && (
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

                  {sale.activatedMobileNumbers && (sale.activatedMobileNumbers as string[]).length > 0 && (
                    <View style={styles.mobileNumbersSection}>
                      <Text style={styles.mobileNumbersTitle}>Activated Numbers:</Text>
                      <View style={styles.mobileNumbersGrid}>
                        {(sale.activatedMobileNumbers as string[]).slice(0, 5).map((num, idx) => (
                          <View key={idx} style={styles.mobileNumberChip}>
                            <Phone size={12} color={Colors.light.primary} />
                            <Text style={styles.mobileNumberText}>{num}</Text>
                          </View>
                        ))}
                        {(sale.activatedMobileNumbers as string[]).length > 5 && (
                          <View style={styles.mobileNumberChip}>
                            <Text style={styles.mobileNumberText}>
                              +{(sale.activatedMobileNumbers as string[]).length - 5} more
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
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#E0E0E0',
  },
  overallProgressContainer: {
    width: '100%',
  },
  overallProgressBar: {
    height: 8,
    backgroundColor: '#E0E0E0',
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 8,
  },
  overallProgressFill: {
    height: '100%',
    backgroundColor: '#1976D2',
    borderRadius: 4,
  },
  overallProgressText: {
    fontSize: 14,
    color: Colors.light.textSecondary,
    textAlign: 'center',
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
    backgroundColor: '#E3F2FD',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  quantityText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1976D2',
  },
  quantityLabel: {
    fontSize: 11,
    color: '#1976D2',
    fontWeight: '500',
  },
  activatedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#E8F5E9',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  activatedText: {
    fontSize: 12,
    color: '#2E7D32',
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
    backgroundColor: '#1976D2',
    borderRadius: 4,
  },
  progressText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1976D2',
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
  customerTypeBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#F3E5F5',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    marginTop: 4,
  },
  customerTypeText: {
    fontSize: 12,
    color: '#7B1FA2',
    fontWeight: '500',
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
  mobileNumbersSection: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  mobileNumbersTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.light.textSecondary,
    marginBottom: 8,
  },
  mobileNumbersGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  mobileNumberChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#E3F2FD',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
  },
  mobileNumberText: {
    fontSize: 12,
    color: Colors.light.primary,
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
