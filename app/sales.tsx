import { View, Text, StyleSheet, TouchableOpacity, ScrollView, RefreshControl, ActivityIndicator } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { ChevronLeft, TrendingUp, Users, BarChart3, Award, Smartphone, Wifi, AlertCircle, Cable, Zap, Wrench, IndianRupee, ShoppingCart } from 'lucide-react-native';
import { useState, useCallback } from 'react';
import Colors from '@/constants/colors';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/contexts/auth';
import {
  DonutChart,
  MultiLineChart,
  GroupedBarChart,
  StackedBarChart,
  ChartLegend,
  formatIndianNumber,
} from '@/components/SalesCharts';
import TimePeriodPicker from '@/components/TimePeriodPicker';
import { computePeriodRange, eachDayInRange, PeriodRange } from '@/utils/timePeriod';

const SIM_COLOR = '#1976D2';
const FTTH_COLOR = '#388E3C';
const SIM_ACT_COLOR = '#64B5F6';
const FTTH_ACT_COLOR = '#81C784';
const LC_COLOR = '#F57C00';
const EB_COLOR = '#7B1FA2';

const BTS_COLOR = '#D32F2F';
const FTTH_DOWN_COLOR = '#F57C00';
const ROUTE_COLOR = '#7B1FA2';
const OFC_COLOR = '#0288D1';

const FIN_LC_COLOR = '#1976D2';
const FIN_LL_FTTH_COLOR = '#388E3C';
const FIN_TOWER_COLOR = '#F57C00';
const FIN_GSM_COLOR = '#7B1FA2';
const FIN_RENT_COLOR = '#0288D1';

const APPROVED_COLOR = '#388E3C';
const PENDING_COLOR = '#F57C00';
const REJECTED_COLOR = '#D32F2F';

const FIN_TYPE_LABELS: Record<string, string> = {
  FIN_LC: 'Lease Circuit',
  FIN_LL_FTTH: 'Landline / FTTH',
  FIN_TOWER: 'Tower Rent',
  FIN_GSM_POSTPAID: 'GSM Postpaid',
  FIN_RENT_BUILDING: 'Building Rent',
};
const FIN_TYPE_COLORS: Record<string, string> = {
  FIN_LC: FIN_LC_COLOR,
  FIN_LL_FTTH: FIN_LL_FTTH_COLOR,
  FIN_TOWER: FIN_TOWER_COLOR,
  FIN_GSM_POSTPAID: FIN_GSM_COLOR,
  FIN_RENT_BUILDING: FIN_RENT_COLOR,
};

type CategoryType = 'sales' | 'operations' | 'finance';
type TabType = 'overview' | 'team' | 'trends';

