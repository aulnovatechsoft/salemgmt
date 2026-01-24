import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Dimensions } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { TrendingUp, Calendar, Users, Target, Package, AlertCircle, Settings, ChevronRight, Clock, CalendarCheck, AlertTriangle } from 'lucide-react-native';
import { useAuth } from '@/contexts/auth';
import { useApp } from '@/contexts/app';
import Colors from '@/constants/colors';
import { useMemo, useState } from 'react';
import React from "react";
import { Event } from '@/types';
import Svg, { Circle } from 'react-native-svg';
import NotificationBell from '@/components/NotificationBell';

const MAX_DISPLAYED_WORKS = 3;

const { width } = Dimensions.get('window');

export default function DashboardScreen() {
  const router = useRouter();
  const { employee } = useAuth();
  const { events, salesReports, resources, issues } = useApp();
  const [showAllActive, setShowAllActive] = useState(false);
  const [showAllCompleted, setShowAllCompleted] = useState(false);

  const stats = useMemo(() => {
    // Management roles see all events
    // SD_JTO sees events in their circle or assigned to them
    // SALES_STAFF only sees events they're specifically assigned to
    const managementRoles = ['GM', 'CGM', 'DGM', 'AGM'];
    const isManagement = managementRoles.includes(employee?.role || '');
    const isSalesStaff = employee?.role === 'SALES_STAFF';
    
    const myEvents = events.filter(e => {
      if (isManagement) return true;
      
      const isAssignedToMe = e.assignedTo === employee?.id;
      const isInMyTeam = Array.isArray(e.assignedTeam) && e.assignedTeam.includes(employee?.id || '');
      
      // SALES_STAFF only sees events they're specifically assigned to
      if (isSalesStaff) {
        return isAssignedToMe || isInMyTeam;
      }
      
      // SD_JTO sees circle events + assigned events
      const isMyCircle = e.circle === employee?.circle;
      return isMyCircle || isAssignedToMe || isInMyTeam;
    });
    
    const totalSimsSold = salesReports.reduce((acc, r) => acc + r.simsSold, 0);
    const totalSimsActivated = salesReports.reduce((acc, r) => acc + r.simsActivated, 0);
    const totalFtthLeads = salesReports.reduce((acc, r) => acc + r.ftthLeads, 0);
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

    const pendingIssues = issues.filter(i => i.status === 'OPEN' || i.status === 'IN_PROGRESS');

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
          <View style={styles.headerLeft}>
            <Text style={styles.greeting}>Welcome back,</Text>
            <Text style={styles.name}>{employee?.name}</Text>
            <Text style={styles.role}>{employee?.designation} - {employee?.circle}</Text>
          </View>
          <NotificationBell />
        </View>

        <View style={styles.statsGrid}>
          <StatCard
            icon={<Calendar size={24} color={Colors.light.primary} />}
            label="Total Works"
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
            onPress={() => router.push('/(tabs)/sales')}
          />
          <StatCard
            icon={<Target size={24} color={Colors.light.info} />}
            label="FTTH Leads"
            value={stats.ftthLeads.toString()}
            subtitle={`${stats.ftthInstalled} installed`}
            color={Colors.light.info}
            onPress={() => router.push('/(tabs)/sales')}
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

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Work Status Overview</Text>
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
            <Text style={styles.sectionTitle}>Work Progress</Text>
            
            {stats.activeEventsList.length > 0 && (
              <View style={styles.progressSection}>
                <View style={styles.progressSectionHeader}>
                  <Text style={styles.progressSectionLabel}>Active Works</Text>
                  <Text style={styles.progressSectionCount}>{stats.activeEventsList.length} works</Text>
                </View>
                {(showAllActive ? stats.activeEventsList : stats.activeEventsList.slice(0, MAX_DISPLAYED_WORKS)).map(event => (
                  <EventProgressMeter 
                    key={event.id} 
                    event={event} 
                    onPress={() => router.push(`/event-detail?id=${event.id}`)}
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
          <Text style={styles.sectionTitle}>Resources Available</Text>
          <View style={styles.resourcesContainer}>
            <ResourceCard
              label="SIM Stock"
              available={stats.simAvailable}
              icon={<Package size={20} color={Colors.light.primary} />}
              onPress={() => router.push('/resource-management?type=SIM')}
            />
            <ResourceCard
              label="FTTH Capacity"
              available={stats.ftthAvailable}
              icon={<Package size={20} color={Colors.light.secondary} />}
              onPress={() => router.push('/resource-management?type=FTTH')}
            />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Quick Actions</Text>
          <View style={styles.actionsGrid}>
            {['GM', 'CGM', 'DGM', 'AGM', 'SD_JTO'].includes(employee?.role || '') && (
              <ActionButton 
                label="Create Work" 
                icon={<Calendar size={24} color={Colors.light.background} />} 
                onPress={() => router.push('/create-event')}
              />
            )}
            <ActionButton 
              label="Submit Sales" 
              icon={<TrendingUp size={24} color={Colors.light.background} />} 
              onPress={() => router.push('/submit-sales')}
            />
            <ActionButton 
              label="Raise Issue" 
              icon={<AlertCircle size={24} color={Colors.light.background} />} 
              onPress={() => router.push('/raise-issue')}
            />
            <ActionButton 
              label="View Reports" 
              icon={<Users size={24} color={Colors.light.background} />} 
              onPress={() => router.push('/sales')}
            />
            {['GM', 'CGM', 'DGM', 'AGM'].includes(employee?.role || '') && (
              <ActionButton 
                label="Admin Panel" 
                icon={<Settings size={24} color={Colors.light.background} />} 
                onPress={() => router.push('/admin')}
              />
            )}
          </View>
        </View>

        <View style={styles.bottomSpacer} />
      </ScrollView>
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

function EventProgressMeter({ event, onPress, isCompleted }: { event: Event; onPress: () => void; isCompleted?: boolean }) {
  const simTarget = event.allocatedSim || event.targetSim || 0;
  const ftthTarget = event.allocatedFtth || event.targetFtth || 0;
  const simSold = event.simsSold || 0;
  const ftthSold = event.ftthSold || 0;
  
  const totalTarget = simTarget + ftthTarget;
  const totalSold = simSold + ftthSold;
  const overallPercentage = totalTarget > 0 ? Math.round((totalSold / totalTarget) * 100) : 0;
  
  const simPercentage = simTarget > 0 ? Math.round((simSold / simTarget) * 100) : 0;
  const ftthPercentage = ftthTarget > 0 ? Math.round((ftthSold / ftthTarget) * 100) : 0;
  
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
  
  return (
    <TouchableOpacity 
      style={[styles.progressMeterCard, isCompleted && styles.progressMeterCompleted]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={styles.progressMeterLeft}>
        <CircularProgress percentage={Math.min(overallPercentage, 100)} color={overallColor} />
      </View>
      
      <View style={styles.progressMeterContent}>
        <Text style={styles.progressMeterTitle} numberOfLines={1}>{event.name}</Text>
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
        
        <View style={styles.progressBarsContainer}>
          <View style={styles.progressBarRow}>
            <Text style={styles.progressBarLabel}>SIM</Text>
            <View style={styles.progressBarTrack}>
              <View style={[styles.progressBarFill, { width: `${Math.min(simPercentage, 100)}%`, backgroundColor: Colors.light.primary }]} />
            </View>
            <Text style={styles.progressBarValue}>{simSold}/{simTarget}</Text>
          </View>
          
          <View style={styles.progressBarRow}>
            <Text style={styles.progressBarLabel}>FTTH</Text>
            <View style={styles.progressBarTrack}>
              <View style={[styles.progressBarFill, { width: `${Math.min(ftthPercentage, 100)}%`, backgroundColor: Colors.light.success }]} />
            </View>
            <Text style={styles.progressBarValue}>{ftthSold}/{ftthTarget}</Text>
          </View>
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
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  headerLeft: {
    flex: 1,
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
    width: 32,
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
});
