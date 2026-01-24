import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Plus, TrendingUp, Target, Calendar, MapPin, ClipboardCheck, ChevronRight, Clock, CheckCircle, XCircle } from 'lucide-react-native';
import { useAuth } from '@/contexts/auth';
import { useApp } from '@/contexts/app';
import Colors from '@/constants/colors';
import { useMemo } from 'react';
import { SalesReport, SalesReportStatus } from '@/types';
import { trpc } from '@/lib/trpc';

export default function SalesScreen() {
  const router = useRouter();
  const { employee } = useAuth();
  const { events } = useApp();
  
  const salesQuery = trpc.sales.getAll.useQuery({});
  const salesReports = salesQuery.data || [];

  const isManager = employee && ['GM', 'CGM', 'DGM', 'AGM', 'SD_JTO'].includes(employee.role);

  const mySalesReports = useMemo(() => {
    if (employee?.role === 'SALES_STAFF') {
      return salesReports.filter(r => r.salesStaffId === employee.id);
    }
    return salesReports;
  }, [salesReports, employee]);

  const pendingCount = useMemo(() => {
    return salesReports.filter(r => r.status === 'pending').length;
  }, [salesReports]);

  const statusCounts = useMemo(() => {
    return mySalesReports.reduce((acc, report) => {
      const status = report.status || 'pending';
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
  }, [mySalesReports]);

  const totalStats = useMemo(() => {
    return mySalesReports.reduce((acc, report) => ({
      simsSold: acc.simsSold + report.simsSold,
      simsActivated: acc.simsActivated + report.simsActivated,
      ftthLeads: acc.ftthLeads + report.ftthLeads,
      ftthInstalled: acc.ftthInstalled + report.ftthInstalled,
    }), { simsSold: 0, simsActivated: 0, ftthLeads: 0, ftthInstalled: 0 });
  }, [mySalesReports]);

  return (
    <>
      <Stack.Screen 
        options={{ 
          title: 'Sales',
          headerStyle: {
            backgroundColor: Colors.light.primary,
          },
          headerTintColor: Colors.light.background,
          headerTitleStyle: {
            fontWeight: 'bold' as const,
          },
          headerShown: true,
          headerRight: () => (
            employee?.role === 'SALES_STAFF' ? (
              <TouchableOpacity 
                onPress={() => router.push('/submit-sales')}
                style={styles.headerButton}
              >
                <Plus size={24} color={Colors.light.background} />
              </TouchableOpacity>
            ) : null
          ),
        }} 
      />
      <ScrollView style={styles.container}>
        {isManager && pendingCount > 0 && (
          <TouchableOpacity 
            style={styles.approvalBanner}
            onPress={() => router.push('/sales-approval')}
          >
            <View style={styles.approvalBannerLeft}>
              <View style={styles.approvalIconContainer}>
                <ClipboardCheck size={24} color="#fff" />
              </View>
              <View>
                <Text style={styles.approvalBannerTitle}>{pendingCount} Reports Pending Approval</Text>
                <Text style={styles.approvalBannerSubtitle}>Review and approve sales reports</Text>
              </View>
            </View>
            <ChevronRight size={24} color="#fff" />
          </TouchableOpacity>
        )}

        {isManager && pendingCount === 0 && (
          <TouchableOpacity 
            style={[styles.approvalBanner, styles.approvalBannerGreen]}
            onPress={() => router.push('/sales-approval')}
          >
            <View style={styles.approvalBannerLeft}>
              <View style={[styles.approvalIconContainer, styles.approvalIconGreen]}>
                <CheckCircle size={24} color="#fff" />
              </View>
              <View>
                <Text style={styles.approvalBannerTitle}>All Reports Reviewed</Text>
                <Text style={styles.approvalBannerSubtitle}>View approval history</Text>
              </View>
            </View>
            <ChevronRight size={24} color="#fff" />
          </TouchableOpacity>
        )}
        <View style={styles.statsContainer}>
          <View style={styles.statCard}>
            <TrendingUp size={24} color={Colors.light.success} />
            <Text style={styles.statValue}>{totalStats.simsSold}</Text>
            <Text style={styles.statLabel}>SIMs Sold</Text>
            <Text style={styles.statSubtitle}>{totalStats.simsActivated} activated</Text>
          </View>
          <View style={styles.statCard}>
            <Target size={24} color={Colors.light.info} />
            <Text style={styles.statValue}>{totalStats.ftthLeads}</Text>
            <Text style={styles.statLabel}>FTTH Leads</Text>
            <Text style={styles.statSubtitle}>{totalStats.ftthInstalled} installed</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Recent Sales Reports</Text>
          {mySalesReports.length > 0 ? (
            mySalesReports.map(report => {
              const event = events.find(e => e.id === report.eventId);
              return <SalesReportCard key={report.id} report={{...report, photos: report.photos || [], remarks: report.remarks || '', createdAt: report.createdAt instanceof Date ? report.createdAt.toISOString() : report.createdAt, synced: report.synced ?? false, status: (report.status || 'pending') as SalesReportStatus, reviewedBy: report.reviewedBy ?? undefined, reviewedAt: report.reviewedAt ? (report.reviewedAt instanceof Date ? report.reviewedAt.toISOString() : report.reviewedAt) : undefined, reviewRemarks: report.reviewRemarks ?? undefined, salesStaffName: report.salesStaffName ?? undefined, eventName: report.eventName ?? undefined}} event={event} />;
            })
          ) : (
            <View style={styles.emptyState}>
              <TrendingUp size={64} color={Colors.light.textSecondary} />
              <Text style={styles.emptyTitle}>No Sales Reports</Text>
              <Text style={styles.emptySubtitle}>
                {employee?.role === 'SALES_STAFF'
                  ? 'Tap the + button to submit your first sales report'
                  : 'Sales reports will appear here once submitted'}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.bottomSpacer} />
      </ScrollView>
    </>
  );
}

function StatusBadge({ status }: { status: string }) {
  const config = {
    pending: { bg: '#FFF3E0', color: Colors.light.warning, icon: Clock, text: 'Pending' },
    approved: { bg: '#E8F5E9', color: Colors.light.success, icon: CheckCircle, text: 'Approved' },
    rejected: { bg: '#FFEBEE', color: Colors.light.error, icon: XCircle, text: 'Rejected' },
  }[status] || { bg: '#FFF3E0', color: Colors.light.warning, icon: Clock, text: 'Pending' };

  const IconComponent = config.icon;

  return (
    <View style={[styles.statusBadge, { backgroundColor: config.bg }]}>
      <IconComponent size={12} color={config.color} />
      <Text style={[styles.statusText, { color: config.color }]}>{config.text}</Text>
    </View>
  );
}

function SalesReportCard({ report, event }: { report: SalesReport; event?: any }) {
  return (
    <View style={styles.reportCard}>
      <View style={styles.reportHeader}>
        <View style={styles.reportHeaderLeft}>
          <Calendar size={16} color={Colors.light.textSecondary} />
          <Text style={styles.reportDate}>
            {new Date(report.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
          </Text>
        </View>
        <StatusBadge status={report.status || 'pending'} />
      </View>

      {event && (
        <View style={styles.eventInfo}>
          <MapPin size={14} color={Colors.light.textSecondary} />
          <Text style={styles.eventName}>{event.name} - {event.location}</Text>
        </View>
      )}

      <View style={styles.reportStats}>
        <View style={styles.reportStatItem}>
          <Text style={styles.reportStatLabel}>SIMs</Text>
          <Text style={styles.reportStatValue}>{report.simsSold}</Text>
          <Text style={styles.reportStatSubtitle}>{report.simsActivated} activated</Text>
        </View>
        <View style={styles.reportStatItem}>
          <Text style={styles.reportStatLabel}>FTTH</Text>
          <Text style={styles.reportStatValue}>{report.ftthLeads}</Text>
          <Text style={styles.reportStatSubtitle}>{report.ftthInstalled} installed</Text>
        </View>
        <View style={styles.reportStatItem}>
          <Text style={styles.reportStatLabel}>Type</Text>
          <Text style={styles.reportStatValue}>{report.customerType}</Text>
        </View>
      </View>

      {report.remarks && (
        <View style={styles.remarks}>
          <Text style={styles.remarksLabel}>Remarks:</Text>
          <Text style={styles.remarksText}>{report.remarks}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.light.backgroundSecondary,
  },
  headerButton: {
    marginRight: 16,
  },
  statsContainer: {
    flexDirection: 'row',
    padding: 16,
    gap: 12,
  },
  statCard: {
    flex: 1,
    backgroundColor: Colors.light.card,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  statValue: {
    fontSize: 32,
    fontWeight: 'bold' as const,
    color: Colors.light.text,
    marginTop: 8,
  },
  statLabel: {
    fontSize: 14,
    color: Colors.light.textSecondary,
    fontWeight: '600' as const,
    marginTop: 4,
  },
  statSubtitle: {
    fontSize: 12,
    color: Colors.light.textSecondary,
    marginTop: 2,
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
  reportCard: {
    backgroundColor: Colors.light.card,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  reportHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  reportHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  reportDate: {
    fontSize: 14,
    color: Colors.light.textSecondary,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600' as const,
  },
  approvalBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.light.warning,
    marginHorizontal: 16,
    marginTop: 16,
    padding: 16,
    borderRadius: 12,
  },
  approvalBannerGreen: {
    backgroundColor: Colors.light.success,
  },
  approvalBannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  approvalIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.25)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  approvalIconGreen: {
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  approvalBannerTitle: {
    fontSize: 16,
    fontWeight: 'bold' as const,
    color: '#fff',
  },
  approvalBannerSubtitle: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.85)',
    marginTop: 2,
  },
  eventInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  eventName: {
    fontSize: 14,
    color: Colors.light.text,
    flex: 1,
  },
  reportStats: {
    flexDirection: 'row',
    gap: 16,
  },
  reportStatItem: {
    flex: 1,
  },
  reportStatLabel: {
    fontSize: 12,
    color: Colors.light.textSecondary,
    marginBottom: 4,
  },
  reportStatValue: {
    fontSize: 20,
    fontWeight: 'bold' as const,
    color: Colors.light.text,
  },
  reportStatSubtitle: {
    fontSize: 11,
    color: Colors.light.textSecondary,
    marginTop: 2,
  },
  remarks: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
  },
  remarksLabel: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.light.textSecondary,
    marginBottom: 4,
  },
  remarksText: {
    fontSize: 14,
    color: Colors.light.text,
    lineHeight: 20,
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
    lineHeight: 20,
  },
  bottomSpacer: {
    height: 20,
  },
});
