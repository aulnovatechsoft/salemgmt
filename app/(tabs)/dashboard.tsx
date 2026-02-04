import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Dimensions, Modal, FlatList, ActivityIndicator } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { TrendingUp, Calendar, Users, Target, Package, AlertCircle, Settings, ChevronRight, Clock, CalendarCheck, AlertTriangle, IndianRupee, X, Hourglass, CircleCheck, CircleDot, Send, RotateCcw, Award, DollarSign, Server, Wifi } from 'lucide-react-native';
import { useAuth } from '@/contexts/auth';
import { useApp } from '@/contexts/app';
import Colors from '@/constants/colors';
import { useMemo, useState } from 'react';
import React from "react";
import { Event } from '@/types';
import Svg, { Circle } from 'react-native-svg';
import { trpc } from '@/lib/trpc';
import { formatINRCrore, formatINRAmount, formatINRCompact, safeNumber } from '@/lib/currency';
import { canAccessAdminPanel, isAdminRole } from '@/constants/app';

const MAX_DISPLAYED_WORKS = 3;

const { width } = Dimensions.get('window');

export default function DashboardScreen() {
  const router = useRouter();
  const { employee } = useAuth();
  const { salesReports, resources, issues } = useApp();
  const [showAllActive, setShowAllActive] = useState(false);
  const [showAllCompleted, setShowAllCompleted] = useState(false);
  const [outstandingModal, setOutstandingModal] = useState<{ visible: boolean; type: 'ftth' | 'lc' }>({ visible: false, type: 'ftth' });
  const [ftthPendingModalVisible, setFtthPendingModalVisible] = useState(false);

  const isManagementRole = ['GM', 'CGM', 'DGM', 'AGM'].includes(employee?.role || '');

  const { data: myEventsData } = trpc.events.getMyEvents.useQuery(
    { employeeId: employee?.id || '' },
    {
      enabled: !!employee?.id,
      retry: 1,
      refetchOnWindowFocus: true,
      refetchInterval: 5000,
      staleTime: 0,
    }
  );
  
  const events: Event[] = useMemo(() => {
    if (!myEventsData) return [];
    const totalSim = myEventsData.reduce((acc: number, e: any) => acc + (e.simSold || 0), 0);
    const totalFtth = myEventsData.reduce((acc: number, e: any) => acc + (e.ftthSold || 0), 0);
    console.log("Dashboard sales totals - SIM:", totalSim, "FTTH:", totalFtth, "from", myEventsData.length, "events");
    return myEventsData.map((e: any) => ({
      id: e.id,
      name: e.name,
      location: e.location,
      circle: e.circle,
      zone: e.zone,
      dateRange: {
        startDate: e.startDate,
        endDate: e.endDate,
      },
      category: e.category,
      targetSim: e.targetSim,
      targetFtth: e.targetFtth,
      assignedTeam: e.assignedTeam || [],
      allocatedSim: e.allocatedSim,
      allocatedFtth: e.allocatedFtth,
      createdBy: e.createdBy,
      createdAt: e.createdAt,
      keyInsight: e.keyInsight,
      status: e.status || 'active',
      assignedTo: e.assignedTo,
      simsSold: e.simSold || 0,
      ftthSold: e.ftthSold || 0,
      teamMembers: e.teamMembers || [],
      creatorName: e.creatorName || null,
      assigneeName: e.assigneeName || null,
      assigneeDesignation: e.assigneeDesignation || null,
      targetEb: e.targetEb || 0,
      targetLease: e.targetLease || 0,
      targetBtsDown: e.targetBtsDown || 0,
      targetFtthDown: e.targetFtthDown || 0,
      targetRouteFail: e.targetRouteFail || 0,
      targetOfcFail: e.targetOfcFail || 0,
      ebCompleted: e.ebCompleted || 0,
      leaseCompleted: e.leaseCompleted || 0,
      btsDownCompleted: e.btsDownCompleted || 0,
      ftthDownCompleted: e.ftthDownCompleted || 0,
      routeFailCompleted: e.routeFailCompleted || 0,
      ofcFailCompleted: e.ofcFailCompleted || 0,
      submissionStatus: e.submissionStatus || 'not_started',
    }));
  }, [myEventsData]);

  const { data: outstandingSummary } = trpc.admin.getOutstandingSummary.useQuery(
    undefined,
    { enabled: isManagementRole }
  );

  const { data: outstandingEmployees, isLoading: loadingEmployees } = trpc.admin.getOutstandingEmployees.useQuery(
    { type: outstandingModal.type, limit: 200 },
    { enabled: outstandingModal.visible && isManagementRole }
  );

  const { data: ftthPendingSummary } = trpc.ftthPending.getSummary.useQuery(
    undefined,
    { enabled: isManagementRole }
  );

  const { data: kamEbGoldSummary } = trpc.admin.getKamEbGoldSummary.useQuery(
    { userId: employee?.id || '' },
    { enabled: !!employee?.id && isManagementRole }
  );

  const { data: oltSummary } = trpc.admin.getOltSummary.useQuery(
    { userId: employee?.id || '' },
    { enabled: !!employee?.id && isManagementRole }
  );

  const { data: ftthPendingEmployeesData, isLoading: loadingFtthPendingEmployees, error: ftthPendingError } = trpc.ftthPending.getEmployeesWithPending.useQuery(
    { limit: 200 },
    { enabled: ftthPendingModalVisible && isManagementRole }
  );

  const stats = useMemo(() => {
    const myEvents = events;
    
    // Calculate sales from live events data (from database via tRPC)
    const totalSimsSold = myEvents.reduce((acc, e) => acc + (e.simsSold || 0), 0);
    const totalFtthSold = myEvents.reduce((acc, e) => acc + (e.ftthSold || 0), 0);
    
    // Fallback to salesReports for activated counts if available
    const totalSimsActivated = salesReports.reduce((acc, r) => acc + r.simsActivated, 0);
    const totalFtthLeads = totalFtthSold;
    const totalFtthInstalled = salesReports.reduce((acc, r) => acc + r.ftthInstalled, 0);
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Count events by status
    const draftEvents = myEvents.filter(e => e.status === 'draft');
    const pausedEvents = myEvents.filter(e => e.status === 'paused');
    const completedEvents = myEvents.filter(e => e.status === 'completed');
    const cancelledEvents = myEvents.filter(e => e.status === 'cancelled');
    
    // Active events: status is 'active' OR (no special status AND currently running)
    const activeEvents = myEvents.filter(e => {
      if (['draft', 'paused', 'completed', 'cancelled'].includes(e.status)) return false;
      const startDate = new Date(e.dateRange.startDate);
      const endDate = new Date(e.dateRange.endDate);
      startDate.setHours(0, 0, 0, 0);
      endDate.setHours(23, 59, 59, 999);
      return startDate <= today && endDate >= today;
    });
    
    // Upcoming events: future start date
    const upcomingEvents = myEvents.filter(e => {
      if (['draft', 'paused', 'completed', 'cancelled'].includes(e.status)) return false;
      const startDate = new Date(e.dateRange.startDate);
      startDate.setHours(0, 0, 0, 0);
      return startDate > today;
    });
    
    // Past due events: end date passed, not completed/cancelled
    const pastDueEvents = myEvents.filter(e => {
      if (['draft', 'paused', 'completed', 'cancelled'].includes(e.status)) return false;
      const endDate = new Date(e.dateRange.endDate);
      endDate.setHours(23, 59, 59, 999);
      return endDate < today;
    });

    // Filter issues relevant to the current user
    const myRelevantIssues = issues.filter(i => {
      if (employee?.role === 'SALES_STAFF' || employee?.role === 'SD_JTO') {
        return i.raisedBy === employee?.id;
      }
      return i.escalatedTo === employee?.id || i.raisedBy === employee?.id;
    });
    const pendingIssues = myRelevantIssues.filter(i => i.status === 'OPEN' || i.status === 'IN_PROGRESS');

    const simResources = resources.find(r => r.type === 'SIM' && r.circle === employee?.circle);
    const ftthResources = resources.find(r => r.type === 'FTTH' && r.circle === employee?.circle);

    // Sort active events by start date (most recent first)
    const sortedActiveEvents = [...activeEvents].sort((a, b) => 
      new Date(b.dateRange.startDate).getTime() - new Date(a.dateRange.startDate).getTime()
    );

    // Get all completed events sorted by end date (most recent first)
    const recentCompletedEvents = [...completedEvents]
      .sort((a, b) => new Date(b.dateRange.endDate).getTime() - new Date(a.dateRange.endDate).getTime());

    return {
      draftEvents: draftEvents.length,
      activeEvents: activeEvents.length,
      upcomingEvents: upcomingEvents.length,
      pastDueEvents: pastDueEvents.length,
      pausedEvents: pausedEvents.length,
      completedEvents: completedEvents.length,
      cancelledEvents: cancelledEvents.length,
      totalEvents: myEvents.length,
      simsSold: totalSimsSold,
      simsActivated: totalSimsActivated,
      ftthLeads: totalFtthLeads,
      ftthInstalled: totalFtthInstalled,
      pendingIssues: pendingIssues.length,
      simAvailable: simResources?.remaining || 0,
      ftthAvailable: ftthResources?.remaining || 0,
      activeEventsList: sortedActiveEvents,
      recentCompletedList: recentCompletedEvents,
    };
  }, [events, salesReports, issues, resources, employee]);

  return (
    <>
      <Stack.Screen 
        options={{ 
          title: 'Dashboard',
          headerStyle: {
            backgroundColor: Colors.light.primary,
          },
          headerTintColor: Colors.light.background,
          headerTitleStyle: {
            fontWeight: 'bold' as const,
          },
          headerShown: true,
        }} 
      />
      <ScrollView style={styles.container}>
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>Welcome back,</Text>
            <Text style={styles.name}>{employee?.name}</Text>
            <Text style={styles.role}>{employee?.designation} - {employee?.circle}</Text>
          </View>
        </View>

        <View style={styles.statsGrid}>
          <StatCard
            icon={<Calendar size={24} color={Colors.light.primary} />}
            label="Total Tasks"
            value={stats.totalEvents.toString()}
            subtitle={`${stats.draftEvents} draft, ${stats.activeEvents} active`}
            color={Colors.light.primary}
            onPress={() => router.push('/(tabs)/events')}
          />
          <StatCard
            icon={<TrendingUp size={24} color={Colors.light.success} />}
            label="SIMs Sold"
            value={stats.simsSold.toString()}
            subtitle={`${stats.simsActivated} activated`}
            color={Colors.light.success}
            onPress={() => router.push('/sim-sales-detail')}
          />
          <StatCard
            icon={<Target size={24} color={Colors.light.info} />}
            label="FTTH Leads"
            value={stats.ftthLeads.toString()}
            subtitle={`${stats.ftthInstalled} installed`}
            color={Colors.light.info}
            onPress={() => router.push('/ftth-sales-detail')}
          />
          <StatCard
            icon={<AlertCircle size={24} color={Colors.light.error} />}
            label="Pending Issues"
            value={stats.pendingIssues.toString()}
            subtitle="Requires attention"
            color={stats.pendingIssues > 0 ? Colors.light.error : Colors.light.success}
            onPress={() => router.push('/(tabs)/issues')}
          />
        </View>

        {isManagementRole && (
          (outstandingSummary && (safeNumber(outstandingSummary.ftth.totalAmount) > 0 || safeNumber(outstandingSummary.lc.totalAmount) > 0)) ||
          (ftthPendingSummary && Number(ftthPendingSummary.totalPendingOrders) > 0)
        ) && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Outstanding & Pending Overview</Text>
            <View style={styles.outstandingCardsRow}>
              {outstandingSummary && safeNumber(outstandingSummary.ftth.totalAmount) > 0 && (
                <TouchableOpacity 
                  style={styles.outstandingCard}
                  onPress={() => setOutstandingModal({ visible: true, type: 'ftth' })}
                  activeOpacity={0.7}
                >
                  <View style={styles.outstandingCardHeader}>
                    <View style={[styles.outstandingIconContainer, { backgroundColor: '#FFEBEE' }]}>
                      <IndianRupee size={20} color="#D32F2F" />
                    </View>
                    <AlertTriangle size={16} color="#D32F2F" />
                  </View>
                  <Text style={styles.outstandingCardTitle}>FTTH Outstanding</Text>
                  <Text style={styles.outstandingCardAmount} numberOfLines={1} adjustsFontSizeToFit>{formatINRCompact(outstandingSummary.ftth.totalAmount)}</Text>
                  <Text style={styles.outstandingCardCount}>{outstandingSummary.ftth.employeeCount} employees</Text>
                  <View style={styles.outstandingCardAction}>
                    <Text style={styles.outstandingCardActionText}>View Details</Text>
                    <ChevronRight size={14} color="#D32F2F" />
                  </View>
                </TouchableOpacity>
              )}
              
              {outstandingSummary && safeNumber(outstandingSummary.lc.totalAmount) > 0 && (
                <TouchableOpacity 
                  style={styles.outstandingCard}
                  onPress={() => setOutstandingModal({ visible: true, type: 'lc' })}
                  activeOpacity={0.7}
                >
                  <View style={styles.outstandingCardHeader}>
                    <View style={[styles.outstandingIconContainer, { backgroundColor: '#FFF3E0' }]}>
                      <IndianRupee size={20} color="#E65100" />
                    </View>
                    <AlertTriangle size={16} color="#E65100" />
                  </View>
                  <Text style={styles.outstandingCardTitle}>LC Outstanding</Text>
                  <Text style={[styles.outstandingCardAmount, { color: '#E65100' }]} numberOfLines={1} adjustsFontSizeToFit>{formatINRCompact(outstandingSummary.lc.totalAmount)}</Text>
                  <Text style={styles.outstandingCardCount}>{outstandingSummary.lc.employeeCount} employees</Text>
                  <View style={styles.outstandingCardAction}>
                    <Text style={[styles.outstandingCardActionText, { color: '#E65100' }]}>View Details</Text>
                    <ChevronRight size={14} color="#E65100" />
                  </View>
                </TouchableOpacity>
              )}
              
              {ftthPendingSummary && Number(ftthPendingSummary.totalPendingOrders) > 0 && (
                <TouchableOpacity 
                  style={styles.outstandingCard}
                  onPress={() => setFtthPendingModalVisible(true)}
                  activeOpacity={0.7}
                >
                  <View style={styles.outstandingCardHeader}>
                    <View style={[styles.outstandingIconContainer, { backgroundColor: '#E3F2FD' }]}>
                      <Clock size={20} color="#1565C0" />
                    </View>
                    <AlertTriangle size={16} color="#1565C0" />
                  </View>
                  <Text style={styles.outstandingCardTitle}>FTTH Order Pending</Text>
                  <Text style={[styles.outstandingCardAmount, { color: '#1565C0' }]} numberOfLines={1} adjustsFontSizeToFit>{Number(ftthPendingSummary.totalPendingOrders).toLocaleString()}</Text>
                  <Text style={styles.outstandingCardCount}>{Number(ftthPendingSummary.uniqueEmployees).toLocaleString()} employees</Text>
                  <View style={styles.outstandingCardAction}>
                    <Text style={[styles.outstandingCardActionText, { color: '#1565C0' }]}>View Details</Text>
                    <ChevronRight size={14} color="#1565C0" />
                  </View>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}

        {isManagementRole && (kamEbGoldSummary || oltSummary) && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Management Reports</Text>
            <View style={styles.reportsRow}>
              {kamEbGoldSummary && (kamEbGoldSummary.totalPersonnel > 0 || kamEbGoldSummary.totalLeads > 0) && (
                <TouchableOpacity 
                  style={styles.consolidatedReportCard}
                  onPress={() => router.push('/kam-eb-gold-report')}
                  activeOpacity={0.7}
                >
                  <View style={styles.reportCardHeader}>
                    <View style={[styles.reportIconContainer, { backgroundColor: '#E3F2FD' }]}>
                      <Award size={22} color="#1565C0" />
                    </View>
                    <Text style={styles.reportCardTitle}>KAM EB Gold</Text>
                    <ChevronRight size={18} color="#1565C0" />
                  </View>
                  <View style={styles.reportMetricsRow}>
                    <View style={styles.reportMetricItem}>
                      <Target size={16} color="#1565C0" />
                      <Text style={styles.reportMetricValue}>{kamEbGoldSummary.totalLeads.toLocaleString()}</Text>
                      <Text style={styles.reportMetricLabel}>Leads</Text>
                    </View>
                    <View style={styles.reportMetricDivider} />
                    <View style={styles.reportMetricItem}>
                      <DollarSign size={16} color="#2E7D32" />
                      <Text style={[styles.reportMetricValue, { color: '#2E7D32' }]}>{kamEbGoldSummary.totalLeadValueCrore >= 100 ? `${kamEbGoldSummary.totalLeadValueCrore.toFixed(0)}` : kamEbGoldSummary.totalLeadValueCrore.toFixed(1)} Cr</Text>
                      <Text style={styles.reportMetricLabel}>Value</Text>
                    </View>
                    <View style={styles.reportMetricDivider} />
                    <View style={styles.reportMetricItem}>
                      <TrendingUp size={16} color="#7B1FA2" />
                      <Text style={[styles.reportMetricValue, { color: '#7B1FA2' }]}>{kamEbGoldSummary.leadToBillCrore >= 100 ? `${kamEbGoldSummary.leadToBillCrore.toFixed(0)}` : kamEbGoldSummary.leadToBillCrore.toFixed(1)} Cr</Text>
                      <Text style={styles.reportMetricLabel}>To Bill</Text>
                    </View>
                  </View>
                  <Text style={styles.reportSubtext}>{kamEbGoldSummary.totalPersonnel} personnel | {kamEbGoldSummary.ebExclusiveCount} EB exclusive</Text>
                </TouchableOpacity>
              )}
              
              {oltSummary && (
                <TouchableOpacity 
                  style={styles.consolidatedReportCard}
                  onPress={() => router.push('/olt-report')}
                  activeOpacity={0.7}
                >
                  <View style={styles.reportCardHeader}>
                    <View style={[styles.reportIconContainer, { backgroundColor: '#E8F5E9' }]}>
                      <Server size={22} color="#2E7D32" />
                    </View>
                    <Text style={styles.reportCardTitle}>BBM Wise OLT</Text>
                    <ChevronRight size={18} color="#2E7D32" />
                  </View>
                  <View style={styles.reportMetricsRow}>
                    <View style={styles.reportMetricItem}>
                      <Users size={16} color="#1565C0" />
                      <Text style={styles.reportMetricValue}>{oltSummary.uniquePersonnel.toLocaleString()}</Text>
                      <Text style={styles.reportMetricLabel}>Personnel</Text>
                    </View>
                    <View style={styles.reportMetricDivider} />
                    <View style={styles.reportMetricItem}>
                      <Wifi size={16} color="#2E7D32" />
                      <Text style={[styles.reportMetricValue, { color: '#2E7D32' }]}>{oltSummary.uniqueOltIps.toLocaleString()}</Text>
                      <Text style={styles.reportMetricLabel}>OLT IPs</Text>
                    </View>
                    <View style={styles.reportMetricDivider} />
                    <View style={styles.reportMetricItem}>
                      <Target size={16} color="#EF6C00" />
                      <Text style={[styles.reportMetricValue, { color: '#EF6C00' }]}>{oltSummary.totalRecords.toLocaleString()}</Text>
                      <Text style={styles.reportMetricLabel}>Records</Text>
                    </View>
                  </View>
                  <Text style={styles.reportSubtext}>Network infrastructure tracking</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Task Status Overview</Text>
          <View style={styles.eventStatusGrid}>
            <EventStatusBadge label="Draft" count={stats.draftEvents} color="#78909C" bg="#ECEFF1" />
            <EventStatusBadge label="Active" count={stats.activeEvents} color="#2E7D32" bg="#E8F5E9" />
            <EventStatusBadge label="Upcoming" count={stats.upcomingEvents} color="#1565C0" bg="#E3F2FD" />
            <EventStatusBadge label="Past Due" count={stats.pastDueEvents} color="#EF6C00" bg="#FFF3E0" />
            <EventStatusBadge label="Paused" count={stats.pausedEvents} color="#F57C00" bg="#FFF3E0" />
            <EventStatusBadge label="Completed" count={stats.completedEvents} color="#388E3C" bg="#E8F5E9" />
          </View>
        </View>

        {(stats.activeEventsList.length > 0 || stats.recentCompletedList.length > 0) && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Task Progress</Text>
            
            {stats.activeEventsList.length > 0 && (
              <View style={styles.progressSection}>
                <View style={styles.progressSectionHeader}>
                  <Text style={styles.progressSectionLabel}>Active Tasks</Text>
                  <Text style={styles.progressSectionCount}>{stats.activeEventsList.length} tasks</Text>
                </View>
                {(showAllActive ? stats.activeEventsList : stats.activeEventsList.slice(0, MAX_DISPLAYED_WORKS)).map(event => (
                  <EventProgressMeter 
                    key={event.id} 
                    event={event} 
                    onPress={() => router.push(`/event-detail?id=${event.id}`)}
                    submissionStatus={(event as any).submissionStatus}
                  />
                ))}
                {stats.activeEventsList.length > MAX_DISPLAYED_WORKS && (
                  <TouchableOpacity 
                    style={styles.seeMoreBtn}
                    onPress={() => setShowAllActive(!showAllActive)}
                  >
                    <Text style={styles.seeMoreBtnText}>
                      {showAllActive ? 'Show Less' : `See More (${stats.activeEventsList.length - MAX_DISPLAYED_WORKS} more)`}
                    </Text>
                    <ChevronRight size={16} color={Colors.light.primary} style={showAllActive ? { transform: [{ rotate: '-90deg' }] } : { transform: [{ rotate: '90deg' }] }} />
                  </TouchableOpacity>
                )}
              </View>
            )}
            
            {stats.recentCompletedList.length > 0 && (
              <View style={styles.progressSection}>
                <View style={styles.progressSectionHeader}>
                  <Text style={styles.progressSectionLabel}>Recently Completed</Text>
                  <Text style={styles.progressSectionCount}>{stats.completedEvents} total</Text>
                </View>
                {(showAllCompleted ? stats.recentCompletedList : stats.recentCompletedList.slice(0, MAX_DISPLAYED_WORKS)).map(event => (
                  <EventProgressMeter 
                    key={event.id} 
                    event={event} 
                    onPress={() => router.push(`/event-detail?id=${event.id}`)}
                    isCompleted
                    submissionStatus={(event as any).submissionStatus}
                  />
                ))}
                {stats.recentCompletedList.length > MAX_DISPLAYED_WORKS && (
                  <TouchableOpacity 
                    style={styles.seeMoreBtn}
                    onPress={() => setShowAllCompleted(!showAllCompleted)}
                  >
                    <Text style={styles.seeMoreBtnText}>
                      {showAllCompleted ? 'Show Less' : `See More (${stats.recentCompletedList.length - MAX_DISPLAYED_WORKS} more)`}
                    </Text>
                    <ChevronRight size={16} color={Colors.light.primary} style={showAllCompleted ? { transform: [{ rotate: '-90deg' }] } : { transform: [{ rotate: '90deg' }] }} />
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Quick Actions</Text>
          <View style={styles.actionsGrid}>
            {['GM', 'CGM', 'DGM', 'AGM', 'SD_JTO'].includes(employee?.role || '') && (
              <ActionButton 
                label="Create Task" 
                icon={<Calendar size={24} color={Colors.light.background} />} 
                onPress={() => router.push('/create-event')}
              />
            )}
            {!isAdminRole(employee?.role || 'SALES_STAFF') && (
              <ActionButton 
                label="Raise Issue" 
                icon={<AlertCircle size={24} color={Colors.light.background} />} 
                onPress={() => router.push('/raise-issue')}
              />
            )}
            <ActionButton 
              label="View Reports" 
              icon={<Users size={24} color={Colors.light.background} />} 
              onPress={() => router.push('/sales')}
            />
            {canAccessAdminPanel(employee?.role || 'SALES_STAFF') && (
              <ActionButton 
                label={isAdminRole(employee?.role || 'SALES_STAFF') ? 'Admin Panel' : 'Employee Directory'} 
                icon={<Settings size={24} color={Colors.light.background} />} 
                onPress={() => router.push('/admin')}
              />
            )}
          </View>
        </View>

        <View style={styles.bottomSpacer} />
      </ScrollView>

      <Modal
        visible={outstandingModal.visible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setOutstandingModal({ ...outstandingModal, visible: false })}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>
              {outstandingModal.type === 'ftth' ? 'FTTH' : 'LC'} Outstanding - Employees
            </Text>
            <TouchableOpacity 
              style={styles.modalCloseBtn}
              onPress={() => setOutstandingModal({ ...outstandingModal, visible: false })}
            >
              <X size={24} color={Colors.light.text} />
            </TouchableOpacity>
          </View>
          
          {outstandingSummary && (
            <View style={styles.modalSummary}>
              <View style={styles.modalSummaryItem}>
                <Text style={styles.modalSummaryLabel}>Total Outstanding</Text>
                <Text style={styles.modalSummaryValue}>
                  {formatINRCrore(outstandingModal.type === 'ftth' ? outstandingSummary.ftth.totalAmount : outstandingSummary.lc.totalAmount)}
                </Text>
              </View>
              <View style={styles.modalSummaryDivider} />
              <View style={styles.modalSummaryItem}>
                <Text style={styles.modalSummaryLabel}>Employees</Text>
                <Text style={styles.modalSummaryValue}>
                  {outstandingModal.type === 'ftth' ? outstandingSummary.ftth.employeeCount : outstandingSummary.lc.employeeCount}
                </Text>
              </View>
            </View>
          )}
          
          {loadingEmployees ? (
            <View style={styles.modalLoading}>
              <ActivityIndicator size="large" color={Colors.light.primary} />
              <Text style={styles.modalLoadingText}>Loading employees...</Text>
            </View>
          ) : (
            <FlatList
              data={outstandingEmployees?.employees || []}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.modalListContent}
              renderItem={({ item }) => (
                <TouchableOpacity 
                  style={styles.employeeRow}
                  onPress={() => {
                    setOutstandingModal({ ...outstandingModal, visible: false });
                    router.push(`/employee-profile?id=${item.id}&persNo=${item.pers_no}`);
                  }}
                  activeOpacity={0.7}
                >
                  <View style={styles.employeeRowLeft}>
                    <View style={styles.employeeAvatar}>
                      <Text style={styles.employeeAvatarText}>
                        {item.name?.substring(0, 2).toUpperCase() || '??'}
                      </Text>
                    </View>
                    <View style={styles.employeeInfo}>
                      <Text style={styles.employeeName} numberOfLines={1}>{item.name}</Text>
                      <Text style={styles.employeePersNo}>Pers No: {item.pers_no}</Text>
                      {item.circle && <Text style={styles.employeeCircle}>{item.circle}</Text>}
                    </View>
                  </View>
                  <View style={styles.employeeRowRight}>
                    <Text style={styles.employeeAmount}>{formatINRCrore(item.outstanding_amount)}</Text>
                    <Text style={styles.employeeAmountFull}>{formatINRAmount(item.outstanding_amount)}</Text>
                    <ChevronRight size={16} color={Colors.light.textSecondary} />
                  </View>
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <View style={styles.modalEmpty}>
                  <Text style={styles.modalEmptyText}>No employees with outstanding amounts</Text>
                </View>
              }
            />
          )}
        </View>
      </Modal>

      <Modal
        visible={ftthPendingModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setFtthPendingModalVisible(false)}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>FTTH Order Pending - Employees</Text>
            <TouchableOpacity 
              style={styles.modalCloseBtn}
              onPress={() => setFtthPendingModalVisible(false)}
            >
              <X size={24} color={Colors.light.text} />
            </TouchableOpacity>
          </View>
          
          {ftthPendingSummary && (
            <View style={styles.modalSummary}>
              <View style={styles.modalSummaryItem}>
                <Text style={styles.modalSummaryLabel}>Total Pending</Text>
                <Text style={[styles.modalSummaryValue, { color: '#1565C0' }]}>
                  {Number(ftthPendingSummary.totalPendingOrders).toLocaleString()}
                </Text>
              </View>
              <View style={styles.modalSummaryDivider} />
              <View style={styles.modalSummaryItem}>
                <Text style={styles.modalSummaryLabel}>Employees</Text>
                <Text style={[styles.modalSummaryValue, { color: '#1565C0' }]}>
                  {Number(ftthPendingSummary.uniqueEmployees).toLocaleString()}
                </Text>
              </View>
              <View style={styles.modalSummaryDivider} />
              <View style={styles.modalSummaryItem}>
                <Text style={styles.modalSummaryLabel}>BAs</Text>
                <Text style={[styles.modalSummaryValue, { color: '#1565C0' }]}>
                  {Number(ftthPendingSummary.uniqueBAs).toLocaleString()}
                </Text>
              </View>
            </View>
          )}
          
          {loadingFtthPendingEmployees ? (
            <View style={styles.modalLoading}>
              <ActivityIndicator size="large" color="#1565C0" />
              <Text style={styles.modalLoadingText}>Loading employees...</Text>
            </View>
          ) : ftthPendingError ? (
            <View style={styles.modalEmpty}>
              <Text style={styles.modalEmptyText}>Failed to load employees. Please try again.</Text>
            </View>
          ) : (
            <FlatList
              data={ftthPendingEmployeesData?.employees || []}
              keyExtractor={(item) => item.persNo}
              contentContainerStyle={styles.modalListContent}
              renderItem={({ item }) => (
                <TouchableOpacity 
                  style={styles.employeeRow}
                  onPress={() => {
                    setFtthPendingModalVisible(false);
                    router.push(`/employee-profile?persNo=${item.persNo}`);
                  }}
                  activeOpacity={0.7}
                >
                  <View style={styles.employeeRowLeft}>
                    <View style={[styles.employeeAvatar, { backgroundColor: '#E3F2FD' }]}>
                      <Text style={[styles.employeeAvatarText, { color: '#1565C0' }]}>
                        {item.name?.substring(0, 2).toUpperCase() || '??'}
                      </Text>
                    </View>
                    <View style={styles.employeeInfo}>
                      <Text style={styles.employeeName} numberOfLines={1}>{item.name}</Text>
                      <Text style={styles.employeePersNo}>Pers No: {item.persNo}</Text>
                      <Text style={styles.employeeCircle}>{item.designation} | {item.circle}</Text>
                    </View>
                  </View>
                  <View style={styles.employeeRowRight}>
                    <Text style={[styles.employeeAmount, { color: '#1565C0' }]}>{item.totalPending.toLocaleString()}</Text>
                    <Text style={styles.employeeAmountFull}>{item.baCount} BA{item.baCount > 1 ? 's' : ''}</Text>
                    <ChevronRight size={16} color={Colors.light.textSecondary} />
                  </View>
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <View style={styles.modalEmpty}>
                  <Text style={styles.modalEmptyText}>No employees with pending orders</Text>
                </View>
              }
            />
          )}
        </View>
      </Modal>
    </>
  );
}

function StatCard({ icon, label, value, subtitle, color, onPress }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  subtitle: string;
  color: string;
  onPress?: () => void;
}) {
  return (
    <TouchableOpacity 
      style={styles.statCard} 
      onPress={onPress} 
      activeOpacity={0.7}
      disabled={!onPress}
    >
      <View style={styles.statIconContainer}>
        {icon}
      </View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statSubtitle}>{subtitle}</Text>
    </TouchableOpacity>
  );
}

function ResourceCard({ label, available, icon, onPress }: {
  label: string;
  available: number;
  icon: React.ReactNode;
  onPress?: () => void;
}) {
  return (
    <TouchableOpacity 
      style={styles.resourceCard} 
      onPress={onPress}
      activeOpacity={0.7}
      disabled={!onPress}
    >
      <View style={styles.resourceHeader}>
        {icon}
        <Text style={styles.resourceLabel}>{label}</Text>
      </View>
      <Text style={styles.resourceValue}>{available}</Text>
      <Text style={styles.resourceSubtitle}>units available</Text>
    </TouchableOpacity>
  );
}

function ActionButton({ label, icon, onPress }: { label: string; icon: React.ReactNode; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.actionButton} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.actionIconContainer}>
        {icon}
      </View>
      <Text style={styles.actionLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

function EventStatusBadge({ label, count, color, bg }: { label: string; count: number; color: string; bg: string }) {
  return (
    <View style={[styles.eventStatusBadge, { backgroundColor: bg }]}>
      <Text style={[styles.eventStatusCount, { color }]}>{count}</Text>
      <Text style={[styles.eventStatusLabel, { color }]}>{label}</Text>
    </View>
  );
}

function CircularProgress({ percentage, size = 60, strokeWidth = 6, color }: { percentage: number; size?: number; strokeWidth?: number; color: string }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const strokeDashoffset = circumference - (percentage / 100) * circumference;

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="#E0E0E0"
          strokeWidth={strokeWidth}
          fill="transparent"
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={strokeWidth}
          fill="transparent"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          transform={`rotate(-90, ${size / 2}, ${size / 2})`}
        />
      </Svg>
      <Text style={{ fontSize: 14, fontWeight: 'bold', color }}>{percentage}%</Text>
    </View>
  );
}

function getInitials(name: string): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) {
    return parts[0].substring(0, 2).toUpperCase();
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function getDateStatus(startDate: Date, endDate: Date) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999);
  
  const diffTime = end.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  if (today < start) {
    const daysUntil = Math.ceil((start.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    return { 
      status: 'upcoming', 
      text: daysUntil === 1 ? 'Starts tomorrow' : `Starts in ${daysUntil} days`,
      color: Colors.light.info,
      bgColor: Colors.light.info + '15'
    };
  } else if (today > end) {
    const daysAgo = Math.ceil((today.getTime() - end.getTime()) / (1000 * 60 * 60 * 24));
    return { 
      status: 'ended', 
      text: daysAgo === 1 ? 'Ended yesterday' : `Ended ${daysAgo} days ago`,
      color: Colors.light.textSecondary,
      bgColor: Colors.light.backgroundSecondary
    };
  } else if (diffDays <= 0) {
    return { 
      status: 'ending', 
      text: 'Ends today',
      color: Colors.light.error,
      bgColor: Colors.light.error + '15'
    };
  } else if (diffDays <= 2) {
    return { 
      status: 'ending_soon', 
      text: diffDays === 1 ? 'Ends tomorrow' : `Ends in ${diffDays} days`,
      color: Colors.light.warning,
      bgColor: Colors.light.warning + '15'
    };
  } else {
    return { 
      status: 'active', 
      text: `${diffDays} days left`,
      color: Colors.light.success,
      bgColor: Colors.light.success + '15'
    };
  }
}

function formatDateRange(startDate: Date, endDate: Date) {
  const formatDate = (d: Date) => {
    return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  };
  return `${formatDate(startDate)} - ${formatDate(endDate)}`;
}

const TASK_TYPE_COLORS: Record<string, { bg: string; text: string }> = {
  'SIM': { bg: '#E3F2FD', text: '#1565C0' },
  'FTTH': { bg: '#E8F5E9', text: '#2E7D32' },
  'LEASE_CIRCUIT': { bg: '#FFF3E0', text: '#EF6C00' },
  'EB': { bg: '#F3E5F5', text: '#7B1FA2' },
  'BTS_DOWN': { bg: '#FFEBEE', text: '#C62828' },
  'FTTH_DOWN': { bg: '#FCE4EC', text: '#AD1457' },
  'ROUTE_FAIL': { bg: '#FBE9E7', text: '#D84315' },
  'OFC_FAIL': { bg: '#ECEFF1', text: '#546E7A' },
};

const TASK_TYPE_LABELS: Record<string, string> = {
  'SIM': 'SIM',
  'FTTH': 'FTTH',
  'LEASE_CIRCUIT': 'Lease',
  'EB': 'EB',
  'BTS_DOWN': 'BTS-Down',
  'FTTH_DOWN': 'FTTH-Down',
  'ROUTE_FAIL': 'Route-Fail',
  'OFC_FAIL': 'OFC-Fail',
};

function EventProgressMeter({ event, onPress, isCompleted, submissionStatus }: { event: Event & { teamMembers?: { persNo: string; name: string; designation: string | null }[]; creatorName?: string | null; assigneeName?: string | null; targetEb?: number; targetLease?: number; ebCompleted?: number; leaseCompleted?: number }; onPress: () => void; isCompleted?: boolean; submissionStatus?: string }) {
  const simTarget = event.allocatedSim || event.targetSim || 0;
  const ftthTarget = event.allocatedFtth || event.targetFtth || 0;
  const ebTarget = (event as any).targetEb || 0;
  const leaseTarget = (event as any).targetLease || 0;
  const btsDownTarget = (event as any).targetBtsDown || 0;
  const ftthDownTarget = (event as any).targetFtthDown || 0;
  const routeFailTarget = (event as any).targetRouteFail || 0;
  const ofcFailTarget = (event as any).targetOfcFail || 0;
  
  const simSold = event.simsSold || 0;
  const ftthSold = event.ftthSold || 0;
  const ebCompleted = (event as any).ebCompleted || 0;
  const leaseCompleted = (event as any).leaseCompleted || 0;
  const btsDownCompleted = (event as any).btsDownCompleted || 0;
  const ftthDownCompleted = (event as any).ftthDownCompleted || 0;
  const routeFailCompleted = (event as any).routeFailCompleted || 0;
  const ofcFailCompleted = (event as any).ofcFailCompleted || 0;
  
  const totalTarget = simTarget + ftthTarget + ebTarget + leaseTarget + btsDownTarget + ftthDownTarget + routeFailTarget + ofcFailTarget;
  const totalSold = simSold + ftthSold + ebCompleted + leaseCompleted + btsDownCompleted + ftthDownCompleted + routeFailCompleted + ofcFailCompleted;
  const overallPercentage = totalTarget > 0 ? Math.round((totalSold / totalTarget) * 100) : 0;
  
  const simPercentage = simTarget > 0 ? Math.round((simSold / simTarget) * 100) : 0;
  const ftthPercentage = ftthTarget > 0 ? Math.round((ftthSold / ftthTarget) * 100) : 0;
  const ebPercentage = ebTarget > 0 ? Math.round((ebCompleted / ebTarget) * 100) : 0;
  const leasePercentage = leaseTarget > 0 ? Math.round((leaseCompleted / leaseTarget) * 100) : 0;
  const btsDownPercentage = btsDownTarget > 0 ? Math.round((btsDownCompleted / btsDownTarget) * 100) : 0;
  const ftthDownPercentage = ftthDownTarget > 0 ? Math.round((ftthDownCompleted / ftthDownTarget) * 100) : 0;
  const routeFailPercentage = routeFailTarget > 0 ? Math.round((routeFailCompleted / routeFailTarget) * 100) : 0;
  const ofcFailPercentage = ofcFailTarget > 0 ? Math.round((ofcFailCompleted / ofcFailTarget) * 100) : 0;
  
  const getProgressColor = (pct: number) => {
    if (pct >= 75) return '#2E7D32';
    if (pct >= 50) return '#EF6C00';
    return '#C62828';
  };
  
  const overallColor = getProgressColor(overallPercentage);
  
  const dateStatus = getDateStatus(event.dateRange.startDate, event.dateRange.endDate);
  const dateRangeText = formatDateRange(event.dateRange.startDate, event.dateRange.endDate);
  
  const getStatusIcon = () => {
    switch(dateStatus.status) {
      case 'ending':
      case 'ending_soon':
        return <AlertTriangle size={12} color={dateStatus.color} />;
      case 'ended':
        return <CalendarCheck size={12} color={dateStatus.color} />;
      case 'upcoming':
        return <Calendar size={12} color={dateStatus.color} />;
      default:
        return <Clock size={12} color={dateStatus.color} />;
    }
  };

  const taskTypes = event.category ? event.category.split(',').map(t => t.trim()) : [];
  const teamMembers = (event as any).teamMembers || [];
  const assigneeName = (event as any).assigneeName;
  
  const getTaskStatusIndicator = () => {
    if (submissionStatus === 'approved') {
      return { icon: <CircleCheck size={14} color="#2E7D32" />, label: 'Approved', color: '#2E7D32' };
    } else if (submissionStatus === 'submitted') {
      return { icon: <Send size={14} color="#1565C0" />, label: 'Submitted', color: '#1565C0' };
    } else if (submissionStatus === 'rejected') {
      return { icon: <RotateCcw size={14} color="#C62828" />, label: 'Rejected', color: '#C62828' };
    } else if (overallPercentage >= 100) {
      // Targets achieved but not yet submitted - show ready to submit
      return { icon: <CircleCheck size={14} color="#4CAF50" />, label: 'Ready to Submit', color: '#4CAF50' };
    } else if (submissionStatus === 'in_progress' || overallPercentage > 0) {
      return { icon: <Hourglass size={14} color="#EF6C00" />, label: 'In Progress', color: '#EF6C00' };
    } else {
      return { icon: <CircleDot size={14} color="#78909C" />, label: 'Not Started', color: '#78909C' };
    }
  };
  
  const taskStatusIndicator = getTaskStatusIndicator();
  
  return (
    <TouchableOpacity 
      style={[styles.progressMeterCard, isCompleted && styles.progressMeterCompleted]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={styles.progressMeterLeft}>
        <CircularProgress percentage={Math.min(overallPercentage, 100)} color={overallColor} />
        <View style={styles.taskStatusRow}>
          {taskStatusIndicator.icon}
          <Text style={[styles.taskStatusLabel, { color: taskStatusIndicator.color }]}>{taskStatusIndicator.label}</Text>
        </View>
      </View>
      
      <View style={styles.progressMeterContent}>
        <View style={styles.taskTypesRow}>
          {taskTypes.slice(0, 4).map((type, idx) => {
            const colors = TASK_TYPE_COLORS[type] || { bg: '#ECEFF1', text: '#546E7A' };
            const label = TASK_TYPE_LABELS[type] || type;
            return (
              <View key={idx} style={[styles.taskTypeBadge, { backgroundColor: colors.bg }]}>
                <Text style={[styles.taskTypeText, { color: colors.text }]}>{label}</Text>
              </View>
            );
          })}
          {taskTypes.length > 4 && (
            <View style={[styles.taskTypeBadge, { backgroundColor: '#ECEFF1' }]}>
              <Text style={[styles.taskTypeText, { color: '#546E7A' }]}>+{taskTypes.length - 4}</Text>
            </View>
          )}
        </View>
        
        <Text style={styles.progressMeterLocation} numberOfLines={1}>{event.location}</Text>
        
        <View style={styles.dateInfoContainer}>
          <View style={styles.dateRangeRow}>
            <Calendar size={12} color={Colors.light.textSecondary} />
            <Text style={styles.dateRangeText}>{dateRangeText}</Text>
          </View>
          <View style={[styles.dateStatusBadge, { backgroundColor: dateStatus.bgColor }]}>
            {getStatusIcon()}
            <Text style={[styles.dateStatusText, { color: dateStatus.color }]}>{dateStatus.text}</Text>
          </View>
        </View>
        
        {(assigneeName || teamMembers.length > 0) && (
          <View style={styles.assignedTeamRow}>
            {assigneeName && (
              <View style={[styles.memberAvatarCircle, { backgroundColor: '#1565C0' }]}>
                <Text style={styles.memberAvatarText}>{getInitials(assigneeName)}</Text>
              </View>
            )}
            {teamMembers.slice(0, 3).map((m: any, idx: number) => (
              <View 
                key={idx} 
                style={[
                  styles.memberAvatarCircle, 
                  { backgroundColor: '#2E7D32', marginLeft: idx > 0 || assigneeName ? -6 : 0 }
                ]}
              >
                <Text style={styles.memberAvatarText}>{getInitials(m.name)}</Text>
              </View>
            ))}
            {teamMembers.length > 3 && (
              <View style={[styles.memberAvatarCircle, { backgroundColor: '#78909C', marginLeft: -6 }]}>
                <Text style={styles.memberAvatarText}>+{teamMembers.length - 3}</Text>
              </View>
            )}
          </View>
        )}
        
        <View style={styles.progressBarsContainer}>
          {simTarget > 0 && (
            <View style={styles.progressBarRow}>
              <Text style={styles.progressBarLabel}>SIM</Text>
              <View style={styles.progressBarTrack}>
                <View style={[styles.progressBarFill, { width: `${Math.min(simPercentage, 100)}%`, backgroundColor: Colors.light.primary }]} />
              </View>
              <Text style={styles.progressBarValue}>{simSold}/{simTarget}</Text>
            </View>
          )}
          
          {ftthTarget > 0 && (
            <View style={styles.progressBarRow}>
              <Text style={styles.progressBarLabel}>FTTH</Text>
              <View style={styles.progressBarTrack}>
                <View style={[styles.progressBarFill, { width: `${Math.min(ftthPercentage, 100)}%`, backgroundColor: Colors.light.success }]} />
              </View>
              <Text style={styles.progressBarValue}>{ftthSold}/{ftthTarget}</Text>
            </View>
          )}
          
          {ebTarget > 0 && (
            <View style={styles.progressBarRow}>
              <Text style={styles.progressBarLabel}>EB</Text>
              <View style={styles.progressBarTrack}>
                <View style={[styles.progressBarFill, { width: `${Math.min(ebPercentage, 100)}%`, backgroundColor: '#7B1FA2' }]} />
              </View>
              <Text style={styles.progressBarValue}>{ebCompleted}/{ebTarget}</Text>
            </View>
          )}
          
          {leaseTarget > 0 && (
            <View style={styles.progressBarRow}>
              <Text style={styles.progressBarLabel}>Lease</Text>
              <View style={styles.progressBarTrack}>
                <View style={[styles.progressBarFill, { width: `${Math.min(leasePercentage, 100)}%`, backgroundColor: '#EF6C00' }]} />
              </View>
              <Text style={styles.progressBarValue}>{leaseCompleted}/{leaseTarget}</Text>
            </View>
          )}
          
          {btsDownTarget > 0 && (
            <View style={styles.progressBarRow}>
              <Text style={styles.progressBarLabel}>BTS</Text>
              <View style={styles.progressBarTrack}>
                <View style={[styles.progressBarFill, { width: `${Math.min(btsDownPercentage, 100)}%`, backgroundColor: '#C62828' }]} />
              </View>
              <Text style={styles.progressBarValue}>{btsDownCompleted}/{btsDownTarget}</Text>
            </View>
          )}
          
          {ftthDownTarget > 0 && (
            <View style={styles.progressBarRow}>
              <Text style={styles.progressBarLabel}>FD</Text>
              <View style={styles.progressBarTrack}>
                <View style={[styles.progressBarFill, { width: `${Math.min(ftthDownPercentage, 100)}%`, backgroundColor: '#AD1457' }]} />
              </View>
              <Text style={styles.progressBarValue}>{ftthDownCompleted}/{ftthDownTarget}</Text>
            </View>
          )}
          
          {routeFailTarget > 0 && (
            <View style={styles.progressBarRow}>
              <Text style={styles.progressBarLabel}>RF</Text>
              <View style={styles.progressBarTrack}>
                <View style={[styles.progressBarFill, { width: `${Math.min(routeFailPercentage, 100)}%`, backgroundColor: '#D84315' }]} />
              </View>
              <Text style={styles.progressBarValue}>{routeFailCompleted}/{routeFailTarget}</Text>
            </View>
          )}
          
          {ofcFailTarget > 0 && (
            <View style={styles.progressBarRow}>
              <Text style={styles.progressBarLabel}>OFC</Text>
              <View style={styles.progressBarTrack}>
                <View style={[styles.progressBarFill, { width: `${Math.min(ofcFailPercentage, 100)}%`, backgroundColor: '#546E7A' }]} />
              </View>
              <Text style={styles.progressBarValue}>{ofcFailCompleted}/{ofcFailTarget}</Text>
            </View>
          )}
        </View>
      </View>
      
      <ChevronRight size={20} color={Colors.light.textSecondary} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.light.backgroundSecondary,
  },
  header: {
    backgroundColor: Colors.light.primary,
    padding: 20,
    paddingTop: 60,
    paddingBottom: 30,
  },
  greeting: {
    fontSize: 16,
    color: Colors.light.background,
    opacity: 0.9,
  },
  name: {
    fontSize: 28,
    fontWeight: 'bold' as const,
    color: Colors.light.background,
    marginTop: 4,
  },
  role: {
    fontSize: 14,
    color: Colors.light.background,
    opacity: 0.8,
    marginTop: 4,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 16,
    gap: 12,
    marginTop: -20,
  },
  statCard: {
    backgroundColor: Colors.light.card,
    borderRadius: 12,
    padding: 16,
    width: (width - 44) / 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  statIconContainer: {
    marginBottom: 12,
  },
  statValue: {
    fontSize: 32,
    fontWeight: 'bold' as const,
    color: Colors.light.text,
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 14,
    color: Colors.light.textSecondary,
    fontWeight: '600' as const,
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
  resourcesContainer: {
    flexDirection: 'row',
    gap: 12,
  },
  resourceCard: {
    flex: 1,
    backgroundColor: Colors.light.card,
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  resourceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  resourceLabel: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.light.text,
  },
  resourceValue: {
    fontSize: 28,
    fontWeight: 'bold' as const,
    color: Colors.light.text,
  },
  resourceSubtitle: {
    fontSize: 12,
    color: Colors.light.textSecondary,
    marginTop: 2,
  },
  eventStatusGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  eventStatusBadge: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
    minWidth: 80,
  },
  eventStatusCount: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  eventStatusLabel: {
    fontSize: 12,
    fontWeight: '500',
    marginTop: 2,
  },
  actionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  actionButton: {
    backgroundColor: Colors.light.primary,
    borderRadius: 12,
    padding: 16,
    width: (width - 44) / 2,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  actionIconContainer: {
    marginBottom: 8,
  },
  actionLabel: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.light.background,
    textAlign: 'center',
  },
  progressSection: {
    marginBottom: 16,
  },
  progressSectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  progressSectionLabel: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.light.textSecondary,
  },
  progressSectionCount: {
    fontSize: 12,
    color: Colors.light.textSecondary,
    fontWeight: '500' as const,
  },
  seeMoreBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: Colors.light.primary + '10',
    borderRadius: 8,
    marginTop: 4,
    gap: 6,
  },
  seeMoreBtnText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.light.primary,
  },
  progressMeterCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.light.card,
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  progressMeterCompleted: {
    opacity: 0.8,
    backgroundColor: '#F5F5F5',
  },
  progressMeterLeft: {
    marginRight: 12,
    alignItems: 'center',
  },
  taskStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 3,
  },
  taskStatusLabel: {
    fontSize: 9,
    fontWeight: '500' as const,
  },
  progressMeterContent: {
    flex: 1,
  },
  progressMeterTitle: {
    fontSize: 15,
    fontWeight: 'bold' as const,
    color: Colors.light.text,
    marginBottom: 2,
  },
  progressMeterLocation: {
    fontSize: 12,
    color: Colors.light.textSecondary,
    marginBottom: 4,
  },
  taskTypesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginBottom: 4,
  },
  taskTypeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  taskTypeText: {
    fontSize: 10,
    fontWeight: '600' as const,
  },
  assignedTeamRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  memberAvatarCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  memberAvatarText: {
    fontSize: 10,
    fontWeight: '700' as const,
    color: '#FFFFFF',
  },
  assignedTeamText: {
    fontSize: 11,
    color: Colors.light.textSecondary,
    flex: 1,
  },
  dateInfoContainer: {
    marginBottom: 8,
  },
  dateRangeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 4,
  },
  dateRangeText: {
    fontSize: 11,
    color: Colors.light.textSecondary,
  },
  dateStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 12,
    gap: 4,
  },
  dateStatusText: {
    fontSize: 11,
    fontWeight: '600' as const,
  },
  progressBarsContainer: {
    gap: 6,
  },
  progressBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  progressBarLabel: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: Colors.light.textSecondary,
    width: 38,
  },
  progressBarTrack: {
    flex: 1,
    height: 6,
    backgroundColor: '#E0E0E0',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 3,
  },
  progressBarValue: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: Colors.light.text,
    width: 45,
    textAlign: 'right',
  },
  bottomSpacer: {
    height: 20,
  },
  outstandingCardsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  reportsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  consolidatedReportCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  reportCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  reportIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  reportCardTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    color: '#1F2937',
  },
  reportMetricsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  reportMetricItem: {
    flex: 1,
    alignItems: 'center',
  },
  reportMetricValue: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1565C0',
    marginTop: 4,
  },
  reportMetricLabel: {
    fontSize: 11,
    color: '#6B7280',
    marginTop: 2,
  },
  reportMetricDivider: {
    width: 1,
    height: 30,
    backgroundColor: '#E5E7EB',
  },
  reportSubtext: {
    fontSize: 11,
    color: '#9CA3AF',
    textAlign: 'center',
  },
  outstandingCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#FFCDD2',
  },
  outstandingCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  outstandingIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  outstandingCardTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.light.textSecondary,
    marginBottom: 4,
  },
  outstandingCardAmount: {
    fontSize: 22,
    fontWeight: '800',
    color: '#D32F2F',
    marginBottom: 4,
  },
  outstandingCardCount: {
    fontSize: 12,
    color: Colors.light.textSecondary,
    marginBottom: 12,
  },
  outstandingCardAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  outstandingCardActionText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#D32F2F',
  },
  modalContainer: {
    flex: 1,
    backgroundColor: Colors.light.background,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
    backgroundColor: '#FFFFFF',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.light.text,
  },
  modalCloseBtn: {
    padding: 4,
  },
  modalSummary: {
    flexDirection: 'row',
    backgroundColor: '#FFF5F5',
    padding: 16,
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FFCDD2',
  },
  modalSummaryItem: {
    flex: 1,
    alignItems: 'center',
    minWidth: 70,
  },
  modalSummaryLabel: {
    fontSize: 11,
    color: Colors.light.textSecondary,
    marginBottom: 2,
    textAlign: 'center',
  },
  modalSummaryValue: {
    fontSize: 18,
    fontWeight: '800',
    color: '#D32F2F',
  },
  modalSummaryDivider: {
    width: 1,
    backgroundColor: '#FFCDD2',
    marginHorizontal: 8,
  },
  modalLoading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  modalLoadingText: {
    fontSize: 14,
    color: Colors.light.textSecondary,
  },
  modalListContent: {
    padding: 16,
    gap: 8,
  },
  employeeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  employeeRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 12,
  },
  employeeAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.light.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  employeeAvatarText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  employeeInfo: {
    flex: 1,
  },
  employeeName: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.light.text,
    marginBottom: 2,
  },
  employeePersNo: {
    fontSize: 12,
    color: Colors.light.textSecondary,
  },
  employeeCircle: {
    fontSize: 11,
    color: Colors.light.textSecondary,
    marginTop: 2,
  },
  employeeRowRight: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: 8,
  },
  employeeAmount: {
    fontSize: 16,
    fontWeight: '800',
    color: '#D32F2F',
  },
  employeeAmountFull: {
    fontSize: 10,
    color: Colors.light.textSecondary,
    display: 'none',
  },
  modalEmpty: {
    padding: 40,
    alignItems: 'center',
  },
  modalEmptyText: {
    fontSize: 14,
    color: Colors.light.textSecondary,
  },
  kamEbCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#FFE082',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 3,
  },
  kamEbHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  kamEbIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  kamEbHeaderInfo: {
    flex: 1,
    marginLeft: 12,
  },
  kamEbTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.light.text,
  },
  kamEbSubtitle: {
    fontSize: 12,
    color: Colors.light.textSecondary,
    marginTop: 2,
  },
  kamEbMetricsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#FFFDE7',
    borderRadius: 12,
    padding: 12,
  },
  kamEbMetric: {
    flex: 1,
    alignItems: 'center',
  },
  kamEbMetricIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  kamEbMetricValue: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.light.text,
  },
  kamEbMetricLabel: {
    fontSize: 10,
    color: Colors.light.textSecondary,
    marginTop: 2,
  },
});
