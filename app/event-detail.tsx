import { useState, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert, RefreshControl, Modal } from 'react-native';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import { MapPin, Calendar, Users, Plus, Trash2, Camera, User, X, Edit3, Play, Pause, CheckCircle, XCircle, ChevronRight, Clock, Flag, ListTodo, Zap, AlertCircle, Settings } from 'lucide-react-native';
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
  draft: { label: 'Draft', color: '#78909C', bg: '#ECEFF1', icon: 'file', description: 'Work is being prepared' },
  active: { label: 'Active', color: '#2E7D32', bg: '#E8F5E9', icon: 'play', description: 'Work is live and running' },
  paused: { label: 'Paused', color: '#EF6C00', bg: '#FFF3E0', icon: 'pause', description: 'Work is temporarily paused' },
  completed: { label: 'Completed', color: '#1565C0', bg: '#E3F2FD', icon: 'check', description: 'Work has been completed' },
  cancelled: { label: 'Cancelled', color: '#C62828', bg: '#FFEBEE', icon: 'x', description: 'Work has been cancelled' },
};

const STATUS_TRANSITIONS: Record<EventStatus, EventStatus[]> = {
  draft: ['active', 'cancelled'],
  active: ['paused', 'completed', 'cancelled'],
  paused: ['active', 'completed', 'cancelled'],
  completed: ['active'],
  cancelled: ['draft'],
};

