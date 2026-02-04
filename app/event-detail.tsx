import { useState, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert, RefreshControl, Modal } from 'react-native';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import { MapPin, Calendar, Users, Plus, Trash2, Camera, User, X, Edit3, Play, Pause, CheckCircle, XCircle, ChevronRight, Clock, Flag, ListTodo, Zap, AlertCircle, Settings, Send, RotateCcw, CircleCheck, Hourglass, CircleDot, ThumbsUp, ThumbsDown, Check } from 'lucide-react-native';
import { useAuth } from '@/contexts/auth';
import Colors from '@/constants/colors';
import { trpc } from '@/lib/trpc';
import { canCreateEvents } from '@/constants/app';
import { Circle, SubtaskPriority, SubtaskStatus, EventStatus } from '@/types';

const PRIORITY_COLORS: Record<SubtaskPriority, { bg: string; text: string }> = {
  low: { bg: '#E8F5E9', text: '#2E7D32' },
  medium: { bg: '#FFF3E0', text: '#EF6C00' },
  high: { bg: '#FFEBEE', text: '#C62828' },
  urgent: { bg: '#F3E5F5', text: '#7B1FA2' },
};

const STATUS_COLORS: Record<SubtaskStatus, { bg: string; text: string }> = {
  pending: { bg: '#ECEFF1', text: '#546E7A' },
  in_progress: { bg: '#E3F2FD', text: '#1565C0' },
  completed: { bg: '#E8F5E9', text: '#2E7D32' },
  cancelled: { bg: '#FFEBEE', text: '#C62828' },
};

const EVENT_STATUS_CONFIG: Record<EventStatus, { label: string; color: string; bg: string; icon: string; description: string }> = {
  draft: { label: 'Draft', color: '#78909C', bg: '#ECEFF1', icon: 'file', description: 'Task is being prepared' },
  active: { label: 'Active', color: '#2E7D32', bg: '#E8F5E9', icon: 'play', description: 'Task is live and running' },
  paused: { label: 'Paused', color: '#EF6C00', bg: '#FFF3E0', icon: 'pause', description: 'Task is temporarily paused' },
  completed: { label: 'Completed', color: '#1565C0', bg: '#E3F2FD', icon: 'check', description: 'Task has been completed' },
  cancelled: { label: 'Cancelled', color: '#C62828', bg: '#FFEBEE', icon: 'x', description: 'Task has been cancelled' },
};

const STATUS_TRANSITIONS: Record<EventStatus, EventStatus[]> = {
  draft: ['active', 'cancelled'],
  active: ['paused', 'completed', 'cancelled'],
  paused: ['active', 'completed', 'cancelled'],
  completed: ['active'],
  cancelled: ['draft'],
};

// Category configuration with icons and colors
const CATEGORY_CONFIG: Record<string, { label: string; color: string; bg: string; icon: string; type: 'sales' | 'maintenance' }> = {
  SIM: { label: 'SIM Sales', color: '#1565C0', bg: '#E3F2FD', icon: 'sim', type: 'sales' },
  FTTH: { label: 'FTTH Sales', color: '#2E7D32', bg: '#E8F5E9', icon: 'wifi', type: 'sales' },
  LEASE_CIRCUIT: { label: 'Lease Circuit', color: '#EF6C00', bg: '#FFF3E0', icon: 'cable', type: 'maintenance' },
  BTS_DOWN: { label: 'BTS Down', color: '#C62828', bg: '#FFEBEE', icon: 'tower', type: 'maintenance' },
  FTTH_DOWN: { label: 'FTTH Down', color: '#7B1FA2', bg: '#F3E5F5', icon: 'signal', type: 'maintenance' },
  ROUTE_FAIL: { label: 'Route Fail', color: '#00796B', bg: '#E0F2F1', icon: 'route', type: 'maintenance' },
  OFC_FAIL: { label: 'OFC Fail', color: '#546E7A', bg: '#ECEFF1', icon: 'fiber', type: 'maintenance' },
  EB: { label: 'EB Connections', color: '#FF5722', bg: '#FBE9E7', icon: 'zap', type: 'maintenance' },
};

type UrgencyLevel = 'on_track' | 'moderate' | 'warning' | 'critical' | 'overdue' | 'completed';

interface TimeInfo {
  elapsed: string;
  remaining: string;
  percentElapsed: number;
  urgency: UrgencyLevel;
  urgencyColor: string;
  urgencyBg: string;
  urgencyLabel: string;
  trendStatus: 'ahead' | 'on_track' | 'behind';
  expectedProgress: number;
  overdueDuration: string | null;
  overdueHours: number;
  totalDurationDays: number;
  elapsedDays: number;
  dueDateFormatted: string;
}

function getISTDate(): Date {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const utc = now.getTime() + (now.getTimezoneOffset() * 60 * 1000);
  return new Date(utc + istOffset);
}

const AVATAR_COLORS = [
  '#1565C0', '#2E7D32', '#EF6C00', '#7B1FA2', '#00796B',
  '#C62828', '#546E7A', '#FF5722', '#303F9F', '#00838F'
];

type SlaStatusType = 'no_sla' | 'not_started' | 'in_progress' | 'warning' | 'breached' | 'completed';

interface SlaStatusData {
  status: SlaStatusType;
  message: string;
}

const SLA_STATUS_CONFIG: Record<SlaStatusType, { bg: string; color: string; icon: string }> = {
  no_sla: { bg: '#F5F5F5', color: '#616161', icon: '' },
  not_started: { bg: '#F5F5F5', color: '#616161', icon: '⏱' },
  in_progress: { bg: '#E3F2FD', color: '#1565C0', icon: '⏱' },
  warning: { bg: '#FFF8E1', color: '#F57C00', icon: '!' },
  breached: { bg: '#FFEBEE', color: '#C62828', icon: '!' },
  completed: { bg: '#E8F5E9', color: '#2E7D32', icon: '✓' },
};

function renderSlaBadge(slaData: SlaStatusData | undefined, styles: any): React.ReactNode {
  if (!slaData || slaData.status === 'no_sla') return null;
  
  const config = SLA_STATUS_CONFIG[slaData.status];
  return (
    <View style={[styles.slaBadge, { backgroundColor: config.bg }]}>
      <Text style={[styles.slaBadgeIcon, { color: config.color }]}>{config.icon}</Text>
      <Text style={[styles.slaBadgeText, { color: config.color }]}>SLA: {slaData.message}</Text>
    </View>
  );
}

function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function getDistributedTarget(totalTarget: number, teamSize: number, memberIndex: number): number {
  if (teamSize <= 0) return 0;
  const baseTarget = Math.floor(totalTarget / teamSize);
  const remainder = totalTarget % teamSize;
  return memberIndex < remainder ? baseTarget + 1 : baseTarget;
}

function calculateTimeInfo(startDate: Date | string | null, endDate: Date | string | null, completed: number, target: number, _currentTime?: Date): TimeInfo {
  const now = _currentTime || getISTDate();
  const start = startDate ? new Date(startDate) : now;
  const end = endDate ? new Date(endDate) : now;
  
  const totalDuration = end.getTime() - start.getTime();
  const elapsed = now.getTime() - start.getTime();
  const remaining = end.getTime() - now.getTime();
  
  const percentElapsed = totalDuration > 0 ? Math.min(Math.max((elapsed / totalDuration) * 100, 0), 100) : 0;
  const completionPercent = target > 0 ? (completed / target) * 100 : 0;
  const expectedProgress = percentElapsed;
  
  const totalDurationDays = Math.ceil(totalDuration / (1000 * 60 * 60 * 24));
  const elapsedDays = Math.floor(elapsed / (1000 * 60 * 60 * 24));
  
  const overdueMs = remaining < 0 ? Math.abs(remaining) : 0;
  const overdueHours = Math.floor(overdueMs / (1000 * 60 * 60));
  const overdueDuration = remaining < 0 ? formatOverdueDuration(overdueMs) : null;
  
  const dueDateFormatted = end.toLocaleDateString('en-IN', { 
    day: 'numeric', 
    month: 'short', 
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
  
  let urgency: UrgencyLevel;
  let urgencyColor: string;
  let urgencyBg: string;
  let urgencyLabel: string;
  
  if (completed >= target) {
    urgency = 'completed';
    urgencyColor = '#2E7D32';
    urgencyBg = '#E8F5E9';
    urgencyLabel = 'Completed';
  } else if (remaining < 0) {
    urgency = 'overdue';
    urgencyColor = '#B71C1C';
    urgencyBg = '#FFCDD2';
    urgencyLabel = `Overdue by ${overdueDuration}`;
  } else if (percentElapsed >= 90) {
    urgency = 'critical';
    urgencyColor = '#C62828';
    urgencyBg = '#FFEBEE';
    urgencyLabel = 'Critical';
  } else if (percentElapsed >= 75) {
    urgency = 'warning';
    urgencyColor = '#E65100';
    urgencyBg = '#FFF3E0';
    urgencyLabel = 'Warning';
  } else if (percentElapsed >= 50) {
    urgency = 'moderate';
    urgencyColor = '#F9A825';
    urgencyBg = '#FFFDE7';
    urgencyLabel = 'Moderate';
  } else {
    urgency = 'on_track';
    urgencyColor = '#2E7D32';
    urgencyBg = '#E8F5E9';
    urgencyLabel = 'On Track';
  }
  
  let trendStatus: 'ahead' | 'on_track' | 'behind' = 'on_track';
  if (completionPercent > expectedProgress + 10) {
    trendStatus = 'ahead';
  } else if (completionPercent < expectedProgress - 10) {
    trendStatus = 'behind';
  }
  
  return {
    elapsed: formatDuration(elapsed),
    remaining: remaining > 0 ? formatDuration(remaining) : `Overdue by ${overdueDuration}`,
    percentElapsed,
    urgency,
    urgencyColor,
    urgencyBg,
    urgencyLabel,
    trendStatus,
    expectedProgress,
    overdueDuration,
    overdueHours,
    totalDurationDays,
    elapsedDays,
    dueDateFormatted,
  };
}

function formatOverdueDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / (1000 * 60));
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  
  if (days > 0) {
    return `${days}d ${hours}h`;
  } else if (hours > 0) {
    return `${hours}h ${minutes}m`;
  } else {
    return `${minutes}m`;
  }
}

function formatDuration(ms: number): string {
  if (ms < 0) return '0m';
  const totalMinutes = Math.floor(ms / (1000 * 60));
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  
  if (days > 0) {
    return `${days}d ${hours}h`;
  } else if (hours > 0) {
    return `${hours}h ${minutes}m`;
  } else {
    return `${minutes}m`;
  }
}

function getSlaTimeDisplay(slaStatus: { status: string; message: string; remainingMs?: number } | undefined): {
  timeLeft: string;
  urgencyLabel: string;
  urgencyColor: string;
  urgencyBg: string;
} {
  if (!slaStatus) {
    return { timeLeft: 'N/A', urgencyLabel: 'No SLA', urgencyColor: '#616161', urgencyBg: '#F5F5F5' };
  }
  
  const { status, message, remainingMs } = slaStatus;
  
  switch (status) {
    case 'no_sla':
      return { timeLeft: 'No SLA', urgencyLabel: 'No SLA', urgencyColor: '#616161', urgencyBg: '#F5F5F5' };
    case 'not_started':
      return { timeLeft: message, urgencyLabel: 'Not Started', urgencyColor: '#616161', urgencyBg: '#F5F5F5' };
    case 'completed':
      return { timeLeft: 'Completed', urgencyLabel: 'Completed', urgencyColor: '#2E7D32', urgencyBg: '#E8F5E9' };
    case 'breached':
      return { timeLeft: message, urgencyLabel: message, urgencyColor: '#B71C1C', urgencyBg: '#FFCDD2' };
    case 'warning':
      return { timeLeft: message, urgencyLabel: 'Warning', urgencyColor: '#E65100', urgencyBg: '#FFF3E0' };
    case 'in_progress':
      const remaining = remainingMs ? formatDuration(remainingMs) : message;
      return { timeLeft: remaining, urgencyLabel: 'In Progress', urgencyColor: '#1565C0', urgencyBg: '#E3F2FD' };
    default:
      return { timeLeft: message || 'N/A', urgencyLabel: 'Unknown', urgencyColor: '#616161', urgencyBg: '#F5F5F5' };
  }
}

