import { View, Text, StyleSheet, TouchableOpacity, ScrollView, RefreshControl, ActivityIndicator } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { ChevronLeft, TrendingUp, Users, BarChart3, Award, Smartphone, Wifi, AlertCircle } from 'lucide-react-native';
import { useState, useCallback, useMemo } from 'react';
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

const SIM_COLOR = '#1976D2';
const FTTH_COLOR = '#388E3C';
const SIM_ACT_COLOR = '#64B5F6';
const FTTH_ACT_COLOR = '#81C784';

type TabType = 'overview' | 'team' | 'trends';

export default function SalesScreen() {
  const router = useRouter();
  const { employee } = useAuth();
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [refreshing, setRefreshing] = useState(false);
  const [dateRange, setDateRange] = useState<'7' | '30' | '90'>('30');

  const dateRangeParams = useMemo(() => {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(dateRange));
    return {
      startDate: startDate.toISOString().split('T')[0],
      endDate: endDate.toISOString().split('T')[0],
    };
  }, [dateRange]);

  const analyticsQuery = trpc.sales.getSalesAnalytics.useQuery(
    { 
      employeeId: employee?.id || '',
      circle: employee?.circle || undefined,
      startDate: dateRangeParams.startDate,
      endDate: dateRangeParams.endDate,
    },
    { 
      enabled: !!employee?.id,
      staleTime: 60000,
    }
  );

  const teamQuery = trpc.sales.getTeamPerformance.useQuery(
    { 
      employeeId: employee?.id || '', 
      days: parseInt(dateRange), 
      limit: 20,
      circle: employee?.circle || undefined,
    },
    { 
      enabled: !!employee?.id && activeTab === 'team',
      staleTime: 60000,
    }
  );

  const trendsQuery = trpc.sales.getSalesTrends.useQuery(
    { 
      employeeId: employee?.id || '', 
      days: parseInt(dateRange),
      circle: employee?.circle || undefined,
    },
    { 
      enabled: !!employee?.id && activeTab === 'trends',
      staleTime: 60000,
    }
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      analyticsQuery.refetch(),
      teamQuery.refetch(),
      trendsQuery.refetch(),
    ]);
    setRefreshing(false);
  }, [analyticsQuery, teamQuery, trendsQuery]);

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
        <View style={styles.emptyContainer}>
          <BarChart3 size={48} color={Colors.light.textSecondary} />
          <Text style={styles.emptyTitle}>No Sales Data</Text>
          <Text style={styles.emptySubtitle}>Sales entries will appear here once submitted</Text>
        </View>
      );
    }

    const { totals, byEmployee, byEvent, recentEntries } = data;

    return (
      <ScrollView
        style={styles.tabContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.dateFilterSection}>
          <Text style={styles.filterLabel}>Time Period:</Text>
          <View style={styles.dateFilterButtons}>
            {(['7', '30', '90'] as const).map((days) => (
              <TouchableOpacity
                key={days}
                style={[styles.dateFilterButton, dateRange === days && styles.dateFilterButtonActive]}
                onPress={() => setDateRange(days)}
              >
                <Text style={[styles.dateFilterButtonText, dateRange === days && styles.dateFilterButtonTextActive]}>
                  {days} Days
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.summarySection}>
          <Text style={styles.sectionTitle}>Sales Summary</Text>
          <View style={styles.summaryGrid}>
            <View style={[styles.summaryCard, { backgroundColor: '#E3F2FD' }]}>
              <View style={styles.summaryIconWrapper}>
                <Smartphone size={20} color={SIM_COLOR} />
              </View>
              <Text style={styles.summaryValue}>{formatNumber(totals.simsSold)}</Text>
              <Text style={styles.summaryLabel}>SIMs Sold</Text>
              <Text style={styles.summarySubValue}>{formatNumber(totals.simsActivated)} activated</Text>
            </View>
            <View style={[styles.summaryCard, { backgroundColor: '#E8F5E9' }]}>
              <View style={styles.summaryIconWrapper}>
                <Wifi size={20} color={FTTH_COLOR} />
              </View>
              <Text style={styles.summaryValue}>{formatNumber(totals.ftthSold)}</Text>
              <Text style={styles.summaryLabel}>FTTH Sold</Text>
              <Text style={styles.summarySubValue}>{formatNumber(totals.ftthActivated)} activated</Text>
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

        {byEmployee.length > 0 && (totals.simsSold > 0 || totals.ftthSold > 0) && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Top Performers (Sold vs Activated)</Text>
            <View style={styles.chartCard}>
              <ChartLegend
                items={[
                  { label: 'SIM Sold', color: SIM_COLOR },
                  { label: 'SIM Activated', color: SIM_ACT_COLOR },
                  { label: 'FTTH Sold', color: FTTH_COLOR },
                  { label: 'FTTH Activated', color: FTTH_ACT_COLOR },
                ]}
              />
              <GroupedBarChart
                items={byEmployee.slice(0, 5).map(emp => ({
                  label: emp.name,
                  values: [
                    { value: emp.simsSold, color: SIM_COLOR },
                    { value: emp.simsActivated, color: SIM_ACT_COLOR },
                    { value: emp.ftthSold, color: FTTH_COLOR },
                    { value: emp.ftthActivated, color: FTTH_ACT_COLOR },
                  ],
                  trailing: formatIndianNumber(emp.simsSold + emp.ftthSold),
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
                  <Text style={styles.performerStatValue}>{emp.simsSold + emp.ftthSold}</Text>
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
        <View style={styles.emptyContainer}>
          <Users size={48} color={Colors.light.textSecondary} />
          <Text style={styles.emptyTitle}>No Team Data</Text>
          <Text style={styles.emptySubtitle}>Team performance will appear once sales are submitted</Text>
        </View>
      );
    }

    return (
      <ScrollView
        style={styles.tabContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.dateFilterSection}>
          <Text style={styles.filterLabel}>Time Period:</Text>
          <View style={styles.dateFilterButtons}>
            {(['7', '30', '90'] as const).map((days) => (
              <TouchableOpacity
                key={days}
                style={[styles.dateFilterButton, dateRange === days && styles.dateFilterButtonActive]}
                onPress={() => setDateRange(days)}
              >
                <Text style={[styles.dateFilterButtonText, dateRange === days && styles.dateFilterButtonTextActive]}>
                  {days} Days
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

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
                ]}
              />
              <GroupedBarChart
                items={data.rankings.slice(0, 10).map(m => ({
                  label: `#${m.rank} ${m.name}`,
                  values: [
                    { value: m.simsSold, color: SIM_COLOR },
                    { value: m.ftthSold, color: FTTH_COLOR },
                  ],
                  trailing: `${m.contribution ?? 0}%`,
                }))}
                rowHeight={40}
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
                  <Smartphone size={12} color={Colors.light.primary} />
                  <Text style={styles.teamMemberStatValue}>{member.simsSold}</Text>
                </View>
                <View style={styles.teamMemberStatRow}>
                  <Wifi size={12} color="#388E3C" />
                  <Text style={styles.teamMemberStatValue}>{member.ftthSold}</Text>
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
        <View style={styles.emptyContainer}>
          <TrendingUp size={48} color={Colors.light.textSecondary} />
          <Text style={styles.emptyTitle}>No Trend Data</Text>
          <Text style={styles.emptySubtitle}>Sales trends will appear once data is available</Text>
        </View>
      );
    }

    // Build a continuous date series across the full requested window so missing
    // days render as zero (avoids misleading gaps and the prior `slice(-14)` bug
    // that ignored the 30/90-day selection). Build keys from local date parts
    // (NOT toISOString) so positive-offset timezones like IST don't shift the
    // local day backwards by one when serialised to UTC.
    const days = parseInt(dateRange);
    const dailyMap = new Map(data.daily.map(d => [d.date, d]));
    const toLocalKey = (d: Date) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };
    const fullSeries: { date: string; simsSold: number; ftthSold: number; simsActivated: number; ftthActivated: number }[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = days - 1; i >= 0; i--) {
      const dt = new Date(today);
      dt.setDate(dt.getDate() - i);
      const key = toLocalKey(dt);
      const found = dailyMap.get(key);
      fullSeries.push({
        date: key,
        simsSold: Number(found?.simsSold) || 0,
        ftthSold: Number(found?.ftthSold) || 0,
        simsActivated: Number(found?.simsActivated) || 0,
        ftthActivated: Number(found?.ftthActivated) || 0,
      });
    }
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
        <View style={styles.dateFilterSection}>
          <Text style={styles.filterLabel}>Time Period:</Text>
          <View style={styles.dateFilterButtons}>
            {(['7', '30', '90'] as const).map((days) => (
              <TouchableOpacity
                key={days}
                style={[styles.dateFilterButton, dateRange === days && styles.dateFilterButtonActive]}
                onPress={() => setDateRange(days)}
              >
                <Text style={[styles.dateFilterButtonText, dateRange === days && styles.dateFilterButtonTextActive]}>
                  {days} Days
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {data.summary && (
          <View style={styles.trendSummarySection}>
            <Text style={styles.sectionTitle}>Summary</Text>
            <View style={styles.trendSummaryGrid}>
              <View style={styles.trendSummaryCard}>
                <Text style={styles.trendSummaryValue}>{formatNumber(data.summary.totalSims)}</Text>
                <Text style={styles.trendSummaryLabel}>Total SIMs</Text>
                <Text style={styles.trendSummaryAvg}>Avg: {formatNumber(data.summary.avgDailySims)}/day</Text>
              </View>
              <View style={styles.trendSummaryCard}>
                <Text style={styles.trendSummaryValue}>{formatNumber(data.summary.totalFtth)}</Text>
                <Text style={styles.trendSummaryLabel}>Total FTTH</Text>
                <Text style={styles.trendSummaryAvg}>Avg: {formatNumber(data.summary.avgDailyFtth)}/day</Text>
              </View>
            </View>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Daily Sales Trend</Text>
          <View style={styles.chartCard}>
            <ChartLegend
              items={[
                { label: 'SIMs Sold', color: SIM_COLOR },
                { label: 'FTTH Sold', color: FTTH_COLOR },
              ]}
            />
            <MultiLineChart
              labels={labels}
              series={[
                { label: 'SIMs Sold', color: SIM_COLOR, values: fullSeries.map(d => d.simsSold) },
                { label: 'FTTH Sold', color: FTTH_COLOR, values: fullSeries.map(d => d.ftthSold) },
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

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <ChevronLeft size={24} color={Colors.light.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Sales Reports</Text>
        <View style={{ width: 40 }} />
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

      {activeTab === 'overview' && renderOverviewTab()}
      {activeTab === 'team' && renderTeamTab()}
      {activeTab === 'trends' && renderTrendsTab()}
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
    gap: 12,
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
  filterLabel: {
    fontSize: 14,
    color: Colors.light.textSecondary,
  },
  dateFilterButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  dateFilterButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  dateFilterButtonActive: {
    backgroundColor: Colors.light.primary,
    borderColor: Colors.light.primary,
  },
  dateFilterButtonText: {
    fontSize: 13,
    color: Colors.light.textSecondary,
  },
  dateFilterButtonTextActive: {
    color: '#fff',
    fontWeight: '600',
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
});
