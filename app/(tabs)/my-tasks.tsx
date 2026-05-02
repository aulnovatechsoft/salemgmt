import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, Modal, Alert, ActivityIndicator, AppState } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, usePathname } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { MapPin, Calendar, Target, Check, X, Plus, Minus, Wrench, Send, RotateCcw, CircleCheck, Hourglass, CircleDot, ChevronDown, ChevronUp, Users } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { useAuth } from '@/contexts/auth';
import { trpc } from '@/lib/trpc';

const CATEGORY_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
  SIM: { label: 'SIM Sales', color: '#2196F3', icon: 'S' },
  FTTH: { label: 'FTTH Sales', color: '#4CAF50', icon: 'F' },
  LEASE_CIRCUIT: { label: 'Lease Circuit', color: '#9C27B0', icon: 'L' },
  BTS_DOWN: { label: 'BTS Down', color: '#F44336', icon: 'B' },
  ROUTE_FAIL: { label: 'Route Fail', color: '#FF9800', icon: 'R' },
  FTTH_DOWN: { label: 'FTTH Down', color: '#E91E63', icon: 'D' },
  OFC_FAIL: { label: 'OFC Fail', color: '#795548', icon: 'O' },
  EB: { label: 'EB', color: '#607D8B', icon: 'E' },
};

