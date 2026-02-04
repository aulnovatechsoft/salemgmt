import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { ArrowLeft, IndianRupee, User, MapPin, Calendar, TrendingUp, Building, AlertTriangle, RefreshCw, CreditCard, FileText, Phone } from 'lucide-react-native';
import { useAuth } from '@/contexts/auth';
import Colors from '@/constants/colors';
import { trpc } from '@/lib/trpc';
import { useState, useCallback, useMemo } from 'react';

const FINANCE_TYPE_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  FIN_LC: { label: 'LC Collection', color: '#00838F', bg: '#E0F7FA' },
  FIN_LL_FTTH: { label: 'LL/FTTH Collection', color: '#00695C', bg: '#E0F2F1' },
  FIN_TOWER: { label: 'Tower Collection', color: '#4527A0', bg: '#EDE7F6' },
  FIN_GSM_POSTPAID: { label: 'GSM PostPaid Collection', color: '#AD1457', bg: '#FCE4EC' },
  FIN_RENT_BUILDING: { label: 'Building Rent Collection', color: '#6D4C41', bg: '#EFEBE9' },
};

const PAYMENT_MODE_LABELS: Record<string, string> = {
  CASH: 'Cash',
  CHEQUE: 'Cheque',
  NEFT: 'NEFT/RTGS',
  UPI: 'UPI',
  CARD: 'Card',
  DD: 'Demand Draft',
  OTHER: 'Other',
};