export default function EventDetailScreen() {
  const router = useRouter();
  const { id, edit } = useLocalSearchParams<{ id: string; edit?: string }>();
  const { employee } = useAuth();
  
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
  
  const managerPurseId = eventData?.assignedToEmployee ? 
    (eventData.assignedToEmployee as any).purseId || null : null;
  
  const { data: availableMembers } = trpc.events.getAvailableTeamMembers.useQuery(
    { circle: eventData?.circle as Circle, eventId: id, managerPurseId: managerPurseId || undefined },
    { enabled: !!eventData?.circle && !!id }
  );
  
  const { data: resourceStatus } = trpc.events.getEventResourceStatus.useQuery(
    { eventId: id || '' },
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
      Alert.alert('Success', 'Work updated successfully');
      refetch();
      setShowEditModal(false);
    },
    onError: (error) => {
      Alert.alert('Error', error.message);
    },
  });

  const updateStatusMutation = trpc.events.updateEventStatus.useMutation({
    onSuccess: () => {
      Alert.alert('Success', 'Work status updated');
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
    setSubtaskStaffId(subtask.assignedEmployee?.employeeNo || '');
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
      active: { title: 'Activate Work?', message: 'This will make the work active and visible to team members. Sales can be submitted.' },
      paused: { title: 'Pause Work?', message: 'This will temporarily pause the work. Team members will not be able to submit sales. You can resume anytime.' },
      completed: { title: 'Complete Work?', message: 'This will mark the work as completed. Make sure all sales are submitted before completing.' },
      cancelled: { title: 'Cancel Work?', message: 'This will cancel the work. This action is reversible but should be done with caution.' },
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
      Alert.alert('Error', 'Please enter Purse ID');
      return;
    }
    if (!foundEmployee && !subtaskAssignee) {
      Alert.alert('Error', 'Please enter a valid Purse ID and verify the employee');
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
    updateTargetsMutation.mutate({
      eventId: id || '',
      employeeId: editingMember.employeeId,
      simTarget: parseInt(editMemberSimTarget) || 0,
      ftthTarget: parseInt(editMemberFtthTarget) || 0,
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
  const isTeamMember = eventData?.teamWithAllocations?.some(t => t.employeeId === employee?.id);

  const isDraftEvent = eventData?.status === 'draft';
  
  const getDraftChecklist = () => {
    if (!eventData) return [];
    const checks = [
      { label: 'Work Name', done: !!eventData.name },
      { label: 'Location', done: !!eventData.location },
      { label: 'Date Range', done: !!eventData.startDate && !!eventData.endDate },
      { label: 'Work Manager Assigned', done: !!eventData.assignedTo },
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
        <Stack.Screen options={{ title: 'Work Details', headerStyle: { backgroundColor: Colors.light.primary }, headerTintColor: Colors.light.background }} />
        <View style={styles.loadingContainer}>
          <Text style={styles.errorTitle}>Invalid Work</Text>
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
        <Stack.Screen options={{ title: 'Work Details', headerStyle: { backgroundColor: Colors.light.primary }, headerTintColor: Colors.light.background }} />
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
        <Stack.Screen options={{ title: 'Work Details', headerStyle: { backgroundColor: Colors.light.primary }, headerTintColor: Colors.light.background }} />
        <View style={styles.loadingContainer}>
          <Text style={styles.errorIcon}>⚠️</Text>
          <Text style={styles.errorTitle}>Failed to Load Work</Text>
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
        <Stack.Screen options={{ title: 'Work Details', headerStyle: { backgroundColor: Colors.light.primary }, headerTintColor: Colors.light.background }} />
        <View style={styles.loadingContainer}>
          <Text style={styles.errorIcon}>🔍</Text>
          <Text style={styles.errorTitle}>Work Not Found</Text>
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
                  {isReadyToActivate ? 'Activate Work' : 'Complete Setup First'}
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

        <View style={styles.summarySection}>
          <Text style={styles.sectionTitle}>Sales Progress</Text>
          <View style={styles.progressCards}>
            <View style={styles.progressCard}>
              <Text style={styles.progressLabel}>SIM Sales</Text>
              <Text style={styles.progressValue}>
                {eventData.summary?.totalSimsSold || 0} / {eventData.targetSim}
              </Text>
              <View style={styles.progressBar}>
                <View 
                  style={[
                    styles.progressFill, 
                    { 
                      width: `${Math.min(((eventData.summary?.totalSimsSold || 0) / eventData.targetSim) * 100, 100)}%`,
                      backgroundColor: Colors.light.primary 
                    }
                  ]} 
                />
              </View>
            </View>
            <View style={styles.progressCard}>
              <Text style={styles.progressLabel}>FTTH Sales</Text>
              <Text style={styles.progressValue}>
                {eventData.summary?.totalFtthSold || 0} / {eventData.targetFtth}
              </Text>
              <View style={styles.progressBar}>
                <View 
                  style={[
                    styles.progressFill, 
                    { 
                      width: `${Math.min(((eventData.summary?.totalFtthSold || 0) / eventData.targetFtth) * 100, 100)}%`,
                      backgroundColor: Colors.light.success 
                    }
                  ]} 
                />
              </View>
            </View>
          </View>
        </View>
        
        {resourceStatus && (
          <View style={styles.summarySection}>
            <Text style={styles.sectionTitle}>Resource Allocation Status</Text>
            <View style={styles.resourceStatusGrid}>
              <View style={styles.resourceCard}>
                <Text style={styles.resourceCardTitle}>SIM Resources</Text>
                <View style={styles.resourceRow}>
                  <Text style={styles.resourceLabel}>Allocated to Event:</Text>
                  <Text style={styles.resourceValue}>{resourceStatus.allocated.sim}</Text>
                </View>
                <View style={styles.resourceRow}>
                  <Text style={styles.resourceLabel}>Distributed to Team:</Text>
                  <Text style={styles.resourceValue}>{resourceStatus.distributed.sim}</Text>
                </View>
                <View style={styles.resourceRow}>
                  <Text style={styles.resourceLabel}>Sold:</Text>
                  <Text style={[styles.resourceValue, { color: Colors.light.success }]}>{resourceStatus.sold.sim}</Text>
                </View>
                <View style={styles.resourceRow}>
                  <Text style={styles.resourceLabel}>Available to Distribute:</Text>
                  <Text style={[styles.resourceValue, { color: resourceStatus.remaining.simToDistribute > 0 ? Colors.light.primary : Colors.light.textSecondary }]}>
                    {resourceStatus.remaining.simToDistribute}
                  </Text>
                </View>
              </View>
              <View style={styles.resourceCard}>
                <Text style={styles.resourceCardTitle}>FTTH Resources</Text>
                <View style={styles.resourceRow}>
                  <Text style={styles.resourceLabel}>Allocated to Event:</Text>
                  <Text style={styles.resourceValue}>{resourceStatus.allocated.ftth}</Text>
                </View>
                <View style={styles.resourceRow}>
                  <Text style={styles.resourceLabel}>Distributed to Team:</Text>
                  <Text style={styles.resourceValue}>{resourceStatus.distributed.ftth}</Text>
                </View>
                <View style={styles.resourceRow}>
                  <Text style={styles.resourceLabel}>Sold:</Text>
                  <Text style={[styles.resourceValue, { color: Colors.light.success }]}>{resourceStatus.sold.ftth}</Text>
                </View>
                <View style={styles.resourceRow}>
                  <Text style={styles.resourceLabel}>Available to Distribute:</Text>
                  <Text style={[styles.resourceValue, { color: resourceStatus.remaining.ftthToDistribute > 0 ? Colors.light.primary : Colors.light.textSecondary }]}>
                    {resourceStatus.remaining.ftthToDistribute}
                  </Text>
                </View>
              </View>
            </View>
          </View>
        )}

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

        {eventData.assignedToEmployee && (
          <View style={styles.managerSection}>
            <Text style={styles.sectionTitle}>Work Manager</Text>
            <View style={styles.managerCard}>
              <View style={styles.memberInfo}>
                <View style={[styles.avatarCircle, { backgroundColor: Colors.light.primary + '20' }]}>
                  <User size={24} color={Colors.light.primary} />
                </View>
                <View>
                  <Text style={styles.memberName}>{eventData.assignedToEmployee.name}</Text>
                  <Text style={styles.memberRole}>
                    {eventData.assignedToEmployee.designation || eventData.assignedToEmployee.role}
                    {(eventData.assignedToEmployee as any).purseId ? ` | ${(eventData.assignedToEmployee as any).purseId}` : ''}
                  </Text>
                  <Text style={[styles.memberRole, { color: Colors.light.primary, fontWeight: '600' }]}>
                    Manages team & assigns tasks
                  </Text>
                </View>
              </View>
            </View>
          </View>
        )}

        <View style={styles.teamSection}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Field Team ({eventData.teamWithAllocations?.filter((m: any) => m.employeeId !== eventData.assignedTo).length || 0})</Text>
            {canManageTeam && dbStatus !== 'completed' && dbStatus !== 'cancelled' && (
              <TouchableOpacity 
                style={styles.addButton}
                onPress={() => setShowAssignModal(true)}
              >
                <Plus size={18} color={Colors.light.background} />
                <Text style={styles.addButtonText}>Assign Field Officer</Text>
              </TouchableOpacity>
            )}
          </View>
          
          {eventData.teamWithAllocations?.filter((m: any) => m.employeeId !== eventData.assignedTo).length === 0 ? (
            <View style={styles.emptyTeam}>
              <Users size={40} color={Colors.light.textSecondary} />
              <Text style={styles.emptyTeamText}>No field officers assigned yet</Text>
              {canManageTeam && <Text style={styles.emptyTeamHint}>Tap "Assign Field Officer" to add team members</Text>}
            </View>
          ) : (
            eventData.teamWithAllocations?.filter((m: any) => m.employeeId !== eventData.assignedTo).map((member: any) => (
              <View key={member.id} style={styles.teamMemberCard}>
                <View style={styles.memberHeader}>
                  <View style={styles.memberInfo}>
                    <View style={styles.avatarCircle}>
                      <User size={20} color={Colors.light.primary} />
                    </View>
                    <View>
                      <Text style={styles.memberName}>{member.employee?.name || 'Unknown'}</Text>
                      <Text style={styles.memberRole}>{member.employee?.designation || member.employee?.role}{member.employee?.purseId ? ` | ${member.employee.purseId}` : ''}</Text>
                    </View>
                  </View>
                  {canManageTeam && dbStatus !== 'completed' && dbStatus !== 'cancelled' && (
                    <View style={styles.memberActions}>
                      <TouchableOpacity 
                        onPress={() => openEditTargetModal(member)}
                        style={styles.editTargetBtn}
                      >
                        <Edit3 size={16} color={Colors.light.primary} />
                      </TouchableOpacity>
                      <TouchableOpacity 
                        onPress={() => handleRemoveMember(member.employeeId, member.employee?.name || 'this member')}
                        style={styles.removeButton}
                      >
                        <Trash2 size={16} color={Colors.light.error} />
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
                
                <View style={styles.memberTargets}>
                  <View style={styles.targetItem}>
                    <Text style={styles.targetLabel}>SIM Target</Text>
                    <Text style={styles.targetValue}>{member.actualSimSold} / {member.simTarget}</Text>
                    <View style={styles.miniProgressBar}>
                      <View 
                        style={[
                          styles.miniProgressFill, 
                          { 
                            width: member.simTarget > 0 ? `${Math.min((member.actualSimSold / member.simTarget) * 100, 100)}%` : '0%',
                            backgroundColor: Colors.light.primary 
                          }
                        ]} 
                      />
                    </View>
                  </View>
                  <View style={styles.targetItem}>
                    <Text style={styles.targetLabel}>FTTH Target</Text>
                    <Text style={styles.targetValue}>{member.actualFtthSold} / {member.ftthTarget}</Text>
                    <View style={styles.miniProgressBar}>
                      <View 
                        style={[
                          styles.miniProgressFill, 
                          { 
                            width: member.ftthTarget > 0 ? `${Math.min((member.actualFtthSold / member.ftthTarget) * 100, 100)}%` : '0%',
                            backgroundColor: Colors.light.success 
                          }
                        ]} 
                      />
                    </View>
                  </View>
                </View>
                
                {member.salesEntries?.length > 0 && (
                  <Text style={styles.entriesCount}>{member.salesEntries.length} sales entries</Text>
                )}
              </View>
            ))
          )}
        </View>

        {(isTeamMember || canManageTeam) && dbStatus === 'active' && (
          <TouchableOpacity 
            style={styles.submitSalesButton}
            onPress={() => router.push(`/event-sales?eventId=${id}`)}
          >
            <Camera size={20} color={Colors.light.background} />
            <Text style={styles.submitSalesText}>Submit Sales Entry</Text>
          </TouchableOpacity>
        )}

        {eventData.salesEntries?.length > 0 && (
          <View style={styles.salesSection}>
            <Text style={styles.sectionTitle}>Recent Sales Entries</Text>
            {eventData.salesEntries.slice(0, 5).map((entry: any) => {
              const entryMember = eventData.teamWithAllocations?.find((t: any) => t.employeeId === entry.employeeId);
              return (
                <View key={entry.id} style={styles.salesEntry}>
                  <View style={styles.salesEntryHeader}>
                    <Text style={styles.salesEntryName}>{entryMember?.employee?.name || 'Unknown'}</Text>
                    <Text style={styles.salesEntryDate}>
                      {new Date(entry.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </Text>
                  </View>
                  <View style={styles.salesEntryStats}>
                    <View style={styles.salesStat}>
                      <Text style={styles.salesStatLabel}>SIM</Text>
                      <Text style={styles.salesStatValue}>{entry.simsSold}</Text>
                    </View>
                    <View style={styles.salesStat}>
                      <Text style={styles.salesStatLabel}>FTTH</Text>
                      <Text style={styles.salesStatValue}>{entry.ftthSold}</Text>
                    </View>
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
                        <Text style={styles.memberOptionRole}>{member.designation || member.role}{member.purseId ? ` | ${member.purseId}` : ''}</Text>
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
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Edit Event</Text>
              <TouchableOpacity onPress={() => setShowEditModal(false)}>
                <X size={24} color={Colors.light.text} />
              </TouchableOpacity>
            </View>
            
            <ScrollView style={styles.modalBody}>
              <Text style={styles.inputLabel}>Work Name</Text>
              <TextInput style={styles.input} value={editName} onChangeText={setEditName} placeholder="Event name" />
              
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
              
              <View style={styles.row}>
                <View style={styles.halfInput}>
                  <Text style={styles.inputLabel}>SIM Target</Text>
                  <TextInput style={styles.input} value={editTargetSim} onChangeText={setEditTargetSim} keyboardType="number-pad" />
                </View>
                <View style={styles.halfInput}>
                  <Text style={styles.inputLabel}>FTTH Target</Text>
                  <TextInput style={styles.input} value={editTargetFtth} onChangeText={setEditTargetFtth} keyboardType="number-pad" />
                </View>
              </View>

              <Text style={styles.inputLabel}>Key Insight</Text>
              <TextInput style={[styles.input, styles.textArea]} value={editKeyInsight} onChangeText={setEditKeyInsight} placeholder="Key insights" multiline numberOfLines={3} />
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
              
              <Text style={styles.inputLabel}>Assign To (Purse ID) *</Text>
              <View style={styles.purseIdRow}>
                <TextInput 
                  style={[styles.input, styles.purseIdInput]} 
                  value={subtaskStaffId} 
                  onChangeText={(text) => {
                    setSubtaskStaffId(text);
                    setFoundEmployee(null);
                  }} 
                  placeholder="Enter Purse ID" 
                />
                <TouchableOpacity 
                  style={[styles.verifyButton, searchingEmployee && styles.buttonDisabled]}
                  onPress={async () => {
                    if (!subtaskStaffId.trim()) {
                      Alert.alert('Error', 'Please enter a Purse ID');
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
                        Alert.alert('Not Found', 'No registered employee found with this Purse ID');
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
              {resourceStatus && (
                <View style={styles.resourceHint}>
                  <Text style={styles.resourceHintText}>
                    Available: SIM {resourceStatus.remaining.simToDistribute + parseInt(editMemberSimTarget || '0')} | FTTH {resourceStatus.remaining.ftthToDistribute + parseInt(editMemberFtthTarget || '0')}
                  </Text>
                </View>
              )}
              
              <Text style={styles.inputLabel}>SIM Target</Text>
              <TextInput style={styles.input} value={editMemberSimTarget} onChangeText={setEditMemberSimTarget} keyboardType="number-pad" />
              
              <Text style={styles.inputLabel}>FTTH Target</Text>
              <TextInput style={styles.input} value={editMemberFtthTarget} onChangeText={setEditMemberFtthTarget} keyboardType="number-pad" />
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
                  <Text style={styles.statusOptionText}>{dbStatus === 'paused' ? 'Resume Work' : 'Activate Work'}</Text>
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
  eventName: { fontSize: 22, fontWeight: 'bold' as const, color: Colors.light.text, flex: 1, marginRight: 12 },
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
  purseIdRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  purseIdInput: { flex: 1 },
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
});