export default function EventDetailScreen() {
  const router = useRouter();
  const { id, edit } = useLocalSearchParams<{ id: string; edit?: string }>();
  const { employee } = useAuth();
  
  const [currentTime, setCurrentTime] = useState(getISTDate());
  const [refreshing, setRefreshing] = useState(false);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showSubtaskModal, setShowSubtaskModal] = useState(false);
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [showEditTargetModal, setShowEditTargetModal] = useState(false);
  const [selectedMemberId, setSelectedMemberId] = useState('');
  const [simTarget, setSimTarget] = useState('');
  const [ftthTarget, setFtthTarget] = useState('');
  
  const [editName, setEditName] = useState('');
  const [editLocation, setEditLocation] = useState('');
  const [editStartDate, setEditStartDate] = useState('');
  const [editEndDate, setEditEndDate] = useState('');
  const [editTargetSim, setEditTargetSim] = useState('');
  const [editTargetFtth, setEditTargetFtth] = useState('');
  const [editTargetLease, setEditTargetLease] = useState('');
  const [editTargetBtsDown, setEditTargetBtsDown] = useState('');
  const [editTargetRouteFail, setEditTargetRouteFail] = useState('');
  const [editTargetFtthDown, setEditTargetFtthDown] = useState('');
  const [editTargetOfcFail, setEditTargetOfcFail] = useState('');
  const [editTargetEb, setEditTargetEb] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editKeyInsight, setEditKeyInsight] = useState('');
  
  const [subtaskTitle, setSubtaskTitle] = useState('');
  const [subtaskDescription, setSubtaskDescription] = useState('');
  const [subtaskAssignee, setSubtaskAssignee] = useState('');
  const [subtaskStaffId, setSubtaskStaffId] = useState('');
  const [subtaskPriority, setSubtaskPriority] = useState<SubtaskPriority>('medium');
  const [subtaskDueDate, setSubtaskDueDate] = useState('');
  const [subtaskSimAllocated, setSubtaskSimAllocated] = useState('');
  const [subtaskFtthAllocated, setSubtaskFtthAllocated] = useState('');
  const [editingSubtask, setEditingSubtask] = useState<string | null>(null);
  const [foundEmployee, setFoundEmployee] = useState<{ id: string; name: string; designation?: string } | null>(null);
  const [searchingEmployee, setSearchingEmployee] = useState(false);
  
  const [editingMember, setEditingMember] = useState<{ employeeId: string; name: string } | null>(null);
  const [editMemberSimTarget, setEditMemberSimTarget] = useState('');
  const [editMemberFtthTarget, setEditMemberFtthTarget] = useState('');
  
  const trpcUtils = trpc.useUtils();
  
  // Helper: Force integer-only input
  const handleIntegerInput = (value: string, setter: (v: string) => void) => {
    const intValue = value.replace(/[^0-9]/g, '');
    setter(intValue);
  };
  
  // Calculate validation status for target distribution
  const getDistributionValidation = () => {
    if (!eventData || !resourceStatus) return { simValid: true, ftthValid: true, simRemaining: 0, ftthRemaining: 0 };
    
    const newSimTarget = parseInt(editMemberSimTarget) || 0;
    const newFtthTarget = parseInt(editMemberFtthTarget) || 0;
    
    // Calculate what's available for this member (current remaining + their current target)
    const currentMemberSimTarget = editingMember 
      ? (eventData.teamWithAllocations?.find((m: any) => m.employeeId === editingMember.employeeId)?.simTarget || 0)
      : 0;
    const currentMemberFtthTarget = editingMember 
      ? (eventData.teamWithAllocations?.find((m: any) => m.employeeId === editingMember.employeeId)?.ftthTarget || 0)
      : 0;
    
    const simAvailable = resourceStatus.remaining.simToDistribute + currentMemberSimTarget;
    const ftthAvailable = resourceStatus.remaining.ftthToDistribute + currentMemberFtthTarget;
    
    return {
      simValid: newSimTarget <= simAvailable,
      ftthValid: newFtthTarget <= ftthAvailable,
      simRemaining: simAvailable - newSimTarget,
      ftthRemaining: ftthAvailable - newFtthTarget,
      simAvailable,
      ftthAvailable,
    };
  };
  
  // Smart distribute evenly function
  const distributeEvenly = (type: 'sim' | 'ftth') => {
    if (!eventData || !resourceStatus) return;
    
    const teamMembers = eventData.teamWithAllocations?.filter((m: any) => m.employeeId !== eventData.assignedTo) || [];
    if (teamMembers.length === 0) return;
    
    const totalTarget = type === 'sim' 
      ? (resourceStatus.target?.sim || eventData.targetSim || 0)
      : (resourceStatus.target?.ftth || eventData.targetFtth || 0);
    
    if (totalTarget === 0) return;
    
    const baseAmount = Math.floor(totalTarget / teamMembers.length);
    const remainder = totalTarget % teamMembers.length;
    
    // Find current member's index to determine if they get extra
    const memberIndex = teamMembers.findIndex((m: any) => m.employeeId === editingMember?.employeeId);
    // Guard against memberIndex -1 (member not in list) - give base amount
    const memberTarget = memberIndex >= 0 && memberIndex < remainder ? baseAmount + 1 : baseAmount;
    
    if (type === 'sim') {
      setEditMemberSimTarget(memberTarget.toString());
    } else {
      setEditMemberFtthTarget(memberTarget.toString());
    }
    
    Alert.alert(
      'Distribution Info',
      `Total ${type.toUpperCase()}: ${totalTarget}\nTeam Members: ${teamMembers.length}\nEach gets: ${baseAmount}${remainder > 0 ? ` (first ${remainder} members get +1)` : ''}\nThis member: ${memberTarget}`
    );
  };
  
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(getISTDate());
    }, 60000);
    return () => clearInterval(timer);
  }, []);
  
  const { data: eventData, isLoading, isError, error, refetch } = trpc.events.getEventWithDetails.useQuery(
    { id: id || '' },
    { 
      enabled: !!id && id.length > 0,
      retry: 2,
      retryDelay: 1000,
    }
  );
  
  console.log('Event Detail - ID:', id);
  console.log('Event Detail - Loading:', isLoading);
  console.log('Event Detail - Error:', isError, error?.message);
  console.log('Event Detail - Data:', eventData ? 'Found' : 'Not found');
  if (eventData) {
    console.log('Event Detail - Category:', eventData.category);
    console.log('Event Detail - Targets:', { 
      sim: eventData.targetSim, 
      ftth: eventData.targetFtth, 
      eb: eventData.targetEb,
      lease: eventData.targetLease,
      btsDown: eventData.targetBtsDown
    });
  }
  
  const managerPurseId = eventData?.assignedToEmployee ? 
    (eventData.assignedToEmployee as any).persNo || null : null;
  
  const { data: availableMembers } = trpc.events.getAvailableTeamMembers.useQuery(
    { circle: eventData?.circle as Circle, eventId: id, managerPurseId: managerPurseId || undefined },
    { enabled: !!eventData?.circle && !!id }
  );
  
  const { data: resourceStatus } = trpc.events.getEventResourceStatus.useQuery(
    { eventId: id || '' },
    { enabled: !!id && id.length > 0 }
  );

  const { data: activityLogs, refetch: refetchAuditLogs } = trpc.audit.getByEntity.useQuery(
    { entityType: 'EVENT', entityId: id || '' },
    { enabled: !!id && id.length > 0 }
  );
  
  const assignMemberMutation = trpc.events.assignTeamMember.useMutation({
    onSuccess: () => {
      Alert.alert('Success', 'Team member assigned successfully');
      refetch();
      setShowAssignModal(false);
      resetAssignForm();
    },
    onError: (error) => {
      Alert.alert('Error', error.message);
    },
  });
  
  const removeMemberMutation = trpc.events.removeTeamMember.useMutation({
    onSuccess: () => {
      Alert.alert('Success', 'Team member removed');
      refetch();
    },
    onError: (error) => {
      Alert.alert('Error', error.message);
    },
  });

  const updateEventMutation = trpc.events.update.useMutation({
    onSuccess: () => {
      Alert.alert('Success', 'Task updated successfully');
      refetch();
      setShowEditModal(false);
    },
    onError: (error) => {
      Alert.alert('Error', error.message);
    },
  });

  const updateStatusMutation = trpc.events.updateEventStatus.useMutation({
    onSuccess: () => {
      Alert.alert('Success', 'Task status updated');
      refetch();
      setShowStatusModal(false);
    },
    onError: (error) => {
      Alert.alert('Error', error.message);
    },
  });

  const createSubtaskMutation = trpc.events.createSubtask.useMutation({
    onSuccess: () => {
      Alert.alert('Success', 'Subtask created successfully');
      refetch();
      setShowSubtaskModal(false);
      resetSubtaskForm();
    },
    onError: (error) => {
      Alert.alert('Error', error.message);
    },
  });

  const updateSubtaskMutation = trpc.events.updateSubtask.useMutation({
    onSuccess: () => {
      Alert.alert('Success', 'Subtask updated');
      refetch();
      setShowSubtaskModal(false);
      resetSubtaskForm();
    },
    onError: (error) => {
      Alert.alert('Error', error.message);
    },
  });

  const deleteSubtaskMutation = trpc.events.deleteSubtask.useMutation({
    onSuccess: () => {
      Alert.alert('Success', 'Subtask deleted');
      refetch();
    },
    onError: (error) => {
      Alert.alert('Error', error.message);
    },
  });

  const updateTargetsMutation = trpc.events.updateTeamMemberTargets.useMutation({
    onSuccess: () => {
      Alert.alert('Success', 'Targets updated successfully');
      refetch();
      setShowEditTargetModal(false);
      setEditingMember(null);
    },
    onError: (error) => {
      Alert.alert('Error', error.message);
    },
  });

  const updateTaskProgressMutation = trpc.events.updateTaskProgress.useMutation({
    onSuccess: () => {
      refetch();
    },
    onError: (error) => {
      Alert.alert('Error', error.message);
    },
  });

  const [pendingMemberTask, setPendingMemberTask] = useState<string | null>(null);
  
  const updateMemberTaskProgressMutation = trpc.events.updateMemberTaskProgress.useMutation({
    onMutate: () => {
      console.log("Starting member task progress update...");
    },
    onSuccess: () => {
      console.log("Member task progress updated successfully");
      refetch();
      refetchAuditLogs();
      setPendingMemberTask(null);
    },
    onError: (error) => {
      console.log("Member task progress update failed:", error.message);
      Alert.alert('Error', error.message);
      setPendingMemberTask(null);
    },
  });

  const approveTaskMutation = trpc.events.approveTask.useMutation({
    onSuccess: () => {
      Alert.alert('Success', 'Task approved successfully!');
      refetch();
    },
    onError: (error) => {
      Alert.alert('Error', error.message);
    },
  });

  const rejectTaskMutation = trpc.events.rejectTask.useMutation({
    onSuccess: () => {
      Alert.alert('Success', 'Task rejected');
      refetch();
    },
    onError: (error) => {
      Alert.alert('Error', error.message);
    },
  });

  const [rejectReason, setRejectReason] = useState('');
  const [rejectModalVisible, setRejectModalVisible] = useState(false);
  const [rejectingAssignmentId, setRejectingAssignmentId] = useState<string | null>(null);

  const getSubmissionStatusIndicator = (status: string) => {
    switch (status) {
      case 'approved':
        return { icon: <CircleCheck size={12} color="#2E7D32" />, label: 'Approved', color: '#2E7D32', bgColor: '#E8F5E9' };
      case 'submitted':
        return { icon: <Send size={12} color="#1565C0" />, label: 'Submitted', color: '#1565C0', bgColor: '#E3F2FD' };
      case 'rejected':
        return { icon: <RotateCcw size={12} color="#C62828" />, label: 'Rejected', color: '#C62828', bgColor: '#FFEBEE' };
      case 'in_progress':
        return { icon: <Hourglass size={12} color="#EF6C00" />, label: 'In Progress', color: '#EF6C00', bgColor: '#FFF3E0' };
      default:
        return { icon: <CircleDot size={12} color="#78909C" />, label: 'Not Started', color: '#78909C', bgColor: '#ECEFF1' };
    }
  };

  const handleApproveTask = (assignmentId: string) => {
    if (!employee?.id) return;
    Alert.alert(
      'Approve Task',
      'Are you sure you want to approve this task?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Approve', onPress: () => approveTaskMutation.mutate({ assignmentId, reviewerId: employee.id }) }
      ]
    );
  };

  const handleRejectTask = (assignmentId: string) => {
    setRejectingAssignmentId(assignmentId);
    setRejectReason('');
    setRejectModalVisible(true);
  };

  const confirmRejectTask = () => {
    if (!employee?.id || !rejectingAssignmentId) return;
    rejectTaskMutation.mutate({
      assignmentId: rejectingAssignmentId,
      reviewerId: employee.id,
      reason: rejectReason || undefined,
    });
    setRejectModalVisible(false);
    setRejectingAssignmentId(null);
  };

  const handleMarkTaskComplete = (taskType: 'EB' | 'LEASE' | 'BTS_DOWN' | 'FTTH_DOWN' | 'ROUTE_FAIL' | 'OFC_FAIL', increment: number = 1) => {
    if (!employee?.id || !id) return;
    updateTaskProgressMutation.mutate({
      eventId: id,
      taskType,
      increment,
      updatedBy: employee.id,
    });
  };

  const handleMemberTaskComplete = (memberId: string, taskType: 'EB' | 'LEASE' | 'BTS_DOWN' | 'FTTH_DOWN' | 'ROUTE_FAIL' | 'OFC_FAIL', increment: number = 1) => {
    if (!employee?.id || !id) return;
    if (updateMemberTaskProgressMutation.isPending) return;
    
    const taskKey = `${memberId}-${taskType}`;
    setPendingMemberTask(taskKey);
    console.log("Calling updateMemberTaskProgress for:", memberId, taskType, increment);
    
    updateMemberTaskProgressMutation.mutate({
      eventId: id,
      employeeId: memberId,
      taskType,
      increment,
      updatedBy: employee.id,
    });
  };
  
  const resetAssignForm = () => {
    setSelectedMemberId('');
    setSimTarget('');
    setFtthTarget('');
  };

  const resetSubtaskForm = () => {
    setSubtaskTitle('');
    setSubtaskDescription('');
    setSubtaskAssignee('');
    setSubtaskStaffId('');
    setSubtaskPriority('medium');
    setSubtaskDueDate('');
    setSubtaskSimAllocated('');
    setSubtaskFtthAllocated('');
    setEditingSubtask(null);
    setFoundEmployee(null);
  };

  const openEditModal = () => {
    if (!eventData) return;
    setEditName(eventData.name);
    setEditLocation(eventData.location);
    setEditStartDate(new Date(eventData.startDate).toISOString().split('T')[0]);
    setEditEndDate(new Date(eventData.endDate).toISOString().split('T')[0]);
    setEditTargetSim(eventData.targetSim.toString());
    setEditTargetFtth(eventData.targetFtth.toString());
    setEditTargetLease((eventData.targetLease || 0).toString());
    setEditTargetBtsDown((eventData.targetBtsDown || 0).toString());
    setEditTargetRouteFail((eventData.targetRouteFail || 0).toString());
    setEditTargetFtthDown((eventData.targetFtthDown || 0).toString());
    setEditTargetOfcFail((eventData.targetOfcFail || 0).toString());
    setEditTargetEb((eventData.targetEb || 0).toString());
    setEditCategory(eventData.category);
    setEditKeyInsight(eventData.keyInsight || '');
    setShowEditModal(true);
  };

  const openEditTargetModal = (member: any) => {
    setEditingMember({ employeeId: member.employeeId, name: member.employee?.name || 'Unknown' });
    setEditMemberSimTarget(member.simTarget.toString());
    setEditMemberFtthTarget(member.ftthTarget.toString());
    setShowEditTargetModal(true);
  };

  const openEditSubtask = (subtask: any) => {
    setEditingSubtask(subtask.id);
    setSubtaskTitle(subtask.title);
    setSubtaskDescription(subtask.description || '');
    setSubtaskAssignee(subtask.assignedTo || '');
    setSubtaskStaffId(subtask.assignedEmployee?.persNo || '');
    setSubtaskPriority(subtask.priority);
    setSubtaskDueDate(subtask.dueDate ? new Date(subtask.dueDate).toISOString().split('T')[0] : '');
    setSubtaskSimAllocated(subtask.simAllocated?.toString() || '');
    setSubtaskFtthAllocated(subtask.ftthAllocated?.toString() || '');
    if (subtask.assignedEmployee) {
      setFoundEmployee({ id: subtask.assignedEmployee.id, name: subtask.assignedEmployee.name, designation: subtask.assignedEmployee.designation });
    } else {
      setFoundEmployee(null);
    }
    setShowSubtaskModal(true);
  };
  
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

    
  const handleAssignMember = () => {
    if (!selectedMemberId) {
      Alert.alert('Error', 'Please select a team member');
      return;
    }
    if (!employee?.id) return;
    
    assignMemberMutation.mutate({
      eventId: id || '',
      employeeId: selectedMemberId,
      simTarget: parseInt(simTarget) || 0,
      ftthTarget: parseInt(ftthTarget) || 0,
      assignedBy: employee.id,
    });
  };

  const handleUpdateEvent = () => {
    if (!employee?.id || !eventData) return;
    updateEventMutation.mutate({
      id: eventData.id,
      name: editName,
      location: editLocation,
      startDate: editStartDate,
      endDate: editEndDate,
      targetSim: parseInt(editTargetSim) || 0,
      targetFtth: parseInt(editTargetFtth) || 0,
      targetLease: parseInt(editTargetLease) || 0,
      targetBtsDown: parseInt(editTargetBtsDown) || 0,
      targetRouteFail: parseInt(editTargetRouteFail) || 0,
      targetFtthDown: parseInt(editTargetFtthDown) || 0,
      targetOfcFail: parseInt(editTargetOfcFail) || 0,
      targetEb: parseInt(editTargetEb) || 0,
      category: editCategory as any,
      keyInsight: editKeyInsight,
      updatedBy: employee.id,
    });
  };

  const handleUpdateStatus = (newStatus: EventStatus) => {
    if (!employee?.id || !eventData) return;
    
    const currentStatus = (eventData.status as EventStatus) || 'active';
    const allowedTransitions = STATUS_TRANSITIONS[currentStatus] || [];
    
    if (!allowedTransitions.includes(newStatus)) {
      Alert.alert('Invalid Transition', `Cannot change status from ${EVENT_STATUS_CONFIG[currentStatus].label} to ${EVENT_STATUS_CONFIG[newStatus].label}`);
      return;
    }
    
    
    const confirmMessages: Record<EventStatus, { title: string; message: string }> = {
      draft: { title: 'Revert to Draft?', message: 'This will move the event back to draft status. You can edit and reactivate it later.' },
      active: { title: 'Activate Task?', message: 'This will make the task active and visible to team members. Sales can be submitted.' },
      paused: { title: 'Pause Task?', message: 'This will temporarily pause the task. Team members will not be able to submit sales. You can resume anytime.' },
      completed: { title: 'Complete Task?', message: 'This will mark the task as completed. Make sure all sales are submitted before completing.' },
      cancelled: { title: 'Cancel Task?', message: 'This will cancel the task. This action is reversible but should be done with caution.' },
    };
    
    const { title, message } = confirmMessages[newStatus];
    
    Alert.alert(
      title,
      message,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          style: newStatus === 'cancelled' ? 'destructive' : 'default',
          onPress: () => {
            updateStatusMutation.mutate({
              eventId: eventData.id,
              status: newStatus,
              updatedBy: employee.id,
            });
          },
        },
      ]
    );
  };

  const handleCreateSubtask = () => {
    if (!subtaskTitle.trim()) {
      Alert.alert('Error', 'Please enter subtask title');
      return;
    }
    if (!subtaskStaffId.trim()) {
      Alert.alert('Error', 'Please enter Pers No');
      return;
    }
    if (!foundEmployee && !subtaskAssignee) {
      Alert.alert('Error', 'Please enter a valid Pers No and verify the employee');
      return;
    }
    if (!employee?.id) return;

    if (editingSubtask) {
      updateSubtaskMutation.mutate({
        subtaskId: editingSubtask,
        title: subtaskTitle,
        description: subtaskDescription || undefined,
        assignedTo: foundEmployee?.id || subtaskAssignee || null,
        priority: subtaskPriority,
        dueDate: subtaskDueDate || null,
        simAllocated: parseInt(subtaskSimAllocated) || 0,
        ftthAllocated: parseInt(subtaskFtthAllocated) || 0,
        updatedBy: employee.id,
      });
    } else {
      createSubtaskMutation.mutate({
        eventId: id || '',
        title: subtaskTitle,
        description: subtaskDescription || undefined,
        assignedTo: foundEmployee?.id || undefined,
        staffId: subtaskStaffId || undefined,
        priority: subtaskPriority,
        dueDate: subtaskDueDate || undefined,
        simAllocated: parseInt(subtaskSimAllocated) || 0,
        ftthAllocated: parseInt(subtaskFtthAllocated) || 0,
        createdBy: employee.id,
      });
    }
  };

  const handleUpdateSubtaskStatus = (subtaskId: string, status: SubtaskStatus) => {
    if (!employee?.id) return;
    updateSubtaskMutation.mutate({
      subtaskId,
      status,
      updatedBy: employee.id,
    });
  };

  const handleDeleteSubtask = (subtaskId: string, title: string) => {
    Alert.alert(
      'Delete Subtask',
      `Are you sure you want to delete "${title}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            if (!employee?.id) return;
            deleteSubtaskMutation.mutate({ subtaskId, deletedBy: employee.id });
          },
        },
      ]
    );
  };

  const handleUpdateMemberTargets = () => {
    if (!employee?.id || !editingMember) return;
    
    const simTarget = Math.floor(parseInt(editMemberSimTarget) || 0);
    const ftthTarget = Math.floor(parseInt(editMemberFtthTarget) || 0);
    
    // Validate before submitting
    const validation = getDistributionValidation();
    if (!validation.simValid) {
      Alert.alert('Over Allocation', `Cannot assign ${simTarget} SIMs. Only ${validation.simAvailable} available for distribution.`);
      return;
    }
    if (!validation.ftthValid) {
      Alert.alert('Over Allocation', `Cannot assign ${ftthTarget} FTTH. Only ${validation.ftthAvailable} available for distribution.`);
      return;
    }
    
    updateTargetsMutation.mutate({
      eventId: id || '',
      employeeId: editingMember.employeeId,
      simTarget,
      ftthTarget,
      updatedBy: employee.id,
    });
  };
  
  const handleRemoveMember = (employeeId: string, employeeName: string) => {
    Alert.alert(
      'Remove Team Member',
      `Are you sure you want to remove ${employeeName} from this event?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            if (!employee?.id) return;
            removeMemberMutation.mutate({
              eventId: id || '',
              employeeId,
              removedBy: employee.id,
            });
          },
        },
      ]
    );
  };
  
  const isEventManager = eventData?.assignedToEmployee?.id === employee?.id;
  const isEventCreator = eventData?.createdBy === employee?.id;
  const canManageTeam = canCreateEvents(employee?.role || 'SALES_STAFF') || isEventManager || isEventCreator;
  // Check if user is a team member via either event_assignments OR assignedTeam array (persNo based)
  const isInAssignedTeam = employee?.persNo && (eventData?.assignedTeam as string[] || []).includes(employee.persNo);
  const hasAssignmentRecord = eventData?.teamWithAllocations?.some(t => t.employeeId === employee?.id);
  const isTeamMember = isInAssignedTeam || hasAssignmentRecord;

  const isDraftEvent = eventData?.status === 'draft';
  
  const getDraftChecklist = () => {
    if (!eventData) return [];
    const checks = [
      { label: 'Task Name', done: !!eventData.name },
      { label: 'Location', done: !!eventData.location },
      { label: 'Date Range', done: !!eventData.startDate && !!eventData.endDate },
      { label: 'Task Manager Assigned', done: !!eventData.assignedTo },
      { label: 'Team Members Added', done: (eventData.teamWithAllocations?.length || 0) > 0 },
      { label: 'SIM/FTTH Targets Set', done: (eventData.targetSim || 0) > 0 || (eventData.targetFtth || 0) > 0 },
    ];
    return checks;
  };
  
  const draftChecklist = getDraftChecklist();
  const completedChecks = draftChecklist.filter(c => c.done).length;
  const isReadyToActivate = completedChecks >= 4;

  useEffect(() => {
    if (edit === 'true' && eventData && canManageTeam) {
      openEditModal();
    }
  }, [edit, eventData?.id, canManageTeam]);
  
  const getEventStatus = (): EventStatus => {
    if (!eventData) return 'draft';
    const dbStatus = eventData.status as EventStatus;
    if (dbStatus && ['draft', 'active', 'paused', 'completed', 'cancelled'].includes(dbStatus)) {
      return dbStatus;
    }
    return 'active';
  };
  
  const getDisplayStatus = () => {
    const dbStatus = getEventStatus();
    if (dbStatus !== 'active') return dbStatus;
    
    const now = new Date();
    const startDate = new Date(eventData?.startDate || '');
    const endDate = new Date(eventData?.endDate || '');
    
    if (now < startDate) return 'upcoming';
    if (now > endDate) return 'past';
    return 'active';
  };
  
  const dbStatus = getEventStatus();
  const displayStatus = getDisplayStatus();
  
  const extendedStatusColors: Record<string, { color: string; bg: string }> = {
    draft: { color: '#78909C', bg: '#ECEFF1' },
    active: { color: '#2E7D32', bg: '#E8F5E9' },
    paused: { color: '#EF6C00', bg: '#FFF3E0' },
    completed: { color: '#1565C0', bg: '#E3F2FD' },
    cancelled: { color: '#C62828', bg: '#FFEBEE' },
    upcoming: { color: '#7B1FA2', bg: '#F3E5F5' },
    past: { color: '#546E7A', bg: '#ECEFF1' },
  };
  
  const statusColor = extendedStatusColors[displayStatus]?.color || Colors.light.textSecondary;
  const statusBg = extendedStatusColors[displayStatus]?.bg || '#F5F5F5';
  
  const getStatusLabel = () => {
    if (dbStatus === 'active') {
      const now = new Date();
      const startDate = new Date(eventData?.startDate || '');
      const endDate = new Date(eventData?.endDate || '');
      if (now < startDate) return 'Upcoming';
      if (now > endDate) return 'Past Due';
      return 'Active';
    }
    return EVENT_STATUS_CONFIG[dbStatus]?.label || 'Unknown';
  };
  
  const availableTransitions = STATUS_TRANSITIONS[dbStatus] || [];
  
  const unassignedMembers = availableMembers?.filter(m => !m.isAssigned && m.id !== eventData?.assignedTo) || [];
  

  if (!id) {
    return (
      <>
        <Stack.Screen options={{ title: 'Task Details', headerStyle: { backgroundColor: Colors.light.primary }, headerTintColor: Colors.light.background }} />
        <View style={styles.loadingContainer}>
          <Text style={styles.errorTitle}>Invalid Task</Text>
          <Text style={styles.errorText}>No event ID provided</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => router.back()}>
            <Text style={styles.retryButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </>
    );
  }

  if (isLoading) {
    return (
      <>
        <Stack.Screen options={{ title: 'Task Details', headerStyle: { backgroundColor: Colors.light.primary }, headerTintColor: Colors.light.background }} />
        <View style={styles.loadingContainer}>
          <View style={styles.loadingSpinner}>
            <Text style={styles.loadingIcon}>⏳</Text>
          </View>
          <Text style={styles.loadingText}>Loading event details...</Text>
          <Text style={styles.loadingSubtext}>Please wait</Text>
        </View>
      </>
    );
  }

  if (isError) {
    console.error('Event Detail Error:', error);
    return (
      <>
        <Stack.Screen options={{ title: 'Task Details', headerStyle: { backgroundColor: Colors.light.primary }, headerTintColor: Colors.light.background }} />
        <View style={styles.loadingContainer}>
          <Text style={styles.errorIcon}>⚠️</Text>
          <Text style={styles.errorTitle}>Failed to Load Task</Text>
          <Text style={styles.errorText}>{error?.message || 'An unexpected error occurred'}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => refetch()}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <Text style={styles.backButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </>
    );
  }
  
  if (!eventData) {
    return (
      <>
        <Stack.Screen options={{ title: 'Task Details', headerStyle: { backgroundColor: Colors.light.primary }, headerTintColor: Colors.light.background }} />
        <View style={styles.loadingContainer}>
          <Text style={styles.errorIcon}>🔍</Text>
          <Text style={styles.errorTitle}>Task Not Found</Text>
          <Text style={styles.errorText}>The event you are looking for does not exist or has been removed.</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => refetch()}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <Text style={styles.backButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen 
        options={{ 
          title: eventData.name,
          headerStyle: { backgroundColor: Colors.light.primary },
          headerTintColor: Colors.light.background,
          headerTitleStyle: { fontWeight: 'bold' as const },
          headerRight: () => canManageTeam ? (
            <TouchableOpacity onPress={openEditModal} style={styles.headerButton}>
              <Edit3 size={20} color={Colors.light.background} />
            </TouchableOpacity>
          ) : null,
        }} 
      />
      <ScrollView 
        style={styles.container}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <Text style={styles.eventName}>{eventData.name}</Text>
            <TouchableOpacity 
              style={[styles.statusBadge, { backgroundColor: statusBg }]}
              onPress={() => canManageTeam && availableTransitions.length > 0 && setShowStatusModal(true)}
            >
              <Text style={[styles.statusText, { color: statusColor }]}>
                {getStatusLabel()}
              </Text>
              {canManageTeam && availableTransitions.length > 0 && <ChevronRight size={14} color={statusColor} />}
            </TouchableOpacity>
          </View>
          
          <View style={styles.eventInfo}>
            <View style={styles.infoRow}>
              <MapPin size={16} color={Colors.light.textSecondary} />
              <Text style={styles.infoText}>{eventData.location}</Text>
            </View>
            <View style={styles.infoRow}>
              <Calendar size={16} color={Colors.light.textSecondary} />
              <Text style={styles.infoText}>
                {new Date(eventData.startDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} - {new Date(eventData.endDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
              </Text>
            </View>
            <View style={styles.categoryBadge}>
              <Text style={styles.categoryText}>{eventData.category}</Text>
            </View>
          </View>
        </View>

        {isDraftEvent && canManageTeam && (
          <View style={styles.draftSetupPanel}>
            <View style={styles.draftPanelHeader}>
              <View style={styles.draftPanelIcon}>
                <Settings size={24} color="#78909C" />
              </View>
              <View style={styles.draftPanelTitleContainer}>
                <Text style={styles.draftPanelTitle}>Complete Event Setup</Text>
                <Text style={styles.draftPanelSubtitle}>
                  {completedChecks}/{draftChecklist.length} steps completed
                </Text>
              </View>
            </View>
            
            <View style={styles.draftChecklist}>
              {draftChecklist.map((item, index) => (
                <View key={index} style={styles.checklistItem}>
                  <View style={[styles.checklistIcon, item.done && styles.checklistIconDone]}>
                    {item.done ? (
                      <CheckCircle size={16} color="#2E7D32" />
                    ) : (
                      <View style={styles.checklistCircle} />
                    )}
                  </View>
                  <Text style={[styles.checklistLabel, item.done && styles.checklistLabelDone]}>
                    {item.label}
                  </Text>
                </View>
              ))}
            </View>

            <View style={styles.draftActions}>
              <TouchableOpacity style={styles.draftEditButton} onPress={openEditModal}>
                <Edit3 size={18} color={Colors.light.primary} />
                <Text style={styles.draftEditButtonText}>Edit Details</Text>
              </TouchableOpacity>
              
              <TouchableOpacity 
                style={[styles.draftActivateButton, !isReadyToActivate && styles.draftActivateButtonDisabled]}
                onPress={() => isReadyToActivate && handleUpdateStatus('active')}
              >
                <Zap size={18} color="#fff" />
                <Text style={styles.draftActivateButtonText}>
                  {isReadyToActivate ? 'Activate Task' : 'Complete Setup First'}
                </Text>
              </TouchableOpacity>
            </View>

            {!isReadyToActivate && (
              <View style={styles.draftWarning}>
                <AlertCircle size={14} color="#EF6C00" />
                <Text style={styles.draftWarningText}>
                  Complete at least 4 checklist items before activating
                </Text>
              </View>
            )}
          </View>
        )}

        {canManageTeam && availableTransitions.length > 0 && !isDraftEvent && (
          <View style={styles.statusSection}>
            <View style={styles.currentStatusRow}>
              <Text style={styles.statusLabel}>Current Status:</Text>
              <View style={[styles.currentStatusBadge, { backgroundColor: EVENT_STATUS_CONFIG[dbStatus]?.bg }]}>
                <Text style={[styles.currentStatusText, { color: EVENT_STATUS_CONFIG[dbStatus]?.color }]}>
                  {EVENT_STATUS_CONFIG[dbStatus]?.label}
                </Text>
              </View>
            </View>
            <Text style={styles.statusDescription}>{EVENT_STATUS_CONFIG[dbStatus]?.description}</Text>
            <View style={styles.actionButtonsRow}>
              {availableTransitions.includes('active') && (
                <TouchableOpacity style={[styles.actionBtn, styles.startBtn]} onPress={() => handleUpdateStatus('active')}>
                  <Play size={16} color="#fff" />
                  <Text style={styles.actionBtnText}>{dbStatus === 'paused' ? 'Resume' : 'Activate'}</Text>
                </TouchableOpacity>
              )}
              {availableTransitions.includes('paused') && (
                <TouchableOpacity style={[styles.actionBtn, styles.pauseBtn]} onPress={() => handleUpdateStatus('paused')}>
                  <Pause size={16} color="#fff" />
                  <Text style={styles.actionBtnText}>Pause</Text>
                </TouchableOpacity>
              )}
              {availableTransitions.includes('completed') && (
                <TouchableOpacity style={[styles.actionBtn, styles.completeBtn]} onPress={() => handleUpdateStatus('completed')}>
                  <CheckCircle size={16} color="#fff" />
                  <Text style={styles.actionBtnText}>Complete</Text>
                </TouchableOpacity>
              )}
              {availableTransitions.includes('cancelled') && (
                <TouchableOpacity style={[styles.actionBtn, styles.cancelBtn]} onPress={() => handleUpdateStatus('cancelled')}>
                  <XCircle size={16} color="#fff" />
                  <Text style={styles.actionBtnText}>Cancel</Text>
                </TouchableOpacity>
              )}
              {availableTransitions.includes('draft') && (
                <TouchableOpacity style={[styles.actionBtn, styles.draftBtn]} onPress={() => handleUpdateStatus('draft')}>
                  <Edit3 size={16} color="#fff" />
                  <Text style={styles.actionBtnText}>To Draft</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}

        {/* ===== CATEGORY-BASED TASK CARDS ===== */}
        <View style={styles.categoryCardsSection}>
          <Text style={styles.sectionTitle}>Task Categories & Assignments</Text>
          
          {/* SIM Sales Category Card */}
          {eventData.category?.includes('SIM') && (
            <View style={[styles.categoryCard, { borderLeftColor: CATEGORY_CONFIG.SIM.color }]}>
              <View style={styles.categoryCardHeader}>
                <View style={styles.categoryTitleRow}>
                  <View style={[styles.categoryIconCircle, { backgroundColor: CATEGORY_CONFIG.SIM.bg }]}>
                    <Text style={[styles.categoryIconText, { color: CATEGORY_CONFIG.SIM.color }]}>S</Text>
                  </View>
                  <View style={styles.categoryTitleInfo}>
                    <Text style={styles.categoryCardTitle}>{CATEGORY_CONFIG.SIM.label}</Text>
                    <Text style={styles.categoryDueDate}>Due: {new Date(eventData.endDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</Text>
                  </View>
                </View>
                <View style={styles.categoryTargetBadge}>
                  <Text style={styles.categoryTargetText}>{eventData.summary?.totalSimsSold || 0} / {eventData.targetSim}</Text>
                </View>
              </View>
              
              <View style={styles.categoryProgressBar}>
                <View style={[styles.categoryProgressFill, { width: `${Math.min(((eventData.summary?.totalSimsSold || 0) / Math.max(eventData.targetSim, 1)) * 100, 100)}%`, backgroundColor: CATEGORY_CONFIG.SIM.color }]} />
              </View>
              
              <View style={styles.categoryAssignees}>
                <Text style={styles.assigneesLabel}>Assigned Team:</Text>
                {eventData.teamWithAllocations?.filter((m: any) => m.simTarget > 0 && m.employeeId !== eventData.assignedTo).length > 0 ? (
                  eventData.teamWithAllocations?.filter((m: any) => m.simTarget > 0 && m.employeeId !== eventData.assignedTo).map((member: any) => (
                    <View key={member.id} style={styles.assigneeRow}>
                      <View style={styles.assigneeInfo}>
                        <View style={[styles.assigneeAvatar, { backgroundColor: CATEGORY_CONFIG.SIM.bg }]}>
                          <Text style={[styles.assigneeAvatarText, { color: CATEGORY_CONFIG.SIM.color }]}>
                            {(member.employee?.name || 'U').charAt(0)}
                          </Text>
                        </View>
                        <View style={styles.assigneeDetails}>
                          <Text style={styles.assigneeName}>{member.employee?.name || 'Unknown'}</Text>
                          <Text style={styles.assigneeRole}>{member.employee?.designation} | {member.employee?.persNo}</Text>
                        </View>
                      </View>
                      <View style={styles.assigneeProgress}>
                        <Text style={styles.assigneeProgressText}>{member.actualSimSold || 0} / {member.simTarget}</Text>
                        <View style={styles.assigneeMiniBar}>
                          <View style={[styles.assigneeMiniBarFill, { width: `${member.simTarget > 0 ? Math.min((member.actualSimSold / member.simTarget) * 100, 100) : 0}%`, backgroundColor: CATEGORY_CONFIG.SIM.color }]} />
                        </View>
                      </View>
                    </View>
                  ))
                ) : (
                  <Text style={styles.noAssigneesText}>No team members assigned to SIM sales</Text>
                )}
              </View>
            </View>
          )}
          
          {/* FTTH Sales Category Card */}
          {eventData.category?.includes('FTTH') && !eventData.category?.includes('FTTH_DOWN') && (
            <View style={[styles.categoryCard, { borderLeftColor: CATEGORY_CONFIG.FTTH.color }]}>
              <View style={styles.categoryCardHeader}>
                <View style={styles.categoryTitleRow}>
                  <View style={[styles.categoryIconCircle, { backgroundColor: CATEGORY_CONFIG.FTTH.bg }]}>
                    <Text style={[styles.categoryIconText, { color: CATEGORY_CONFIG.FTTH.color }]}>F</Text>
                  </View>
                  <View style={styles.categoryTitleInfo}>
                    <Text style={styles.categoryCardTitle}>{CATEGORY_CONFIG.FTTH.label}</Text>
                    <Text style={styles.categoryDueDate}>Due: {new Date(eventData.endDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</Text>
                  </View>
                </View>
                <View style={styles.categoryTargetBadge}>
                  <Text style={styles.categoryTargetText}>{eventData.summary?.totalFtthSold || 0} / {eventData.targetFtth}</Text>
                </View>
              </View>
              
              <View style={styles.categoryProgressBar}>
                <View style={[styles.categoryProgressFill, { width: `${Math.min(((eventData.summary?.totalFtthSold || 0) / Math.max(eventData.targetFtth, 1)) * 100, 100)}%`, backgroundColor: CATEGORY_CONFIG.FTTH.color }]} />
              </View>
              
              <View style={styles.categoryAssignees}>
                <Text style={styles.assigneesLabel}>Assigned Team:</Text>
                {eventData.teamWithAllocations?.filter((m: any) => m.ftthTarget > 0 && m.employeeId !== eventData.assignedTo).length > 0 ? (
                  eventData.teamWithAllocations?.filter((m: any) => m.ftthTarget > 0 && m.employeeId !== eventData.assignedTo).map((member: any) => (
                    <View key={member.id} style={styles.assigneeRow}>
                      <View style={styles.assigneeInfo}>
                        <View style={[styles.assigneeAvatar, { backgroundColor: CATEGORY_CONFIG.FTTH.bg }]}>
                          <Text style={[styles.assigneeAvatarText, { color: CATEGORY_CONFIG.FTTH.color }]}>
                            {(member.employee?.name || 'U').charAt(0)}
                          </Text>
                        </View>
                        <View style={styles.assigneeDetails}>
                          <Text style={styles.assigneeName}>{member.employee?.name || 'Unknown'}</Text>
                          <Text style={styles.assigneeRole}>{member.employee?.designation} | {member.employee?.persNo}</Text>
                        </View>
                      </View>
                      <View style={styles.assigneeProgress}>
                        <Text style={styles.assigneeProgressText}>{member.actualFtthSold || 0} / {member.ftthTarget}</Text>
                        <View style={styles.assigneeMiniBar}>
                          <View style={[styles.assigneeMiniBarFill, { width: `${member.ftthTarget > 0 ? Math.min((member.actualFtthSold / member.ftthTarget) * 100, 100) : 0}%`, backgroundColor: CATEGORY_CONFIG.FTTH.color }]} />
                        </View>
                      </View>
                    </View>
                  ))
                ) : (
                  <Text style={styles.noAssigneesText}>No team members assigned to FTTH sales</Text>
                )}
              </View>
            </View>
          )}
          
          {/* Lease Circuit Maintenance Card */}
          {eventData.category?.includes('LEASE_CIRCUIT') && eventData.targetLease > 0 && (() => {
            const slaDisplay = getSlaTimeDisplay(eventData.slaStatus?.lease);
            const completionPct = Math.round(((eventData.leaseCompleted || 0) / eventData.targetLease) * 100);
            return (
              <View style={[styles.categoryCard, { borderLeftColor: CATEGORY_CONFIG.LEASE_CIRCUIT.color }]}>
                <View style={styles.categoryCardHeader}>
                  <View style={styles.categoryTitleRow}>
                    <View style={[styles.categoryIconCircle, { backgroundColor: CATEGORY_CONFIG.LEASE_CIRCUIT.bg }]}>
                      <Text style={[styles.categoryIconText, { color: CATEGORY_CONFIG.LEASE_CIRCUIT.color }]}>LC</Text>
                    </View>
                    <View style={styles.categoryTitleInfo}>
                      <Text style={styles.categoryCardTitle}>{CATEGORY_CONFIG.LEASE_CIRCUIT.label}</Text>
                      <Text style={styles.categoryDueDate}>Due: {new Date(eventData.endDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</Text>
                    </View>
                  </View>
                  <View style={[styles.statusBadgeMini, { backgroundColor: slaDisplay.urgencyBg }]}>
                    <Text style={[styles.statusBadgeMiniText, { color: slaDisplay.urgencyColor }]}>{slaDisplay.urgencyLabel}</Text>
                  </View>
                </View>
                
                <View style={styles.maintenanceStats}>
                  <View style={styles.maintenanceStatItem}>
                    <Text style={styles.maintenanceStatLabel}>Target</Text>
                    <Text style={styles.maintenanceStatValue}>{eventData.targetLease}</Text>
                  </View>
                  <View style={styles.maintenanceStatItem}>
                    <Text style={styles.maintenanceStatLabel}>Completed</Text>
                    <Text style={[styles.maintenanceStatValue, { color: CATEGORY_CONFIG.LEASE_CIRCUIT.color }]}>{eventData.leaseCompleted || 0}</Text>
                  </View>
                  <View style={styles.maintenanceStatItem}>
                    <Text style={styles.maintenanceStatLabel}>Remaining</Text>
                    <Text style={styles.maintenanceStatValue}>{eventData.targetLease - (eventData.leaseCompleted || 0)}</Text>
                  </View>
                  <View style={styles.maintenanceStatItem}>
                    <Text style={styles.maintenanceStatLabel}>Time Left</Text>
                    <Text style={styles.maintenanceStatValue}>{slaDisplay.timeLeft}</Text>
                  </View>
                </View>
                
                {renderSlaBadge(eventData.slaStatus?.lease, styles)}
                
                <View style={styles.categoryProgressBar}>
                  <View style={[styles.categoryProgressFill, { width: `${completionPct}%`, backgroundColor: CATEGORY_CONFIG.LEASE_CIRCUIT.color }]} />
                </View>
                
                {/* Team Members for Lease Circuit with per-member progress */}
                {eventData.teamWithAllocations && eventData.teamWithAllocations.length > 0 && (
                  <View style={styles.categoryAssignees}>
                    <Text style={styles.assigneesLabel}>Assigned Team ({eventData.teamWithAllocations.length})</Text>
                    {eventData.teamWithAllocations.map((member: any, idx: number) => {
                      const memberTarget = member.leaseTarget || getDistributedTarget(eventData.targetLease, eventData.teamWithAllocations.length, idx);
                      const memberCompleted = member.leaseCompleted || 0;
                      const isSelf = member.employeeId === employee?.id;
                      const canUpdateMember = canManageTeam || isSelf;
                      return (
                        <View key={member.id} style={styles.assigneeRow}>
                          <View style={styles.assigneeInfo}>
                            <View style={[styles.assigneeAvatar, { backgroundColor: getAvatarColor(member.employee?.name || 'U') }]}>
                              <Text style={[styles.assigneeAvatarText, { color: '#fff' }]}>
                                {(member.employee?.name || 'U').split(' ').map((n: string) => n[0]).join('').slice(0,2).toUpperCase()}
                              </Text>
                            </View>
                            <View style={styles.assigneeDetails}>
                              <Text style={styles.assigneeName}>{member.employee?.name || 'Unknown'}{isSelf ? ' (You)' : ''}</Text>
                              <Text style={styles.assigneeRole}>{member.employee?.designation || member.employee?.role}{member.employee?.persNo ? ` | ${member.employee.persNo}` : ''}</Text>
                            </View>
                          </View>
                          <View style={styles.memberProgressContainer}>
                            <Text style={[styles.memberProgressText, { color: CATEGORY_CONFIG.LEASE_CIRCUIT.color }]}>{memberCompleted}/{memberTarget}</Text>
                            {canUpdateMember && dbStatus === 'active' && (
                              <View style={styles.memberActionButtons}>
                                {memberCompleted > 0 && (
                                  <TouchableOpacity 
                                    style={[styles.memberActionBtn, { borderColor: CATEGORY_CONFIG.LEASE_CIRCUIT.color }]} 
                                    onPress={() => handleMemberTaskComplete(member.employeeId, 'LEASE', -1)}
                                  >
                                    <Text style={[styles.memberActionBtnText, { color: CATEGORY_CONFIG.LEASE_CIRCUIT.color }]}>-1</Text>
                                  </TouchableOpacity>
                                )}
                                {memberCompleted < memberTarget && (
                                  <TouchableOpacity 
                                    style={[styles.memberActionBtnPrimary, { backgroundColor: CATEGORY_CONFIG.LEASE_CIRCUIT.color, opacity: pendingMemberTask === `${member.employeeId}-LEASE` ? 0.6 : 1 }]} 
                                    onPress={() => handleMemberTaskComplete(member.employeeId, 'LEASE', 1)}
                                    disabled={pendingMemberTask === `${member.employeeId}-LEASE`}
                                  >
                                    <Text style={styles.memberActionBtnPrimaryText}>{pendingMemberTask === `${member.employeeId}-LEASE` ? 'Updating...' : 'Mark +1'}</Text>
                                  </TouchableOpacity>
                                )}
                              </View>
                            )}
                          </View>
                        </View>
                      );
                    })}
                  </View>
                )}
              </View>
            );
          })()}
          
          {/* BTS Down Maintenance Card */}
          {eventData.category?.includes('BTS_DOWN') && eventData.targetBtsDown > 0 && (() => {
            const slaDisplay = getSlaTimeDisplay(eventData.slaStatus?.btsDown);
            const completionPct = Math.round(((eventData.btsDownCompleted || 0) / eventData.targetBtsDown) * 100);
            return (
              <View style={[styles.categoryCard, { borderLeftColor: CATEGORY_CONFIG.BTS_DOWN.color }]}>
                <View style={styles.categoryCardHeader}>
                  <View style={styles.categoryTitleRow}>
                    <View style={[styles.categoryIconCircle, { backgroundColor: CATEGORY_CONFIG.BTS_DOWN.bg }]}>
                      <Text style={[styles.categoryIconText, { color: CATEGORY_CONFIG.BTS_DOWN.color }]}>BTS</Text>
                    </View>
                    <View style={styles.categoryTitleInfo}>
                      <Text style={styles.categoryCardTitle}>{CATEGORY_CONFIG.BTS_DOWN.label}</Text>
                      <Text style={styles.categoryDueDate}>Due: {new Date(eventData.endDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</Text>
                    </View>
                  </View>
                  <View style={[styles.statusBadgeMini, { backgroundColor: slaDisplay.urgencyBg }]}>
                    <Text style={[styles.statusBadgeMiniText, { color: slaDisplay.urgencyColor }]}>{slaDisplay.urgencyLabel}</Text>
                  </View>
                </View>
                
                <View style={styles.maintenanceStats}>
                  <View style={styles.maintenanceStatItem}>
                    <Text style={styles.maintenanceStatLabel}>Target</Text>
                    <Text style={styles.maintenanceStatValue}>{eventData.targetBtsDown}</Text>
                  </View>
                  <View style={styles.maintenanceStatItem}>
                    <Text style={styles.maintenanceStatLabel}>Completed</Text>
                    <Text style={[styles.maintenanceStatValue, { color: CATEGORY_CONFIG.BTS_DOWN.color }]}>{eventData.btsDownCompleted || 0}</Text>
                  </View>
                  <View style={styles.maintenanceStatItem}>
                    <Text style={styles.maintenanceStatLabel}>Remaining</Text>
                    <Text style={styles.maintenanceStatValue}>{eventData.targetBtsDown - (eventData.btsDownCompleted || 0)}</Text>
                  </View>
                  <View style={styles.maintenanceStatItem}>
                    <Text style={styles.maintenanceStatLabel}>Time Left</Text>
                    <Text style={styles.maintenanceStatValue}>{slaDisplay.timeLeft}</Text>
                  </View>
                </View>
                
                {renderSlaBadge(eventData.slaStatus?.btsDown, styles)}
                
                <View style={styles.categoryProgressBar}>
                  <View style={[styles.categoryProgressFill, { width: `${completionPct}%`, backgroundColor: CATEGORY_CONFIG.BTS_DOWN.color }]} />
                </View>
                
                {/* Team Members for BTS Down with per-member progress */}
                {eventData.teamWithAllocations && eventData.teamWithAllocations.length > 0 && (
                  <View style={styles.categoryAssignees}>
                    <Text style={styles.assigneesLabel}>Assigned Team ({eventData.teamWithAllocations.length})</Text>
                    {eventData.teamWithAllocations.map((member: any, idx: number) => {
                      const memberTarget = member.btsDownTarget || getDistributedTarget(eventData.targetBtsDown, eventData.teamWithAllocations.length, idx);
                      const memberCompleted = member.btsDownCompleted || 0;
                      const isSelf = member.employeeId === employee?.id;
                      const canUpdateMember = canManageTeam || isSelf;
                      return (
                        <View key={member.id} style={styles.assigneeRow}>
                          <View style={styles.assigneeInfo}>
                            <View style={[styles.assigneeAvatar, { backgroundColor: getAvatarColor(member.employee?.name || 'U') }]}>
                              <Text style={[styles.assigneeAvatarText, { color: '#fff' }]}>
                                {(member.employee?.name || 'U').split(' ').map((n: string) => n[0]).join('').slice(0,2).toUpperCase()}
                              </Text>
                            </View>
                            <View style={styles.assigneeDetails}>
                              <Text style={styles.assigneeName}>{member.employee?.name || 'Unknown'}{isSelf ? ' (You)' : ''}</Text>
                              <Text style={styles.assigneeRole}>{member.employee?.designation || member.employee?.role}{member.employee?.persNo ? ` | ${member.employee.persNo}` : ''}</Text>
                            </View>
                          </View>
                          <View style={styles.memberProgressContainer}>
                            <Text style={[styles.memberProgressText, { color: CATEGORY_CONFIG.BTS_DOWN.color }]}>{memberCompleted}/{memberTarget}</Text>
                            {canUpdateMember && dbStatus === 'active' && (
                              <View style={styles.memberActionButtons}>
                                {memberCompleted > 0 && (
                                  <TouchableOpacity 
                                    style={[styles.memberActionBtn, { borderColor: CATEGORY_CONFIG.BTS_DOWN.color }]} 
                                    onPress={() => handleMemberTaskComplete(member.employeeId, 'BTS_DOWN', -1)}
                                  >
                                    <Text style={[styles.memberActionBtnText, { color: CATEGORY_CONFIG.BTS_DOWN.color }]}>-1</Text>
                                  </TouchableOpacity>
                                )}
                                {memberCompleted < memberTarget && (
                                  <TouchableOpacity 
                                    style={[styles.memberActionBtnPrimary, { backgroundColor: CATEGORY_CONFIG.BTS_DOWN.color, opacity: pendingMemberTask === `${member.employeeId}-BTS_DOWN` ? 0.6 : 1 }]} 
                                    onPress={() => handleMemberTaskComplete(member.employeeId, 'BTS_DOWN', 1)}
                                    disabled={pendingMemberTask === `${member.employeeId}-BTS_DOWN`}
                                  >
                                    <Text style={styles.memberActionBtnPrimaryText}>{pendingMemberTask === `${member.employeeId}-BTS_DOWN` ? 'Updating...' : 'Mark +1'}</Text>
                                  </TouchableOpacity>
                                )}
                              </View>
                            )}
                          </View>
                        </View>
                      );
                    })}
                  </View>
                )}
              </View>
            );
          })()}
          
          {/* Route Fail Maintenance Card */}
          {eventData.category?.includes('ROUTE_FAIL') && eventData.targetRouteFail > 0 && (() => {
            const slaDisplay = getSlaTimeDisplay(eventData.slaStatus?.routeFail);
            const completionPct = Math.round(((eventData.routeFailCompleted || 0) / eventData.targetRouteFail) * 100);
            return (
              <View style={[styles.categoryCard, { borderLeftColor: CATEGORY_CONFIG.ROUTE_FAIL.color }]}>
                <View style={styles.categoryCardHeader}>
                  <View style={styles.categoryTitleRow}>
                    <View style={[styles.categoryIconCircle, { backgroundColor: CATEGORY_CONFIG.ROUTE_FAIL.bg }]}>
                      <Text style={[styles.categoryIconText, { color: CATEGORY_CONFIG.ROUTE_FAIL.color }]}>RF</Text>
                    </View>
                    <View style={styles.categoryTitleInfo}>
                      <Text style={styles.categoryCardTitle}>{CATEGORY_CONFIG.ROUTE_FAIL.label}</Text>
                      <Text style={styles.categoryDueDate}>Due: {new Date(eventData.endDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</Text>
                    </View>
                  </View>
                  <View style={[styles.statusBadgeMini, { backgroundColor: slaDisplay.urgencyBg }]}>
                    <Text style={[styles.statusBadgeMiniText, { color: slaDisplay.urgencyColor }]}>{slaDisplay.urgencyLabel}</Text>
                  </View>
                </View>
                
                <View style={styles.maintenanceStats}>
                  <View style={styles.maintenanceStatItem}>
                    <Text style={styles.maintenanceStatLabel}>Target</Text>
                    <Text style={styles.maintenanceStatValue}>{eventData.targetRouteFail}</Text>
                  </View>
                  <View style={styles.maintenanceStatItem}>
                    <Text style={styles.maintenanceStatLabel}>Completed</Text>
                    <Text style={[styles.maintenanceStatValue, { color: CATEGORY_CONFIG.ROUTE_FAIL.color }]}>{eventData.routeFailCompleted || 0}</Text>
                  </View>
                  <View style={styles.maintenanceStatItem}>
                    <Text style={styles.maintenanceStatLabel}>Remaining</Text>
                    <Text style={styles.maintenanceStatValue}>{eventData.targetRouteFail - (eventData.routeFailCompleted || 0)}</Text>
                  </View>
                  <View style={styles.maintenanceStatItem}>
                    <Text style={styles.maintenanceStatLabel}>Time Left</Text>
                    <Text style={styles.maintenanceStatValue}>{slaDisplay.timeLeft}</Text>
                  </View>
                </View>
                
                {renderSlaBadge(eventData.slaStatus?.routeFail, styles)}
                
                <View style={styles.categoryProgressBar}>
                  <View style={[styles.categoryProgressFill, { width: `${completionPct}%`, backgroundColor: CATEGORY_CONFIG.ROUTE_FAIL.color }]} />
                </View>
                
                {/* Team Members for Route Fail with per-member progress */}
                {eventData.teamWithAllocations && eventData.teamWithAllocations.length > 0 && (
                  <View style={styles.categoryAssignees}>
                    <Text style={styles.assigneesLabel}>Assigned Team ({eventData.teamWithAllocations.length})</Text>
                    {eventData.teamWithAllocations.map((member: any, idx: number) => {
                      const memberTarget = member.routeFailTarget || getDistributedTarget(eventData.targetRouteFail, eventData.teamWithAllocations.length, idx);
                      const memberCompleted = member.routeFailCompleted || 0;
                      const isSelf = member.employeeId === employee?.id;
                      const canUpdateMember = canManageTeam || isSelf;
                      return (
                        <View key={member.id} style={styles.assigneeRow}>
                          <View style={styles.assigneeInfo}>
                            <View style={[styles.assigneeAvatar, { backgroundColor: getAvatarColor(member.employee?.name || 'U') }]}>
                              <Text style={[styles.assigneeAvatarText, { color: '#fff' }]}>
                                {(member.employee?.name || 'U').split(' ').map((n: string) => n[0]).join('').slice(0,2).toUpperCase()}
                              </Text>
                            </View>
                            <View style={styles.assigneeDetails}>
                              <Text style={styles.assigneeName}>{member.employee?.name || 'Unknown'}{isSelf ? ' (You)' : ''}</Text>
                              <Text style={styles.assigneeRole}>{member.employee?.designation || member.employee?.role}{member.employee?.persNo ? ` | ${member.employee.persNo}` : ''}</Text>
                            </View>
                          </View>
                          <View style={styles.memberProgressContainer}>
                            <Text style={[styles.memberProgressText, { color: CATEGORY_CONFIG.ROUTE_FAIL.color }]}>{memberCompleted}/{memberTarget}</Text>
                            {canUpdateMember && dbStatus === 'active' && (
                              <View style={styles.memberActionButtons}>
                                {memberCompleted > 0 && (
                                  <TouchableOpacity 
                                    style={[styles.memberActionBtn, { borderColor: CATEGORY_CONFIG.ROUTE_FAIL.color }]} 
                                    onPress={() => handleMemberTaskComplete(member.employeeId, 'ROUTE_FAIL', -1)}
                                  >
                                    <Text style={[styles.memberActionBtnText, { color: CATEGORY_CONFIG.ROUTE_FAIL.color }]}>-1</Text>
                                  </TouchableOpacity>
                                )}
                                {memberCompleted < memberTarget && (
                                  <TouchableOpacity 
                                    style={[styles.memberActionBtnPrimary, { backgroundColor: CATEGORY_CONFIG.ROUTE_FAIL.color, opacity: pendingMemberTask === `${member.employeeId}-ROUTE_FAIL` ? 0.6 : 1 }]} 
                                    onPress={() => handleMemberTaskComplete(member.employeeId, 'ROUTE_FAIL', 1)}
                                    disabled={pendingMemberTask === `${member.employeeId}-ROUTE_FAIL`}
                                  >
                                    <Text style={styles.memberActionBtnPrimaryText}>{pendingMemberTask === `${member.employeeId}-ROUTE_FAIL` ? 'Updating...' : 'Mark +1'}</Text>
                                  </TouchableOpacity>
                                )}
                              </View>
                            )}
                          </View>
                        </View>
                      );
                    })}
                  </View>
                )}
              </View>
            );
          })()}
          
          {/* FTTH Down Maintenance Card */}
          {eventData.category?.includes('FTTH_DOWN') && eventData.targetFtthDown > 0 && (() => {
            const slaDisplay = getSlaTimeDisplay(eventData.slaStatus?.ftthDown);
            const completionPct = Math.round(((eventData.ftthDownCompleted || 0) / eventData.targetFtthDown) * 100);
            return (
              <View style={[styles.categoryCard, { borderLeftColor: CATEGORY_CONFIG.FTTH_DOWN.color }]}>
                <View style={styles.categoryCardHeader}>
                  <View style={styles.categoryTitleRow}>
                    <View style={[styles.categoryIconCircle, { backgroundColor: CATEGORY_CONFIG.FTTH_DOWN.bg }]}>
                      <Text style={[styles.categoryIconText, { color: CATEGORY_CONFIG.FTTH_DOWN.color }]}>FD</Text>
                    </View>
                    <View style={styles.categoryTitleInfo}>
                      <Text style={styles.categoryCardTitle}>{CATEGORY_CONFIG.FTTH_DOWN.label}</Text>
                      <Text style={styles.categoryDueDate}>Due: {new Date(eventData.endDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</Text>
                    </View>
                  </View>
                  <View style={[styles.statusBadgeMini, { backgroundColor: slaDisplay.urgencyBg }]}>
                    <Text style={[styles.statusBadgeMiniText, { color: slaDisplay.urgencyColor }]}>{slaDisplay.urgencyLabel}</Text>
                  </View>
                </View>
                
                <View style={styles.maintenanceStats}>
                  <View style={styles.maintenanceStatItem}>
                    <Text style={styles.maintenanceStatLabel}>Target</Text>
                    <Text style={styles.maintenanceStatValue}>{eventData.targetFtthDown}</Text>
                  </View>
                  <View style={styles.maintenanceStatItem}>
                    <Text style={styles.maintenanceStatLabel}>Completed</Text>
                    <Text style={[styles.maintenanceStatValue, { color: CATEGORY_CONFIG.FTTH_DOWN.color }]}>{eventData.ftthDownCompleted || 0}</Text>
                  </View>
                  <View style={styles.maintenanceStatItem}>
                    <Text style={styles.maintenanceStatLabel}>Remaining</Text>
                    <Text style={styles.maintenanceStatValue}>{eventData.targetFtthDown - (eventData.ftthDownCompleted || 0)}</Text>
                  </View>
                  <View style={styles.maintenanceStatItem}>
                    <Text style={styles.maintenanceStatLabel}>Time Left</Text>
                    <Text style={styles.maintenanceStatValue}>{slaDisplay.timeLeft}</Text>
                  </View>
                </View>
                
                {renderSlaBadge(eventData.slaStatus?.ftthDown, styles)}
                
                <View style={styles.categoryProgressBar}>
                  <View style={[styles.categoryProgressFill, { width: `${completionPct}%`, backgroundColor: CATEGORY_CONFIG.FTTH_DOWN.color }]} />
                </View>
                
                {/* Team Members for FTTH Down with per-member progress */}
                {eventData.teamWithAllocations && eventData.teamWithAllocations.length > 0 && (
                  <View style={styles.categoryAssignees}>
                    <Text style={styles.assigneesLabel}>Assigned Team ({eventData.teamWithAllocations.length})</Text>
                    {eventData.teamWithAllocations.map((member: any, idx: number) => {
                      const memberTarget = member.ftthDownTarget || getDistributedTarget(eventData.targetFtthDown, eventData.teamWithAllocations.length, idx);
                      const memberCompleted = member.ftthDownCompleted || 0;
                      const isSelf = member.employeeId === employee?.id;
                      const canUpdateMember = canManageTeam || isSelf;
                      return (
                        <View key={member.id} style={styles.assigneeRow}>
                          <View style={styles.assigneeInfo}>
                            <View style={[styles.assigneeAvatar, { backgroundColor: getAvatarColor(member.employee?.name || 'U') }]}>
                              <Text style={[styles.assigneeAvatarText, { color: '#fff' }]}>
                                {(member.employee?.name || 'U').split(' ').map((n: string) => n[0]).join('').slice(0,2).toUpperCase()}
                              </Text>
                            </View>
                            <View style={styles.assigneeDetails}>
                              <Text style={styles.assigneeName}>{member.employee?.name || 'Unknown'}{isSelf ? ' (You)' : ''}</Text>
                              <Text style={styles.assigneeRole}>{member.employee?.designation || member.employee?.role}{member.employee?.persNo ? ` | ${member.employee.persNo}` : ''}</Text>
                            </View>
                          </View>
                          <View style={styles.memberProgressContainer}>
                            <Text style={[styles.memberProgressText, { color: CATEGORY_CONFIG.FTTH_DOWN.color }]}>{memberCompleted}/{memberTarget}</Text>
                            {canUpdateMember && dbStatus === 'active' && (
                              <View style={styles.memberActionButtons}>
                                {memberCompleted > 0 && (
                                  <TouchableOpacity 
                                    style={[styles.memberActionBtn, { borderColor: CATEGORY_CONFIG.FTTH_DOWN.color }]} 
                                    onPress={() => handleMemberTaskComplete(member.employeeId, 'FTTH_DOWN', -1)}
                                  >
                                    <Text style={[styles.memberActionBtnText, { color: CATEGORY_CONFIG.FTTH_DOWN.color }]}>-1</Text>
                                  </TouchableOpacity>
                                )}
                                {memberCompleted < memberTarget && (
                                  <TouchableOpacity 
                                    style={[styles.memberActionBtnPrimary, { backgroundColor: CATEGORY_CONFIG.FTTH_DOWN.color, opacity: pendingMemberTask === `${member.employeeId}-FTTH_DOWN` ? 0.6 : 1 }]} 
                                    onPress={() => handleMemberTaskComplete(member.employeeId, 'FTTH_DOWN', 1)}
                                    disabled={pendingMemberTask === `${member.employeeId}-FTTH_DOWN`}
                                  >
                                    <Text style={styles.memberActionBtnPrimaryText}>{pendingMemberTask === `${member.employeeId}-FTTH_DOWN` ? 'Updating...' : 'Mark +1'}</Text>
                                  </TouchableOpacity>
                                )}
                              </View>
                            )}
                          </View>
                        </View>
                      );
                    })}
                  </View>
                )}
              </View>
            );
          })()}
          
          {/* OFC Fail Maintenance Card */}
          {eventData.category?.includes('OFC_FAIL') && eventData.targetOfcFail > 0 && (() => {
            const slaDisplay = getSlaTimeDisplay(eventData.slaStatus?.ofcFail);
            const completionPct = Math.round(((eventData.ofcFailCompleted || 0) / eventData.targetOfcFail) * 100);
            return (
              <View style={[styles.categoryCard, { borderLeftColor: CATEGORY_CONFIG.OFC_FAIL.color }]}>
                <View style={styles.categoryCardHeader}>
                  <View style={styles.categoryTitleRow}>
                    <View style={[styles.categoryIconCircle, { backgroundColor: CATEGORY_CONFIG.OFC_FAIL.bg }]}>
                      <Text style={[styles.categoryIconText, { color: CATEGORY_CONFIG.OFC_FAIL.color }]}>OFC</Text>
                    </View>
                    <View style={styles.categoryTitleInfo}>
                      <Text style={styles.categoryCardTitle}>{CATEGORY_CONFIG.OFC_FAIL.label}</Text>
                      <Text style={styles.categoryDueDate}>Due: {new Date(eventData.endDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</Text>
                    </View>
                  </View>
                  <View style={[styles.statusBadgeMini, { backgroundColor: slaDisplay.urgencyBg }]}>
                    <Text style={[styles.statusBadgeMiniText, { color: slaDisplay.urgencyColor }]}>{slaDisplay.urgencyLabel}</Text>
                  </View>
                </View>
                
                <View style={styles.maintenanceStats}>
                  <View style={styles.maintenanceStatItem}>
                    <Text style={styles.maintenanceStatLabel}>Target</Text>
                    <Text style={styles.maintenanceStatValue}>{eventData.targetOfcFail}</Text>
                  </View>
                  <View style={styles.maintenanceStatItem}>
                    <Text style={styles.maintenanceStatLabel}>Completed</Text>
                    <Text style={[styles.maintenanceStatValue, { color: CATEGORY_CONFIG.OFC_FAIL.color }]}>{eventData.ofcFailCompleted || 0}</Text>
                  </View>
                  <View style={styles.maintenanceStatItem}>
                    <Text style={styles.maintenanceStatLabel}>Remaining</Text>
                    <Text style={styles.maintenanceStatValue}>{eventData.targetOfcFail - (eventData.ofcFailCompleted || 0)}</Text>
                  </View>
                  <View style={styles.maintenanceStatItem}>
                    <Text style={styles.maintenanceStatLabel}>Time Left</Text>
                    <Text style={styles.maintenanceStatValue}>{slaDisplay.timeLeft}</Text>
                  </View>
                </View>
                
                {renderSlaBadge(eventData.slaStatus?.ofcFail, styles)}
                
                <View style={styles.categoryProgressBar}>
                  <View style={[styles.categoryProgressFill, { width: `${completionPct}%`, backgroundColor: CATEGORY_CONFIG.OFC_FAIL.color }]} />
                </View>
                
                {/* Team Members for OFC Fail with per-member progress */}
                {eventData.teamWithAllocations && eventData.teamWithAllocations.length > 0 && (
                  <View style={styles.categoryAssignees}>
                    <Text style={styles.assigneesLabel}>Assigned Team ({eventData.teamWithAllocations.length})</Text>
                    {eventData.teamWithAllocations.map((member: any, idx: number) => {
                      const memberTarget = member.ofcFailTarget || getDistributedTarget(eventData.targetOfcFail, eventData.teamWithAllocations.length, idx);
                      const memberCompleted = member.ofcFailCompleted || 0;
                      const isSelf = member.employeeId === employee?.id;
                      const canUpdateMember = canManageTeam || isSelf;
                      return (
                        <View key={member.id} style={styles.assigneeRow}>
                          <View style={styles.assigneeInfo}>
                            <View style={[styles.assigneeAvatar, { backgroundColor: getAvatarColor(member.employee?.name || 'U') }]}>
                              <Text style={[styles.assigneeAvatarText, { color: '#fff' }]}>
                                {(member.employee?.name || 'U').split(' ').map((n: string) => n[0]).join('').slice(0,2).toUpperCase()}
                              </Text>
                            </View>
                            <View style={styles.assigneeDetails}>
                              <Text style={styles.assigneeName}>{member.employee?.name || 'Unknown'}{isSelf ? ' (You)' : ''}</Text>
                              <Text style={styles.assigneeRole}>{member.employee?.designation || member.employee?.role}{member.employee?.persNo ? ` | ${member.employee.persNo}` : ''}</Text>
                            </View>
                          </View>
                          <View style={styles.memberProgressContainer}>
                            <Text style={[styles.memberProgressText, { color: CATEGORY_CONFIG.OFC_FAIL.color }]}>{memberCompleted}/{memberTarget}</Text>
                            {canUpdateMember && dbStatus === 'active' && (
                              <View style={styles.memberActionButtons}>
                                {memberCompleted > 0 && (
                                  <TouchableOpacity 
                                    style={[styles.memberActionBtn, { borderColor: CATEGORY_CONFIG.OFC_FAIL.color }]} 
                                    onPress={() => handleMemberTaskComplete(member.employeeId, 'OFC_FAIL', -1)}
                                  >
                                    <Text style={[styles.memberActionBtnText, { color: CATEGORY_CONFIG.OFC_FAIL.color }]}>-1</Text>
                                  </TouchableOpacity>
                                )}
                                {memberCompleted < memberTarget && (
                                  <TouchableOpacity 
                                    style={[styles.memberActionBtnPrimary, { backgroundColor: CATEGORY_CONFIG.OFC_FAIL.color, opacity: pendingMemberTask === `${member.employeeId}-OFC_FAIL` ? 0.6 : 1 }]} 
                                    onPress={() => handleMemberTaskComplete(member.employeeId, 'OFC_FAIL', 1)}
                                    disabled={pendingMemberTask === `${member.employeeId}-OFC_FAIL`}
                                  >
                                    <Text style={styles.memberActionBtnPrimaryText}>{pendingMemberTask === `${member.employeeId}-OFC_FAIL` ? 'Updating...' : 'Mark +1'}</Text>
                                  </TouchableOpacity>
                                )}
                              </View>
                            )}
                          </View>
                        </View>
                      );
                    })}
                  </View>
                )}
              </View>
            );
          })()}
          
          {/* EB Connections Maintenance Card */}
          {eventData.targetEb > 0 && (() => {
            const slaDisplay = getSlaTimeDisplay(eventData.slaStatus?.eb);
            const completionPct = Math.round(((eventData.ebCompleted || 0) / eventData.targetEb) * 100);
            return (
              <View style={[styles.categoryCard, { borderLeftColor: CATEGORY_CONFIG.EB.color }]}>
                <View style={styles.categoryCardHeader}>
                  <View style={styles.categoryTitleRow}>
                    <View style={[styles.categoryIconCircle, { backgroundColor: CATEGORY_CONFIG.EB.bg }]}>
                      <Zap size={16} color={CATEGORY_CONFIG.EB.color} />
                    </View>
                    <View style={styles.categoryTitleInfo}>
                      <Text style={styles.categoryCardTitle}>{CATEGORY_CONFIG.EB.label}</Text>
                      <Text style={styles.categoryDueDate}>Due: {new Date(eventData.endDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</Text>
                    </View>
                  </View>
                  <View style={[styles.statusBadgeMini, { backgroundColor: slaDisplay.urgencyBg }]}>
                    <Text style={[styles.statusBadgeMiniText, { color: slaDisplay.urgencyColor }]}>{slaDisplay.urgencyLabel}</Text>
                  </View>
                </View>
                
                <View style={styles.maintenanceStats}>
                  <View style={styles.maintenanceStatItem}>
                    <Text style={styles.maintenanceStatLabel}>Target</Text>
                    <Text style={styles.maintenanceStatValue}>{eventData.targetEb}</Text>
                  </View>
                  <View style={styles.maintenanceStatItem}>
                    <Text style={styles.maintenanceStatLabel}>Completed</Text>
                    <Text style={[styles.maintenanceStatValue, { color: CATEGORY_CONFIG.EB.color }]}>{eventData.ebCompleted || 0}</Text>
                  </View>
                  <View style={styles.maintenanceStatItem}>
                    <Text style={styles.maintenanceStatLabel}>Remaining</Text>
                    <Text style={styles.maintenanceStatValue}>{eventData.targetEb - (eventData.ebCompleted || 0)}</Text>
                  </View>
                  <View style={styles.maintenanceStatItem}>
                    <Text style={styles.maintenanceStatLabel}>Time Left</Text>
                    <Text style={styles.maintenanceStatValue}>{slaDisplay.timeLeft}</Text>
                  </View>
                </View>
                
                {renderSlaBadge(eventData.slaStatus?.eb, styles)}
                
                <View style={styles.categoryProgressBar}>
                  <View style={[styles.categoryProgressFill, { width: `${completionPct}%`, backgroundColor: CATEGORY_CONFIG.EB.color }]} />
                </View>
                
                {/* Team Members for EB with per-member progress */}
                {eventData.teamWithAllocations && eventData.teamWithAllocations.length > 0 && (
                  <View style={styles.categoryAssignees}>
                    <Text style={styles.assigneesLabel}>Assigned Team ({eventData.teamWithAllocations.length})</Text>
                    {eventData.teamWithAllocations.map((member: any, idx: number) => {
                      const memberTarget = member.ebTarget || getDistributedTarget(eventData.targetEb, eventData.teamWithAllocations.length, idx);
                      const memberCompleted = member.ebCompleted || 0;
                      const isSelf = member.employeeId === employee?.id;
                      const canUpdateMember = canManageTeam || isSelf;
                      return (
                        <View key={member.id} style={styles.assigneeRow}>
                          <View style={styles.assigneeInfo}>
                            <View style={[styles.assigneeAvatar, { backgroundColor: getAvatarColor(member.employee?.name || 'U') }]}>
                              <Text style={[styles.assigneeAvatarText, { color: '#fff' }]}>
                                {(member.employee?.name || 'U').split(' ').map((n: string) => n[0]).join('').slice(0,2).toUpperCase()}
                              </Text>
                            </View>
                            <View style={styles.assigneeDetails}>
                              <Text style={styles.assigneeName}>{member.employee?.name || 'Unknown'}{isSelf ? ' (You)' : ''}</Text>
                              <Text style={styles.assigneeRole}>{member.employee?.designation || member.employee?.role}{member.employee?.persNo ? ` | ${member.employee.persNo}` : ''}</Text>
                            </View>
                          </View>
                          <View style={styles.memberProgressContainer}>
                            <Text style={[styles.memberProgressText, { color: CATEGORY_CONFIG.EB.color }]}>{memberCompleted}/{memberTarget}</Text>
                            {canUpdateMember && dbStatus === 'active' && (
                              <View style={styles.memberActionButtons}>
                                {memberCompleted > 0 && (
                                  <TouchableOpacity 
                                    style={[styles.memberActionBtn, { borderColor: CATEGORY_CONFIG.EB.color }]} 
                                    onPress={() => handleMemberTaskComplete(member.employeeId, 'EB', -1)}
                                  >
                                    <Text style={[styles.memberActionBtnText, { color: CATEGORY_CONFIG.EB.color }]}>-1</Text>
                                  </TouchableOpacity>
                                )}
                                {memberCompleted < memberTarget && (
                                  <TouchableOpacity 
                                    style={[styles.memberActionBtnPrimary, { backgroundColor: CATEGORY_CONFIG.EB.color, opacity: pendingMemberTask === `${member.employeeId}-EB` ? 0.6 : 1 }]} 
                                    onPress={() => handleMemberTaskComplete(member.employeeId, 'EB', 1)}
                                    disabled={pendingMemberTask === `${member.employeeId}-EB`}
                                  >
                                    <Text style={styles.memberActionBtnPrimaryText}>{pendingMemberTask === `${member.employeeId}-EB` ? 'Updating...' : 'Mark +1'}</Text>
                                  </TouchableOpacity>
                                )}
                              </View>
                            )}
                          </View>
                        </View>
                      );
                    })}
                  </View>
                )}
              </View>
            );
          })()}
        </View>
        {/* ===== END CATEGORY-BASED TASK CARDS ===== */}

        {/* Old Maintenance Tasks section removed - now integrated into Category Cards */}

        {/* Activity Log Section */}
        {activityLogs && activityLogs.length > 0 && (
          <View style={styles.summarySection}>
            <View style={styles.sectionTitleRow}>
              <Clock size={18} color={Colors.light.text} />
              <Text style={styles.sectionTitle}>Recent Activity</Text>
            </View>
            <View style={styles.activityList}>
              {activityLogs.slice(0, 5).map((log, idx) => {
                const getActivityIcon = (action: string) => {
                  if (action.includes('TASK_PROGRESS')) return { icon: 'check', color: '#2E7D32', bg: '#E8F5E9' };
                  if (action.includes('ASSIGN')) return { icon: 'user', color: '#1565C0', bg: '#E3F2FD' };
                  if (action.includes('STATUS')) return { icon: 'flag', color: '#EF6C00', bg: '#FFF3E0' };
                  if (action.includes('CREATE')) return { icon: 'plus', color: '#7B1FA2', bg: '#F3E5F5' };
                  return { icon: 'activity', color: '#546E7A', bg: '#ECEFF1' };
                };
                const iconInfo = getActivityIcon(log.action);
                const details = log.details as { taskType?: string; increment?: number; status?: string } | null;
                
                const getActivityText = () => {
                  if (log.action === 'UPDATE_TASK_PROGRESS' && details) {
                    return `Completed ${details.increment || 1} ${details.taskType?.replace('_', ' ') || 'task'}`;
                  }
                  if (log.action === 'UPDATE_EVENT_STATUS' && details) {
                    return `Status changed to ${details.status}`;
                  }
                  if (log.action === 'ASSIGN_TEAM_MEMBER') return 'Team member assigned';
                  if (log.action === 'CREATE_SUBTASK') return 'Subtask created';
                  return log.action.replace(/_/g, ' ').toLowerCase();
                };
                
                const performerName = (log as any).performerName || 'Unknown';
                return (
                  <View key={log.id || idx} style={styles.activityItem}>
                    <View style={[styles.activityIcon, { backgroundColor: iconInfo.bg }]}>
                      <CheckCircle size={12} color={iconInfo.color} />
                    </View>
                    <View style={styles.activityContent}>
                      <Text style={styles.activityText}>
                        <Text style={styles.activityPerformer}>{performerName}</Text> {getActivityText()}
                      </Text>
                      <Text style={styles.activityTime}>
                        {(() => {
                          // Database stores timestamps in IST but JSON serialization treats them as UTC
                          // Use UTC getters since the stored values are actually IST values marked as UTC
                          const date = new Date(log.timestamp);
                          const day = date.getUTCDate();
                          const month = new Date(date.getUTCFullYear(), date.getUTCMonth(), 1).toLocaleString('en-IN', { month: 'short' });
                          let hours = date.getUTCHours();
                          const minutes = date.getUTCMinutes().toString().padStart(2, '0');
                          const ampm = hours >= 12 ? 'pm' : 'am';
                          hours = hours % 12;
                          hours = hours ? hours : 12;
                          return `${day} ${month}, ${hours.toString().padStart(2, '0')}:${minutes} ${ampm}`;
                        })()}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {/* Pending Reviews Section - For Managers */}
        {canManageTeam && eventData.teamWithAllocations?.some((m: any) => m.submissionStatus === 'submitted') && (
          <View style={[styles.sectionCard, { borderLeftColor: '#1565C0', borderLeftWidth: 4 }]}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionTitleRow}>
                <Send size={18} color="#1565C0" />
                <Text style={[styles.sectionTitle, { color: '#1565C0' }]}>Pending Reviews</Text>
              </View>
            </View>
            {eventData.teamWithAllocations?.filter((m: any) => m.submissionStatus === 'submitted').map((member: any) => {
              const statusIndicator = getSubmissionStatusIndicator(member.submissionStatus);
              return (
                <View key={member.id} style={{ backgroundColor: '#E3F2FD', borderRadius: 12, padding: 12, marginBottom: 8 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <View style={[styles.assigneeAvatar, { backgroundColor: getAvatarColor(member.employee?.name || 'U') }]}>
                        <Text style={[styles.assigneeAvatarText, { color: '#fff' }]}>
                          {(member.employee?.name || 'U').split(' ').map((n: string) => n[0]).join('').slice(0,2).toUpperCase()}
                        </Text>
                      </View>
                      <View>
                        <Text style={styles.assigneeName}>{member.employee?.name || 'Unknown'}</Text>
                        <Text style={styles.assigneeRole}>{member.employee?.designation || member.employee?.role}</Text>
                      </View>
                    </View>
                    <View style={[styles.statusBadge, { backgroundColor: statusIndicator.bgColor }]}>
                      {statusIndicator.icon}
                      <Text style={{ color: statusIndicator.color, fontSize: 11, marginLeft: 4 }}>{statusIndicator.label}</Text>
                    </View>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
                    <TouchableOpacity 
                      style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#2E7D32', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, gap: 6 }}
                      onPress={() => handleApproveTask(member.id)}
                    >
                      <ThumbsUp size={14} color="#fff" />
                      <Text style={{ color: '#fff', fontWeight: '600', fontSize: 13 }}>Approve</Text>
                    </TouchableOpacity>
                    <TouchableOpacity 
                      style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#C62828', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, gap: 6 }}
                      onPress={() => handleRejectTask(member.id)}
                    >
                      <ThumbsDown size={14} color="#fff" />
                      <Text style={{ color: '#fff', fontWeight: '600', fontSize: 13 }}>Reject</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {/* Subtask feature temporarily disabled
        <View style={styles.subtasksSection}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionTitleRow}>
              <ListTodo size={18} color={Colors.light.text} />
              <Text style={styles.sectionTitle}>Subtasks ({eventData.subtasks?.length || 0})</Text>
            </View>
            {canManageTeam && dbStatus !== 'completed' && dbStatus !== 'cancelled' && (
              <TouchableOpacity 
                style={styles.addButton}
                onPress={() => { resetSubtaskForm(); setShowSubtaskModal(true); }}
              >
                <Plus size={18} color={Colors.light.background} />
                <Text style={styles.addButtonText}>Add</Text>
              </TouchableOpacity>
            )}
          </View>

          {eventData.summary?.subtaskStats && (
            <View style={styles.subtaskStatsRow}>
              <View style={[styles.statChip, { backgroundColor: STATUS_COLORS.completed.bg }]}>
                <Text style={[styles.statChipText, { color: STATUS_COLORS.completed.text }]}>
                  {eventData.summary.subtaskStats.completed} Done
                </Text>
              </View>
              <View style={[styles.statChip, { backgroundColor: STATUS_COLORS.in_progress.bg }]}>
                <Text style={[styles.statChipText, { color: STATUS_COLORS.in_progress.text }]}>
                  {eventData.summary.subtaskStats.inProgress} In Progress
                </Text>
              </View>
              <View style={[styles.statChip, { backgroundColor: STATUS_COLORS.pending.bg }]}>
                <Text style={[styles.statChipText, { color: STATUS_COLORS.pending.text }]}>
                  {eventData.summary.subtaskStats.pending} Pending
                </Text>
              </View>
            </View>
          )}

          {(!eventData.subtasks || eventData.subtasks.length === 0) ? (
            <View style={styles.emptySubtasks}>
              <ListTodo size={32} color={Colors.light.textSecondary} />
              <Text style={styles.emptySubtasksText}>No subtasks yet</Text>
            </View>
          ) : (
            eventData.subtasks.map((subtask: any) => (
              <View key={subtask.id} style={styles.subtaskCard}>
                <View style={styles.subtaskHeader}>
                  <TouchableOpacity 
                    style={styles.subtaskCheckbox}
                    onPress={() => handleUpdateSubtaskStatus(
                      subtask.id, 
                      subtask.status === 'completed' ? 'pending' : 'completed'
                    )}
                  >
                    {subtask.status === 'completed' ? (
                      <CheckCircle size={22} color={STATUS_COLORS.completed.text} />
                    ) : (
                      <View style={styles.emptyCheckbox} />
                    )}
                  </TouchableOpacity>
                  <View style={styles.subtaskContent}>
                    <Text style={[
                      styles.subtaskTitle,
                      subtask.status === 'completed' && styles.subtaskTitleCompleted
                    ]}>{subtask.title}</Text>
                    {subtask.description && (
                      <Text style={styles.subtaskDescription}>{subtask.description}</Text>
                    )}
                    <View style={styles.subtaskMeta}>
                      <View style={[styles.priorityBadge, { backgroundColor: PRIORITY_COLORS[subtask.priority as SubtaskPriority].bg }]}>
                        <Flag size={10} color={PRIORITY_COLORS[subtask.priority as SubtaskPriority].text} />
                        <Text style={[styles.priorityText, { color: PRIORITY_COLORS[subtask.priority as SubtaskPriority].text }]}>
                          {subtask.priority}
                        </Text>
                      </View>
                      {subtask.dueDate && (
                        <View style={styles.dueDateBadge}>
                          <Clock size={10} color={Colors.light.textSecondary} />
                          <Text style={styles.dueDateText}>
                            {new Date(subtask.dueDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                          </Text>
                        </View>
                      )}
                      {subtask.assignedEmployee && (
                        <View style={styles.assigneeBadge}>
                          <User size={10} color={Colors.light.primary} />
                          <Text style={styles.assigneeText}>{subtask.assignedEmployee.name}</Text>
                        </View>
                      )}
                    </View>
                    {(subtask.simAllocated > 0 || subtask.ftthAllocated > 0) && (
                      <View style={{ flexDirection: 'row', gap: 12, marginTop: 8 }}>
                        {subtask.simAllocated > 0 && (
                          <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#E3F2FD', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4 }}>
                            <Text style={{ fontSize: 11, color: '#1565C0', fontWeight: '600' }}>
                              SIM: {subtask.simSold || 0}/{subtask.simAllocated}
                            </Text>
                          </View>
                        )}
                        {subtask.ftthAllocated > 0 && (
                          <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#E8F5E9', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4 }}>
                            <Text style={{ fontSize: 11, color: '#2E7D32', fontWeight: '600' }}>
                              FTTH: {subtask.ftthSold || 0}/{subtask.ftthAllocated}
                            </Text>
                          </View>
                        )}
                      </View>
                    )}
                  </View>
                  {canManageTeam && (
                    <View style={styles.subtaskActions}>
                      <TouchableOpacity onPress={() => openEditSubtask(subtask)} style={styles.subtaskActionBtn}>
                        <Edit3 size={16} color={Colors.light.textSecondary} />
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => handleDeleteSubtask(subtask.id, subtask.title)} style={styles.subtaskActionBtn}>
                        <Trash2 size={16} color={Colors.light.error} />
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              </View>
            ))
          )}
        </View>
        */}

        {eventData.assignedToEmployee && (
          <View style={styles.managerSection}>
            <Text style={styles.sectionTitle}>Task Manager</Text>
            <View style={styles.managerCard}>
              <View style={styles.memberInfo}>
                <View style={[styles.avatarCircle, { backgroundColor: Colors.light.primary + '20' }]}>
                  <User size={24} color={Colors.light.primary} />
                </View>
                <View>
                  <Text style={styles.memberName}>{eventData.assignedToEmployee.name}</Text>
                  <Text style={styles.memberRole}>
                    {eventData.assignedToEmployee.designation || eventData.assignedToEmployee.role}
                    {(eventData.assignedToEmployee as any).persNo ? ` | ${(eventData.assignedToEmployee as any).persNo}` : ''}
                  </Text>
                  <Text style={[styles.memberRole, { color: Colors.light.primary, fontWeight: '600' }]}>
                    Manages team & assigns tasks
                  </Text>
                </View>
              </View>
            </View>
          </View>
        )}

        {/* Old Sales Team section removed - now integrated into Category Cards above */}

        {(isTeamMember || canManageTeam) && dbStatus === 'active' && (eventData.category?.includes('SIM') || (eventData.category?.includes('FTTH') && !eventData.category?.includes('FTTH_DOWN'))) && (() => {
          // Find current user's allocation
          const myAllocation = eventData.teamWithAllocations?.find((t: any) => t.employeeId === employee?.id);
          const hasSim = eventData.category?.includes('SIM');
          const hasFtth = eventData.category?.includes('FTTH') && !eventData.category?.includes('FTTH_DOWN');
          
          // Check if targets are fully achieved
          const simAchieved = !hasSim || (myAllocation && (myAllocation.actualSimSold || 0) >= (myAllocation.simTarget || 0) && myAllocation.simTarget > 0);
          const ftthAchieved = !hasFtth || (myAllocation && (myAllocation.actualFtthSold || 0) >= (myAllocation.ftthTarget || 0) && myAllocation.ftthTarget > 0);
          const allTargetsAchieved = simAchieved && ftthAchieved && myAllocation && ((myAllocation.simTarget || 0) > 0 || (myAllocation.ftthTarget || 0) > 0);
          
          if (allTargetsAchieved) {
            return (
              <View style={styles.targetsAchievedBadge}>
                <Check size={18} color="#16a34a" />
                <Text style={styles.targetsAchievedText}>Sales Targets Achieved</Text>
              </View>
            );
          }
          
          return (
            <TouchableOpacity 
              style={styles.submitSalesButton}
              onPress={() => router.push(`/event-sales?eventId=${id}`)}
            >
              <Camera size={20} color={Colors.light.background} />
              <Text style={styles.submitSalesText}>Submit Sales Entry</Text>
            </TouchableOpacity>
          );
        })()}

        {eventData.salesEntries?.length > 0 && (eventData.category?.includes('SIM') || (eventData.category?.includes('FTTH') && !eventData.category?.includes('FTTH_DOWN'))) && (
          <View style={styles.salesSection}>
            <Text style={styles.sectionTitle}>Recent Sales Entries</Text>
            {eventData.salesEntries.slice(0, 5).map((entry: any) => {
              const entryMember = eventData.teamWithAllocations?.find((t: any) => t.employeeId === entry.employeeId);
              const hasSim = eventData.category?.includes('SIM');
              const hasFtth = eventData.category?.includes('FTTH') && !eventData.category?.includes('FTTH_DOWN');
              return (
                <View key={entry.id} style={styles.salesEntry}>
                  <View style={styles.salesEntryHeader}>
                    <Text style={styles.salesEntryName}>{entryMember?.employee?.name || 'Unknown'}</Text>
                    <Text style={styles.salesEntryDate}>
                      {(() => {
                        const date = new Date(entry.createdAt);
                        const day = date.getUTCDate();
                        const month = new Date(date.getUTCFullYear(), date.getUTCMonth(), 1).toLocaleString('en-IN', { month: 'short' });
                        let hours = date.getUTCHours();
                        const minutes = date.getUTCMinutes().toString().padStart(2, '0');
                        const ampm = hours >= 12 ? 'pm' : 'am';
                        hours = hours % 12;
                        hours = hours ? hours : 12;
                        return `${day} ${month}, ${hours.toString().padStart(2, '0')}:${minutes} ${ampm}`;
                      })()}
                    </Text>
                  </View>
                  <View style={styles.salesEntryStats}>
                    {hasSim && (
                      <View style={styles.salesStat}>
                        <Text style={styles.salesStatLabel}>SIM</Text>
                        <Text style={styles.salesStatValue}>{entry.simsSold}</Text>
                      </View>
                    )}
                    {hasFtth && (
                      <View style={styles.salesStat}>
                        <Text style={styles.salesStatLabel}>FTTH</Text>
                        <Text style={styles.salesStatValue}>{entry.ftthSold}</Text>
                      </View>
                    )}
                    {entry.gpsLatitude && (
                      <View style={styles.gpsIndicator}>
                        <MapPin size={12} color={Colors.light.success} />
                        <Text style={styles.gpsText}>GPS</Text>
                      </View>
                    )}
                    {entry.photos && entry.photos.length > 0 && (
                      <View style={styles.photoIndicator}>
                        <Camera size={12} color={Colors.light.info} />
                        <Text style={styles.photoText}>{entry.photos.length}</Text>
                      </View>
                    )}
                  </View>
                </View>
              );
            })}
          </View>
        )}

        <View style={styles.bottomSpacer} />
      </ScrollView>

      {/* Assign Team Member Modal */}
      <Modal visible={showAssignModal} animationType="slide" transparent={true} onRequestClose={() => setShowAssignModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Assign Field Officer</Text>
              <TouchableOpacity onPress={() => setShowAssignModal(false)}>
                <X size={24} color={Colors.light.text} />
              </TouchableOpacity>
            </View>
            
            <ScrollView style={styles.modalBody}>
              <Text style={styles.inputLabel}>Select Field Officer</Text>
              <View style={styles.membersList}>
                {unassignedMembers.length === 0 ? (
                  <Text style={styles.noMembersText}>No available team members in this circle</Text>
                ) : (
                  unassignedMembers.map((member: any) => (
                    <TouchableOpacity
                      key={member.id}
                      style={[styles.memberOption, selectedMemberId === member.id && styles.memberOptionSelected]}
                      onPress={() => setSelectedMemberId(member.id)}
                    >
                      <View style={styles.memberOptionInfo}>
                        <Text style={styles.memberOptionName}>{member.name}</Text>
                        <Text style={styles.memberOptionRole}>{member.designation || member.role}{member.persNo ? ` | ${member.persNo}` : ''}</Text>
                      </View>
                      {selectedMemberId === member.id && (
                        <View style={styles.checkmark}><Text style={styles.checkmarkText}>✓</Text></View>
                      )}
                    </TouchableOpacity>
                  ))
                )}
              </View>
              
              {resourceStatus && (
                <View style={styles.resourceHint}>
                  <Text style={styles.resourceHintText}>
                    Available: SIM {resourceStatus.remaining.simToDistribute} | FTTH {resourceStatus.remaining.ftthToDistribute}
                  </Text>
                </View>
              )}
              
              <Text style={styles.inputLabel}>SIM Target</Text>
              <TextInput style={styles.input} placeholder="Enter SIM target" value={simTarget} onChangeText={setSimTarget} keyboardType="number-pad" />
              
              <Text style={styles.inputLabel}>FTTH Target</Text>
              <TextInput style={styles.input} placeholder="Enter FTTH target" value={ftthTarget} onChangeText={setFtthTarget} keyboardType="number-pad" />
            </ScrollView>
            
            <View style={styles.modalFooter}>
              <TouchableOpacity style={styles.cancelButton} onPress={() => { setShowAssignModal(false); resetAssignForm(); }}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.assignButton, assignMemberMutation.isPending && styles.buttonDisabled]} onPress={handleAssignMember} disabled={assignMemberMutation.isPending}>
                <Text style={styles.assignButtonText}>{assignMemberMutation.isPending ? 'Assigning...' : 'Assign'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Edit Event Modal */}
      <Modal visible={showEditModal} animationType="slide" transparent={true} onRequestClose={() => setShowEditModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxHeight: '90%' }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Edit Task</Text>
              <TouchableOpacity onPress={() => setShowEditModal(false)}>
                <X size={24} color={Colors.light.text} />
              </TouchableOpacity>
            </View>
            
            <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={true}>
              {/* Basic Info Section */}
              <View style={styles.editSection}>
                <Text style={styles.editSectionTitle}>Basic Information</Text>
                
                <Text style={styles.inputLabel}>Task Name</Text>
                <TextInput style={styles.input} value={editName} onChangeText={setEditName} placeholder="Task name" />
                
                <Text style={styles.inputLabel}>Location</Text>
                <TextInput style={styles.input} value={editLocation} onChangeText={setEditLocation} placeholder="Location" />
                
                <View style={styles.row}>
                  <View style={styles.halfInput}>
                    <Text style={styles.inputLabel}>Start Date</Text>
                    <TextInput style={styles.input} value={editStartDate} onChangeText={setEditStartDate} placeholder="YYYY-MM-DD" />
                  </View>
                  <View style={styles.halfInput}>
                    <Text style={styles.inputLabel}>End Date</Text>
                    <TextInput style={styles.input} value={editEndDate} onChangeText={setEditEndDate} placeholder="YYYY-MM-DD" />
                  </View>
                </View>
              </View>

              {/* Category Targets Section - Only show categories that are part of this task */}
              <View style={styles.editSection}>
                <Text style={styles.editSectionTitle}>Category Targets</Text>
                <Text style={styles.editSectionSubtitle}>Categories: {eventData?.category || 'None'}</Text>
                
                {/* SIM Target - only show if SIM is in category */}
                {eventData?.category?.includes('SIM') && (
                  <View style={styles.targetRow}>
                    <View style={[styles.targetIndicator, { backgroundColor: CATEGORY_CONFIG.SIM.color }]} />
                    <View style={styles.targetInputContainer}>
                      <Text style={styles.inputLabel}>SIM Target</Text>
                      <TextInput style={styles.input} value={editTargetSim} onChangeText={setEditTargetSim} keyboardType="number-pad" placeholder="0" />
                    </View>
                  </View>
                )}
                
                {/* FTTH Target - only show if FTTH (not FTTH_DOWN) is in category */}
                {eventData?.category?.includes('FTTH') && !eventData?.category?.includes('FTTH_DOWN') && (
                  <View style={styles.targetRow}>
                    <View style={[styles.targetIndicator, { backgroundColor: CATEGORY_CONFIG.FTTH.color }]} />
                    <View style={styles.targetInputContainer}>
                      <Text style={styles.inputLabel}>FTTH Target</Text>
                      <TextInput style={styles.input} value={editTargetFtth} onChangeText={setEditTargetFtth} keyboardType="number-pad" placeholder="0" />
                    </View>
                  </View>
                )}
                
                {/* Lease Circuit Target */}
                {eventData?.category?.includes('LEASE_CIRCUIT') && (
                  <View style={styles.targetRow}>
                    <View style={[styles.targetIndicator, { backgroundColor: CATEGORY_CONFIG.LEASE_CIRCUIT.color }]} />
                    <View style={styles.targetInputContainer}>
                      <Text style={styles.inputLabel}>Lease Circuit Target</Text>
                      <TextInput style={styles.input} value={editTargetLease} onChangeText={setEditTargetLease} keyboardType="number-pad" placeholder="0" />
                    </View>
                  </View>
                )}
                
                {/* BTS Down Target */}
                {eventData?.category?.includes('BTS_DOWN') && (
                  <View style={styles.targetRow}>
                    <View style={[styles.targetIndicator, { backgroundColor: CATEGORY_CONFIG.BTS_DOWN.color }]} />
                    <View style={styles.targetInputContainer}>
                      <Text style={styles.inputLabel}>BTS Down Target</Text>
                      <TextInput style={styles.input} value={editTargetBtsDown} onChangeText={setEditTargetBtsDown} keyboardType="number-pad" placeholder="0" />
                    </View>
                  </View>
                )}
                
                {/* Route Fail Target */}
                {eventData?.category?.includes('ROUTE_FAIL') && (
                  <View style={styles.targetRow}>
                    <View style={[styles.targetIndicator, { backgroundColor: CATEGORY_CONFIG.ROUTE_FAIL.color }]} />
                    <View style={styles.targetInputContainer}>
                      <Text style={styles.inputLabel}>Route Fail Target</Text>
                      <TextInput style={styles.input} value={editTargetRouteFail} onChangeText={setEditTargetRouteFail} keyboardType="number-pad" placeholder="0" />
                    </View>
                  </View>
                )}
                
                {/* FTTH Down Target */}
                {eventData?.category?.includes('FTTH_DOWN') && (
                  <View style={styles.targetRow}>
                    <View style={[styles.targetIndicator, { backgroundColor: CATEGORY_CONFIG.FTTH_DOWN.color }]} />
                    <View style={styles.targetInputContainer}>
                      <Text style={styles.inputLabel}>FTTH Down Target</Text>
                      <TextInput style={styles.input} value={editTargetFtthDown} onChangeText={setEditTargetFtthDown} keyboardType="number-pad" placeholder="0" />
                    </View>
                  </View>
                )}
                
                {/* OFC Fail Target */}
                {eventData?.category?.includes('OFC_FAIL') && (
                  <View style={styles.targetRow}>
                    <View style={[styles.targetIndicator, { backgroundColor: CATEGORY_CONFIG.OFC_FAIL.color }]} />
                    <View style={styles.targetInputContainer}>
                      <Text style={styles.inputLabel}>OFC Fail Target</Text>
                      <TextInput style={styles.input} value={editTargetOfcFail} onChangeText={setEditTargetOfcFail} keyboardType="number-pad" placeholder="0" />
                    </View>
                  </View>
                )}
                
                {/* EB Target */}
                {eventData?.category?.includes('EB') && (
                  <View style={styles.targetRow}>
                    <View style={[styles.targetIndicator, { backgroundColor: CATEGORY_CONFIG.EB.color }]} />
                    <View style={styles.targetInputContainer}>
                      <Text style={styles.inputLabel}>EB Connections Target</Text>
                      <TextInput style={styles.input} value={editTargetEb} onChangeText={setEditTargetEb} keyboardType="number-pad" placeholder="0" />
                    </View>
                  </View>
                )}
              </View>

              {/* Assigned Team Section */}
              {eventData?.teamWithAllocations && eventData.teamWithAllocations.length > 0 && (
                <View style={styles.editSection}>
                  <Text style={styles.editSectionTitle}>Assigned Team ({eventData.teamWithAllocations.length})</Text>
                  <Text style={styles.editSectionSubtitle}>Team members and their current allocations</Text>
                  
                  {eventData.teamWithAllocations.map((member: any) => (
                    <View key={member.id} style={styles.editTeamMemberCard}>
                      <View style={styles.editTeamMemberHeader}>
                        <View style={[styles.assigneeAvatar, { backgroundColor: getAvatarColor(member.employee?.name || 'U') }]}>
                          <Text style={[styles.assigneeAvatarText, { color: '#fff' }]}>
                            {(member.employee?.name || 'U').split(' ').map((n: string) => n[0]).join('').slice(0,2).toUpperCase()}
                          </Text>
                        </View>
                        <View style={styles.editTeamMemberInfo}>
                          <Text style={styles.editTeamMemberName}>{member.employee?.name || 'Unknown'}</Text>
                          <Text style={styles.editTeamMemberRole}>{member.employee?.designation || 'N/A'}{member.employee?.persNo ? ` | ${member.employee.persNo}` : ''}</Text>
                        </View>
                      </View>
                      <View style={styles.editTeamMemberTargets}>
                        {eventData?.category?.includes('SIM') && (
                          <View style={styles.editMemberTargetBadge}>
                            <Text style={styles.editMemberTargetLabel}>SIM</Text>
                            <Text style={styles.editMemberTargetValue}>{member.simTarget || 0}</Text>
                          </View>
                        )}
                        {eventData?.category?.includes('FTTH') && !eventData?.category?.includes('FTTH_DOWN') && (
                          <View style={styles.editMemberTargetBadge}>
                            <Text style={styles.editMemberTargetLabel}>FTTH</Text>
                            <Text style={styles.editMemberTargetValue}>{member.ftthTarget || 0}</Text>
                          </View>
                        )}
                      </View>
                    </View>
                  ))}
                  <Text style={styles.editTeamNote}>To edit individual team member targets, use the Team Management section on the task detail page.</Text>
                </View>
              )}

              {/* Key Insight Section */}
              <View style={styles.editSection}>
                <Text style={styles.editSectionTitle}>Additional Information</Text>
                <Text style={styles.inputLabel}>Key Insight / Notes</Text>
                <TextInput style={[styles.input, styles.textArea]} value={editKeyInsight} onChangeText={setEditKeyInsight} placeholder="Key insights or notes about this task" multiline numberOfLines={4} />
              </View>
            </ScrollView>
            
            <View style={styles.modalFooter}>
              <TouchableOpacity style={styles.cancelButton} onPress={() => setShowEditModal(false)}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.assignButton, updateEventMutation.isPending && styles.buttonDisabled]} onPress={handleUpdateEvent} disabled={updateEventMutation.isPending}>
                <Text style={styles.assignButtonText}>{updateEventMutation.isPending ? 'Saving...' : 'Save Changes'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Subtask Modal */}
      <Modal visible={showSubtaskModal} animationType="slide" transparent={true} onRequestClose={() => setShowSubtaskModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{editingSubtask ? 'Edit Subtask' : 'Add Subtask'}</Text>
              <TouchableOpacity onPress={() => { setShowSubtaskModal(false); resetSubtaskForm(); }}>
                <X size={24} color={Colors.light.text} />
              </TouchableOpacity>
            </View>
            
            <ScrollView style={styles.modalBody}>
              <Text style={styles.inputLabel}>Title *</Text>
              <TextInput style={styles.input} value={subtaskTitle} onChangeText={setSubtaskTitle} placeholder="Subtask title" />
              
              <Text style={styles.inputLabel}>Description</Text>
              <TextInput style={[styles.input, styles.textArea]} value={subtaskDescription} onChangeText={setSubtaskDescription} placeholder="Description (optional)" multiline numberOfLines={3} />
              
              <Text style={styles.inputLabel}>Assign To (Pers No) *</Text>
              <View style={styles.persNoRow}>
                <TextInput 
                  style={[styles.input, styles.persNoInput]} 
                  value={subtaskStaffId} 
                  onChangeText={(text) => {
                    setSubtaskStaffId(text);
                    setFoundEmployee(null);
                  }} 
                  placeholder="Enter Pers No" 
                />
                <TouchableOpacity 
                  style={[styles.verifyButton, searchingEmployee && styles.buttonDisabled]}
                  onPress={async () => {
                    if (!subtaskStaffId.trim()) {
                      Alert.alert('Error', 'Please enter a Pers No');
                      return;
                    }
                    setSearchingEmployee(true);
                    try {
                      const result = await trpcUtils.client.employees.getByStaffId.query({ staffId: subtaskStaffId });
                      if (result) {
                        setFoundEmployee({ id: result.id, name: result.name, designation: result.designation });
                        Alert.alert('Found', `Employee: ${result.name}`);
                      } else {
                        setFoundEmployee(null);
                        Alert.alert('Not Found', 'No registered employee found with this Pers No');
                      }
                    } catch (err) {
                      console.error('Error searching employee:', err);
                      Alert.alert('Error', 'Failed to search employee');
                    } finally {
                      setSearchingEmployee(false);
                    }
                  }}
                  disabled={searchingEmployee}
                >
                  <Text style={styles.verifyButtonText}>{searchingEmployee ? 'Searching...' : 'Verify'}</Text>
                </TouchableOpacity>
              </View>
              {foundEmployee && (
                <View style={styles.foundEmployeeCard}>
                  <User size={16} color={Colors.light.primary} />
                  <View style={styles.foundEmployeeInfo}>
                    <Text style={styles.foundEmployeeName}>{foundEmployee.name}</Text>
                    {foundEmployee.designation && (
                      <Text style={styles.foundEmployeeRole}>{foundEmployee.designation}</Text>
                    )}
                  </View>
                  <CheckCircle size={18} color={Colors.light.success} />
                </View>
              )}
              
              <Text style={styles.inputLabel}>Priority</Text>
              <View style={styles.priorityOptions}>
                {(['low', 'medium', 'high', 'urgent'] as SubtaskPriority[]).map((p) => (
                  <TouchableOpacity
                    key={p}
                    style={[styles.priorityOption, subtaskPriority === p && { backgroundColor: PRIORITY_COLORS[p].bg, borderColor: PRIORITY_COLORS[p].text }]}
                    onPress={() => setSubtaskPriority(p)}
                  >
                    <Text style={[styles.priorityOptionText, subtaskPriority === p && { color: PRIORITY_COLORS[p].text }]}>{p}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              
              <Text style={styles.inputLabel}>Due Date</Text>
              <TextInput style={styles.input} value={subtaskDueDate} onChangeText={setSubtaskDueDate} placeholder="YYYY-MM-DD (optional)" />
              
              <Text style={[styles.inputLabel, { marginTop: 16, fontWeight: '600', color: Colors.light.primary }]}>Resource Allocation</Text>
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.inputLabel}>SIM Allocation</Text>
                  <TextInput 
                    style={styles.input} 
                    value={subtaskSimAllocated} 
                    onChangeText={setSubtaskSimAllocated} 
                    placeholder="0" 
                    keyboardType="number-pad"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.inputLabel}>FTTH Allocation</Text>
                  <TextInput 
                    style={styles.input} 
                    value={subtaskFtthAllocated} 
                    onChangeText={setSubtaskFtthAllocated} 
                    placeholder="0" 
                    keyboardType="number-pad"
                  />
                </View>
              </View>
            </ScrollView>
            
            <View style={styles.modalFooter}>
              <TouchableOpacity style={styles.cancelButton} onPress={() => { setShowSubtaskModal(false); resetSubtaskForm(); }}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.assignButton, (createSubtaskMutation.isPending || updateSubtaskMutation.isPending) && styles.buttonDisabled]} 
                onPress={handleCreateSubtask} 
                disabled={createSubtaskMutation.isPending || updateSubtaskMutation.isPending}
              >
                <Text style={styles.assignButtonText}>
                  {createSubtaskMutation.isPending || updateSubtaskMutation.isPending ? 'Saving...' : editingSubtask ? 'Update' : 'Create'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Edit Target Modal */}
      <Modal visible={showEditTargetModal} animationType="slide" transparent={true} onRequestClose={() => setShowEditTargetModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Edit Targets - {editingMember?.name}</Text>
              <TouchableOpacity onPress={() => setShowEditTargetModal(false)}>
                <X size={24} color={Colors.light.text} />
              </TouchableOpacity>
            </View>
            
            <View style={styles.modalBody}>
              {(() => {
                const validation = getDistributionValidation();
                const totalSim = resourceStatus?.target?.sim || eventData?.targetSim || 0;
                const totalFtth = resourceStatus?.target?.ftth || eventData?.targetFtth || 0;
                return (
                  <>
                    <View style={[styles.resourceHint, { backgroundColor: (!validation.simValid || !validation.ftthValid) ? '#FEE2E2' : '#ECFDF5' }]}>
                      <Text style={[styles.resourceHintText, { color: (!validation.simValid || !validation.ftthValid) ? '#DC2626' : '#059669' }]}>
                        {validation.simValid && validation.ftthValid 
                          ? `Remaining: SIM ${validation.simRemaining} | FTTH ${validation.ftthRemaining}`
                          : `Over allocation! SIM: ${validation.simRemaining < 0 ? validation.simRemaining : 'OK'} | FTTH: ${validation.ftthRemaining < 0 ? validation.ftthRemaining : 'OK'}`
                        }
                      </Text>
                      <Text style={[styles.resourceHintText, { fontSize: 11, marginTop: 2 }]}>
                        Total Target: SIM {totalSim} | FTTH {totalFtth}
                      </Text>
                    </View>
                    
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                      <Text style={styles.inputLabel}>SIM Target</Text>
                      {totalSim > 0 && (
                        <TouchableOpacity onPress={() => distributeEvenly('sim')} style={{ padding: 4 }}>
                          <Text style={{ color: Colors.light.primary, fontSize: 12 }}>Auto-distribute</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                    <TextInput 
                      style={[styles.input, !validation.simValid && { borderColor: '#DC2626', borderWidth: 2 }]} 
                      value={editMemberSimTarget} 
                      onChangeText={(v) => handleIntegerInput(v, setEditMemberSimTarget)} 
                      keyboardType="number-pad" 
                      placeholder="Enter whole number only"
                    />
                    
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                      <Text style={styles.inputLabel}>FTTH Target</Text>
                      {totalFtth > 0 && (
                        <TouchableOpacity onPress={() => distributeEvenly('ftth')} style={{ padding: 4 }}>
                          <Text style={{ color: Colors.light.primary, fontSize: 12 }}>Auto-distribute</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                    <TextInput 
                      style={[styles.input, !validation.ftthValid && { borderColor: '#DC2626', borderWidth: 2 }]} 
                      value={editMemberFtthTarget} 
                      onChangeText={(v) => handleIntegerInput(v, setEditMemberFtthTarget)} 
                      keyboardType="number-pad" 
                      placeholder="Enter whole number only"
                    />
                  </>
                );
              })()}
            </View>
            
            <View style={styles.modalFooter}>
              <TouchableOpacity style={styles.cancelButton} onPress={() => setShowEditTargetModal(false)}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.assignButton, updateTargetsMutation.isPending && styles.buttonDisabled]} 
                onPress={handleUpdateMemberTargets} 
                disabled={updateTargetsMutation.isPending}
              >
                <Text style={styles.assignButtonText}>{updateTargetsMutation.isPending ? 'Saving...' : 'Update'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Status Change Modal */}
      <Modal visible={showStatusModal} animationType="fade" transparent={true} onRequestClose={() => setShowStatusModal(false)}>
        <TouchableOpacity style={styles.statusModalOverlay} activeOpacity={1} onPress={() => setShowStatusModal(false)}>
          <View style={styles.statusModalContent}>
            <Text style={styles.statusModalTitle}>Change Event Status</Text>
            <View style={styles.currentStatusInfo}>
              <Text style={styles.currentStatusInfoLabel}>Current:</Text>
              <View style={[styles.statusInfoBadge, { backgroundColor: EVENT_STATUS_CONFIG[dbStatus]?.bg }]}>
                <Text style={[styles.statusInfoText, { color: EVENT_STATUS_CONFIG[dbStatus]?.color }]}>
                  {EVENT_STATUS_CONFIG[dbStatus]?.label}
                </Text>
              </View>
            </View>
            <Text style={styles.availableTransitionsLabel}>Available Actions:</Text>
            {availableTransitions.includes('active') && (
              <TouchableOpacity style={styles.statusOption} onPress={() => { setShowStatusModal(false); handleUpdateStatus('active'); }}>
                <Play size={20} color={EVENT_STATUS_CONFIG.active.color} />
                <View style={styles.statusOptionContent}>
                  <Text style={styles.statusOptionText}>{dbStatus === 'paused' ? 'Resume Task' : 'Activate Task'}</Text>
                  <Text style={styles.statusOptionDesc}>{EVENT_STATUS_CONFIG.active.description}</Text>
                </View>
              </TouchableOpacity>
            )}
            {availableTransitions.includes('paused') && (
              <TouchableOpacity style={styles.statusOption} onPress={() => { setShowStatusModal(false); handleUpdateStatus('paused'); }}>
                <Pause size={20} color={EVENT_STATUS_CONFIG.paused.color} />
                <View style={styles.statusOptionContent}>
                  <Text style={styles.statusOptionText}>Pause Event</Text>
                  <Text style={styles.statusOptionDesc}>{EVENT_STATUS_CONFIG.paused.description}</Text>
                </View>
              </TouchableOpacity>
            )}
            {availableTransitions.includes('completed') && (
              <TouchableOpacity style={styles.statusOption} onPress={() => { setShowStatusModal(false); handleUpdateStatus('completed'); }}>
                <CheckCircle size={20} color={EVENT_STATUS_CONFIG.completed.color} />
                <View style={styles.statusOptionContent}>
                  <Text style={styles.statusOptionText}>Mark Completed</Text>
                  <Text style={styles.statusOptionDesc}>{EVENT_STATUS_CONFIG.completed.description}</Text>
                </View>
              </TouchableOpacity>
            )}
            {availableTransitions.includes('cancelled') && (
              <TouchableOpacity style={[styles.statusOption, styles.statusOptionDanger]} onPress={() => { setShowStatusModal(false); handleUpdateStatus('cancelled'); }}>
                <XCircle size={20} color={EVENT_STATUS_CONFIG.cancelled.color} />
                <View style={styles.statusOptionContent}>
                  <Text style={[styles.statusOptionText, { color: EVENT_STATUS_CONFIG.cancelled.color }]}>Cancel Event</Text>
                  <Text style={styles.statusOptionDesc}>{EVENT_STATUS_CONFIG.cancelled.description}</Text>
                </View>
              </TouchableOpacity>
            )}
            {availableTransitions.includes('draft') && (
              <TouchableOpacity style={styles.statusOption} onPress={() => { setShowStatusModal(false); handleUpdateStatus('draft'); }}>
                <Edit3 size={20} color={EVENT_STATUS_CONFIG.draft.color} />
                <View style={styles.statusOptionContent}>
                  <Text style={styles.statusOptionText}>Revert to Draft</Text>
                  <Text style={styles.statusOptionDesc}>{EVENT_STATUS_CONFIG.draft.description}</Text>
                </View>
              </TouchableOpacity>
            )}
            {availableTransitions.length === 0 && (
              <Text style={styles.noTransitionsText}>No status changes available for this event.</Text>
            )}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Reject Task Modal */}
      <Modal visible={rejectModalVisible} animationType="fade" transparent={true} onRequestClose={() => setRejectModalVisible(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setRejectModalVisible(false)}>
          <View style={styles.statusModalContent}>
            <View style={styles.statusModalHeader}>
              <Text style={styles.statusModalTitle}>Reject Task</Text>
              <TouchableOpacity onPress={() => setRejectModalVisible(false)}>
                <X size={24} color={Colors.light.textSecondary} />
              </TouchableOpacity>
            </View>
            <Text style={{ fontSize: 14, color: Colors.light.textSecondary, marginBottom: 12 }}>
              Please provide a reason for rejection (optional):
            </Text>
            <TextInput
              style={[styles.input, { minHeight: 80, textAlignVertical: 'top' }]}
              placeholder="Enter rejection reason..."
              value={rejectReason}
              onChangeText={setRejectReason}
              multiline
            />
            <View style={{ flexDirection: 'row', gap: 12, marginTop: 16 }}>
              <TouchableOpacity 
                style={[styles.primaryButton, { flex: 1, backgroundColor: '#C62828' }]}
                onPress={confirmRejectTask}
              >
                <Text style={styles.primaryButtonText}>Reject</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.secondaryButton, { flex: 1 }]}
                onPress={() => setRejectModalVisible(false)}
              >
                <Text style={styles.secondaryButtonText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.backgroundSecondary },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, backgroundColor: Colors.light.backgroundSecondary },
  loadingSpinner: { marginBottom: 16 },
  loadingIcon: { fontSize: 48 },
  loadingText: { fontSize: 18, fontWeight: '600' as const, color: Colors.light.text, marginBottom: 4 },
  loadingSubtext: { fontSize: 14, color: Colors.light.textSecondary },
  errorIcon: { fontSize: 64, marginBottom: 16 },
  errorTitle: { fontSize: 20, fontWeight: 'bold' as const, color: Colors.light.text, marginBottom: 8, textAlign: 'center' as const },
  errorText: { fontSize: 14, color: Colors.light.textSecondary, textAlign: 'center' as const, marginBottom: 24, lineHeight: 20 },
  retryButton: { backgroundColor: Colors.light.primary, paddingHorizontal: 32, paddingVertical: 14, borderRadius: 10, marginBottom: 12 },
  retryButtonText: { color: Colors.light.background, fontSize: 16, fontWeight: '600' as const },
  backButton: { paddingHorizontal: 32, paddingVertical: 14 },
  backButtonText: { color: Colors.light.primary, fontSize: 16, fontWeight: '600' as const },
  headerButton: { marginRight: 16, padding: 4 },
  header: { backgroundColor: Colors.light.card, padding: 16, marginBottom: 12 },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
  eventName: { fontSize: 22, fontWeight: 'bold' as const, color: Colors.light.primary, backgroundColor: '#E3F2FD', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, flex: 1, marginRight: 12, borderLeftWidth: 4, borderLeftColor: Colors.light.primary },
  statusBadge: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 4 },
  statusText: { fontSize: 12, fontWeight: '600' as const },
  eventInfo: { gap: 8 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  infoText: { fontSize: 14, color: Colors.light.textSecondary },
  categoryBadge: { backgroundColor: Colors.light.lightBlue, alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, marginTop: 4 },
  categoryText: { fontSize: 12, color: Colors.light.primary, fontWeight: '600' as const },
  statusSection: { backgroundColor: Colors.light.card, padding: 16, marginBottom: 12 },
  currentStatusRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  statusLabel: { fontSize: 14, color: Colors.light.textSecondary, marginRight: 8 },
  currentStatusBadge: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12 },
  currentStatusText: { fontSize: 13, fontWeight: '600' as const },
  statusDescription: { fontSize: 12, color: Colors.light.textSecondary, marginBottom: 12 },
  actionButtonsRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  actionBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, gap: 6 },
  actionBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' as const },
  startBtn: { backgroundColor: Colors.light.success },
  pauseBtn: { backgroundColor: '#EF6C00' },
  completeBtn: { backgroundColor: '#2E7D32' },
  cancelBtn: { backgroundColor: Colors.light.error },
  draftBtn: { backgroundColor: '#78909C' },
  summarySection: { backgroundColor: Colors.light.card, padding: 16, marginBottom: 12 },
  sectionTitle: { fontSize: 16, fontWeight: 'bold' as const, color: Colors.light.text, marginBottom: 12 },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  progressCards: { flexDirection: 'row', gap: 12 },
  progressCard: { flex: 1, backgroundColor: Colors.light.backgroundSecondary, padding: 12, borderRadius: 8 },
  progressLabel: { fontSize: 12, color: Colors.light.textSecondary, marginBottom: 4 },
  progressValue: { fontSize: 18, fontWeight: 'bold' as const, color: Colors.light.text, marginBottom: 8 },
  progressBar: { height: 6, backgroundColor: '#E0E0E0', borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 3 },
  maintenanceTasksGrid: { gap: 10 },
  maintenanceSectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  timerBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#E8F5E9', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12 },
  timerBadgeText: { fontSize: 10, color: '#2E7D32', fontWeight: '600' as const },
  maintenanceCard: { backgroundColor: Colors.light.backgroundSecondary, padding: 12, borderRadius: 8 },
  maintenanceHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  maintenanceTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  maintenanceLabel: { fontSize: 13, fontWeight: '600' as const, color: Colors.light.text },
  maintenanceProgress: { fontSize: 13, fontWeight: 'bold' as const, color: Colors.light.textSecondary },
  urgencyBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  urgencyBadgeText: { fontSize: 9, fontWeight: '700' as const },
  maintenanceStats: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 },
  maintenanceStat: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  maintenanceStatText: { fontSize: 11, color: Colors.light.textSecondary },
  trendIndicator: { fontSize: 11, fontWeight: '600' as const },
  taskButtonRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  markCompleteBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 6, gap: 6 },
  markCompleteBtnText: { fontSize: 12, fontWeight: '600' as const },
  undoBtn: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 6, borderWidth: 1.5, backgroundColor: '#FFF' },
  undoBtnText: { fontSize: 12, fontWeight: '700' as const },
  activityList: { marginTop: 12, gap: 10 },
  activityItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  activityIcon: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  activityContent: { flex: 1 },
  activityText: { fontSize: 13, color: Colors.light.text, marginBottom: 2 },
  activityPerformer: { fontWeight: '600' as const, color: Colors.light.primary },
  activityTime: { fontSize: 11, color: Colors.light.textSecondary },
  subtasksSection: { backgroundColor: Colors.light.card, padding: 16, marginBottom: 12 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  addButton: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.light.primary, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, gap: 4 },
  addButtonText: { color: Colors.light.background, fontSize: 14, fontWeight: '600' as const },
  subtaskStatsRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  statChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  statChipText: { fontSize: 11, fontWeight: '600' as const },
  emptySubtasks: { alignItems: 'center', paddingVertical: 24 },
  emptySubtasksText: { fontSize: 14, color: Colors.light.textSecondary, marginTop: 8 },
  subtaskCard: { backgroundColor: Colors.light.backgroundSecondary, borderRadius: 10, padding: 12, marginBottom: 10 },
  subtaskHeader: { flexDirection: 'row', alignItems: 'flex-start' },
  subtaskCheckbox: { marginRight: 10, paddingTop: 2 },
  emptyCheckbox: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: Colors.light.border },
  subtaskContent: { flex: 1 },
  subtaskTitle: { fontSize: 14, fontWeight: '600' as const, color: Colors.light.text, marginBottom: 4 },
  subtaskTitleCompleted: { textDecorationLine: 'line-through', color: Colors.light.textSecondary },
  subtaskDescription: { fontSize: 12, color: Colors.light.textSecondary, marginBottom: 8 },
  subtaskMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  priorityBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, gap: 4 },
  priorityText: { fontSize: 10, fontWeight: '600' as const, textTransform: 'capitalize' as const },
  dueDateBadge: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dueDateText: { fontSize: 10, color: Colors.light.textSecondary },
  assigneeBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.light.lightBlue, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, gap: 4 },
  assigneeText: { fontSize: 10, color: Colors.light.primary },
  subtaskActions: { flexDirection: 'row', gap: 8 },
  subtaskActionBtn: { padding: 4 },
  managerSection: { backgroundColor: Colors.light.card, padding: 16, marginBottom: 12 },
  managerCard: { backgroundColor: Colors.light.backgroundSecondary, borderRadius: 10, padding: 12 },
  teamSection: { backgroundColor: Colors.light.card, padding: 16, marginBottom: 12 },
  emptyTeam: { alignItems: 'center', paddingVertical: 32 },
  emptyTeamText: { fontSize: 14, color: Colors.light.textSecondary, marginTop: 8 },
  emptyTeamHint: { fontSize: 12, color: Colors.light.primary, marginTop: 4 },
  teamMemberCard: { backgroundColor: Colors.light.backgroundSecondary, borderRadius: 10, padding: 12, marginBottom: 10 },
  memberHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  memberInfo: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatarCircle: { width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.light.lightBlue, justifyContent: 'center', alignItems: 'center' },
  memberName: { fontSize: 14, fontWeight: '600' as const, color: Colors.light.text },
  memberRole: { fontSize: 12, color: Colors.light.textSecondary },
  memberActions: { flexDirection: 'row', gap: 8 },
  editTargetBtn: { padding: 8 },
  removeButton: { padding: 8 },
  memberTargets: { flexDirection: 'row', gap: 16 },
  targetItem: { flex: 1 },
  targetLabel: { fontSize: 11, color: Colors.light.textSecondary, marginBottom: 2 },
  targetValue: { fontSize: 14, fontWeight: '600' as const, color: Colors.light.text, marginBottom: 4 },
  miniProgressBar: { height: 4, backgroundColor: '#E0E0E0', borderRadius: 2, overflow: 'hidden' },
  miniProgressFill: { height: '100%', borderRadius: 2 },
  entriesCount: { fontSize: 12, color: Colors.light.info, marginTop: 8 },
  submitSalesButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.light.success, marginHorizontal: 16, marginBottom: 12, padding: 16, borderRadius: 12, gap: 8 },
  submitSalesText: { color: Colors.light.background, fontSize: 16, fontWeight: 'bold' as const },
  targetsAchievedBadge: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#dcfce7', borderWidth: 1, borderColor: '#86efac', marginHorizontal: 16, marginBottom: 12, padding: 14, borderRadius: 12, gap: 8 },
  targetsAchievedText: { color: '#16a34a', fontSize: 15, fontWeight: '600' as const },
  salesSection: { backgroundColor: Colors.light.card, padding: 16, marginBottom: 12 },
  salesEntry: { backgroundColor: Colors.light.backgroundSecondary, padding: 12, borderRadius: 8, marginBottom: 8 },
  salesEntryHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  salesEntryName: { fontSize: 14, fontWeight: '600' as const, color: Colors.light.text },
  salesEntryDate: { fontSize: 12, color: Colors.light.textSecondary },
  salesEntryStats: { flexDirection: 'row', gap: 16, alignItems: 'center' },
  salesStat: { alignItems: 'center' },
  salesStatLabel: { fontSize: 10, color: Colors.light.textSecondary },
  salesStatValue: { fontSize: 16, fontWeight: 'bold' as const, color: Colors.light.text },
  gpsIndicator: { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: '#E8F5E9', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  gpsText: { fontSize: 10, color: Colors.light.success },
  photoIndicator: { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: '#E3F2FD', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  photoText: { fontSize: 10, color: Colors.light.info },
  resourceStatusGrid: { gap: 12 },
  resourceCard: { backgroundColor: Colors.light.backgroundSecondary, borderRadius: 10, padding: 12 },
  resourceCardTitle: { fontSize: 14, fontWeight: '700' as const, color: Colors.light.text, marginBottom: 10 },
  resourceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  resourceLabel: { fontSize: 12, color: Colors.light.textSecondary },
  resourceValue: { fontSize: 13, fontWeight: '600' as const, color: Colors.light.text },
  resourceHint: { backgroundColor: Colors.light.lightBlue, padding: 10, borderRadius: 8, marginTop: 12 },
  resourceHintText: { fontSize: 12, color: Colors.light.primary, textAlign: 'center', fontWeight: '600' as const },
  bottomSpacer: { height: 32 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: Colors.light.background, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '85%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: Colors.light.border },
  modalTitle: { fontSize: 18, fontWeight: 'bold' as const, color: Colors.light.text },
  modalBody: { padding: 16, maxHeight: 400 },
  inputLabel: { fontSize: 14, fontWeight: '600' as const, color: Colors.light.text, marginBottom: 8, marginTop: 12 },
  input: { backgroundColor: Colors.light.backgroundSecondary, borderWidth: 1, borderColor: Colors.light.border, borderRadius: 8, padding: 12, fontSize: 16 },
  textArea: { minHeight: 80, textAlignVertical: 'top' },
  row: { flexDirection: 'row', gap: 12 },
  halfInput: { flex: 1 },
  membersList: { maxHeight: 200 },
  noMembersText: { fontSize: 14, color: Colors.light.textSecondary, textAlign: 'center', paddingVertical: 16 },
  memberOption: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12, backgroundColor: Colors.light.backgroundSecondary, borderRadius: 8, marginBottom: 8, borderWidth: 1, borderColor: Colors.light.border },
  memberOptionSelected: { borderColor: Colors.light.primary, backgroundColor: Colors.light.lightBlue },
  memberOptionInfo: { flex: 1 },
  memberOptionName: { fontSize: 14, fontWeight: '600' as const, color: Colors.light.text },
  memberOptionRole: { fontSize: 12, color: Colors.light.textSecondary },
  checkmark: { width: 24, height: 24, borderRadius: 12, backgroundColor: Colors.light.primary, justifyContent: 'center', alignItems: 'center' },
  checkmarkText: { color: Colors.light.background, fontWeight: 'bold' as const },
  assigneeList: { marginTop: 8 },
  assigneeOption: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: Colors.light.backgroundSecondary, marginRight: 8, borderWidth: 1, borderColor: Colors.light.border },
  assigneeOptionSelected: { backgroundColor: Colors.light.primary, borderColor: Colors.light.primary },
  assigneeOptionText: { fontSize: 13, color: Colors.light.text },
  assigneeOptionTextSelected: { color: Colors.light.background },
  priorityOptions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  priorityOption: { flex: 1, paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: Colors.light.border, alignItems: 'center' },
  priorityOptionText: { fontSize: 12, fontWeight: '600' as const, textTransform: 'capitalize' as const, color: Colors.light.textSecondary },
  modalFooter: { flexDirection: 'row', padding: 16, gap: 12, borderTopWidth: 1, borderTopColor: Colors.light.border },
  cancelButton: { flex: 1, padding: 14, borderRadius: 8, borderWidth: 1, borderColor: Colors.light.border, alignItems: 'center' },
  cancelButtonText: { fontSize: 16, color: Colors.light.text },
  assignButton: { flex: 1, padding: 14, borderRadius: 8, backgroundColor: Colors.light.primary, alignItems: 'center' },
  assignButtonText: { fontSize: 16, fontWeight: 'bold' as const, color: Colors.light.background },
  buttonDisabled: { opacity: 0.6 },
  statusModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 32 },
  statusModalContent: { backgroundColor: Colors.light.background, borderRadius: 16, padding: 20, width: '100%', maxWidth: 320 },
  statusModalTitle: { fontSize: 18, fontWeight: 'bold' as const, color: Colors.light.text, marginBottom: 12, textAlign: 'center' },
  currentStatusInfo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 16, gap: 8 },
  currentStatusInfoLabel: { fontSize: 14, color: Colors.light.textSecondary },
  statusInfoBadge: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12 },
  statusInfoText: { fontSize: 13, fontWeight: '600' as const },
  availableTransitionsLabel: { fontSize: 12, color: Colors.light.textSecondary, marginBottom: 8, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  statusOption: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: Colors.light.border },
  statusOptionDanger: { borderBottomColor: '#FFCDD2' },
  statusOptionContent: { flex: 1 },
  statusOptionText: { fontSize: 16, color: Colors.light.text, marginBottom: 2 },
  statusOptionDesc: { fontSize: 12, color: Colors.light.textSecondary },
  noTransitionsText: { fontSize: 14, color: Colors.light.textSecondary, textAlign: 'center', paddingVertical: 16 },
  persNoRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  persNoInput: { flex: 1 },
  verifyButton: { backgroundColor: Colors.light.primary, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 8 },
  verifyButtonText: { color: Colors.light.background, fontSize: 14, fontWeight: '600' as const },
  foundEmployeeCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#E8F5E9', padding: 12, borderRadius: 8, marginTop: 8, gap: 10 },
  foundEmployeeInfo: { flex: 1 },
  foundEmployeeName: { fontSize: 14, fontWeight: '600' as const, color: Colors.light.text },
  foundEmployeeRole: { fontSize: 12, color: Colors.light.textSecondary },
  draftSetupPanel: { backgroundColor: Colors.light.card, padding: 16, marginBottom: 12, borderLeftWidth: 4, borderLeftColor: '#78909C' },
  draftPanelHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 16, gap: 12 },
  draftPanelIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#ECEFF1', justifyContent: 'center', alignItems: 'center' },
  draftPanelTitleContainer: { flex: 1 },
  draftPanelTitle: { fontSize: 18, fontWeight: 'bold' as const, color: Colors.light.text, marginBottom: 2 },
  draftPanelSubtitle: { fontSize: 13, color: Colors.light.textSecondary },
  draftChecklist: { backgroundColor: '#FAFAFA', borderRadius: 10, padding: 12, marginBottom: 16 },
  checklistItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, gap: 12 },
  checklistIcon: { width: 24, height: 24, justifyContent: 'center', alignItems: 'center' },
  checklistIconDone: {},
  checklistCircle: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: '#CFD8DC' },
  checklistLabel: { fontSize: 14, color: Colors.light.textSecondary },
  checklistLabelDone: { color: Colors.light.text, textDecorationLine: 'line-through' },
  draftActions: { flexDirection: 'row', gap: 12 },
  draftEditButton: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 10, borderWidth: 1, borderColor: Colors.light.primary, backgroundColor: Colors.light.background },
  draftEditButtonText: { fontSize: 15, fontWeight: '600' as const, color: Colors.light.primary },
  draftActivateButton: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 10, backgroundColor: Colors.light.success },
  draftActivateButtonDisabled: { backgroundColor: '#B0BEC5' },
  draftActivateButtonText: { fontSize: 15, fontWeight: '600' as const, color: '#fff' },
  draftWarning: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF3E0', padding: 12, borderRadius: 8, marginTop: 12, gap: 8 },
  draftWarningText: { flex: 1, fontSize: 12, color: '#EF6C00' },
  
  // Category Cards Styles
  categoryCardsSection: { backgroundColor: Colors.light.card, padding: 16, marginBottom: 12 },
  categoryCard: { backgroundColor: '#FAFAFA', borderRadius: 12, padding: 16, marginBottom: 12, borderLeftWidth: 4 },
  categoryCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
  categoryTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  categoryIconCircle: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  categoryIconText: { fontSize: 12, fontWeight: 'bold' as const },
  categoryTitleInfo: { flex: 1 },
  categoryCardTitle: { fontSize: 16, fontWeight: '600' as const, color: Colors.light.text, marginBottom: 2 },
  categoryDueDate: { fontSize: 12, color: Colors.light.textSecondary },
  categoryTargetBadge: { backgroundColor: Colors.light.backgroundSecondary, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16 },
  categoryTargetText: { fontSize: 14, fontWeight: '600' as const, color: Colors.light.text },
  categoryProgressBar: { height: 6, backgroundColor: '#E0E0E0', borderRadius: 3, marginBottom: 12, overflow: 'hidden' as const },
  categoryProgressFill: { height: '100%' as const, borderRadius: 3 },
  slaBadge: { flexDirection: 'row' as const, alignItems: 'center' as const, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, marginBottom: 10, gap: 6 },
  slaBadgeIcon: { fontSize: 14, fontWeight: '700' as const },
  slaBadgeText: { fontSize: 12, fontWeight: '600' as const },
  categoryAssignees: { borderTopWidth: 1, borderTopColor: '#E0E0E0', paddingTop: 12 },
  assigneesLabel: { fontSize: 12, fontWeight: '600' as const, color: Colors.light.textSecondary, marginBottom: 8, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  assigneeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F0F0F0' },
  assigneeInfo: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  assigneeAvatar: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center' },
  assigneeAvatarText: { fontSize: 14, fontWeight: '600' as const },
  assigneeDetails: { flex: 1 },
  assigneeName: { fontSize: 14, fontWeight: '500' as const, color: Colors.light.text },
  assigneeRole: { fontSize: 11, color: Colors.light.textSecondary, marginTop: 1 },
  assigneeProgress: { alignItems: 'flex-end' },
  assigneeProgressText: { fontSize: 14, fontWeight: '600' as const, color: Colors.light.text, marginBottom: 4 },
  assigneeMiniBar: { width: 60, height: 4, backgroundColor: '#E0E0E0', borderRadius: 2, overflow: 'hidden' as const },
  assigneeMiniBarFill: { height: '100%' as const, borderRadius: 2 },
  noAssigneesText: { fontSize: 13, color: Colors.light.textSecondary, fontStyle: 'italic' as const, paddingVertical: 8 },
  statusBadgeMini: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10 },
  statusBadgeMiniText: { fontSize: 10, fontWeight: '600' as const },
  maintenanceStatItem: { flex: 1, alignItems: 'center' as const, paddingVertical: 8 },
  maintenanceStatLabel: { fontSize: 10, color: Colors.light.textSecondary, textTransform: 'uppercase' as const, marginBottom: 4 },
  maintenanceStatValue: { fontSize: 16, fontWeight: '700' as const, color: Colors.light.text },
  maintenanceActions: { flexDirection: 'row', gap: 12, marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#E0E0E0' },
  maintenanceActionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8, borderWidth: 1.5 },
  maintenanceActionBtnText: { fontSize: 14, fontWeight: '600' as const },
  maintenanceActionBtnPrimary: { flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8 },
  maintenanceActionBtnPrimaryText: { fontSize: 14, fontWeight: '600' as const, color: '#fff' },
  editSection: { marginBottom: 20, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: Colors.light.border },
  editSectionTitle: { fontSize: 16, fontWeight: '700' as const, color: Colors.light.text, marginBottom: 4 },
  editSectionSubtitle: { fontSize: 12, color: Colors.light.textSecondary, marginBottom: 12 },
  targetRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 },
  targetIndicator: { width: 4, height: 50, borderRadius: 2 },
  targetInputContainer: { flex: 1 },
  editTeamMemberCard: { backgroundColor: Colors.light.backgroundSecondary, borderRadius: 10, padding: 12, marginBottom: 8 },
  editTeamMemberHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  editTeamMemberInfo: { flex: 1 },
  editTeamMemberName: { fontSize: 14, fontWeight: '600' as const, color: Colors.light.text },
  editTeamMemberRole: { fontSize: 11, color: Colors.light.textSecondary },
  editTeamMemberTargets: { flexDirection: 'row', gap: 12, marginTop: 4 },
  editMemberTargetBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.light.lightBlue, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  editMemberTargetLabel: { fontSize: 11, color: Colors.light.primary, fontWeight: '500' as const },
  editMemberTargetValue: { fontSize: 13, color: Colors.light.primary, fontWeight: '700' as const },
  editTeamNote: { fontSize: 11, color: Colors.light.textSecondary, fontStyle: 'italic' as const, marginTop: 8, textAlign: 'center' as const },
  memberProgressContainer: { alignItems: 'flex-end' as const, gap: 6 },
  memberProgressText: { fontSize: 14, fontWeight: '700' as const },
  memberActionButtons: { flexDirection: 'row' as const, gap: 6 },
  memberActionBtn: { borderWidth: 1.5, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4, minWidth: 36, alignItems: 'center' as const, justifyContent: 'center' as const },
  memberActionBtnText: { fontSize: 14, fontWeight: '700' as const },
  memberActionBtnPrimary: { borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4, minWidth: 36, alignItems: 'center' as const, justifyContent: 'center' as const },
  memberActionBtnPrimaryText: { fontSize: 14, fontWeight: '700' as const, color: '#fff' },
});
