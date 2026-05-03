import { useMemo, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl, Platform } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { ChevronLeft, Activity, AlertTriangle, Clock, CheckCircle, Flag, MapPin, ChevronRight, ArrowUpRight } from 'lucide-react-native';
import { useAuth } from '@/contexts/auth';
import Colors from '@/constants/colors';
import { trpc } from '@/lib/trpc';
import { isAdminRole } from '@/constants/app';
import { computePeriodRange, formatPeriodLabel, type PeriodRange } from '@/utils/timePeriod';
import TimePeriodPicker from '@/components/TimePeriodPicker';

const HEALTH_COLORS = {
  green: { bg: '#E6F7EE', border: '#1FA463', text: '#0F7B45', label: 'Healthy' },
  amber: { bg: '#FFF4E0', border: '#E5A100', text: '#7A5500', label: 'Watch' },
  red:   { bg: '#FDE8E8', border: '#D32F2F', text: '#8A1A1A', label: 'Critical' },
} as const;

const prettyCircle = (c: string) => c.replace(/_/g, ' ');

export default function CmdTasksScreen() {
  const router = useRouter();
  const { employee } = useAuth();
  const role = employee?.role || 'SALES_STAFF';
  const allowed = isAdminRole(role);

  const [period, setPeriod] = useState<PeriodRange>(() => computePeriodRange('mtd'));
  const [refreshing, setRefreshing] = useState(false);

  const enabled = allowed && !!employee?.id;

  const kpisQ = trpc.events.getNationalTaskKPIs.useQuery(
    { startDate: period.startDate, endDate: period.endDate },
    { enabled }
  );
  const gridQ = trpc.events.getCircleHealthGrid.useQuery(
    { startDate: period.startDate, endDate: period.endDate },
    { enabled }
  );
  const attnQ = trpc.events.getCmdAttentionList.useQuery(
    { limit: 25 },
    { enabled }
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([kpisQ.refetch(), gridQ.refetch(), attnQ.refetch()]);
    setRefreshing(false);
  }, [kpisQ, gridQ, attnQ]);

  const summary = useMemo(() => {
    const grid = gridQ.data?.grid || [];
    const red = grid.filter((g) => g.health === 'red').length;
    const amber = grid.filter((g) => g.health === 'amber').length;
    const green = grid.filter((g) => g.health === 'green').length;
    return { red, amber, green, total: grid.length };
  }, [gridQ.data]);

  if (!allowed) {
    return (
      <>
        <Stack.Screen options={{ title: 'Executive View', headerStyle: { backgroundColor: Colors.light.primary }, headerTintColor: Colors.light.background }} />
        <View style={styles.deniedContainer}>
          <AlertTriangle size={42} color={Colors.light.error} />
          <Text style={styles.deniedTitle}>Restricted</Text>
          <Text style={styles.deniedText}>The Executive Tasks Console is available to CMD and ADMIN users only.</Text>
          <TouchableOpacity style={styles.deniedBtn} onPress={() => router.back()}>
            <Text style={styles.deniedBtnText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Executive Tasks Console',
          headerStyle: { backgroundColor: Colors.light.primary },
          headerTintColor: Colors.light.background,
          headerLeft: () => (
            <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn}>
              <ChevronLeft size={24} color={Colors.light.background} />
            </TouchableOpacity>
          ),
        }}
      />

      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.contentContainer}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Period selector */}
        <View style={styles.periodRow}>
          <TimePeriodPicker value={period} onChange={setPeriod} />
        </View>

        {/* Tier 1: KPI strip */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>National Pulse</Text>
          {kpisQ.isLoading ? (
            <ActivityIndicator color={Colors.light.primary} style={{ marginVertical: 16 }} />
          ) : kpisQ.error ? (
            <Text style={styles.errorText}>Failed to load KPIs: {kpisQ.error.message}</Text>
          ) : (
            <View style={styles.kpiGrid}>
              <KpiTile icon={<Activity size={20} color="#fff" />} label="Active" value={kpisQ.data?.active ?? 0} bg={Colors.light.primary} />
              <KpiTile icon={<AlertTriangle size={20} color="#fff" />} label="Overdue" value={kpisQ.data?.overdue ?? 0} bg="#D32F2F" highlight />
              <KpiTile icon={<Clock size={20} color="#fff" />} label="At Risk (48h)" value={kpisQ.data?.atRisk ?? 0} bg="#E5A100" />
              <KpiTile icon={<CheckCircle size={20} color="#fff" />} label="Completed" value={kpisQ.data?.completedInPeriod ?? 0} bg="#1FA463" sublabel={formatPeriodLabel(period)} />
              <KpiTile icon={<Flag size={20} color="#fff" />} label="Escalated" value={kpisQ.data?.escalated ?? 0} bg="#6B3FA0" />
            </View>
          )}
        </View>

        {/* Tier 2: Circle health grid */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Circles ({summary.total})</Text>
            <Text style={styles.healthLegend}>
              <Text style={{ color: '#D32F2F', fontWeight: '700' }}>● {summary.red}</Text>
              {'  '}
              <Text style={{ color: '#E5A100', fontWeight: '700' }}>● {summary.amber}</Text>
              {'  '}
              <Text style={{ color: '#1FA463', fontWeight: '700' }}>● {summary.green}</Text>
            </Text>
          </View>

          {gridQ.isLoading ? (
            <ActivityIndicator color={Colors.light.primary} style={{ marginVertical: 16 }} />
          ) : gridQ.error ? (
            <Text style={styles.errorText}>Failed to load circles: {gridQ.error.message}</Text>
          ) : (
            <View style={styles.circleGrid}>
              {(gridQ.data?.grid ?? []).map((c) => {
                const palette = HEALTH_COLORS[c.health];
                return (
                  <TouchableOpacity
                    key={c.circle}
                    style={[styles.circleCard, { backgroundColor: palette.bg, borderLeftColor: palette.border }]}
                    activeOpacity={0.7}
                    onPress={() => router.push(`/(tabs)/events?circle=${encodeURIComponent(c.circle)}`)}
                  >
                    <View style={styles.circleHeader}>
                      <MapPin size={14} color={palette.text} />
                      <Text style={[styles.circleName, { color: palette.text }]} numberOfLines={1}>
                        {prettyCircle(c.circle)}
                      </Text>
                    </View>
                    <View style={styles.circleStatsRow}>
                      <View style={styles.circleStat}>
                        <Text style={styles.circleStatNum}>{c.active}</Text>
                        <Text style={styles.circleStatLbl}>Active</Text>
                      </View>
                      <View style={styles.circleStat}>
                        <Text style={[styles.circleStatNum, c.overdue > 0 && { color: '#D32F2F' }]}>{c.overdue}</Text>
                        <Text style={styles.circleStatLbl}>Overdue</Text>
                      </View>
                      <View style={styles.circleStat}>
                        <Text style={[styles.circleStatNum, c.atRisk > 0 && { color: '#E5A100' }]}>{c.atRisk}</Text>
                        <Text style={styles.circleStatLbl}>At Risk</Text>
                      </View>
                    </View>
                    <View style={styles.circleFooter}>
                      <Text style={[styles.circleHealthBadge, { color: palette.text, borderColor: palette.border }]}>
                        {palette.label} • {c.overduePct}% late
                      </Text>
                      {c.escalatedOpen > 0 && (
                        <Text style={styles.circleEscBadge}>⚑ {c.escalatedOpen}</Text>
                      )}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </View>

        {/* Tier 3: Needs attention */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Needs Your Attention</Text>
            <TouchableOpacity onPress={() => router.push('/(tabs)/events')}>
              <Text style={styles.viewAllLink}>View all tasks →</Text>
            </TouchableOpacity>
          </View>

          {attnQ.isLoading ? (
            <ActivityIndicator color={Colors.light.primary} style={{ marginVertical: 16 }} />
          ) : attnQ.error ? (
            <Text style={styles.errorText}>Failed to load attention list: {attnQ.error.message}</Text>
          ) : (
            <>
              {(attnQ.data?.overdue ?? []).length === 0 && (attnQ.data?.escalated ?? []).length === 0 ? (
                <View style={styles.emptyAttn}>
                  <CheckCircle size={36} color="#1FA463" />
                  <Text style={styles.emptyAttnText}>Nothing requires your attention.</Text>
                  <Text style={styles.emptyAttnSub}>No overdue tasks and no top-management escalations.</Text>
                </View>
              ) : (
                <>
                  {(attnQ.data?.escalated ?? []).length > 0 && (
                    <View style={styles.attnGroup}>
                      <Text style={styles.attnGroupTitle}>Escalations to top management ({attnQ.data!.totalEscalated})</Text>
                      {attnQ.data!.escalated.map((e) => (
                        <TouchableOpacity
                          key={`esc-${e.issueId}`}
                          style={[styles.attnRow, { borderLeftColor: '#6B3FA0' }]}
                          activeOpacity={0.7}
                          onPress={() => router.push(`/event-detail?id=${e.eventId}`)}
                        >
                          <View style={styles.attnRowMain}>
                            <Text style={styles.attnTitle} numberOfLines={1}>{e.title}</Text>
                            <Text style={styles.attnMeta} numberOfLines={1}>
                              {prettyCircle(e.circle)} • {e.issueType} • Open {e.daysOpen}d
                            </Text>
                            <Text style={styles.attnDesc} numberOfLines={2}>{e.description}</Text>
                            <Text style={styles.attnFoot} numberOfLines={1}>
                              Raised by {e.escalatorName ?? '—'} ({e.escalatorRole ?? '—'}) → {e.escalateeName ?? '—'} ({e.escalateeRole ?? '—'})
                            </Text>
                          </View>
                          <ChevronRight size={18} color={Colors.light.textSecondary} />
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}

                  {(attnQ.data?.overdue ?? []).length > 0 && (
                    <View style={styles.attnGroup}>
                      <Text style={styles.attnGroupTitle}>Overdue tasks ({attnQ.data!.totalOverdue})</Text>
                      {attnQ.data!.overdue.map((o) => (
                        <TouchableOpacity
                          key={`ov-${o.eventId}`}
                          style={[styles.attnRow, { borderLeftColor: '#D32F2F' }]}
                          activeOpacity={0.7}
                          onPress={() => router.push(`/event-detail?id=${o.eventId}`)}
                        >
                          <View style={styles.attnRowMain}>
                            <Text style={styles.attnTitle} numberOfLines={1}>{o.title}</Text>
                            <Text style={styles.attnMeta} numberOfLines={1}>
                              {prettyCircle(o.circle)} • {o.taskCategory} • {o.daysOverdue}d overdue
                            </Text>
                            <Text style={styles.attnFoot} numberOfLines={1}>
                              Assigned to {o.assigneeName ?? 'Unassigned'} {o.assigneeRole ? `(${o.assigneeRole})` : ''}
                            </Text>
                          </View>
                          <ArrowUpRight size={18} color={Colors.light.textSecondary} />
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                </>
              )}
            </>
          )}
        </View>

        <View style={{ height: 24 }} />
      </ScrollView>
    </>
  );
}

function KpiTile({
  icon, label, value, bg, sublabel, highlight,
}: { icon: React.ReactNode; label: string; value: number; bg: string; sublabel?: string; highlight?: boolean }) {
  return (
    <View style={[styles.kpiTile, { backgroundColor: bg }, highlight && styles.kpiTileHighlight]}>
      <View style={styles.kpiHeader}>{icon}</View>
      <Text style={styles.kpiValue}>{value.toLocaleString('en-IN')}</Text>
      <Text style={styles.kpiLabel} numberOfLines={1}>{label}</Text>
      {sublabel ? <Text style={styles.kpiSub} numberOfLines={1}>{sublabel}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F4F6F8' },
  contentContainer: { paddingBottom: 24 },
  headerBtn: { padding: 8 },
  periodRow: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },

  section: { backgroundColor: '#fff', marginTop: 8, paddingHorizontal: 16, paddingVertical: 14 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: Colors.light.text, marginBottom: 10 },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  errorText: { color: Colors.light.error, fontSize: 13, padding: 8 },

  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  kpiTile: { flexBasis: Platform.OS === 'web' ? 160 : '47%', flexGrow: 1, padding: 12, borderRadius: 12, minHeight: 92 },
  kpiTileHighlight: { borderWidth: 2, borderColor: '#fff', shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  kpiHeader: { flexDirection: 'row', alignItems: 'center' },
  kpiValue: { fontSize: 26, fontWeight: '800', color: '#fff', marginTop: 6 },
  kpiLabel: { fontSize: 12, color: 'rgba(255,255,255,0.92)', fontWeight: '600' },
  kpiSub: { fontSize: 10, color: 'rgba(255,255,255,0.85)', marginTop: 2 },

  healthLegend: { fontSize: 13 },

  circleGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  circleCard: {
    flexBasis: Platform.OS === 'web' ? 220 : '47%', flexGrow: 1,
    padding: 12, borderRadius: 10, borderLeftWidth: 4, minHeight: 110,
  },
  circleHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  circleName: { fontSize: 13, fontWeight: '700', flex: 1 },
  circleStatsRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  circleStat: { alignItems: 'center', flex: 1 },
  circleStatNum: { fontSize: 18, fontWeight: '700', color: Colors.light.text },
  circleStatLbl: { fontSize: 10, color: Colors.light.textSecondary, marginTop: 2 },
  circleFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  circleHealthBadge: { fontSize: 10, fontWeight: '700', borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  circleEscBadge: { fontSize: 11, fontWeight: '700', color: '#6B3FA0' },

  viewAllLink: { color: Colors.light.primary, fontWeight: '600', fontSize: 13 },
  emptyAttn: { alignItems: 'center', paddingVertical: 24, gap: 6 },
  emptyAttnText: { fontSize: 15, fontWeight: '600', color: Colors.light.text },
  emptyAttnSub: { fontSize: 12, color: Colors.light.textSecondary },

  attnGroup: { marginTop: 8 },
  attnGroupTitle: { fontSize: 12, fontWeight: '700', color: Colors.light.textSecondary, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  attnRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#F8F9FB', borderRadius: 10, padding: 12,
    marginBottom: 8, borderLeftWidth: 4, gap: 8,
  },
  attnRowMain: { flex: 1 },
  attnTitle: { fontSize: 14, fontWeight: '700', color: Colors.light.text },
  attnMeta: { fontSize: 12, color: Colors.light.textSecondary, marginTop: 2 },
  attnDesc: { fontSize: 12, color: Colors.light.text, marginTop: 4 },
  attnFoot: { fontSize: 11, color: Colors.light.textSecondary, marginTop: 4 },

  deniedContainer: { flex: 1, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  deniedTitle: { fontSize: 18, fontWeight: '700', color: Colors.light.text },
  deniedText: { fontSize: 14, color: Colors.light.textSecondary, textAlign: 'center' },
  deniedBtn: { marginTop: 12, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 10, backgroundColor: Colors.light.primary },
  deniedBtnText: { color: '#fff', fontWeight: '700' },
});