function formatDate(date: Date | string): string {
  const d = new Date(date);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

export default function MyTasksScreen() {
  const router = useRouter();
  const { employee } = useAuth();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [maintenanceModalVisible, setMaintenanceModalVisible] = useState(false);
  const [selectedTask, setSelectedTask] = useState<any>(null);
  const [createdExpanded, setCreatedExpanded] = useState(true);
  const [assignedExpanded, setAssignedExpanded] = useState(true);

  const { data: myTasks, isLoading, refetch } = trpc.events.getMyAssignedTasks.useQuery(
    { employeeId: employee?.id || '' },
    {
      enabled: !!employee?.id,
      staleTime: 0,
      refetchOnMount: 'always',
      refetchOnWindowFocus: true,
    }
  );

  const pathname = usePathname();
  const prevPathRef = useRef(pathname);
  useEffect(() => {
    if (pathname === '/my-tasks' && prevPathRef.current !== '/my-tasks') {
      refetch();
    }
    prevPathRef.current = pathname;
  }, [pathname, refetch]);

  const utils = trpc.useUtils();
  
  const invalidateAllQueries = useCallback(async () => {
    await Promise.all([
      utils.events.getMyAssignedTasks.invalidate(),
      utils.events.getMyEvents.invalidate(),
      utils.events.getAll.invalidate(),
    ]);
  }, [utils]);
  
  const maintenanceMutation = trpc.events.updateTaskProgress.useMutation({
    onSuccess: async () => {
      await invalidateAllQueries();
    },
    onError: (error: any) => {
      Alert.alert('Error', error.message || 'Failed to update maintenance progress');
    },
  });

  const submitForReviewMutation = trpc.events.submitTaskForReview.useMutation({
    onSuccess: async () => {
      await invalidateAllQueries();
      Alert.alert('Success', 'Task submitted for review!');
    },
    onError: (error: any) => {
      Alert.alert('Error', error.message || 'Failed to submit task');
    },
  });

  const { createdByMe, assignedToMe } = useMemo(() => {
    if (!myTasks) return { createdByMe: [], assignedToMe: [] };
    const created: any[] = [];
    const assigned: any[] = [];
    for (const task of myTasks) {
      if (task.myRole === 'creator') {
        created.push(task);
      } else {
        assigned.push(task);
      }
    }
    return { createdByMe: created, assignedToMe: assigned };
  }, [myTasks]);

  const getStatusIndicator = (status: string, allTargetsAchieved: boolean = false) => {
    switch (status) {
      case 'approved':
        return { icon: <CircleCheck size={14} color="#2E7D32" />, label: 'Approved', color: '#2E7D32', bgColor: '#E8F5E9' };
      case 'submitted':
        return { icon: <Send size={14} color="#1565C0" />, label: 'Submitted', color: '#1565C0', bgColor: '#E3F2FD' };
      case 'rejected':
        return { icon: <RotateCcw size={14} color="#C62828" />, label: 'Rejected', color: '#C62828', bgColor: '#FFEBEE' };
      case 'in_progress':
        if (allTargetsAchieved) {
          return { icon: <CircleCheck size={14} color="#4CAF50" />, label: 'Ready to Submit', color: '#4CAF50', bgColor: '#E8F5E9' };
        }
        return { icon: <Hourglass size={14} color="#EF6C00" />, label: 'In Progress', color: '#EF6C00', bgColor: '#FFF3E0' };
      case 'not_started':
        if (allTargetsAchieved) {
          return { icon: <CircleCheck size={14} color="#4CAF50" />, label: 'Ready to Submit', color: '#4CAF50', bgColor: '#E8F5E9' };
        }
        return { icon: <CircleDot size={14} color="#78909C" />, label: 'Not Started', color: '#78909C', bgColor: '#ECEFF1' };
      default:
        return { icon: <CircleDot size={14} color="#78909C" />, label: 'Not Started', color: '#78909C', bgColor: '#ECEFF1' };
    }
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const openMaintenanceModal = (task: any) => {
    setSelectedTask(task);
    setMaintenanceModalVisible(true);
  };

  // Route to the evidence form instead of incrementing in-place. The
  // submit-maintenance screen captures photo + GPS + site ID and calls
  // submitMaintenanceEntry, which transactionally writes the maintenance_entries
  // row AND increments the per-member counter.
  const handleMaintenanceComplete = (taskType: string) => {
    if (!selectedTask) return;
    setMaintenanceModalVisible(false);
    router.push(`/submit-maintenance?eventId=${selectedTask.id}&taskType=${taskType}`);
  };

  // Undo still uses the legacy decrement path. This rolls the per-member
  // counter back by 1 but does NOT delete the corresponding maintenance_entry.
  // TODO(P2): replace with a "delete most recent entry" flow so counter and
  // entries stay consistent.
  const handleMaintenanceUndo = (taskType: string) => {
    if (!selectedTask || !employee?.id) return;
    Alert.alert(
      'Undo last entry',
      `This will decrement your ${taskType} counter by 1 but will not remove the photo/GPS evidence already on record. Continue?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Undo',
          style: 'destructive',
          onPress: () => {
            maintenanceMutation.mutate({
              eventId: selectedTask.id,
              taskType: taskType as any,
              increment: -1,
              updatedBy: employee.id,
            });
          },
        },
      ]
    );
  };

  const getRoleBadge = (role: string) => {
    switch (role) {
      case 'creator':
        return { label: 'Creator', color: '#6B21A8', bgColor: '#F3E8FF' };
      case 'manager':
        return { label: 'Manager', color: '#0369A1', bgColor: '#E0F2FE' };
      case 'assigned':
        return { label: 'Assigned', color: '#166534', bgColor: '#DCFCE7' };
      default:
        return { label: 'Team', color: '#78716C', bgColor: '#F5F5F4' };
    }
  };

  const renderCreatorCard = (item: any) => {
    const categories = (item.category || '').split(',').filter(Boolean);
    const isCompleted = item.status === 'completed';
    const statusIndicator = getStatusIndicator(item.submissionStatus || 'not_started', false);

    return (
      <TouchableOpacity 
        key={item.id}
        style={[styles.taskCard, isCompleted && styles.completedCard, styles.creatorCard]}
        onPress={() => router.push(`/event-detail?id=${item.id}`)}
        activeOpacity={0.7}
      >
        <View style={styles.cardHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.taskName} numberOfLines={2}>{item.name}</Text>
            <View style={[styles.roleBadge, { backgroundColor: '#F3E8FF' }]}>
              <Text style={[styles.roleBadgeText, { color: '#6B21A8' }]}>Creator</Text>
            </View>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: statusIndicator.bgColor }]}>
            {statusIndicator.icon}
            <Text style={[styles.statusText, { color: statusIndicator.color, marginLeft: 4 }]}>
              {statusIndicator.label}
            </Text>
          </View>
        </View>

        <View style={styles.infoRow}>
          <MapPin size={14} color={Colors.light.textSecondary} />
          <Text style={styles.infoText} numberOfLines={1}>{item.location}</Text>
        </View>
        <View style={styles.infoRow}>
          <Calendar size={14} color={Colors.light.textSecondary} />
          <Text style={styles.infoText}>
            {formatDate(item.startDate)} - {formatDate(item.endDate)}
          </Text>
        </View>

        <View style={styles.categoriesRow}>
          {categories.map((cat: string) => {
            const config = CATEGORY_CONFIG[cat];
            if (!config) return null;
            return (
              <View key={cat} style={[styles.categoryChip, { backgroundColor: config.color + '20' }]}>
                <Text style={[styles.categoryChipText, { color: config.color }]}>{config.label}</Text>
              </View>
            );
          })}
        </View>

        {item.teamMembers && item.teamMembers.length > 0 && (
          <View style={styles.teamSection}>
            <View style={styles.teamHeader}>
              <Users size={14} color={Colors.light.primary} />
              <Text style={styles.teamLabel}>Team ({item.teamMembers.length})</Text>
            </View>
            {item.teamMembers.map((member: any) => (
              <View key={member.persNo} style={styles.teamMemberRow}>
                <View style={styles.teamMemberAvatar}>
                  <Text style={styles.teamMemberAvatarText}>
                    {(member.name || '?')[0].toUpperCase()}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.teamMemberName} numberOfLines={1}>{member.name}</Text>
                  <Text style={styles.teamMemberPersNo}>{member.persNo}</Text>
                </View>
                {member.targets && (
                  <View style={styles.memberTargets}>
                    {member.targets.sim > 0 && (
                      <Text style={styles.memberTargetText}>SIM: {member.progress?.simSold ?? 0}/{member.targets.sim}</Text>
                    )}
                    {member.targets.ftth > 0 && (
                      <Text style={styles.memberTargetText}>FTTH: {member.progress?.ftthSold ?? 0}/{member.targets.ftth}</Text>
                    )}
                    {member.targets.lease > 0 && (
                      <Text style={styles.memberTargetText}>LC: {member.progress?.lease ?? 0}/{member.targets.lease}</Text>
                    )}
                    {member.targets.btsDown > 0 && (
                      <Text style={styles.memberTargetText}>BTS: {member.progress?.btsDown ?? 0}/{member.targets.btsDown}</Text>
                    )}
                    {member.targets.routeFail > 0 && (
                      <Text style={styles.memberTargetText}>RF: {member.progress?.routeFail ?? 0}/{member.targets.routeFail}</Text>
                    )}
                    {member.targets.ftthDown > 0 && (
                      <Text style={styles.memberTargetText}>FD: {member.progress?.ftthDown ?? 0}/{member.targets.ftthDown}</Text>
                    )}
                    {member.targets.ofcFail > 0 && (
                      <Text style={styles.memberTargetText}>OFC: {member.progress?.ofcFail ?? 0}/{member.targets.ofcFail}</Text>
                    )}
                    {member.targets.eb > 0 && (
                      <Text style={styles.memberTargetText}>EB: {member.progress?.eb ?? 0}/{member.targets.eb}</Text>
                    )}
                  </View>
                )}
              </View>
            ))}
          </View>
        )}

        <Text style={styles.overallTargetsLabel}>Overall Progress:</Text>
        <View style={styles.targetsGrid}>
          {item.categories.hasSIM && item.myTargets.sim > 0 && (
            <View style={styles.targetItem}>
              <View style={[styles.targetIcon, { backgroundColor: CATEGORY_CONFIG.SIM.color }]}>
                <Text style={styles.targetIconText}>S</Text>
              </View>
              <View style={styles.targetInfo}>
                <Text style={styles.targetLabel}>SIM</Text>
                <Text style={styles.targetValue}>{item.myProgress.simSold}/{item.myTargets.sim}</Text>
              </View>
            </View>
          )}
          {item.categories.hasFTTH && item.myTargets.ftth > 0 && (
            <View style={styles.targetItem}>
              <View style={[styles.targetIcon, { backgroundColor: CATEGORY_CONFIG.FTTH.color }]}>
                <Text style={styles.targetIconText}>F</Text>
              </View>
              <View style={styles.targetInfo}>
                <Text style={styles.targetLabel}>FTTH</Text>
                <Text style={styles.targetValue}>{item.myProgress.ftthSold}/{item.myTargets.ftth}</Text>
              </View>
            </View>
          )}
          {item.categories.hasLease && (
            <View style={styles.targetItem}>
              <View style={[styles.targetIcon, { backgroundColor: CATEGORY_CONFIG.LEASE_CIRCUIT.color }]}>
                <Text style={styles.targetIconText}>L</Text>
              </View>
              <View style={styles.targetInfo}>
                <Text style={styles.targetLabel}>Lease</Text>
                <Text style={styles.targetValue}>{(item.myProgress as any)?.lease ?? item.maintenanceProgress.lease}/{item.myTargets.lease}</Text>
              </View>
            </View>
          )}
          {item.categories.hasBtsDown && item.myTargets.btsDown > 0 && (
            <View style={styles.targetItem}>
              <View style={[styles.targetIcon, { backgroundColor: CATEGORY_CONFIG.BTS_DOWN.color }]}>
                <Text style={styles.targetIconText}>B</Text>
              </View>
              <View style={styles.targetInfo}>
                <Text style={styles.targetLabel}>BTS Down</Text>
                <Text style={styles.targetValue}>{item.maintenanceProgress.btsDown}/{item.myTargets.btsDown}</Text>
              </View>
            </View>
          )}
          {item.categories.hasRouteFail && item.myTargets.routeFail > 0 && (
            <View style={styles.targetItem}>
              <View style={[styles.targetIcon, { backgroundColor: CATEGORY_CONFIG.ROUTE_FAIL.color }]}>
                <Text style={styles.targetIconText}>R</Text>
              </View>
              <View style={styles.targetInfo}>
                <Text style={styles.targetLabel}>Route Fail</Text>
                <Text style={styles.targetValue}>{item.maintenanceProgress.routeFail}/{item.myTargets.routeFail}</Text>
              </View>
            </View>
          )}
          {item.categories.hasFtthDown && item.myTargets.ftthDown > 0 && (
            <View style={styles.targetItem}>
              <View style={[styles.targetIcon, { backgroundColor: CATEGORY_CONFIG.FTTH_DOWN.color }]}>
                <Text style={styles.targetIconText}>D</Text>
              </View>
              <View style={styles.targetInfo}>
                <Text style={styles.targetLabel}>FTTH Down</Text>
                <Text style={styles.targetValue}>{item.maintenanceProgress.ftthDown}/{item.myTargets.ftthDown}</Text>
              </View>
            </View>
          )}
          {item.categories.hasOfcFail && item.myTargets.ofcFail > 0 && (
            <View style={styles.targetItem}>
              <View style={[styles.targetIcon, { backgroundColor: CATEGORY_CONFIG.OFC_FAIL.color }]}>
                <Text style={styles.targetIconText}>O</Text>
              </View>
              <View style={styles.targetInfo}>
                <Text style={styles.targetLabel}>OFC Fail</Text>
                <Text style={styles.targetValue}>{item.maintenanceProgress.ofcFail}/{item.myTargets.ofcFail}</Text>
              </View>
            </View>
          )}
          {item.categories.hasEb && (
            <View style={styles.targetItem}>
              <View style={[styles.targetIcon, { backgroundColor: CATEGORY_CONFIG.EB.color }]}>
                <Text style={styles.targetIconText}>E</Text>
              </View>
              <View style={styles.targetInfo}>
                <Text style={styles.targetLabel}>EB</Text>
                <Text style={styles.targetValue}>{(item.myProgress as any)?.eb ?? item.maintenanceProgress.eb}/{item.myTargets.eb}</Text>
              </View>
            </View>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  const renderAssignedCard = (item: any) => {
    const categories = (item.category || '').split(',').filter(Boolean);
    const isCompleted = item.status === 'completed';
    const roleBadge = getRoleBadge(item.myRole || 'team_member');
    
    const hasTargets = item.myTargets.sim > 0 || item.myTargets.ftth > 0 || 
      item.myTargets.lease > 0 || item.myTargets.btsDown > 0 || 
      item.myTargets.routeFail > 0 || item.myTargets.ftthDown > 0 || 
      item.myTargets.ofcFail > 0 || item.myTargets.eb > 0;

    const canSubmit = item.assignmentId && 
      (item.submissionStatus === 'in_progress' || item.submissionStatus === 'rejected' || item.submissionStatus === 'not_started');

    const salesTargetsAchieved = 
      (!item.categories.hasSIM || item.myProgress.simSold >= item.myTargets.sim) &&
      (!item.categories.hasFTTH || item.myProgress.ftthSold >= item.myTargets.ftth) &&
      (!item.categories.hasLease || ((item.myProgress as any)?.lease ?? 0) >= (item.myTargets.lease || 0)) &&
      (!item.categories.hasEb || ((item.myProgress as any)?.eb ?? 0) >= (item.myTargets.eb || 0));
    
    const maintenanceTargetsAchieved =
      (!item.categories.hasBtsDown || item.maintenanceProgress.btsDown >= item.maintenanceProgress.btsDownTarget) &&
      (!item.categories.hasRouteFail || item.maintenanceProgress.routeFail >= item.maintenanceProgress.routeFailTarget) &&
      (!item.categories.hasFtthDown || item.maintenanceProgress.ftthDown >= item.maintenanceProgress.ftthDownTarget) &&
      (!item.categories.hasOfcFail || item.maintenanceProgress.ofcFail >= item.maintenanceProgress.ofcFailTarget);
    
    const allTargetsAchieved = hasTargets && salesTargetsAchieved && maintenanceTargetsAchieved;
    const statusIndicator = getStatusIndicator(item.submissionStatus || 'not_started', allTargetsAchieved);
    const isAlreadySubmittedOrApproved = item.submissionStatus === 'submitted' || item.submissionStatus === 'approved';

    return (
      <TouchableOpacity 
        key={item.id}
        style={[styles.taskCard, isCompleted && styles.completedCard]}
        onPress={() => router.push(`/event-detail?id=${item.id}`)}
        activeOpacity={0.7}
      >
        <View style={styles.cardHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.taskName} numberOfLines={2}>{item.name}</Text>
            <View style={[styles.roleBadge, { backgroundColor: roleBadge.bgColor }]}>
              <Text style={[styles.roleBadgeText, { color: roleBadge.color }]}>
                {roleBadge.label}
              </Text>
            </View>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: statusIndicator.bgColor }]}>
            {statusIndicator.icon}
            <Text style={[styles.statusText, { color: statusIndicator.color, marginLeft: 4 }]}>
              {statusIndicator.label}
            </Text>
          </View>
        </View>

        <View style={styles.infoRow}>
          <MapPin size={14} color={Colors.light.textSecondary} />
          <Text style={styles.infoText} numberOfLines={1}>{item.location}</Text>
        </View>
        <View style={styles.infoRow}>
          <Calendar size={14} color={Colors.light.textSecondary} />
          <Text style={styles.infoText}>
            {formatDate(item.startDate)} - {formatDate(item.endDate)}
          </Text>
        </View>

        <View style={styles.categoriesRow}>
          {categories.map((cat: string) => {
            const config = CATEGORY_CONFIG[cat];
            if (!config) return null;
            return (
              <View key={cat} style={[styles.categoryChip, { backgroundColor: config.color + '20' }]}>
                <Text style={[styles.categoryChipText, { color: config.color }]}>{config.label}</Text>
              </View>
            );
          })}
        </View>

        {item.teamMembers && item.teamMembers.length > 0 && (
          <View style={styles.teamMembersInline}>
            <Users size={12} color={Colors.light.textSecondary} />
            <Text style={styles.teamMembersInlineText} numberOfLines={1}>
              {item.teamMembers.map((m: any) => m.name).join(', ')}
            </Text>
          </View>
        )}

        <Text style={styles.myTargetsLabel}>Your Targets:</Text>
        <View style={styles.targetsGrid}>
          {item.categories.hasSIM && item.myTargets.sim > 0 && (
            <View style={styles.targetItem}>
              <View style={[styles.targetIcon, { backgroundColor: CATEGORY_CONFIG.SIM.color }]}>
                <Text style={styles.targetIconText}>S</Text>
              </View>
              <View style={styles.targetInfo}>
                <Text style={styles.targetLabel}>SIM</Text>
                <Text style={styles.targetValue}>{item.myProgress.simSold}/{item.myTargets.sim}</Text>
              </View>
            </View>
          )}
          {item.categories.hasFTTH && item.myTargets.ftth > 0 && (
            <View style={styles.targetItem}>
              <View style={[styles.targetIcon, { backgroundColor: CATEGORY_CONFIG.FTTH.color }]}>
                <Text style={styles.targetIconText}>F</Text>
              </View>
              <View style={styles.targetInfo}>
                <Text style={styles.targetLabel}>FTTH</Text>
                <Text style={styles.targetValue}>{item.myProgress.ftthSold}/{item.myTargets.ftth}</Text>
              </View>
            </View>
          )}
          {item.categories.hasLease && (
            <View style={styles.targetItem}>
              <View style={[styles.targetIcon, { backgroundColor: CATEGORY_CONFIG.LEASE_CIRCUIT.color }]}>
                <Text style={styles.targetIconText}>L</Text>
              </View>
              <View style={styles.targetInfo}>
                <Text style={styles.targetLabel}>Lease</Text>
                <Text style={styles.targetValue}>{(item.myProgress as any)?.lease ?? 0}/{item.myTargets.lease || 0}</Text>
              </View>
            </View>
          )}
          {item.categories.hasBtsDown && item.myTargets.btsDown > 0 && (
            <View style={styles.targetItem}>
              <View style={[styles.targetIcon, { backgroundColor: CATEGORY_CONFIG.BTS_DOWN.color }]}>
                <Text style={styles.targetIconText}>B</Text>
              </View>
              <View style={styles.targetInfo}>
                <Text style={styles.targetLabel}>BTS Down</Text>
                <Text style={styles.targetValue}>Target: {item.myTargets.btsDown}</Text>
              </View>
            </View>
          )}
          {item.categories.hasRouteFail && item.myTargets.routeFail > 0 && (
            <View style={styles.targetItem}>
              <View style={[styles.targetIcon, { backgroundColor: CATEGORY_CONFIG.ROUTE_FAIL.color }]}>
                <Text style={styles.targetIconText}>R</Text>
              </View>
              <View style={styles.targetInfo}>
                <Text style={styles.targetLabel}>Route Fail</Text>
                <Text style={styles.targetValue}>Target: {item.myTargets.routeFail}</Text>
              </View>
            </View>
          )}
          {item.categories.hasFtthDown && item.myTargets.ftthDown > 0 && (
            <View style={styles.targetItem}>
              <View style={[styles.targetIcon, { backgroundColor: CATEGORY_CONFIG.FTTH_DOWN.color }]}>
                <Text style={styles.targetIconText}>D</Text>
              </View>
              <View style={styles.targetInfo}>
                <Text style={styles.targetLabel}>FTTH Down</Text>
                <Text style={styles.targetValue}>Target: {item.myTargets.ftthDown}</Text>
              </View>
            </View>
          )}
          {item.categories.hasOfcFail && item.myTargets.ofcFail > 0 && (
            <View style={styles.targetItem}>
              <View style={[styles.targetIcon, { backgroundColor: CATEGORY_CONFIG.OFC_FAIL.color }]}>
                <Text style={styles.targetIconText}>O</Text>
              </View>
              <View style={styles.targetInfo}>
                <Text style={styles.targetLabel}>OFC Fail</Text>
                <Text style={styles.targetValue}>Target: {item.myTargets.ofcFail}</Text>
              </View>
            </View>
          )}
          {item.categories.hasEb && (
            <View style={styles.targetItem}>
              <View style={[styles.targetIcon, { backgroundColor: CATEGORY_CONFIG.EB.color }]}>
                <Text style={styles.targetIconText}>E</Text>
              </View>
              <View style={styles.targetInfo}>
                <Text style={styles.targetLabel}>EB</Text>
                <Text style={styles.targetValue}>{(item.myProgress as any)?.eb ?? 0}/{item.myTargets.eb || 0}</Text>
              </View>
            </View>
          )}
        </View>

        {!isCompleted && !isAlreadySubmittedOrApproved && (item.categories.hasSIM || item.categories.hasFTTH || item.categories.hasLease || item.categories.hasEb) && (
          salesTargetsAchieved ? (
            <View style={[styles.submitButton, styles.disabledButton]}>
              <Check size={16} color="#fff" />
              <Text style={styles.submitButtonText}>Sales Targets Achieved</Text>
            </View>
          ) : (
            <TouchableOpacity 
              style={styles.submitButton}
              onPress={() => router.push(`/event-sales?eventId=${item.id}`)}
            >
              <Target size={16} color="#fff" />
              <Text style={styles.submitButtonText}>Submit Sales Entry</Text>
            </TouchableOpacity>
          )
        )}

        {!isCompleted && !isAlreadySubmittedOrApproved && (item.categories.hasBtsDown || item.categories.hasRouteFail || 
          item.categories.hasFtthDown || item.categories.hasOfcFail) && (
          (() => {
            const omTargetsAchieved =
              (!item.categories.hasBtsDown || item.maintenanceProgress.btsDown >= item.maintenanceProgress.btsDownTarget) &&
              (!item.categories.hasRouteFail || item.maintenanceProgress.routeFail >= item.maintenanceProgress.routeFailTarget) &&
              (!item.categories.hasFtthDown || item.maintenanceProgress.ftthDown >= item.maintenanceProgress.ftthDownTarget) &&
              (!item.categories.hasOfcFail || item.maintenanceProgress.ofcFail >= item.maintenanceProgress.ofcFailTarget);
            return omTargetsAchieved ? (
              <View style={[styles.submitButton, { backgroundColor: '#4CAF50' }]}>
                <Check size={16} color="#fff" />
                <Text style={styles.submitButtonText}>Maintenance Complete</Text>
              </View>
            ) : (
              <TouchableOpacity 
                style={[styles.submitButton, { backgroundColor: '#9C27B0' }]}
                onPress={() => openMaintenanceModal(item)}
              >
                <Wrench size={16} color="#fff" />
                <Text style={styles.submitButtonText}>Complete Maintenance</Text>
              </TouchableOpacity>
            );
          })()
        )}
        
        {canSubmit && !isCompleted && (
          <TouchableOpacity 
            style={[styles.submitButton, { backgroundColor: '#1565C0', marginTop: 8 }]}
            onPress={(e) => {
              e.stopPropagation();
              Alert.alert(
                'Submit for Review',
                'Are you sure you want to submit this task for review?',
                [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Submit', onPress: () => submitForReviewMutation.mutate({ assignmentId: item.assignmentId, employeeId: employee?.id || '' }) }
                ]
              );
            }}
          >
            <Send size={16} color="#fff" />
            <Text style={styles.submitButtonText}>Submit for Review</Text>
          </TouchableOpacity>
        )}

        {item.submissionStatus === 'rejected' && item.rejectionReason && (
          <View style={styles.rejectionReasonBox}>
            <Text style={styles.rejectionReasonLabel}>Rejection Reason:</Text>
            <Text style={styles.rejectionReasonText}>{item.rejectionReason}</Text>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>My Tasks</Text>
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.light.primary} />
          <Text style={styles.loadingText}>Loading your tasks...</Text>
        </View>
      </SafeAreaView>
    );
  }

  const totalTasks = (myTasks?.length || 0);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>My Tasks</Text>
        <Text style={styles.headerSubtitle}>
          {createdByMe.length} created, {assignedToMe.length} assigned
        </Text>
      </View>

      {totalTasks === 0 ? (
        <View style={styles.emptyContainer}>
          <Target size={64} color={Colors.light.textSecondary} />
          <Text style={styles.emptyTitle}>No Tasks</Text>
          <Text style={styles.emptySubtitle}>You don't have any tasks created or assigned yet.</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
        >
          {createdByMe.length > 0 && (
            <View style={styles.section}>
              <TouchableOpacity
                style={styles.sectionHeader}
                onPress={() => setCreatedExpanded(!createdExpanded)}
                activeOpacity={0.7}
              >
                <View style={styles.sectionHeaderLeft}>
                  <View style={[styles.sectionIcon, { backgroundColor: '#F3E8FF' }]}>
                    <Text style={{ color: '#6B21A8', fontWeight: '700', fontSize: 12 }}>C</Text>
                  </View>
                  <Text style={styles.sectionTitle}>Created by Me</Text>
                  <View style={styles.sectionCount}>
                    <Text style={styles.sectionCountText}>{createdByMe.length}</Text>
                  </View>
                </View>
                {createdExpanded ? (
                  <ChevronUp size={20} color={Colors.light.textSecondary} />
                ) : (
                  <ChevronDown size={20} color={Colors.light.textSecondary} />
                )}
              </TouchableOpacity>
              {createdExpanded && createdByMe.map(renderCreatorCard)}
            </View>
          )}

          {assignedToMe.length > 0 && (
            <View style={styles.section}>
              <TouchableOpacity
                style={styles.sectionHeader}
                onPress={() => setAssignedExpanded(!assignedExpanded)}
                activeOpacity={0.7}
              >
                <View style={styles.sectionHeaderLeft}>
                  <View style={[styles.sectionIcon, { backgroundColor: '#DCFCE7' }]}>
                    <Text style={{ color: '#166534', fontWeight: '700', fontSize: 12 }}>A</Text>
                  </View>
                  <Text style={styles.sectionTitle}>Assigned to Me</Text>
                  <View style={styles.sectionCount}>
                    <Text style={styles.sectionCountText}>{assignedToMe.length}</Text>
                  </View>
                </View>
                {assignedExpanded ? (
                  <ChevronUp size={20} color={Colors.light.textSecondary} />
                ) : (
                  <ChevronDown size={20} color={Colors.light.textSecondary} />
                )}
              </TouchableOpacity>
              {assignedExpanded && assignedToMe.map(renderAssignedCard)}
            </View>
          )}
        </ScrollView>
      )}

      <Modal
        visible={maintenanceModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setMaintenanceModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Complete Maintenance Tasks</Text>
              <TouchableOpacity onPress={() => setMaintenanceModalVisible(false)}>
                <X size={24} color={Colors.light.text} />
              </TouchableOpacity>
            </View>

            {selectedTask && (
              <>
                <Text style={styles.modalTaskName}>{selectedTask.name}</Text>
                <Text style={styles.maintenanceHelpText}>Tap the + button to mark one task as completed, or - to undo.</Text>

                {selectedTask.categories.hasBtsDown && selectedTask.myTargets.btsDown > 0 && (() => {
                  const progress = selectedTask.maintenanceProgress?.btsDown || 0;
                  const target = selectedTask.maintenanceProgress?.btsDownTarget || selectedTask.myTargets.btsDown;
                  const atTarget = progress >= target;
                  return (
                  <View style={styles.maintenanceRow}>
                    <View style={styles.maintenanceInfo}>
                      <View style={[styles.maintenanceIcon, { backgroundColor: CATEGORY_CONFIG.BTS_DOWN.color }]}>
                        <Text style={styles.maintenanceIconText}>B</Text>
                      </View>
                      <View>
                        <Text style={styles.maintenanceLabel}>BTS Down</Text>
                        <Text style={[styles.maintenanceProgress, atTarget && { color: '#2E7D32', fontWeight: '700' }]}>
                          {progress} / {target}{atTarget ? ' ✓' : ''}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.maintenanceButtons}>
                      <TouchableOpacity 
                        style={[styles.maintenanceBtn, { backgroundColor: progress <= 0 ? '#ccc' : '#F44336' }]}
                        onPress={() => handleMaintenanceUndo('BTS_DOWN')}
                        disabled={maintenanceMutation.isPending || progress <= 0}
                      >
                        <Minus size={18} color="#fff" />
                      </TouchableOpacity>
                      <TouchableOpacity 
                        style={[styles.maintenanceBtn, { backgroundColor: atTarget ? '#ccc' : '#4CAF50' }]}
                        onPress={() => handleMaintenanceComplete('BTS_DOWN')}
                        disabled={maintenanceMutation.isPending || atTarget}
                      >
                        <Plus size={18} color="#fff" />
                      </TouchableOpacity>
                    </View>
                  </View>
                  );
                })()}

                {selectedTask.categories.hasRouteFail && selectedTask.myTargets.routeFail > 0 && (() => {
                  const progress = selectedTask.maintenanceProgress?.routeFail || 0;
                  const target = selectedTask.maintenanceProgress?.routeFailTarget || selectedTask.myTargets.routeFail;
                  const atTarget = progress >= target;
                  return (
                  <View style={styles.maintenanceRow}>
                    <View style={styles.maintenanceInfo}>
                      <View style={[styles.maintenanceIcon, { backgroundColor: CATEGORY_CONFIG.ROUTE_FAIL.color }]}>
                        <Text style={styles.maintenanceIconText}>R</Text>
                      </View>
                      <View>
                        <Text style={styles.maintenanceLabel}>Route Fail</Text>
                        <Text style={[styles.maintenanceProgress, atTarget && { color: '#2E7D32', fontWeight: '700' }]}>
                          {progress} / {target}{atTarget ? ' ✓' : ''}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.maintenanceButtons}>
                      <TouchableOpacity 
                        style={[styles.maintenanceBtn, { backgroundColor: progress <= 0 ? '#ccc' : '#F44336' }]}
                        onPress={() => handleMaintenanceUndo('ROUTE_FAIL')}
                        disabled={maintenanceMutation.isPending || progress <= 0}
                      >
                        <Minus size={18} color="#fff" />
                      </TouchableOpacity>
                      <TouchableOpacity 
                        style={[styles.maintenanceBtn, { backgroundColor: atTarget ? '#ccc' : '#4CAF50' }]}
                        onPress={() => handleMaintenanceComplete('ROUTE_FAIL')}
                        disabled={maintenanceMutation.isPending || atTarget}
                      >
                        <Plus size={18} color="#fff" />
                      </TouchableOpacity>
                    </View>
                  </View>
                  );
                })()}

                {selectedTask.categories.hasFtthDown && selectedTask.myTargets.ftthDown > 0 && (() => {
                  const progress = selectedTask.maintenanceProgress?.ftthDown || 0;
                  const target = selectedTask.maintenanceProgress?.ftthDownTarget || selectedTask.myTargets.ftthDown;
                  const atTarget = progress >= target;
                  return (
                  <View style={styles.maintenanceRow}>
                    <View style={styles.maintenanceInfo}>
                      <View style={[styles.maintenanceIcon, { backgroundColor: CATEGORY_CONFIG.FTTH_DOWN.color }]}>
                        <Text style={styles.maintenanceIconText}>D</Text>
                      </View>
                      <View>
                        <Text style={styles.maintenanceLabel}>FTTH Down</Text>
                        <Text style={[styles.maintenanceProgress, atTarget && { color: '#2E7D32', fontWeight: '700' }]}>
                          {progress} / {target}{atTarget ? ' ✓' : ''}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.maintenanceButtons}>
                      <TouchableOpacity 
                        style={[styles.maintenanceBtn, { backgroundColor: progress <= 0 ? '#ccc' : '#F44336' }]}
                        onPress={() => handleMaintenanceUndo('FTTH_DOWN')}
                        disabled={maintenanceMutation.isPending || progress <= 0}
                      >
                        <Minus size={18} color="#fff" />
                      </TouchableOpacity>
                      <TouchableOpacity 
                        style={[styles.maintenanceBtn, { backgroundColor: atTarget ? '#ccc' : '#4CAF50' }]}
                        onPress={() => handleMaintenanceComplete('FTTH_DOWN')}
                        disabled={maintenanceMutation.isPending || atTarget}
                      >
                        <Plus size={18} color="#fff" />
                      </TouchableOpacity>
                    </View>
                  </View>
                  );
                })()}

                {selectedTask.categories.hasOfcFail && selectedTask.myTargets.ofcFail > 0 && (() => {
                  const progress = selectedTask.maintenanceProgress?.ofcFail || 0;
                  const target = selectedTask.maintenanceProgress?.ofcFailTarget || selectedTask.myTargets.ofcFail;
                  const atTarget = progress >= target;
                  return (
                  <View style={styles.maintenanceRow}>
                    <View style={styles.maintenanceInfo}>
                      <View style={[styles.maintenanceIcon, { backgroundColor: CATEGORY_CONFIG.OFC_FAIL.color }]}>
                        <Text style={styles.maintenanceIconText}>O</Text>
                      </View>
                      <View>
                        <Text style={styles.maintenanceLabel}>OFC Fail</Text>
                        <Text style={[styles.maintenanceProgress, atTarget && { color: '#2E7D32', fontWeight: '700' }]}>
                          {progress} / {target}{atTarget ? ' ✓' : ''}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.maintenanceButtons}>
                      <TouchableOpacity 
                        style={[styles.maintenanceBtn, { backgroundColor: progress <= 0 ? '#ccc' : '#F44336' }]}
                        onPress={() => handleMaintenanceUndo('OFC_FAIL')}
                        disabled={maintenanceMutation.isPending || progress <= 0}
                      >
                        <Minus size={18} color="#fff" />
                      </TouchableOpacity>
                      <TouchableOpacity 
                        style={[styles.maintenanceBtn, { backgroundColor: atTarget ? '#ccc' : '#4CAF50' }]}
                        onPress={() => handleMaintenanceComplete('OFC_FAIL')}
                        disabled={maintenanceMutation.isPending || atTarget}
                      >
                        <Plus size={18} color="#fff" />
                      </TouchableOpacity>
                    </View>
                  </View>
                  );
                })()}

                <TouchableOpacity
                  style={styles.closeModalButton}
                  onPress={() => setMaintenanceModalVisible(false)}
                >
                  <Text style={styles.closeModalButtonText}>Done</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  header: { padding: 16, backgroundColor: Colors.light.primary },
  headerTitle: { fontSize: 24, fontWeight: 'bold', color: '#fff' },
  headerSubtitle: { fontSize: 14, color: 'rgba(255,255,255,0.8)', marginTop: 4 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 12, fontSize: 16, color: Colors.light.textSecondary },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  emptyTitle: { fontSize: 20, fontWeight: '600', color: Colors.light.text, marginTop: 16 },
  emptySubtitle: { fontSize: 14, color: Colors.light.textSecondary, textAlign: 'center', marginTop: 8 },
  listContent: { padding: 16 },
  section: { marginBottom: 16 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 10, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 3, elevation: 2 },
  sectionHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sectionIcon: { width: 28, height: 28, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: Colors.light.text },
  sectionCount: { backgroundColor: Colors.light.primary, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 2 },
  sectionCountText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  taskCard: { backgroundColor: Colors.light.card, borderRadius: 12, padding: 16, marginBottom: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 3 },
  creatorCard: { borderLeftWidth: 4, borderLeftColor: '#6B21A8' },
  completedCard: { opacity: 0.7, borderLeftWidth: 4, borderLeftColor: '#4CAF50' },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
  taskName: { fontSize: 18, fontWeight: '600', color: Colors.light.primary, flex: 1, marginRight: 8, backgroundColor: '#E3F2FD', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderLeftWidth: 3, borderLeftColor: Colors.light.primary },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  statusText: { fontSize: 12, fontWeight: '600' },
  roleBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, alignSelf: 'flex-start', marginTop: 4 },
  roleBadgeText: { fontSize: 10, fontWeight: '600' },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  infoText: { fontSize: 13, color: Colors.light.textSecondary, flex: 1 },
  categoriesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8, marginBottom: 12 },
  categoryChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  categoryChipText: { fontSize: 11, fontWeight: '600' },
  teamSection: { backgroundColor: '#F8F9FA', borderRadius: 10, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: '#E8E8E8' },
  teamHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  teamLabel: { fontSize: 13, fontWeight: '700', color: Colors.light.primary },
  teamMemberRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#F0F0F0' },
  teamMemberAvatar: { width: 26, height: 26, borderRadius: 13, backgroundColor: Colors.light.primary, justifyContent: 'center', alignItems: 'center' },
  teamMemberAvatarText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  teamMemberName: { fontSize: 13, fontWeight: '500', color: Colors.light.text },
  teamMemberPersNo: { fontSize: 11, color: Colors.light.textSecondary },
  memberTargets: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, justifyContent: 'flex-end', maxWidth: 180 },
  memberTargetText: { fontSize: 10, fontWeight: '600', color: Colors.light.primary, backgroundColor: '#E3F2FD', paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4 },
  teamMembersInline: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  teamMembersInlineText: { fontSize: 12, color: Colors.light.textSecondary, flex: 1 },
  myTargetsLabel: { fontSize: 14, fontWeight: '600', color: Colors.light.text, marginBottom: 8 },
  overallTargetsLabel: { fontSize: 14, fontWeight: '600', color: '#6B21A8', marginBottom: 8 },
  targetsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  targetItem: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F5F5F5', borderRadius: 8, padding: 8, minWidth: '45%' },
  targetIcon: { width: 32, height: 32, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  targetIconText: { color: '#fff', fontSize: 14, fontWeight: 'bold' },
  targetInfo: { marginLeft: 8 },
  targetLabel: { fontSize: 11, color: Colors.light.textSecondary },
  targetValue: { fontSize: 14, fontWeight: '600', color: Colors.light.text },
  submitButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.light.primary, borderRadius: 8, padding: 12, marginTop: 12, gap: 8 },
  disabledButton: { backgroundColor: '#4CAF50', opacity: 1 },
  submitButtonText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: Colors.light.background, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 40 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitle: { fontSize: 20, fontWeight: 'bold', color: Colors.light.text },
  modalTaskName: { fontSize: 16, color: Colors.light.primary, fontWeight: '600', marginBottom: 20, backgroundColor: '#E3F2FD', padding: 12, borderRadius: 8 },
  maintenanceHelpText: { fontSize: 13, color: Colors.light.textSecondary, marginBottom: 16, textAlign: 'center', fontStyle: 'italic' },
  maintenanceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#F5F5F5', borderRadius: 12, padding: 12, marginBottom: 12 },
  maintenanceInfo: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  maintenanceIcon: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  maintenanceIconText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  maintenanceLabel: { fontSize: 14, fontWeight: '600', color: Colors.light.text },
  maintenanceProgress: { fontSize: 13, color: Colors.light.textSecondary, marginTop: 2 },
  maintenanceButtons: { flexDirection: 'row', gap: 8 },
  maintenanceBtn: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center' },
  closeModalButton: { backgroundColor: Colors.light.primary, borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 8 },
  closeModalButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  rejectionReasonBox: { backgroundColor: '#FFEBEE', borderRadius: 8, padding: 12, marginTop: 12, borderLeftWidth: 3, borderLeftColor: '#C62828' },
  rejectionReasonLabel: { fontSize: 12, fontWeight: '600', color: '#C62828', marginBottom: 4 },
  rejectionReasonText: { fontSize: 13, color: '#B71C1C' },
});