export default function SalesScreen() {
  const router = useRouter();
  const { employee } = useAuth();
  const [category, setCategory] = useState<CategoryType>('sales');
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [refreshing, setRefreshing] = useState(false);
  const [period, setPeriod] = useState<PeriodRange>(() => computePeriodRange('30d'));

  const analyticsQuery = trpc.sales.getSalesAnalytics.useQuery(
    {
      employeeId: employee?.id || '',
      circle: employee?.circle || undefined,
      startDate: period.startDate,
      endDate: period.endDate,
    },
    {
      enabled: !!employee?.id && category === 'sales',
      staleTime: 60000,
    }
  );

  const teamQuery = trpc.sales.getTeamPerformance.useQuery(
    {
      employeeId: employee?.id || '',
      circle: employee?.circle || undefined,
      startDate: period.startDate,
      endDate: period.endDate,
      limit: 20,
    },
    {
      enabled: !!employee?.id && category === 'sales' && activeTab === 'team',
      staleTime: 60000,
    }
  );

  const trendsQuery = trpc.sales.getSalesTrends.useQuery(
    {
      employeeId: employee?.id || '',
      circle: employee?.circle || undefined,
      startDate: period.startDate,
      endDate: period.endDate,
    },
    {
      enabled: !!employee?.id && category === 'sales' && activeTab === 'trends',
      staleTime: 60000,
    }
  );

  const opsQuery = trpc.sales.getOperationsAnalytics.useQuery(
    {
      employeeId: employee?.id || '',
      circle: employee?.circle || undefined,
      startDate: period.startDate,
      endDate: period.endDate,
    },
    {
      enabled: !!employee?.id && category === 'operations',
      staleTime: 60000,
    }
  );

  const financeQuery = trpc.sales.getFinanceAnalytics.useQuery(
    {
      employeeId: employee?.id || '',
      circle: employee?.circle || undefined,
      startDate: period.startDate,
      endDate: period.endDate,
    },
    {
      enabled: !!employee?.id && category === 'finance',
      staleTime: 60000,
    }
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      analyticsQuery.refetch(),
      teamQuery.refetch(),
      trendsQuery.refetch(),
      opsQuery.refetch(),
      financeQuery.refetch(),
    ]);
    setRefreshing(false);
  }, [analyticsQuery, teamQuery, trendsQuery, opsQuery, financeQuery]);

  const formatNumber = (num: number) => formatIndianNumber(num);

  const getInitials = (name: string) => {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    return parts
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const getRankColor = (rank: number) => {
    if (rank === 1) return '#FFD700';
    if (rank === 2) return '#C0C0C0';
    if (rank === 3) return '#CD7F32';
    return Colors.light.textSecondary;
  };

  const renderOverviewTab = () => {
    if (analyticsQuery.isLoading) {
      return (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.light.primary} />
          <Text style={styles.loadingText}>Loading analytics...</Text>
        </View>
      );
    }

    if (analyticsQuery.isError) {
      return (
        <View style={styles.emptyContainer}>
          <AlertCircle size={48} color="#D32F2F" />
          <Text style={styles.emptyTitle}>Error Loading Data</Text>
          <Text style={styles.emptySubtitle}>{analyticsQuery.error?.message || 'Failed to load sales analytics'}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => analyticsQuery.refetch()}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      );
    }

    const data = analyticsQuery.data;
    if (!data?.totals) {
      return (
        <ScrollView
          style={styles.tabContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          {renderDateFilter()}
          <View style={styles.emptyContainer}>
            <BarChart3 size={48} color={Colors.light.textSecondary} />
            <Text style={styles.emptyTitle}>No Sales Data</Text>
            <Text style={styles.emptySubtitle}>Sales entries will appear here once submitted</Text>
          </View>
        </ScrollView>
      );
    }

    const { totals, byEmployee, byEvent, recentEntries } = data;

    return (
      <ScrollView
        style={styles.tabContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {renderDateFilter()}

        <View style={styles.summarySection}>
          <Text style={styles.sectionTitle}>Sales Summary</Text>
          <View style={styles.summaryGrid}>
            <View style={[styles.summaryCardSm, { backgroundColor: '#E3F2FD' }]}>
              <View style={styles.summaryIconWrapper}>
                <Smartphone size={18} color={SIM_COLOR} />
              </View>
              <Text style={styles.summaryValueSm}>{formatNumber(totals.simsSold)}</Text>
              <Text style={styles.summaryLabel}>SIMs</Text>
              <Text style={styles.summarySubValue}>{formatNumber(totals.simsActivated)} act.</Text>
            </View>
            <View style={[styles.summaryCardSm, { backgroundColor: '#E8F5E9' }]}>
              <View style={styles.summaryIconWrapper}>
                <Wifi size={18} color={FTTH_COLOR} />
              </View>
              <Text style={styles.summaryValueSm}>{formatNumber(totals.ftthSold)}</Text>
              <Text style={styles.summaryLabel}>FTTH</Text>
              <Text style={styles.summarySubValue}>{formatNumber(totals.ftthActivated)} act.</Text>
            </View>
            <View style={[styles.summaryCardSm, { backgroundColor: '#FFF3E0' }]}>
              <View style={styles.summaryIconWrapper}>
                <Cable size={18} color={LC_COLOR} />
              </View>
              <Text style={styles.summaryValueSm}>{formatNumber(totals.leaseSold ?? 0)}</Text>
              <Text style={styles.summaryLabel}>Lease Circuit</Text>
              <Text style={styles.summarySubValue}>connections</Text>
            </View>
            <View style={[styles.summaryCardSm, { backgroundColor: '#F3E5F5' }]}>
              <View style={styles.summaryIconWrapper}>
                <Zap size={18} color={EB_COLOR} />
              </View>
              <Text style={styles.summaryValueSm}>{formatNumber(totals.ebSold ?? 0)}</Text>
              <Text style={styles.summaryLabel}>EB</Text>
              <Text style={styles.summarySubValue}>connections</Text>
            </View>
          </View>
          <View style={styles.totalEntriesCard}>
            <Text style={styles.totalEntriesLabel}>Total Sales Entries</Text>
            <Text style={styles.totalEntriesValue}>{formatNumber(totals.totalEntries)}</Text>
          </View>
        </View>

        {(totals.simsSold > 0 || totals.ftthSold > 0) && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Activation Rate</Text>
            <View style={styles.donutRow}>
              <View style={styles.donutCard}>
                <DonutChart
                  percent={totals.simsSold > 0 ? totals.simActivationRate : 0}
                  color={SIM_COLOR}
                  size={120}
                  strokeWidth={14}
                  centerLabel={totals.simsSold > 0 ? `${totals.simActivationRate}%` : '—'}
                  centerSubLabel="SIM"
                />
                <Text style={styles.donutCardLabel}>
                  {formatNumber(totals.simsActivated)} / {formatNumber(totals.simsSold)}
                </Text>
              </View>
              <View style={styles.donutCard}>
                <DonutChart
                  percent={totals.ftthSold > 0 ? totals.ftthActivationRate : 0}
                  color={FTTH_COLOR}
                  size={120}
                  strokeWidth={14}
                  centerLabel={totals.ftthSold > 0 ? `${totals.ftthActivationRate}%` : '—'}
                  centerSubLabel="FTTH"
                />
                <Text style={styles.donutCardLabel}>
                  {formatNumber(totals.ftthActivated)} / {formatNumber(totals.ftthSold)}
                </Text>
              </View>
            </View>
          </View>
        )}

        {byEmployee.length > 0 && (totals.simsSold + totals.ftthSold + (totals.leaseSold ?? 0) + (totals.ebSold ?? 0)) > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Top Performers (All Categories)</Text>
            <View style={styles.chartCard}>
              <ChartLegend
                items={[
                  { label: 'SIM', color: SIM_COLOR },
                  { label: 'FTTH', color: FTTH_COLOR },
                  { label: 'LC', color: LC_COLOR },
                  { label: 'EB', color: EB_COLOR },
                ]}
              />
              <GroupedBarChart
                items={byEmployee.slice(0, 5).map(emp => ({
                  label: emp.name,
                  values: [
                    { value: emp.simsSold, color: SIM_COLOR },
                    { value: emp.ftthSold, color: FTTH_COLOR },
                    { value: emp.leaseSold ?? 0, color: LC_COLOR },
                    { value: emp.ebSold ?? 0, color: EB_COLOR },
                  ],
                  trailing: formatIndianNumber(emp.simsSold + emp.ftthSold + (emp.leaseSold ?? 0) + (emp.ebSold ?? 0)),
                }))}
                rowHeight={56}
              />
            </View>
          </View>
        )}

        {byEmployee.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Top Performers</Text>
            {byEmployee.slice(0, 5).map((emp, index) => (
              <View key={emp.id} style={styles.performerCard}>
                <View style={[styles.rankBadge, { backgroundColor: getRankColor(index + 1) + '20' }]}>
                  <Text style={[styles.rankText, { color: getRankColor(index + 1) }]}>#{index + 1}</Text>
                </View>
                <View style={styles.performerAvatar}>
                  <Text style={styles.performerInitials}>{getInitials(emp.name)}</Text>
                </View>
                <View style={styles.performerInfo}>
                  <Text style={styles.performerName}>{emp.name}</Text>
                  <Text style={styles.performerDesignation}>{emp.designation}</Text>
                </View>
                <View style={styles.performerStats}>
                  <Text style={styles.performerStatValue}>
                    {formatNumber(emp.simsSold + emp.ftthSold + (emp.leaseSold ?? 0) + (emp.ebSold ?? 0))}
                  </Text>
                  <Text style={styles.performerStatLabel}>Total Sales</Text>
                </View>
              </View>
            ))}
            {byEmployee.length > 5 && (
              <TouchableOpacity style={styles.viewAllButton} onPress={() => setActiveTab('team')}>
                <Text style={styles.viewAllText}>View All Team Members</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {byEvent.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Top Events</Text>
            {byEvent.slice(0, 5).map((evt, index) => (
              <View key={evt.id} style={styles.eventCard}>
                <View style={styles.eventInfo}>
                  <Text style={styles.eventName} numberOfLines={1}>{evt.name}</Text>
                  <Text style={styles.eventCategory}>{evt.category}</Text>
                </View>
                <View style={styles.eventStats}>
                  <View style={styles.eventStatItem}>
                    <Smartphone size={14} color={Colors.light.primary} />
                    <Text style={styles.eventStatValue}>{evt.simsSold}</Text>
                  </View>
                  <View style={styles.eventStatItem}>
                    <Wifi size={14} color="#388E3C" />
                    <Text style={styles.eventStatValue}>{evt.ftthSold}</Text>
                  </View>
                </View>
              </View>
            ))}
          </View>
        )}

        {recentEntries.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Recent Sales Entries</Text>
            {recentEntries.slice(0, 10).map((entry) => (
              <View key={entry.id} style={styles.recentEntryCard}>
                <View style={styles.recentEntryHeader}>
                  <Text style={styles.recentEntryName}>{entry.employeeName}</Text>
                  <Text style={styles.recentEntryDate}>
                    {new Date(entry.createdAt).toLocaleDateString()}
                  </Text>
                </View>
                <View style={styles.recentEntryStats}>
                  {entry.simsSold > 0 && (
                    <View style={styles.recentEntryStat}>
                      <Smartphone size={12} color={Colors.light.primary} />
                      <Text style={styles.recentEntryStatText}>{entry.simsSold} SIM</Text>
                    </View>
                  )}
                  {entry.ftthSold > 0 && (
                    <View style={styles.recentEntryStat}>
                      <Wifi size={12} color="#388E3C" />
                      <Text style={styles.recentEntryStatText}>{entry.ftthSold} FTTH</Text>
                    </View>
                  )}
                  <View style={[styles.customerTypeBadge, { backgroundColor: entry.customerType === 'B2B' ? '#FFF3E0' : '#E3F2FD' }]}>
                    <Text style={[styles.customerTypeText, { color: entry.customerType === 'B2B' ? '#E65100' : '#1565C0' }]}>
                      {entry.customerType}
                    </Text>
                  </View>
                </View>
              </View>
            ))}
          </View>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>
    );
  };

  const renderTeamTab = () => {
    if (teamQuery.isLoading) {
      return (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.light.primary} />
          <Text style={styles.loadingText}>Loading team performance...</Text>
        </View>
      );
    }

    if (teamQuery.isError) {
      return (
        <View style={styles.emptyContainer}>
          <AlertCircle size={48} color="#D32F2F" />
          <Text style={styles.emptyTitle}>Error Loading Data</Text>
          <Text style={styles.emptySubtitle}>{teamQuery.error?.message || 'Failed to load team performance'}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => teamQuery.refetch()}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      );
    }

    const data = teamQuery.data;
    if (!data?.rankings || data.rankings.length === 0) {
      return (
        <ScrollView
          style={styles.tabContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          {renderDateFilter()}
          <View style={styles.emptyContainer}>
            <Users size={48} color={Colors.light.textSecondary} />
            <Text style={styles.emptyTitle}>No Team Data</Text>
            <Text style={styles.emptySubtitle}>Team performance will appear once sales are submitted</Text>
          </View>
        </ScrollView>
      );
    }

    return (
      <ScrollView
        style={styles.tabContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {renderDateFilter()}

        {(data.grandTotal ?? 0) > 0 && (
          <View style={styles.grandTotalCard}>
            <Text style={styles.grandTotalLabel}>Total Team Sales</Text>
            <Text style={styles.grandTotalValue}>{formatNumber(data.grandTotal ?? 0)}</Text>
          </View>
        )}

        {data.rankings.length > 0 && (data.grandTotal ?? 0) > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Contribution by Member (Top 10)</Text>
            <View style={styles.chartCard}>
              <ChartLegend
                items={[
                  { label: 'SIMs', color: SIM_COLOR },
                  { label: 'FTTH', color: FTTH_COLOR },
                  { label: 'LC', color: LC_COLOR },
                  { label: 'EB', color: EB_COLOR },
                ]}
              />
              <GroupedBarChart
                items={data.rankings.slice(0, 10).map((m: any) => ({
                  label: `#${m.rank} ${m.name}`,
                  values: [
                    { value: m.simsSold, color: SIM_COLOR },
                    { value: m.ftthSold, color: FTTH_COLOR },
                    { value: m.leaseSold ?? 0, color: LC_COLOR },
                    { value: m.ebSold ?? 0, color: EB_COLOR },
                  ],
                  trailing: `${m.contribution ?? 0}%`,
                }))}
                rowHeight={48}
              />
            </View>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Team Rankings</Text>
          {data.rankings.map((member) => (
            <View key={member.id} style={styles.teamMemberCard}>
              <View style={[styles.rankBadge, { backgroundColor: getRankColor(member.rank) + '20' }]}>
                {member.rank <= 3 ? (
                  <Award size={16} color={getRankColor(member.rank)} />
                ) : (
                  <Text style={[styles.rankText, { color: getRankColor(member.rank) }]}>#{member.rank}</Text>
                )}
              </View>
              <View style={styles.teamMemberAvatar}>
                <Text style={styles.teamMemberInitials}>{getInitials(member.name)}</Text>
              </View>
              <View style={styles.teamMemberInfo}>
                <Text style={styles.teamMemberName}>{member.name}</Text>
                <Text style={styles.teamMemberDesignation}>{member.designation} | {member.circle}</Text>
                <Text style={styles.contributionText}>{member.contribution ?? 0}% contribution</Text>
              </View>
              <View style={styles.teamMemberStatsColumn}>
                <View style={styles.teamMemberStatRow}>
                  <Smartphone size={12} color={SIM_COLOR} />
                  <Text style={styles.teamMemberStatValue}>{formatNumber(member.simsSold)}</Text>
                </View>
                <View style={styles.teamMemberStatRow}>
                  <Wifi size={12} color={FTTH_COLOR} />
                  <Text style={styles.teamMemberStatValue}>{formatNumber(member.ftthSold)}</Text>
                </View>
                <View style={styles.teamMemberStatRow}>
                  <Cable size={12} color={LC_COLOR} />
                  <Text style={styles.teamMemberStatValue}>{formatNumber((member as any).leaseSold ?? 0)}</Text>
                </View>
                <View style={styles.teamMemberStatRow}>
                  <Zap size={12} color={EB_COLOR} />
                  <Text style={styles.teamMemberStatValue}>{formatNumber((member as any).ebSold ?? 0)}</Text>
                </View>
              </View>
            </View>
          ))}
        </View>

        <View style={{ height: 100 }} />
      </ScrollView>
    );
  };

  const renderTrendsTab = () => {
    if (trendsQuery.isLoading) {
      return (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.light.primary} />
          <Text style={styles.loadingText}>Loading trends...</Text>
        </View>
      );
    }

    if (trendsQuery.isError) {
      return (
        <View style={styles.emptyContainer}>
          <AlertCircle size={48} color="#D32F2F" />
          <Text style={styles.emptyTitle}>Error Loading Data</Text>
          <Text style={styles.emptySubtitle}>{trendsQuery.error?.message || 'Failed to load sales trends'}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => trendsQuery.refetch()}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      );
    }

    const data = trendsQuery.data;
    if (!data?.daily || data.daily.length === 0) {
      return (
        <ScrollView
          style={styles.tabContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          {renderDateFilter()}
          <View style={styles.emptyContainer}>
            <TrendingUp size={48} color={Colors.light.textSecondary} />
            <Text style={styles.emptyTitle}>No Trend Data</Text>
            <Text style={styles.emptySubtitle}>Sales trends will appear once data is available</Text>
          </View>
        </ScrollView>
      );
    }

    // Build a continuous date series across the full requested window so missing
    // days render as zero. Use IST-local day keys (eachDayInRange) so they match
    // backend keys (DATE in Asia/Kolkata).
    const allDays = eachDayInRange(period.startDate, period.endDate);
    const dailyMap = new Map(data.daily.map(d => [d.date, d]));
    const fullSeries = allDays.map(key => {
      const found = dailyMap.get(key) as any;
      return {
        date: key,
        simsSold: Number(found?.simsSold) || 0,
        ftthSold: Number(found?.ftthSold) || 0,
        simsActivated: Number(found?.simsActivated) || 0,
        ftthActivated: Number(found?.ftthActivated) || 0,
        leaseSold: Number(found?.leaseSold) || 0,
        ebSold: Number(found?.ebSold) || 0,
      };
    });
    const labels = fullSeries.map(d => {
      const [yy, mm, dd] = d.date.split('-').map(Number);
      const local = new Date(yy, (mm || 1) - 1, dd || 1);
      return local.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    });

    return (
      <ScrollView
        style={styles.tabContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {renderDateFilter()}

        {data.summary && (
          <View style={styles.trendSummarySection}>
            <Text style={styles.sectionTitle}>Summary</Text>
            <View style={styles.summaryGrid}>
              <View style={styles.trendSummaryCardSm}>
                <Text style={styles.trendSummaryValueSm}>{formatNumber(data.summary.totalSims)}</Text>
                <Text style={styles.trendSummaryLabel}>SIMs</Text>
                <Text style={styles.trendSummaryAvg}>{formatNumber(data.summary.avgDailySims)}/day</Text>
              </View>
              <View style={styles.trendSummaryCardSm}>
                <Text style={styles.trendSummaryValueSm}>{formatNumber(data.summary.totalFtth)}</Text>
                <Text style={styles.trendSummaryLabel}>FTTH</Text>
                <Text style={styles.trendSummaryAvg}>{formatNumber(data.summary.avgDailyFtth)}/day</Text>
              </View>
              <View style={styles.trendSummaryCardSm}>
                <Text style={styles.trendSummaryValueSm}>{formatNumber((data.summary as any).totalLease ?? 0)}</Text>
                <Text style={styles.trendSummaryLabel}>LC</Text>
                <Text style={styles.trendSummaryAvg}>{formatNumber((data.summary as any).avgDailyLease ?? 0)}/day</Text>
              </View>
              <View style={styles.trendSummaryCardSm}>
                <Text style={styles.trendSummaryValueSm}>{formatNumber((data.summary as any).totalEb ?? 0)}</Text>
                <Text style={styles.trendSummaryLabel}>EB</Text>
                <Text style={styles.trendSummaryAvg}>{formatNumber((data.summary as any).avgDailyEb ?? 0)}/day</Text>
              </View>
            </View>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Daily Sales Trend</Text>
          <View style={styles.chartCard}>
            <ChartLegend
              items={[
                { label: 'SIM', color: SIM_COLOR },
                { label: 'FTTH', color: FTTH_COLOR },
                { label: 'LC', color: LC_COLOR },
                { label: 'EB', color: EB_COLOR },
              ]}
            />
            <MultiLineChart
              labels={labels}
              series={[
                { label: 'SIM', color: SIM_COLOR, values: fullSeries.map(d => d.simsSold) },
                { label: 'FTTH', color: FTTH_COLOR, values: fullSeries.map(d => d.ftthSold) },
                { label: 'LC', color: LC_COLOR, values: fullSeries.map(d => d.leaseSold) },
                { label: 'EB', color: EB_COLOR, values: fullSeries.map(d => d.ebSold) },
              ]}
              height={240}
            />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Daily Activations</Text>
          <View style={styles.chartCard}>
            <ChartLegend
              items={[
                { label: 'SIM Activated', color: SIM_ACT_COLOR },
                { label: 'FTTH Activated', color: FTTH_ACT_COLOR },
              ]}
            />
            <StackedBarChart
              labels={labels}
              series={[
                { label: 'SIM Activated', color: SIM_ACT_COLOR, values: fullSeries.map(d => d.simsActivated) },
                { label: 'FTTH Activated', color: FTTH_ACT_COLOR, values: fullSeries.map(d => d.ftthActivated) },
              ]}
              height={200}
            />
          </View>
        </View>

        <View style={{ height: 100 }} />
      </ScrollView>
    );
  };

  // ---------------- OPERATIONS ----------------
  const renderOpsLoadingError = () => {
    if (opsQuery.isLoading) {
      return (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.light.primary} />
          <Text style={styles.loadingText}>Loading operations data...</Text>
        </View>
      );
    }
    if (opsQuery.isError) {
      return (
        <View style={styles.emptyContainer}>
          <AlertCircle size={48} color="#D32F2F" />
          <Text style={styles.emptyTitle}>Error Loading Data</Text>
          <Text style={styles.emptySubtitle}>{opsQuery.error?.message || 'Failed to load operations analytics'}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => opsQuery.refetch()}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return null;
  };

  const renderDateFilter = () => (
    <View style={styles.dateFilterSection}>
      <View style={{ flex: 1 }}>
        <TimePeriodPicker value={period} onChange={setPeriod} />
      </View>
    </View>
  );

  const renderOpsOverview = () => {
    const loadErr = renderOpsLoadingError();
    if (loadErr) return loadErr;
    const data = opsQuery.data;
    if (!data || data.totals.grandTotal === 0) {
      return (
        <ScrollView
          style={styles.tabContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          {renderDateFilter()}
          <View style={styles.emptyContainer}>
            <Wrench size={48} color={Colors.light.textSecondary} />
            <Text style={styles.emptyTitle}>No Operations Data</Text>
            <Text style={styles.emptySubtitle}>Maintenance entries will appear here once submitted</Text>
          </View>
        </ScrollView>
      );
    }
    const { totals, byEmployee } = data;
    const t = totals.byType;
    return (
      <ScrollView
        style={styles.tabContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {renderDateFilter()}

        <View style={styles.summarySection}>
          <Text style={styles.sectionTitle}>Operations Summary</Text>
          <View style={styles.summaryGrid}>
            <View style={[styles.summaryCardSm, { backgroundColor: '#FFEBEE' }]}>
              <Text style={styles.summaryValueSm}>{formatNumber(t.BTS_DOWN.total)}</Text>
              <Text style={styles.summaryLabel}>BTS Down</Text>
              <Text style={styles.summarySubValue}>{formatNumber(t.BTS_DOWN.entries)} entries</Text>
            </View>
            <View style={[styles.summaryCardSm, { backgroundColor: '#FFF3E0' }]}>
              <Text style={styles.summaryValueSm}>{formatNumber(t.FTTH_DOWN.total)}</Text>
              <Text style={styles.summaryLabel}>FTTH Down</Text>
              <Text style={styles.summarySubValue}>{formatNumber(t.FTTH_DOWN.entries)} entries</Text>
            </View>
            <View style={[styles.summaryCardSm, { backgroundColor: '#F3E5F5' }]}>
              <Text style={styles.summaryValueSm}>{formatNumber(t.ROUTE_FAIL.total)}</Text>
              <Text style={styles.summaryLabel}>Route Fail</Text>
              <Text style={styles.summarySubValue}>{formatNumber(t.ROUTE_FAIL.entries)} entries</Text>
            </View>
            <View style={[styles.summaryCardSm, { backgroundColor: '#E1F5FE' }]}>
              <Text style={styles.summaryValueSm}>{formatNumber(t.OFC_FAIL.total)}</Text>
              <Text style={styles.summaryLabel}>OFC Fail</Text>
              <Text style={styles.summarySubValue}>{formatNumber(t.OFC_FAIL.entries)} entries</Text>
            </View>
          </View>
          <View style={styles.totalEntriesCard}>
            <Text style={styles.totalEntriesLabel}>Total Resolutions</Text>
            <Text style={styles.totalEntriesValue}>{formatNumber(totals.grandTotal)}</Text>
          </View>
        </View>

        {byEmployee.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Top Performers (by Task Type)</Text>
            <View style={styles.chartCard}>
              <ChartLegend
                items={[
                  { label: 'BTS Down', color: BTS_COLOR },
                  { label: 'FTTH Down', color: FTTH_DOWN_COLOR },
                  { label: 'Route Fail', color: ROUTE_COLOR },
                  { label: 'OFC Fail', color: OFC_COLOR },
                ]}
              />
              <GroupedBarChart
                items={byEmployee.slice(0, 5).map(emp => ({
                  label: emp.name,
                  values: [
                    { value: emp.btsDown, color: BTS_COLOR },
                    { value: emp.ftthDown, color: FTTH_DOWN_COLOR },
                    { value: emp.routeFail, color: ROUTE_COLOR },
                    { value: emp.ofcFail, color: OFC_COLOR },
                  ],
                  trailing: formatIndianNumber(emp.total),
                }))}
                rowHeight={56}
              />
            </View>
          </View>
        )}

        {byEmployee.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Top Performers</Text>
            {byEmployee.slice(0, 5).map((emp) => (
              <View key={emp.id} style={styles.performerCard}>
                <View style={[styles.rankBadge, { backgroundColor: getRankColor(emp.rank) + '20' }]}>
                  <Text style={[styles.rankText, { color: getRankColor(emp.rank) }]}>#{emp.rank}</Text>
                </View>
                <View style={styles.performerAvatar}>
                  <Text style={styles.performerInitials}>{getInitials(emp.name)}</Text>
                </View>
                <View style={styles.performerInfo}>
                  <Text style={styles.performerName}>{emp.name}</Text>
                  <Text style={styles.performerDesignation}>{emp.designation}</Text>
                </View>
                <View style={styles.performerStats}>
                  <Text style={styles.performerStatValue}>{formatNumber(emp.total)}</Text>
                  <Text style={styles.performerStatLabel}>Resolutions</Text>
                </View>
              </View>
            ))}
            {byEmployee.length > 5 && (
              <TouchableOpacity style={styles.viewAllButton} onPress={() => setActiveTab('team')}>
                <Text style={styles.viewAllText}>View All Team Members</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>
    );
  };

  const renderOpsTeam = () => {
    const loadErr = renderOpsLoadingError();
    if (loadErr) return loadErr;
    const data = opsQuery.data;
    if (!data || data.byEmployee.length === 0) {
      return (
        <ScrollView style={styles.tabContent} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
          {renderDateFilter()}
          <View style={styles.emptyContainer}>
            <Users size={48} color={Colors.light.textSecondary} />
            <Text style={styles.emptyTitle}>No Team Data</Text>
            <Text style={styles.emptySubtitle}>Team performance will appear once data is available</Text>
          </View>
        </ScrollView>
      );
    }
    const grand = data.totals.grandTotal;
    return (
      <ScrollView style={styles.tabContent} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        {renderDateFilter()}
        {grand > 0 && (
          <View style={styles.grandTotalCard}>
            <Text style={styles.grandTotalLabel}>Total Resolutions</Text>
            <Text style={styles.grandTotalValue}>{formatNumber(grand)}</Text>
          </View>
        )}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Contribution by Member (Top 10)</Text>
          <View style={styles.chartCard}>
            <ChartLegend
              items={[
                { label: 'BTS Down', color: BTS_COLOR },
                { label: 'FTTH Down', color: FTTH_DOWN_COLOR },
                { label: 'Route Fail', color: ROUTE_COLOR },
                { label: 'OFC Fail', color: OFC_COLOR },
              ]}
            />
            <GroupedBarChart
              items={data.byEmployee.slice(0, 10).map(m => ({
                label: `#${m.rank} ${m.name}`,
                values: [
                  { value: m.btsDown, color: BTS_COLOR },
                  { value: m.ftthDown, color: FTTH_DOWN_COLOR },
                  { value: m.routeFail, color: ROUTE_COLOR },
                  { value: m.ofcFail, color: OFC_COLOR },
                ],
                trailing: `${m.contribution}%`,
              }))}
              rowHeight={48}
            />
          </View>
        </View>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Team Rankings</Text>
          {data.byEmployee.map((m) => (
            <View key={m.id} style={styles.teamMemberCard}>
              <View style={[styles.rankBadge, { backgroundColor: getRankColor(m.rank) + '20' }]}>
                {m.rank <= 3 ? (
                  <Award size={16} color={getRankColor(m.rank)} />
                ) : (
                  <Text style={[styles.rankText, { color: getRankColor(m.rank) }]}>#{m.rank}</Text>
                )}
              </View>
              <View style={styles.teamMemberAvatar}>
                <Text style={styles.teamMemberInitials}>{getInitials(m.name)}</Text>
              </View>
              <View style={styles.teamMemberInfo}>
                <Text style={styles.teamMemberName}>{m.name}</Text>
                <Text style={styles.teamMemberDesignation}>{m.designation} | {m.circle}</Text>
                <Text style={styles.contributionText}>{m.contribution}% contribution</Text>
              </View>
              <View style={styles.teamMemberStatsColumn}>
                <Text style={[styles.teamMemberStatValue, { color: BTS_COLOR }]}>{formatNumber(m.btsDown)} BTS</Text>
                <Text style={[styles.teamMemberStatValue, { color: FTTH_DOWN_COLOR }]}>{formatNumber(m.ftthDown)} FTTH</Text>
                <Text style={[styles.teamMemberStatValue, { color: ROUTE_COLOR }]}>{formatNumber(m.routeFail)} RT</Text>
                <Text style={[styles.teamMemberStatValue, { color: OFC_COLOR }]}>{formatNumber(m.ofcFail)} OFC</Text>
              </View>
            </View>
          ))}
        </View>
        <View style={{ height: 100 }} />
      </ScrollView>
    );
  };

  const renderOpsTrends = () => {
    const loadErr = renderOpsLoadingError();
    if (loadErr) return loadErr;
    const data = opsQuery.data;
    if (!data || data.daily.length === 0) {
      return (
        <ScrollView style={styles.tabContent} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
          {renderDateFilter()}
          <View style={styles.emptyContainer}>
            <TrendingUp size={48} color={Colors.light.textSecondary} />
            <Text style={styles.emptyTitle}>No Trend Data</Text>
            <Text style={styles.emptySubtitle}>Operations trends will appear once data is available</Text>
          </View>
        </ScrollView>
      );
    }
    const allDays = eachDayInRange(period.startDate, period.endDate);
    const dailyMap = new Map(data.daily.map(d => [d.date, d]));
    const series = allDays.map(key => {
      const f = dailyMap.get(key) as any;
      return {
        date: key,
        btsDown: Number(f?.btsDown) || 0,
        ftthDown: Number(f?.ftthDown) || 0,
        routeFail: Number(f?.routeFail) || 0,
        ofcFail: Number(f?.ofcFail) || 0,
      };
    });
    const labels = series.map(d => {
      const [yy, mm, dd] = d.date.split('-').map(Number);
      const local = new Date(yy, (mm || 1) - 1, dd || 1);
      return local.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    });
    const t = data.totals.byType;
    return (
      <ScrollView style={styles.tabContent} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        {renderDateFilter()}
        <View style={styles.trendSummarySection}>
          <Text style={styles.sectionTitle}>Summary</Text>
          <View style={styles.summaryGrid}>
            <View style={styles.trendSummaryCardSm}>
              <Text style={[styles.trendSummaryValueSm, { color: BTS_COLOR }]}>{formatNumber(t.BTS_DOWN.total)}</Text>
              <Text style={styles.trendSummaryLabel}>BTS Down</Text>
            </View>
            <View style={styles.trendSummaryCardSm}>
              <Text style={[styles.trendSummaryValueSm, { color: FTTH_DOWN_COLOR }]}>{formatNumber(t.FTTH_DOWN.total)}</Text>
              <Text style={styles.trendSummaryLabel}>FTTH Down</Text>
            </View>
            <View style={styles.trendSummaryCardSm}>
              <Text style={[styles.trendSummaryValueSm, { color: ROUTE_COLOR }]}>{formatNumber(t.ROUTE_FAIL.total)}</Text>
              <Text style={styles.trendSummaryLabel}>Route Fail</Text>
            </View>
            <View style={styles.trendSummaryCardSm}>
              <Text style={[styles.trendSummaryValueSm, { color: OFC_COLOR }]}>{formatNumber(t.OFC_FAIL.total)}</Text>
              <Text style={styles.trendSummaryLabel}>OFC Fail</Text>
            </View>
          </View>
        </View>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Daily Resolutions Trend</Text>
          <View style={styles.chartCard}>
            <ChartLegend
              items={[
                { label: 'BTS Down', color: BTS_COLOR },
                { label: 'FTTH Down', color: FTTH_DOWN_COLOR },
                { label: 'Route Fail', color: ROUTE_COLOR },
                { label: 'OFC Fail', color: OFC_COLOR },
              ]}
            />
            <MultiLineChart
              labels={labels}
              series={[
                { label: 'BTS Down', color: BTS_COLOR, values: series.map(d => d.btsDown) },
                { label: 'FTTH Down', color: FTTH_DOWN_COLOR, values: series.map(d => d.ftthDown) },
                { label: 'Route Fail', color: ROUTE_COLOR, values: series.map(d => d.routeFail) },
                { label: 'OFC Fail', color: OFC_COLOR, values: series.map(d => d.ofcFail) },
              ]}
              height={240}
            />
          </View>
        </View>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Stacked Daily Volume</Text>
          <View style={styles.chartCard}>
            <ChartLegend
              items={[
                { label: 'BTS Down', color: BTS_COLOR },
                { label: 'FTTH Down', color: FTTH_DOWN_COLOR },
                { label: 'Route Fail', color: ROUTE_COLOR },
                { label: 'OFC Fail', color: OFC_COLOR },
              ]}
            />
            <StackedBarChart
              labels={labels}
              series={[
                { label: 'BTS Down', color: BTS_COLOR, values: series.map(d => d.btsDown) },
                { label: 'FTTH Down', color: FTTH_DOWN_COLOR, values: series.map(d => d.ftthDown) },
                { label: 'Route Fail', color: ROUTE_COLOR, values: series.map(d => d.routeFail) },
                { label: 'OFC Fail', color: OFC_COLOR, values: series.map(d => d.ofcFail) },
              ]}
              height={220}
            />
          </View>
        </View>
        <View style={{ height: 100 }} />
      </ScrollView>
    );
  };

  // ---------------- FINANCE ----------------
  const renderFinLoadingError = () => {
    if (financeQuery.isLoading) {
      return (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.light.primary} />
          <Text style={styles.loadingText}>Loading finance data...</Text>
        </View>
      );
    }
    if (financeQuery.isError) {
      return (
        <View style={styles.emptyContainer}>
          <AlertCircle size={48} color="#D32F2F" />
          <Text style={styles.emptyTitle}>Error Loading Data</Text>
          <Text style={styles.emptySubtitle}>{financeQuery.error?.message || 'Failed to load finance analytics'}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => financeQuery.refetch()}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return null;
  };

  const formatINR = (v: number) => `₹${formatIndianNumber(v)}`;

  const renderFinOverview = () => {
    const loadErr = renderFinLoadingError();
    if (loadErr) return loadErr;
    const data = financeQuery.data;
    if (!data || (data.totals.approvedAmount + data.totals.pendingAmount + data.totals.rejectedAmount) === 0) {
      return (
        <ScrollView style={styles.tabContent} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
          {renderDateFilter()}
          <View style={styles.emptyContainer}>
            <IndianRupee size={48} color={Colors.light.textSecondary} />
            <Text style={styles.emptyTitle}>No Finance Data</Text>
            <Text style={styles.emptySubtitle}>Collection entries will appear here once submitted</Text>
          </View>
        </ScrollView>
      );
    }
    const t = data.totals;
    // Aggregate by type from byEmployee for overview breakdown
    const typeTotals: Record<string, number> = { FIN_LC: 0, FIN_LL_FTTH: 0, FIN_TOWER: 0, FIN_GSM_POSTPAID: 0, FIN_RENT_BUILDING: 0 };
    for (const e of data.byEmployee) {
      typeTotals.FIN_LC += e.FIN_LC;
      typeTotals.FIN_LL_FTTH += e.FIN_LL_FTTH;
      typeTotals.FIN_TOWER += e.FIN_TOWER;
      typeTotals.FIN_GSM_POSTPAID += e.FIN_GSM_POSTPAID;
      typeTotals.FIN_RENT_BUILDING += e.FIN_RENT_BUILDING;
    }
    return (
      <ScrollView style={styles.tabContent} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        {renderDateFilter()}

        <View style={styles.summarySection}>
          <Text style={styles.sectionTitle}>Approval Status</Text>
          <View style={styles.summaryGrid}>
            <View style={[styles.summaryCardSm, { backgroundColor: '#E8F5E9' }]}>
              <Text style={[styles.summaryValueSm, { color: APPROVED_COLOR, fontSize: 18 }]} numberOfLines={1} adjustsFontSizeToFit>{formatINR(t.approvedAmount)}</Text>
              <Text style={styles.summaryLabel}>Approved</Text>
              <Text style={styles.summarySubValue}>{formatNumber(t.approvedEntries)} entries</Text>
            </View>
            <View style={[styles.summaryCardSm, { backgroundColor: '#FFF3E0' }]}>
              <Text style={[styles.summaryValueSm, { color: PENDING_COLOR, fontSize: 18 }]} numberOfLines={1} adjustsFontSizeToFit>{formatINR(t.pendingAmount)}</Text>
              <Text style={styles.summaryLabel}>Pending</Text>
              <Text style={styles.summarySubValue}>{formatNumber(t.pendingEntries)} entries</Text>
            </View>
            <View style={[styles.summaryCardSm, { backgroundColor: '#FFEBEE' }]}>
              <Text style={[styles.summaryValueSm, { color: REJECTED_COLOR, fontSize: 18 }]} numberOfLines={1} adjustsFontSizeToFit>{formatINR(t.rejectedAmount)}</Text>
              <Text style={styles.summaryLabel}>Rejected</Text>
              <Text style={styles.summarySubValue}>{formatNumber(t.rejectedEntries)} entries</Text>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Approved Collections by Type</Text>
          <View style={styles.chartCard}>
            <ChartLegend
              items={Object.keys(typeTotals).map(k => ({ label: FIN_TYPE_LABELS[k], color: FIN_TYPE_COLORS[k] }))}
            />
            <GroupedBarChart
              items={Object.entries(typeTotals).map(([k, v]) => ({
                label: FIN_TYPE_LABELS[k],
                values: [{ value: v, color: FIN_TYPE_COLORS[k] }],
                trailing: formatINR(v),
              }))}
              rowHeight={40}
            />
          </View>
        </View>

        {data.byEmployee.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Top Collectors</Text>
            {data.byEmployee.slice(0, 5).map((m) => (
              <View key={m.id} style={styles.performerCard}>
                <View style={[styles.rankBadge, { backgroundColor: getRankColor(m.rank) + '20' }]}>
                  <Text style={[styles.rankText, { color: getRankColor(m.rank) }]}>#{m.rank}</Text>
                </View>
                <View style={styles.performerAvatar}>
                  <Text style={styles.performerInitials}>{getInitials(m.name)}</Text>
                </View>
                <View style={styles.performerInfo}>
                  <Text style={styles.performerName}>{m.name}</Text>
                  <Text style={styles.performerDesignation}>{m.designation}</Text>
                </View>
                <View style={styles.performerStats}>
                  <Text style={styles.performerStatValue}>{formatINR(m.total)}</Text>
                  <Text style={styles.performerStatLabel}>Collected</Text>
                </View>
              </View>
            ))}
            {data.byEmployee.length > 5 && (
              <TouchableOpacity style={styles.viewAllButton} onPress={() => setActiveTab('team')}>
                <Text style={styles.viewAllText}>View All Collectors</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>
    );
  };

  const renderFinTeam = () => {
    const loadErr = renderFinLoadingError();
    if (loadErr) return loadErr;
    const data = financeQuery.data;
    if (!data || data.byEmployee.length === 0) {
      return (
        <ScrollView style={styles.tabContent} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
          {renderDateFilter()}
          <View style={styles.emptyContainer}>
            <Users size={48} color={Colors.light.textSecondary} />
            <Text style={styles.emptyTitle}>No Collector Data</Text>
            <Text style={styles.emptySubtitle}>Collector rankings will appear once approved collections exist</Text>
          </View>
        </ScrollView>
      );
    }
    const grand = data.byEmployee.reduce((a, b) => a + b.total, 0);
    return (
      <ScrollView style={styles.tabContent} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        {renderDateFilter()}
        {grand > 0 && (
          <View style={styles.grandTotalCard}>
            <Text style={styles.grandTotalLabel}>Total Approved Collections</Text>
            <Text style={styles.grandTotalValue}>{formatINR(grand)}</Text>
          </View>
        )}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Contribution by Collector (Top 10)</Text>
          <View style={styles.chartCard}>
            <ChartLegend
              items={[
                { label: 'LC', color: FIN_LC_COLOR },
                { label: 'FTTH', color: FIN_LL_FTTH_COLOR },
                { label: 'Tower', color: FIN_TOWER_COLOR },
                { label: 'GSM', color: FIN_GSM_COLOR },
                { label: 'Rent', color: FIN_RENT_COLOR },
              ]}
            />
            <GroupedBarChart
              items={data.byEmployee.slice(0, 10).map(m => ({
                label: `#${m.rank} ${m.name}`,
                values: [
                  { value: m.FIN_LC, color: FIN_LC_COLOR },
                  { value: m.FIN_LL_FTTH, color: FIN_LL_FTTH_COLOR },
                  { value: m.FIN_TOWER, color: FIN_TOWER_COLOR },
                  { value: m.FIN_GSM_POSTPAID, color: FIN_GSM_COLOR },
                  { value: m.FIN_RENT_BUILDING, color: FIN_RENT_COLOR },
                ],
                trailing: `${m.contribution}%`,
              }))}
              rowHeight={52}
            />
          </View>
        </View>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Collector Rankings</Text>
          {data.byEmployee.map((m) => (
            <View key={m.id} style={styles.teamMemberCard}>
              <View style={[styles.rankBadge, { backgroundColor: getRankColor(m.rank) + '20' }]}>
                {m.rank <= 3 ? (
                  <Award size={16} color={getRankColor(m.rank)} />
                ) : (
                  <Text style={[styles.rankText, { color: getRankColor(m.rank) }]}>#{m.rank}</Text>
                )}
              </View>
              <View style={styles.teamMemberAvatar}>
                <Text style={styles.teamMemberInitials}>{getInitials(m.name)}</Text>
              </View>
              <View style={styles.teamMemberInfo}>
                <Text style={styles.teamMemberName}>{m.name}</Text>
                <Text style={styles.teamMemberDesignation}>{m.designation} | {m.circle}</Text>
                <Text style={styles.contributionText}>{m.contribution}% • {formatINR(m.total)}</Text>
              </View>
            </View>
          ))}
        </View>
        <View style={{ height: 100 }} />
      </ScrollView>
    );
  };

  const renderFinTrends = () => {
    const loadErr = renderFinLoadingError();
    if (loadErr) return loadErr;
    const data = financeQuery.data;
    if (!data || data.daily.length === 0) {
      return (
        <ScrollView style={styles.tabContent} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
          {renderDateFilter()}
          <View style={styles.emptyContainer}>
            <TrendingUp size={48} color={Colors.light.textSecondary} />
            <Text style={styles.emptyTitle}>No Trend Data</Text>
            <Text style={styles.emptySubtitle}>Collection trends will appear once approved data is available</Text>
          </View>
        </ScrollView>
      );
    }
    const allDays = eachDayInRange(period.startDate, period.endDate);
    const dailyMap = new Map(data.daily.map(d => [d.date, d]));
    const series = allDays.map(key => {
      const f = dailyMap.get(key) as any;
      return {
        date: key,
        FIN_LC: Number(f?.FIN_LC) || 0,
        FIN_LL_FTTH: Number(f?.FIN_LL_FTTH) || 0,
        FIN_TOWER: Number(f?.FIN_TOWER) || 0,
        FIN_GSM_POSTPAID: Number(f?.FIN_GSM_POSTPAID) || 0,
        FIN_RENT_BUILDING: Number(f?.FIN_RENT_BUILDING) || 0,
      };
    });
    const labels = series.map(d => {
      const [yy, mm, dd] = d.date.split('-').map(Number);
      const local = new Date(yy, (mm || 1) - 1, dd || 1);
      return local.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    });
    return (
      <ScrollView style={styles.tabContent} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        {renderDateFilter()}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Daily Approved Collections</Text>
          <View style={styles.chartCard}>
            <ChartLegend
              items={[
                { label: 'LC', color: FIN_LC_COLOR },
                { label: 'FTTH', color: FIN_LL_FTTH_COLOR },
                { label: 'Tower', color: FIN_TOWER_COLOR },
                { label: 'GSM', color: FIN_GSM_COLOR },
                { label: 'Rent', color: FIN_RENT_COLOR },
              ]}
            />
            <MultiLineChart
              labels={labels}
              series={[
                { label: 'LC', color: FIN_LC_COLOR, values: series.map(d => d.FIN_LC) },
                { label: 'FTTH', color: FIN_LL_FTTH_COLOR, values: series.map(d => d.FIN_LL_FTTH) },
                { label: 'Tower', color: FIN_TOWER_COLOR, values: series.map(d => d.FIN_TOWER) },
                { label: 'GSM', color: FIN_GSM_COLOR, values: series.map(d => d.FIN_GSM_POSTPAID) },
                { label: 'Rent', color: FIN_RENT_COLOR, values: series.map(d => d.FIN_RENT_BUILDING) },
              ]}
              height={240}
            />
          </View>
        </View>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Daily Stacked Volume</Text>
          <View style={styles.chartCard}>
            <ChartLegend
              items={[
                { label: 'LC', color: FIN_LC_COLOR },
                { label: 'FTTH', color: FIN_LL_FTTH_COLOR },
                { label: 'Tower', color: FIN_TOWER_COLOR },
                { label: 'GSM', color: FIN_GSM_COLOR },
                { label: 'Rent', color: FIN_RENT_COLOR },
              ]}
            />
            <StackedBarChart
              labels={labels}
              series={[
                { label: 'LC', color: FIN_LC_COLOR, values: series.map(d => d.FIN_LC) },
                { label: 'FTTH', color: FIN_LL_FTTH_COLOR, values: series.map(d => d.FIN_LL_FTTH) },
                { label: 'Tower', color: FIN_TOWER_COLOR, values: series.map(d => d.FIN_TOWER) },
                { label: 'GSM', color: FIN_GSM_COLOR, values: series.map(d => d.FIN_GSM_POSTPAID) },
                { label: 'Rent', color: FIN_RENT_COLOR, values: series.map(d => d.FIN_RENT_BUILDING) },
              ]}
              height={220}
            />
          </View>
        </View>
        <View style={{ height: 100 }} />
      </ScrollView>
    );
  };

  const headerTitle = category === 'sales' ? 'Sales & Marketing' : category === 'operations' ? 'Operations & Maintenance' : 'Finance Collections';

  const renderActiveContent = () => {
    if (category === 'sales') {
      if (activeTab === 'overview') return renderOverviewTab();
      if (activeTab === 'team') return renderTeamTab();
      return renderTrendsTab();
    }
    if (category === 'operations') {
      if (activeTab === 'overview') return renderOpsOverview();
      if (activeTab === 'team') return renderOpsTeam();
      return renderOpsTrends();
    }
    if (activeTab === 'overview') return renderFinOverview();
    if (activeTab === 'team') return renderFinTeam();
    return renderFinTrends();
  };

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <ChevronLeft size={24} color={Colors.light.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{headerTitle}</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.categoryBar}>
        <TouchableOpacity
          style={[styles.categoryPill, category === 'sales' && styles.categoryPillActive]}
          onPress={() => setCategory('sales')}
        >
          <ShoppingCart size={16} color={category === 'sales' ? '#fff' : Colors.light.textSecondary} />
          <Text style={[styles.categoryPillText, category === 'sales' && styles.categoryPillTextActive]}>S&M</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.categoryPill, category === 'operations' && styles.categoryPillActive]}
          onPress={() => setCategory('operations')}
        >
          <Wrench size={16} color={category === 'operations' ? '#fff' : Colors.light.textSecondary} />
          <Text style={[styles.categoryPillText, category === 'operations' && styles.categoryPillTextActive]}>O&M</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.categoryPill, category === 'finance' && styles.categoryPillActive]}
          onPress={() => setCategory('finance')}
        >
          <IndianRupee size={16} color={category === 'finance' ? '#fff' : Colors.light.textSecondary} />
          <Text style={[styles.categoryPillText, category === 'finance' && styles.categoryPillTextActive]}>Finance</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'overview' && styles.tabActive]}
          onPress={() => setActiveTab('overview')}
        >
          <BarChart3 size={18} color={activeTab === 'overview' ? Colors.light.primary : Colors.light.textSecondary} />
          <Text style={[styles.tabText, activeTab === 'overview' && styles.tabTextActive]}>Overview</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'team' && styles.tabActive]}
          onPress={() => setActiveTab('team')}
        >
          <Users size={18} color={activeTab === 'team' ? Colors.light.primary : Colors.light.textSecondary} />
          <Text style={[styles.tabText, activeTab === 'team' && styles.tabTextActive]}>Team</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'trends' && styles.tabActive]}
          onPress={() => setActiveTab('trends')}
        >
          <TrendingUp size={18} color={activeTab === 'trends' ? Colors.light.primary : Colors.light.textSecondary} />
          <Text style={[styles.tabText, activeTab === 'trends' && styles.tabTextActive]}>Trends</Text>
        </TouchableOpacity>
      </View>

      {renderActiveContent()}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.light.background,
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
    borderBottomColor: Colors.light.border,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.light.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.light.text,
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    gap: 6,
    borderRadius: 8,
  },
  tabActive: {
    backgroundColor: '#E3F2FD',
  },
  tabText: {
    fontSize: 14,
    color: Colors.light.textSecondary,
    fontWeight: '500',
  },
  tabTextActive: {
    color: Colors.light.primary,
    fontWeight: '600',
  },
  tabContent: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    color: Colors.light.textSecondary,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 12,
  },
  retryButton: {
    marginTop: 12,
    backgroundColor: Colors.light.primary,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.light.text,
  },
  emptySubtitle: {
    fontSize: 14,
    color: Colors.light.textSecondary,
    textAlign: 'center',
  },
  summarySection: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.light.text,
    marginBottom: 12,
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'space-between',
  },
  summaryCard: {
    flex: 1,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  summaryIconWrapper: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  summaryValue: {
    fontSize: 28,
    fontWeight: '700',
    color: Colors.light.text,
  },
  summaryLabel: {
    fontSize: 14,
    color: Colors.light.textSecondary,
    marginTop: 4,
  },
  activationBadge: {
    marginTop: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: '#fff',
    borderRadius: 12,
  },
  activationText: {
    fontSize: 12,
    color: Colors.light.textSecondary,
  },
  totalEntriesCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 12,
    marginTop: 12,
  },
  totalEntriesLabel: {
    fontSize: 14,
    color: Colors.light.textSecondary,
  },
  totalEntriesValue: {
    fontSize: 20,
    fontWeight: '600',
    color: Colors.light.text,
  },
  summarySubValue: {
    fontSize: 12,
    color: Colors.light.textSecondary,
    marginTop: 6,
  },
  donutRow: {
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-around',
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 8,
  },
  donutCard: {
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  donutCardLabel: {
    fontSize: 12,
    color: Colors.light.textSecondary,
    fontWeight: '500',
  },
  chartCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
  },
  section: {
    padding: 16,
    paddingTop: 8,
  },
  performerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 12,
    marginBottom: 8,
    gap: 12,
  },
  rankBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankText: {
    fontSize: 12,
    fontWeight: '600',
  },
  performerAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.light.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  performerInitials: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  performerInfo: {
    flex: 1,
  },
  performerName: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.light.text,
  },
  performerDesignation: {
    fontSize: 12,
    color: Colors.light.textSecondary,
  },
  performerStats: {
    alignItems: 'flex-end',
  },
  performerStatValue: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.light.primary,
  },
  performerStatLabel: {
    fontSize: 11,
    color: Colors.light.textSecondary,
  },
  viewAllButton: {
    alignItems: 'center',
    paddingVertical: 12,
    marginTop: 4,
  },
  viewAllText: {
    fontSize: 14,
    color: Colors.light.primary,
    fontWeight: '600',
  },
  eventCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 12,
    marginBottom: 8,
  },
  eventInfo: {
    flex: 1,
  },
  eventName: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.light.text,
  },
  eventCategory: {
    fontSize: 12,
    color: Colors.light.textSecondary,
    marginTop: 2,
  },
  eventStats: {
    flexDirection: 'row',
    gap: 16,
  },
  eventStatItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  eventStatValue: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.light.text,
  },
  recentEntryCard: {
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 12,
    marginBottom: 8,
  },
  recentEntryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  recentEntryName: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.light.text,
  },
  recentEntryDate: {
    fontSize: 12,
    color: Colors.light.textSecondary,
  },
  recentEntryStats: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
  },
  recentEntryStat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  recentEntryStatText: {
    fontSize: 12,
    color: Colors.light.textSecondary,
  },
  customerTypeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  customerTypeText: {
    fontSize: 10,
    fontWeight: '600',
  },
  teamMemberCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 12,
    marginBottom: 8,
    gap: 12,
  },
  teamMemberAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.light.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  teamMemberInitials: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  teamMemberInfo: {
    flex: 1,
  },
  teamMemberName: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.light.text,
  },
  teamMemberDesignation: {
    fontSize: 12,
    color: Colors.light.textSecondary,
    marginTop: 2,
  },
  teamMemberStatsColumn: {
    alignItems: 'flex-end',
    gap: 4,
  },
  teamMemberStatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  teamMemberStatValue: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.light.text,
    minWidth: 30,
    textAlign: 'right',
  },
  dateFilterSection: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 12,
  },
  trendSummarySection: {
    padding: 16,
    paddingTop: 0,
  },
  trendSummaryGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  trendSummaryCard: {
    flex: 1,
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  trendSummaryValue: {
    fontSize: 24,
    fontWeight: '700',
    color: Colors.light.text,
  },
  trendSummaryLabel: {
    fontSize: 14,
    color: Colors.light.textSecondary,
    marginTop: 4,
  },
  trendSummaryAvg: {
    fontSize: 12,
    color: Colors.light.primary,
    marginTop: 4,
  },
  chartLegend: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 12,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendText: {
    fontSize: 12,
    color: Colors.light.textSecondary,
  },
  dailyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 12,
  },
  dailyDate: {
    fontSize: 12,
    color: Colors.light.textSecondary,
    width: 50,
  },
  dailyBars: {
    flex: 1,
    gap: 4,
  },
  barContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 16,
    gap: 6,
  },
  bar: {
    height: 12,
    borderRadius: 6,
    minWidth: 4,
  },
  barValue: {
    fontSize: 11,
    color: Colors.light.textSecondary,
    minWidth: 24,
  },
  grandTotalCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: Colors.light.primary,
    margin: 16,
    marginBottom: 0,
    padding: 16,
    borderRadius: 12,
  },
  grandTotalLabel: {
    fontSize: 14,
    color: '#fff',
    opacity: 0.9,
  },
  grandTotalValue: {
    fontSize: 24,
    fontWeight: '700',
    color: '#fff',
  },
  contributionText: {
    fontSize: 11,
    color: Colors.light.primary,
    marginTop: 2,
  },
  categoryBar: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  categoryPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
    paddingHorizontal: 8,
    borderRadius: 20,
    backgroundColor: Colors.light.background,
    borderWidth: 1,
    borderColor: Colors.light.border,
    gap: 6,
  },
  categoryPillActive: {
    backgroundColor: Colors.light.primary,
    borderColor: Colors.light.primary,
  },
  categoryPillText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.light.textSecondary,
  },
  categoryPillTextActive: {
    color: '#fff',
  },
  summaryCardSm: {
    width: '48%',
    padding: 12,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 8,
  },
  summaryValueSm: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.light.text,
  },
  trendSummaryCardSm: {
    width: '48%',
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 8,
  },
  trendSummaryValueSm: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.light.text,
  },
});