export default function FinanceCollectionDetailScreen() {
  const router = useRouter();
  const { employee } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  
  const collectionsQuery = trpc.sales.getFinanceCollections.useQuery({ 
    employeeId: employee?.id || '',
    limit: 200
  }, {
    enabled: !!employee?.id
  });
  
  const summaryQuery = trpc.sales.getFinanceSummary.useQuery({
    employeeId: employee?.id || '',
  }, {
    enabled: !!employee?.id
  });
  
  const collectionsData = collectionsQuery.data || [];
  const summaryData = summaryQuery.data;

  const totals = useMemo(() => {
    return {
      collected: summaryData?.totalCollected || 0,
      entries: summaryData?.entries || 0,
    };
  }, [summaryData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      collectionsQuery.refetch(),
      summaryQuery.refetch()
    ]);
    setRefreshing(false);
  }, [collectionsQuery, summaryQuery]);

  const formatDate = (date: string | Date | null) => {
    if (!date) return '-';
    return new Date(date).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });
  };

  const formatAmount = (amount: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const getTypeConfig = (type: string) => {
    return FINANCE_TYPE_CONFIG[type] || { label: type, color: '#00838F', bg: '#E0F7FA' };
  };

  return (
    <>
      <Stack.Screen 
        options={{ 
          title: 'Finance Collections',
          headerStyle: { backgroundColor: '#00838F' },
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
              <View style={[styles.summaryIcon, { backgroundColor: '#E0F7FA' }]}>
                <IndianRupee size={24} color="#00838F" />
              </View>
              <Text style={styles.summaryValue}>{formatAmount(totals.collected)}</Text>
              <Text style={styles.summaryLabel}>Total Collected</Text>
            </View>
            <View style={styles.summaryDivider} />
            <View style={styles.summaryItem}>
              <View style={[styles.summaryIcon, { backgroundColor: '#E8F5E9' }]}>
                <FileText size={24} color="#2E7D32" />
              </View>
              <Text style={styles.summaryValue}>{totals.entries}</Text>
              <Text style={styles.summaryLabel}>Entries</Text>
            </View>
          </View>
          
          {summaryData?.byType && Object.keys(summaryData.byType).length > 0 && (
            <View style={styles.typeBreakdown}>
              <Text style={styles.breakdownTitle}>Collection by Type</Text>
              {Object.entries(summaryData.byType).map(([type, data]: [string, any]) => {
                const config = getTypeConfig(type);
                const progress = data.target > 0 ? Math.round((data.totalCollected / data.target) * 100) : 0;
                return (
                  <View key={type} style={styles.breakdownItem}>
                    <View style={styles.breakdownRow}>
                      <View style={[styles.breakdownDot, { backgroundColor: config.color }]} />
                      <Text style={styles.breakdownLabel}>{config.label}</Text>
                      <Text style={styles.breakdownValue}>{formatAmount(data.totalCollected)}</Text>
                    </View>
                    {data.target > 0 && (
                      <View style={styles.breakdownProgress}>
                        <View style={styles.breakdownProgressBar}>
                          <View style={[styles.breakdownProgressFill, { width: `${Math.min(progress, 100)}%`, backgroundColor: config.color }]} />
                        </View>
                        <Text style={styles.breakdownProgressText}>{progress}% of {formatAmount(data.target)}</Text>
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          )}
          
          {summaryData && summaryData.totalTarget && summaryData.totalTarget > 0 && (
            <View style={styles.overallProgress}>
              <Text style={styles.overallProgressLabel}>Overall Progress</Text>
              <View style={styles.overallProgressBar}>
                <View style={[styles.overallProgressFill, { width: `${Math.min(Math.round(((summaryData.totalCollected || 0) / summaryData.totalTarget) * 100), 100)}%` }]} />
              </View>
              <Text style={styles.overallProgressText}>
                {Math.round(((summaryData.totalCollected || 0) / summaryData.totalTarget) * 100)}% of {formatAmount(summaryData.totalTarget)} target
              </Text>
            </View>
          )}
        </View>

        {(collectionsQuery.isLoading || summaryQuery.isLoading) && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#00838F" />
            <Text style={styles.loadingText}>Loading collection data...</Text>
          </View>
        )}

        {collectionsQuery.isError && (
          <View style={styles.errorState}>
            <AlertTriangle size={48} color={Colors.light.error} />
            <Text style={styles.errorTitle}>Failed to Load Data</Text>
            <Text style={styles.errorSubtitle}>
              {collectionsQuery.error?.message || 'Something went wrong. Please try again.'}
            </Text>
            <TouchableOpacity style={styles.retryButton} onPress={() => collectionsQuery.refetch()}>
              <RefreshCw size={18} color={Colors.light.background} />
              <Text style={styles.retryButtonText}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}

        {!collectionsQuery.isLoading && !collectionsQuery.isError && collectionsData.length === 0 && (
          <View style={styles.emptyState}>
            <IndianRupee size={64} color={Colors.light.textSecondary} />
            <Text style={styles.emptyTitle}>No Collections Yet</Text>
            <Text style={styles.emptySubtitle}>
              Finance collection entries will appear here once submitted
            </Text>
          </View>
        )}

        {collectionsData.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Collection Entries ({collectionsData.length})</Text>
            {collectionsData.map((entry) => {
              const typeConfig = getTypeConfig(entry.financeType);
              return (
                <View key={entry.id} style={styles.entryCard}>
                  <View style={styles.entryHeader}>
                    <View style={styles.entryHeaderLeft}>
                      <View style={[styles.amountBadge, { backgroundColor: typeConfig.bg }]}>
                        <IndianRupee size={16} color={typeConfig.color} />
                        <Text style={[styles.amountText, { color: typeConfig.color }]}>
                          {formatAmount(entry.amountCollected)}
                        </Text>
                      </View>
                    </View>
                    <View style={[styles.typeBadge, { backgroundColor: typeConfig.bg }]}>
                      <Text style={[styles.typeText, { color: typeConfig.color }]}>
                        {typeConfig.label}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.entryDetails}>
                    <View style={styles.detailRow}>
                      <CreditCard size={16} color={Colors.light.textSecondary} />
                      <Text style={styles.detailText}>
                        {PAYMENT_MODE_LABELS[entry.paymentMode] || entry.paymentMode}
                        {entry.transactionReference && ` - ${entry.transactionReference}`}
                      </Text>
                    </View>
                    
                    <View style={styles.detailRow}>
                      <User size={16} color={Colors.light.textSecondary} />
                      <Text style={styles.detailText}>
                        {entry.employeeName || 'Unknown'} 
                        {entry.employeeDesignation && ` (${entry.employeeDesignation})`}
                      </Text>
                    </View>
                    
                    {entry.customerName && (
                      <View style={styles.detailRow}>
                        <Phone size={16} color={Colors.light.textSecondary} />
                        <Text style={styles.detailText}>
                          Customer: {entry.customerName}
                          {entry.customerContact && ` - ${entry.customerContact}`}
                        </Text>
                      </View>
                    )}
                    
                    {entry.eventName && (
                      <View style={styles.detailRow}>
                        <Building size={16} color={Colors.light.textSecondary} />
                        <Text style={styles.detailText}>{entry.eventName}</Text>
                      </View>
                    )}
                    
                    {entry.eventLocation && (
                      <View style={styles.detailRow}>
                        <MapPin size={16} color={Colors.light.textSecondary} />
                        <Text style={styles.detailText}>{entry.eventLocation}</Text>
                      </View>
                    )}
                    
                    <View style={styles.detailRow}>
                      <Calendar size={16} color={Colors.light.textSecondary} />
                      <Text style={styles.detailText}>
                        {entry.eventStartDate && entry.eventEndDate 
                          ? `${formatDate(entry.eventStartDate)} - ${formatDate(entry.eventEndDate)}`
                          : formatDate(entry.createdAt)}
                      </Text>
                    </View>

                    {entry.employeeCircle && (
                      <View style={styles.circleBadge}>
                        <Text style={styles.circleText}>{entry.employeeCircle.replace(/_/g, ' ')}</Text>
                      </View>
                    )}
                  </View>

                  {entry.remarks && (
                    <View style={styles.remarksSection}>
                      <Text style={styles.remarksLabel}>Remarks:</Text>
                      <Text style={styles.remarksText}>{entry.remarks}</Text>
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
    fontSize: 22,
    fontWeight: 'bold',
    color: Colors.light.text,
  },
  summaryLabel: {
    fontSize: 14,
    color: Colors.light.textSecondary,
    marginTop: 4,
  },
  typeBreakdown: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#E0E0E0',
  },
  breakdownTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.light.textSecondary,
    marginBottom: 12,
  },
  breakdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  breakdownDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  breakdownLabel: {
    flex: 1,
    fontSize: 13,
    color: Colors.light.text,
  },
  breakdownValue: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.light.text,
  },
  breakdownItem: {
    marginBottom: 12,
  },
  breakdownProgress: {
    marginLeft: 16,
    marginTop: 4,
  },
  breakdownProgressBar: {
    height: 6,
    backgroundColor: '#E0E0E0',
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 4,
  },
  breakdownProgressFill: {
    height: '100%',
    borderRadius: 3,
  },
  breakdownProgressText: {
    fontSize: 11,
    color: Colors.light.textSecondary,
  },
  overallProgress: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#E0E0E0',
  },
  overallProgressLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.light.textSecondary,
    marginBottom: 8,
  },
  overallProgressBar: {
    height: 8,
    backgroundColor: '#E0E0E0',
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 6,
  },
  overallProgressFill: {
    height: '100%',
    backgroundColor: '#00838F',
    borderRadius: 4,
  },
  overallProgressText: {
    fontSize: 12,
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
    backgroundColor: '#00838F',
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
  entryCard: {
    backgroundColor: Colors.light.card,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  entryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  entryHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  amountBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  amountText: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  typeBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  typeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  entryDetails: {
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
