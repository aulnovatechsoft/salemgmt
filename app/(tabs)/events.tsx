import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Plus, Search, Calendar, MapPin, Users, Play, Pause, CheckCircle, XCircle, FileText, Edit3, ChevronRight, ChevronDown, ChevronUp, Zap, Briefcase, Clock, AlertTriangle, Inbox } from 'lucide-react-native';
import { useAuth } from '@/contexts/auth';
import { useApp } from '@/contexts/app';
import { getDisplayTaskId } from '@/utils/taskId';
import Colors from '@/constants/colors';
import { useState, useMemo } from 'react';
import { Event, EventStatus } from '@/types';
import { canCreateEvents } from '@/constants/app';
import { trpc } from '@/lib/trpc';

const EVENT_STATUS_CONFIG: Record<EventStatus, { label: string; color: string; bg: string }> = {
  draft: { label: 'Draft', color: '#78909C', bg: '#ECEFF1' },
  active: { label: 'Active', color: '#2E7D32', bg: '#E8F5E9' },
  paused: { label: 'Paused', color: '#EF6C00', bg: '#FFF3E0' },
  completed: { label: 'Completed', color: '#1565C0', bg: '#E3F2FD' },
  cancelled: { label: 'Cancelled', color: '#C62828', bg: '#FFEBEE' },
};

export default function EventsScreen() {
  const router = useRouter();
  const { employee } = useAuth();
  const { refetchEvents } = useApp();
  const [searchQuery, setSearchQuery] = useState('');
  
  const { data: myEventsData, refetch: refetchMyEvents } = trpc.events.getMyEvents.useQuery(
    { employeeId: employee?.id || '' },
    {
      enabled: !!employee?.id,
      retry: 1,
      refetchOnWindowFocus: true,
      refetchInterval: 10000,
      staleTime: 5000,
    }
  );
  
  type EventWithOwnership = Event & {
    ownershipCategory: 'created_by_me' | 'assigned_to_me' | 'subordinate_task' | 'draft_task';
    submissionStatus?: string;
  };
  
  const events: EventWithOwnership[] = useMemo(() => {
    if (!myEventsData) return [];
    return myEventsData.map((e: any) => {
      const isAssignedToMe = e.ownershipCategory === 'assigned_to_me';
      const myAssignment = e.myAssignment;
      const hasPersonalAssignment = isAssignedToMe && myAssignment;
      
      return {
        id: e.id,
        displayId: e.displayId,
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
        simsSold: hasPersonalAssignment ? (myAssignment.simSold ?? 0) : (e.simSold ?? 0),
        ftthSold: hasPersonalAssignment ? (myAssignment.ftthSold ?? 0) : (e.ftthSold ?? 0),
        mySimTarget: hasPersonalAssignment ? myAssignment.simTarget : null,
        myFtthTarget: hasPersonalAssignment ? myAssignment.ftthTarget : null,
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
        ownershipCategory: e.ownershipCategory || 'subordinate_task',
        // Aggregate submission status from getMyEvents — drives both
        // the "Pending review" status chip and the "needs my action"
        // red badge. Values: 'not_started' | 'in_progress' | 'submitted'
        // | 'approved' | 'rejected'.
        submissionStatus: e.submissionStatus || 'not_started',
      };
    });
  }, [myEventsData]);
  
  const updateStatusMutation = trpc.events.updateEventStatus.useMutation({
    onSuccess: () => {
      Alert.alert('Success', 'Task activated successfully! Team members can now submit sales.');
      refetchMyEvents();
      refetchEvents?.();
    },
    onError: (error) => {
      Alert.alert('Error', error.message);
    },
  });

  const handleActivateEvent = (eventId: string) => {
    if (!employee?.id) return;
    Alert.alert(
      'Activate Task?',
      'This will make the task active and visible to team members. Sales can be submitted once activated.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Activate',
          style: 'default',
          onPress: () => {
            updateStatusMutation.mutate({
              eventId,
              status: 'active',
              updatedBy: employee.id,
            });
          },
        },
      ]
    );
  };

  const canEditEvent = canCreateEvents(employee?.role || 'SALES_STAFF');

  const [activeCategory, setActiveCategory] = useState<'all' | 'created_by_me' | 'assigned_to_me' | 'subordinate_task' | 'draft_task'>('all');
  type StatusFilter = 'all' | 'needs_action' | 'active' | 'pending_review' | 'overdue' | 'completed';
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    created_by_me: true,
    assigned_to_me: true,
    subordinate_task: true,
    draft_task: true,
  });

  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  // ─── Per-event derived signals ─────────────────────────────────────────
  // These are the building blocks behind the status sub-filter chips AND
  // the red "needs my action" badge. Computed once per event so a single
  // pass produces both filter buckets and the action count.
  const eventSignals = useMemo(() => {
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    return new Map(events.map(e => {
      const endMs = new Date(e.dateRange.endDate).getTime();
      const startMs = new Date(e.dateRange.startDate).getTime();
      const status = e.status as EventStatus;
      const terminal = status === 'completed' || status === 'cancelled';
      const isDraft = status === 'draft';
      const isCompleted = status === 'completed';
      const isOverdue = !terminal && !isDraft && endMs < now;
      const isActive = !terminal && !isDraft && status !== 'paused' && now >= startMs && now <= endMs;
      // "Pending review" only makes sense for tasks I created — those
      // are the ones where MY action (approve/reject) unblocks the
      // submitter. For tasks assigned to me with status 'submitted',
      // the ball is in someone else's court (the creator).
      const isPendingMyReview = e.ownershipCategory === 'created_by_me' && e.submissionStatus === 'submitted';
      // "Needs my action" is the one number a manager scans first:
      //   · I have submissions waiting for my approval, OR
      //   · I'm personally on the hook for an overdue task and haven't
      //     approved/submitted yet (rejected counts — I need to fix and resubmit)
      const myWorkPending = e.ownershipCategory === 'assigned_to_me'
        && isOverdue
        && e.submissionStatus !== 'approved'
        && e.submissionStatus !== 'submitted';
      const needsMyAction = isPendingMyReview || myWorkPending;
      return [e.id, { isOverdue, isActive, isCompleted, isPendingMyReview, needsMyAction, daysToEnd: Math.floor((endMs - now) / dayMs) }] as const;
    }));
  }, [events]);

  const passesStatus = (e: EventWithOwnership, f: StatusFilter): boolean => {
    if (f === 'all') return true;
    const s = eventSignals.get(e.id);
    if (!s) return false;
    if (f === 'needs_action') return s.needsMyAction;
    if (f === 'active') return s.isActive;
    if (f === 'pending_review') return s.isPendingMyReview;
    if (f === 'overdue') return s.isOverdue;
    if (f === 'completed') return s.isCompleted;
    return true;
  };

  const filteredEvents = useMemo(() => {
    let filtered = events;

    if (searchQuery.trim()) {
      filtered = filtered.filter(e =>
        e.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        e.location.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    filtered = filtered.filter(e => passesStatus(e, statusFilter));

    return filtered.sort((a, b) => 
      new Date(b.dateRange.startDate).getTime() - new Date(a.dateRange.startDate).getTime()
    );
  }, [events, searchQuery, statusFilter, eventSignals]);

  const getEventDisplayStatus = (event: Event): { status: EventStatus | 'upcoming' | 'past'; label: string } => {
    const dbStatus = event.status as EventStatus;
    if (dbStatus && ['draft', 'paused', 'completed', 'cancelled'].includes(dbStatus)) {
      return { status: dbStatus, label: EVENT_STATUS_CONFIG[dbStatus].label };
    }
    
    const today = new Date();
    const startDate = new Date(event.dateRange.startDate);
    const endDate = new Date(event.dateRange.endDate);
    
    if (today < startDate) return { status: 'upcoming', label: 'Upcoming' };
    if (today > endDate) return { status: 'past', label: 'Past Due' };
    return { status: 'active', label: 'Active' };
  };

  const createdByMeEvents = filteredEvents.filter(e => e.ownershipCategory === 'created_by_me');
  const assignedToMeEvents = filteredEvents.filter(e => e.ownershipCategory === 'assigned_to_me');
  const subordinateEvents = filteredEvents.filter(e => e.ownershipCategory === 'subordinate_task');
  const draftEvents = filteredEvents.filter(e => e.ownershipCategory === 'draft_task');

  const categoryCounts = {
    all: filteredEvents.length,
    created_by_me: createdByMeEvents.length,
    assigned_to_me: assignedToMeEvents.length,
    subordinate_task: subordinateEvents.length,
    draft_task: draftEvents.length,
  };

  // ─── Counts for the status sub-filter chips ────────────────────────────
  // Computed against the SEARCH-filtered set (not the status-filtered
  // set) so the chip labels reflect "what's available to filter to",
  // not "what's currently shown" — otherwise selecting Overdue would
  // make the other chips read 0 and look broken.
  const searchedEvents = useMemo(() => {
    if (!searchQuery.trim()) return events;
    const q = searchQuery.toLowerCase();
    return events.filter(e =>
      e.name.toLowerCase().includes(q) || e.location.toLowerCase().includes(q),
    );
  }, [events, searchQuery]);

  const statusCounts = useMemo(() => {
    let needsAction = 0, active = 0, pendingReview = 0, overdue = 0, completed = 0;
    for (const e of searchedEvents) {
      const s = eventSignals.get(e.id);
      if (!s) continue;
      if (s.needsMyAction) needsAction++;
      if (s.isActive) active++;
      if (s.isPendingMyReview) pendingReview++;
      if (s.isOverdue) overdue++;
      if (s.isCompleted) completed++;
    }
    return { needsAction, active, pendingReview, overdue, completed, all: searchedEvents.length };
  }, [searchedEvents, eventSignals]);

  // The "needs your action" red badge on the All tab uses the count
  // computed from ALL events (ignoring search/status filters) so the
  // headline number stays stable regardless of what you're filtering.
  const needsActionTotal = useMemo(() => {
    let n = 0;
    for (const e of events) {
      const s = eventSignals.get(e.id);
      if (s?.needsMyAction) n++;
    }
    return n;
  }, [events, eventSignals]);

  // ─── Hide-empty-tabs ───────────────────────────────────────────────────
  // "All" and the active tab always render so the user never sees a
  // ghost-jump when their last task in a category gets approved.
  // Empty drafts/assigned vanish — they're noise.
  type CatKey = 'created_by_me' | 'assigned_to_me' | 'subordinate_task' | 'draft_task';
  const visibleCategories: CatKey[] = (['created_by_me', 'assigned_to_me', 'subordinate_task', 'draft_task'] as const)
    .filter(k => categoryCounts[k] > 0 || activeCategory === k);

  // If the active category just became empty (e.g. last task approved
  // and no longer matches the status filter), bounce back to All so
  // the user isn't staring at an empty pane.
  useMemo(() => {
    if (activeCategory !== 'all' && categoryCounts[activeCategory] === 0 && events.length > 0) {
      // Fire-and-forget — useState setter inside useMemo is fine here
      // because it's idempotent and we only care about the side effect.
      setActiveCategory('all');
    }
  }, [activeCategory, categoryCounts, events.length]);

  const CATEGORY_CONFIG: Record<CatKey, { label: string; short: string; color: string; bg: string }> = {
    created_by_me: { label: 'Created by Me', short: 'Created', color: '#1565C0', bg: '#E3F2FD' },
    assigned_to_me: { label: 'Assigned to Me', short: 'Assigned', color: '#2E7D32', bg: '#E8F5E9' },
    subordinate_task: { label: 'Team Tasks', short: 'Team', color: '#7B1FA2', bg: '#F3E5F5' },
    draft_task: { label: 'My Drafts', short: 'Drafts', color: '#78909C', bg: '#ECEFF1' },
  };

  return (
    <>
      <Stack.Screen 
        options={{ 
          title: 'Tasks',
          headerStyle: {
            backgroundColor: Colors.light.primary,
          },
          headerTintColor: Colors.light.background,
          headerTitleStyle: {
            fontWeight: 'bold' as const,
          },
          headerShown: true,
          headerRight: () => (
            canCreateEvents(employee?.role || 'SALES_STAFF') ? (
              <TouchableOpacity 
                onPress={() => router.push('/create-event')}
                style={styles.headerButton}
              >
                <Plus size={24} color={Colors.light.background} />
              </TouchableOpacity>
            ) : null
          ),
        }} 
      />
      <View style={styles.container}>
        <View style={styles.searchContainer}>
          <Search size={20} color={Colors.light.textSecondary} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search tasks..."
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
        </View>

        {/* Ownership tabs — single horizontally-scrollable row, with
            empty categories hidden (Drafts vanishes if you have none,
            etc.) so the eye lands on what's actionable. The All tab
            carries a small red badge with the count of tasks that need
            YOUR action — submissions to approve, plus overdue work
            personally assigned to you that still needs to ship. */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.categoryStripContent}
          style={styles.categoryStrip}
        >
          <TouchableOpacity
            style={[styles.categoryChip, activeCategory === 'all' && styles.categoryChipActive]}
            onPress={() => setActiveCategory('all')}
          >
            <Text style={[styles.categoryChipText, activeCategory === 'all' && styles.categoryChipTextActive]}>
              All ({categoryCounts.all})
            </Text>
            {needsActionTotal > 0 && (
              <View style={styles.actionBadge}>
                <Text style={styles.actionBadgeText}>
                  {needsActionTotal > 9 ? '9+' : String(needsActionTotal)}
                </Text>
              </View>
            )}
          </TouchableOpacity>
          {visibleCategories.map(key => {
            const cfg = CATEGORY_CONFIG[key];
            const active = activeCategory === key;
            return (
              <TouchableOpacity
                key={key}
                style={[styles.categoryChip, active && styles.categoryChipActive, { borderColor: cfg.color }]}
                onPress={() => setActiveCategory(key)}
              >
                <Text style={[
                  styles.categoryChipText,
                  active && styles.categoryChipTextActive,
                  active && { color: cfg.color },
                ]}>
                  {cfg.short} ({categoryCounts[key]})
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Status sub-filter chips — sit under the ownership tabs and
            slice whichever category is active by what NEEDS LOOKING AT.
            "Needs action" gets a red dot to mirror the badge above.
            Each chip hides itself when its count is 0 so the row stays
            compact (we always show "All" so the user can clear the
            filter without thinking). */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.statusStripContent}
          style={styles.statusStrip}
        >
          <TouchableOpacity
            style={[styles.statusChip, statusFilter === 'all' && styles.statusChipActive]}
            onPress={() => setStatusFilter('all')}
          >
            <Text style={[styles.statusChipText, statusFilter === 'all' && styles.statusChipTextActive]}>
              All status
            </Text>
          </TouchableOpacity>
          {statusCounts.needsAction > 0 && (
            <TouchableOpacity
              style={[
                styles.statusChip,
                statusFilter === 'needs_action' && styles.statusChipActiveDanger,
                { borderColor: '#C62828' },
              ]}
              onPress={() => setStatusFilter('needs_action')}
            >
              <View style={styles.statusDotRed} />
              <Text style={[
                styles.statusChipText,
                statusFilter === 'needs_action' ? { color: '#fff', fontWeight: '600' as const } : { color: '#C62828' },
              ]}>
                Needs action ({statusCounts.needsAction})
              </Text>
            </TouchableOpacity>
          )}
          {statusCounts.pendingReview > 0 && (
            <TouchableOpacity
              style={[styles.statusChip, statusFilter === 'pending_review' && styles.statusChipActive, { borderColor: '#E65100' }]}
              onPress={() => setStatusFilter('pending_review')}
            >
              <Inbox size={12} color={statusFilter === 'pending_review' ? '#fff' : '#E65100'} />
              <Text style={[
                styles.statusChipText,
                statusFilter === 'pending_review' ? { color: '#fff', fontWeight: '600' as const } : { color: '#E65100' },
              ]}>
                Pending review ({statusCounts.pendingReview})
              </Text>
            </TouchableOpacity>
          )}
          {statusCounts.overdue > 0 && (
            <TouchableOpacity
              style={[styles.statusChip, statusFilter === 'overdue' && styles.statusChipActive, { borderColor: '#B71C1C' }]}
              onPress={() => setStatusFilter('overdue')}
            >
              <AlertTriangle size={12} color={statusFilter === 'overdue' ? '#fff' : '#B71C1C'} />
              <Text style={[
                styles.statusChipText,
                statusFilter === 'overdue' ? { color: '#fff', fontWeight: '600' as const } : { color: '#B71C1C' },
              ]}>
                Overdue ({statusCounts.overdue})
              </Text>
            </TouchableOpacity>
          )}
          {statusCounts.active > 0 && (
            <TouchableOpacity
              style={[styles.statusChip, statusFilter === 'active' && styles.statusChipActive, { borderColor: '#2E7D32' }]}
              onPress={() => setStatusFilter('active')}
            >
              <Text style={[
                styles.statusChipText,
                statusFilter === 'active' ? { color: '#fff', fontWeight: '600' as const } : { color: '#2E7D32' },
              ]}>
                Active ({statusCounts.active})
              </Text>
            </TouchableOpacity>
          )}
          {statusCounts.completed > 0 && (
            <TouchableOpacity
              style={[styles.statusChip, statusFilter === 'completed' && styles.statusChipActive, { borderColor: '#1565C0' }]}
              onPress={() => setStatusFilter('completed')}
            >
              <CheckCircle size={12} color={statusFilter === 'completed' ? '#fff' : '#1565C0'} />
              <Text style={[
                styles.statusChipText,
                statusFilter === 'completed' ? { color: '#fff', fontWeight: '600' as const } : { color: '#1565C0' },
              ]}>
                Completed ({statusCounts.completed})
              </Text>
            </TouchableOpacity>
          )}
        </ScrollView>

        <ScrollView style={styles.scrollView}>
          {(activeCategory === 'all' || activeCategory === 'created_by_me') && createdByMeEvents.length > 0 && (
            <View style={styles.section}>
              <TouchableOpacity style={styles.sectionHeader} onPress={() => toggleSection('created_by_me')}>
                <View style={[styles.sectionIconContainer, { backgroundColor: '#E3F2FD' }]}>
                  <Edit3 size={16} color="#1565C0" />
                </View>
                <Text style={[styles.sectionTitle, { color: '#1565C0' }]}>Created by Me</Text>
                <View style={styles.sectionCountBadge}>
                  <Text style={styles.sectionCountText}>{createdByMeEvents.length}</Text>
                </View>
                {expandedSections.created_by_me ? <ChevronUp size={18} color="#1565C0" /> : <ChevronDown size={18} color="#1565C0" />}
              </TouchableOpacity>
              {expandedSections.created_by_me && createdByMeEvents.map(event => (
                <EventCard key={event.id} event={event} getDisplayStatus={getEventDisplayStatus} canEdit={canEditEvent} onActivate={event.status === 'draft' ? handleActivateEvent : undefined} />
              ))}
            </View>
          )}

          {(activeCategory === 'all' || activeCategory === 'assigned_to_me') && assignedToMeEvents.length > 0 && (
            <View style={styles.section}>
              <TouchableOpacity style={styles.sectionHeader} onPress={() => toggleSection('assigned_to_me')}>
                <View style={[styles.sectionIconContainer, { backgroundColor: '#E8F5E9' }]}>
                  <Briefcase size={16} color="#2E7D32" />
                </View>
                <Text style={[styles.sectionTitle, { color: '#2E7D32' }]}>Assigned to Me</Text>
                <View style={styles.sectionCountBadge}>
                  <Text style={styles.sectionCountText}>{assignedToMeEvents.length}</Text>
                </View>
                {expandedSections.assigned_to_me ? <ChevronUp size={18} color="#2E7D32" /> : <ChevronDown size={18} color="#2E7D32" />}
              </TouchableOpacity>
              {expandedSections.assigned_to_me && assignedToMeEvents.map(event => (
                <EventCard key={event.id} event={event} getDisplayStatus={getEventDisplayStatus} canEdit={canEditEvent} />
              ))}
            </View>
          )}

          {(activeCategory === 'all' || activeCategory === 'subordinate_task') && subordinateEvents.length > 0 && (
            <View style={styles.section}>
              <TouchableOpacity style={styles.sectionHeader} onPress={() => toggleSection('subordinate_task')}>
                <View style={[styles.sectionIconContainer, { backgroundColor: '#F3E5F5' }]}>
                  <Users size={16} color="#7B1FA2" />
                </View>
                <Text style={[styles.sectionTitle, { color: '#7B1FA2' }]}>Team Tasks</Text>
                <View style={styles.sectionCountBadge}>
                  <Text style={styles.sectionCountText}>{subordinateEvents.length}</Text>
                </View>
                {expandedSections.subordinate_task ? <ChevronUp size={18} color="#7B1FA2" /> : <ChevronDown size={18} color="#7B1FA2" />}
              </TouchableOpacity>
              {expandedSections.subordinate_task && subordinateEvents.map(event => (
                <EventCard key={event.id} event={event} getDisplayStatus={getEventDisplayStatus} canEdit={canEditEvent} />
              ))}
            </View>
          )}

          {(activeCategory === 'all' || activeCategory === 'draft_task') && draftEvents.length > 0 && (
            <View style={styles.section}>
              <TouchableOpacity style={styles.sectionHeader} onPress={() => toggleSection('draft_task')}>
                <View style={[styles.sectionIconContainer, { backgroundColor: '#ECEFF1' }]}>
                  <FileText size={16} color="#78909C" />
                </View>
                <Text style={[styles.sectionTitle, { color: '#78909C' }]}>My Drafts</Text>
                <View style={styles.sectionCountBadge}>
                  <Text style={styles.sectionCountText}>{draftEvents.length}</Text>
                </View>
                {expandedSections.draft_task ? <ChevronUp size={18} color="#78909C" /> : <ChevronDown size={18} color="#78909C" />}
              </TouchableOpacity>
              {expandedSections.draft_task && draftEvents.map(event => (
                <EventCard key={event.id} event={event} getDisplayStatus={getEventDisplayStatus} canEdit={canEditEvent} onActivate={handleActivateEvent} />
              ))}
            </View>
          )}

          {filteredEvents.length === 0 && (
            <View style={styles.emptyState}>
              <Calendar size={64} color={Colors.light.textSecondary} />
              <Text style={styles.emptyTitle}>No Tasks Found</Text>
              <Text style={styles.emptySubtitle}>
                {canCreateEvents(employee?.role || 'SALES_STAFF')
                  ? 'Tap the + button to create your first task'
                  : 'Check back later for upcoming tasks'}
              </Text>
            </View>
          )}

          {events.length > 0 && filteredEvents.length === 0 && (
            <View style={styles.emptyState}>
              <FileText size={48} color={Colors.light.textSecondary} />
              <Text style={styles.emptyTitle}>Nothing matches this filter</Text>
              <Text style={styles.emptySubtitle}>
                {statusFilter !== 'all'
                  ? 'Try clearing the status filter or switching tabs.'
                  : 'Try a different tab or clear your search.'}
              </Text>
            </View>
          )}

          <View style={styles.bottomSpacer} />
        </ScrollView>
      </View>
    </>
  );
}

// Helper functions for avatars
const AVATAR_COLORS = [
  '#E53935', '#D81B60', '#8E24AA', '#5E35B1', '#3949AB',
  '#1E88E5', '#039BE5', '#00ACC1', '#00897B', '#43A047',
  '#7CB342', '#C0CA33', '#FDD835', '#FFB300', '#FB8C00',
  '#F4511E', '#6D4C41', '#757575', '#546E7A'
];

function getInitials(name: string): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

function getAvatarColor(name: string): string {
  if (!name) return AVATAR_COLORS[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function EventCard({ event, getDisplayStatus, canEdit, onActivate }: { 
  event: Event; 
  getDisplayStatus: (e: Event) => { status: EventStatus | 'upcoming' | 'past'; label: string };
  canEdit: boolean;
  onActivate?: (eventId: string) => void;
}) {
  const router = useRouter();
  const { status, label } = getDisplayStatus(event);
  const isDraft = status === 'draft';
  
  const statusColors: Record<string, { color: string; bg: string }> = {
    draft: { color: '#78909C', bg: '#ECEFF1' },
    active: { color: '#2E7D32', bg: '#E8F5E9' },
    paused: { color: '#EF6C00', bg: '#FFF3E0' },
    completed: { color: '#1565C0', bg: '#E3F2FD' },
    cancelled: { color: '#C62828', bg: '#FFEBEE' },
    upcoming: { color: '#7B1FA2', bg: '#F3E5F5' },
    past: { color: '#546E7A', bg: '#ECEFF1' },
  };
  
  const statusColor = statusColors[status]?.color || Colors.light.textSecondary;
  const statusBg = statusColors[status]?.bg || '#F5F5F5';

  const handleEdit = (e: any) => {
    e.stopPropagation();
    router.push(`/event-detail?id=${event.id}&edit=true`);
  };

  const handleActivate = (e: any) => {
    e.stopPropagation();
    if (onActivate) {
      onActivate(event.id);
    }
  };

  return (
    <TouchableOpacity 
      style={[styles.eventCard, status === 'cancelled' && styles.eventCardCancelled, isDraft && styles.eventCardDraft]}
      onPress={() => router.push(`/event-detail?id=${event.id}`)}
    >
      {isDraft && (
        <View style={styles.draftBanner}>
          <FileText size={14} color="#78909C" />
          <Text style={styles.draftBannerText}>Draft - Complete setup to activate</Text>
        </View>
      )}
      
      <View style={styles.eventHeader}>
        <View style={{ flex: 1, marginRight: 8 }}>
          <Text style={{ fontSize: 11, fontWeight: '700' as const, color: '#1565C0', letterSpacing: 0.5, marginBottom: 2 }}>
            {getDisplayTaskId(event)}
          </Text>
          <Text style={[styles.eventName, status === 'cancelled' && styles.eventNameCancelled]}>{event.name}</Text>
        </View>
        <View style={styles.headerActions}>
          {isDraft && canEdit && (
            <TouchableOpacity onPress={handleEdit} style={styles.editButton}>
              <Edit3 size={18} color={Colors.light.primary} />
            </TouchableOpacity>
          )}
          <View style={[styles.statusBadge, { backgroundColor: statusBg }]}>
            <Text style={[styles.statusText, { color: statusColor }]}>
              {label}
            </Text>
          </View>
        </View>
      </View>
      
      <View style={styles.eventDetails}>
        <View style={styles.eventDetail}>
          <MapPin size={16} color={Colors.light.textSecondary} />
          <Text style={styles.eventDetailText} numberOfLines={1}>{event.location}</Text>
        </View>
        {/* Tier C polish — date + SLA pill share one row with the pill
            right-aligned. Earlier the pill sat as its own row underneath,
            which (a) made the card taller for no reason and (b) visually
            separated two pieces of information that managers always read
            together ("when is it due?" + "how urgent is that?"). The pill
            is hidden on terminal statuses where remaining-time is meaningless,
            so the row gracefully collapses back to just the date when a task
            closes out. */}
        <View style={[styles.eventDetail, { justifyContent: 'space-between' }]}>
          <View style={[styles.eventDetail, { flexShrink: 1 }]}>
            <Calendar size={16} color={Colors.light.textSecondary} />
            <Text style={styles.eventDetailText} numberOfLines={1}>
              {new Date(event.dateRange.startDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} - {new Date(event.dateRange.endDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
            </Text>
          </View>
          {(() => {
            if (status === 'completed' || status === 'cancelled' || status === 'past') return null;
            const end = new Date(event.dateRange.endDate);
            const now = new Date();
            const ms = end.getTime() - now.getTime();
            const dayMs = 24 * 60 * 60 * 1000;
            const days = Math.floor(Math.abs(ms) / dayMs);
            const hours = Math.floor((Math.abs(ms) % dayMs) / (60 * 60 * 1000));
            let label: string; let pillColor: string; let pillBg: string;
            if (ms < 0) {
              label = days > 0 ? `Overdue ${days}d` : `Overdue ${hours}h`;
              pillColor = '#B71C1C'; pillBg = '#FFCDD2';
            } else if (ms < dayMs) {
              label = `Due in ${hours}h`;
              pillColor = '#C62828'; pillBg = '#FFEBEE';
            } else if (ms < 3 * dayMs) {
              label = `Due in ${days}d`; pillColor = '#E65100'; pillBg = '#FFF3E0';
            } else if (ms < 7 * dayMs) {
              label = `Due in ${days}d`; pillColor = '#EF6C00'; pillBg = '#FFF3E0';
            } else {
              label = `Due in ${days}d`; pillColor = '#2E7D32'; pillBg = '#E8F5E9';
            }
            return (
              <View style={[styles.slaPill, { backgroundColor: pillBg }]}>
                <Clock size={12} color={pillColor} />
                <Text style={[styles.slaPillText, { color: pillColor }]}>{label}</Text>
              </View>
            );
          })()}
        </View>
      </View>

      {/* Creator Info */}
      {event.creatorName && (
        <View style={styles.creatorRow}>
          <Text style={styles.creatorLabel}>Created by:</Text>
          <View style={styles.creatorInfo}>
            <View style={[styles.miniAvatar, { backgroundColor: getAvatarColor(event.creatorName) }]}>
              <Text style={styles.miniAvatarText}>{getInitials(event.creatorName)}</Text>
            </View>
            <Text style={styles.creatorName}>{event.creatorName}</Text>
          </View>
        </View>
      )}

      {event.teamMembers && event.teamMembers.length > 0 && (
        <View style={styles.teamDetailSection}>
          <Text style={styles.teamDetailLabel}>Team ({event.teamMembers.length})</Text>
          {event.teamMembers.map((member: any) => {
            const t = member.targets || {};
            const p = member.progress || {};
            const chips: { label: string; value: string }[] = [];
            if (t.sim > 0) chips.push({ label: 'SIM', value: `${p.simSold ?? 0}/${t.sim}` });
            if (t.ftth > 0) chips.push({ label: 'FTTH', value: `${p.ftthSold ?? 0}/${t.ftth}` });
            if (t.lease > 0) chips.push({ label: 'LC', value: `${p.lease ?? 0}/${t.lease}` });
            if (t.btsDown > 0) chips.push({ label: 'BTS', value: `${p.btsDown ?? 0}/${t.btsDown}` });
            if (t.routeFail > 0) chips.push({ label: 'RF', value: `${p.routeFail ?? 0}/${t.routeFail}` });
            if (t.ftthDown > 0) chips.push({ label: 'FD', value: `${p.ftthDown ?? 0}/${t.ftthDown}` });
            if (t.ofcFail > 0) chips.push({ label: 'OFC', value: `${p.ofcFail ?? 0}/${t.ofcFail}` });
            if (t.eb > 0) chips.push({ label: 'EB', value: `${p.eb ?? 0}/${t.eb}` });

            return (
              <View key={member.persNo} style={styles.teamMemberDetailRow}>
                <View style={[styles.miniAvatar, { backgroundColor: getAvatarColor(member.name) }]}>
                  <Text style={styles.miniAvatarText}>{getInitials(member.name)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.memberDetailName} numberOfLines={1}>{member.name}</Text>
                </View>
                {chips.length > 0 && (
                  <View style={styles.memberChipsRow}>
                    {chips.map(c => (
                      <Text key={c.label} style={styles.memberChip}>{c.label}: {c.value}</Text>
                    ))}
                  </View>
                )}
              </View>
            );
          })}
        </View>
      )}

      <View style={styles.eventCategory}>
        <Text style={styles.categoryText}>{event.category}</Text>
      </View>

      {/* Overall progress — derived locally from the per-category target/completed
          pairs already on the event row; a single number managers can scan in
          a list. Only renders when at least one category has a target > 0. */}
      {(() => {
        const pairs: { tgt: number; done: number }[] = [
          { tgt: event.targetSim ?? 0,           done: event.simsSold ?? 0 },
          { tgt: event.targetFtth ?? 0,          done: event.ftthSold ?? 0 },
          { tgt: event.targetEb ?? 0,            done: event.ebCompleted ?? 0 },
          { tgt: event.targetLease ?? 0,         done: event.leaseCompleted ?? 0 },
          { tgt: event.targetBtsDown ?? 0,       done: event.btsDownCompleted ?? 0 },
          { tgt: event.targetFtthDown ?? 0,      done: event.ftthDownCompleted ?? 0 },
          { tgt: event.targetRouteFail ?? 0,     done: event.routeFailCompleted ?? 0 },
          { tgt: event.targetOfcFail ?? 0,       done: event.ofcFailCompleted ?? 0 },
        ].filter(p => p.tgt > 0);
        if (pairs.length === 0) return null;
        const pcts = pairs.map(p => Math.min(100, Math.round((p.done / p.tgt) * 100)));
        const overallPct = Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length);
        const barColor =
          overallPct >= 100 ? '#1565C0' :
          overallPct >= 75  ? '#2E7D32' :
          overallPct >= 40  ? '#EF6C00' : '#C62828';
        return (
          <View style={styles.progressOverallWrap}>
            <View style={styles.progressOverallHeader}>
              <Text style={styles.progressOverallLabel}>
                {event.ownershipCategory === 'assigned_to_me' ? 'Team Progress' : 'Overall Progress'}
              </Text>
              <Text style={[styles.progressOverallValue, { color: barColor }]}>{overallPct}%</Text>
            </View>
            <View style={styles.progressBarTrack}>
              <View style={[styles.progressBarFill, { width: `${overallPct}%`, backgroundColor: barColor }]} />
            </View>
          </View>
        );
      })()}

      {(() => {
        const isMyTask = event.ownershipCategory === 'assigned_to_me';
        const mySimTarget = (event as any).mySimTarget;
        const myFtthTarget = (event as any).myFtthTarget;
        const showSIM = isMyTask && mySimTarget !== null ? mySimTarget > 0 : event.category?.includes('SIM');
        const showFTTH = isMyTask && myFtthTarget !== null 
          ? myFtthTarget > 0 
          : (event.category?.includes('FTTH') && !event.category?.includes('FTTH_DOWN'));
        
        if (!showSIM && !showFTTH) return null;
        
        return (
          <View style={styles.eventTargets}>
            {showSIM && (
              <View style={styles.targetItem}>
                <Text style={styles.targetLabel}>{isMyTask ? 'My SIM' : 'SIM Progress'}</Text>
                <View style={styles.progressRow}>
                  <Text style={styles.targetValue}>{event.simsSold ?? 0}</Text>
                  <Text style={styles.targetDivider}>/</Text>
                  <Text style={styles.targetTotal}>
                    {isMyTask && mySimTarget !== null ? mySimTarget : (event.allocatedSim || event.targetSim)}
                  </Text>
                </View>
              </View>
            )}
            {showFTTH && (
              <View style={styles.targetItem}>
                <Text style={styles.targetLabel}>{isMyTask ? 'My FTTH' : 'FTTH Progress'}</Text>
                <View style={styles.progressRow}>
                  <Text style={styles.targetValue}>{event.ftthSold ?? 0}</Text>
                  <Text style={styles.targetDivider}>/</Text>
                  <Text style={styles.targetTotal}>
                    {isMyTask && myFtthTarget !== null ? myFtthTarget : (event.allocatedFtth || event.targetFtth)}
                  </Text>
                </View>
              </View>
            )}
          </View>
        );
      })()}

      {isDraft && canEdit && (
        <View style={styles.quickActions}>
          <TouchableOpacity style={styles.quickActionButton} onPress={handleEdit}>
            <Edit3 size={16} color={Colors.light.primary} />
            <Text style={styles.quickActionText}>Edit Details</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.quickActionButtonPrimary} onPress={handleActivate}>
            <Zap size={16} color="#fff" />
            <Text style={styles.quickActionTextPrimary}>Activate Task</Text>
          </TouchableOpacity>
        </View>
      )}
    </TouchableOpacity>
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
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.light.background,
    margin: 16,
    marginBottom: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: Colors.light.text,
  },
  scrollView: {
    flex: 1,
  },
  section: {
    padding: 16,
    paddingTop: 8,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
    paddingVertical: 8,
  },
  sectionIconContainer: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.light.text,
  },
  sectionCountBadge: {
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  sectionCountText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: '#374151',
  },
  categoryStrip: {
    flexGrow: 0,
    paddingVertical: 8,
  },
  categoryStripContent: {
    paddingHorizontal: 16,
    gap: 8,
    alignItems: 'center',
  },
  categoryChip: {
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: Colors.light.background,
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  categoryChipActive: {
    backgroundColor: '#fff',
    borderWidth: 2,
  },
  categoryChipText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: '#6B7280',
  },
  categoryChipTextActive: {
    color: Colors.light.primary,
  },
  // Red attention badge that rides on the All chip — capped at 9+ so
  // the layout never grows past two characters.
  actionBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#C62828',
    paddingHorizontal: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionBadgeText: {
    fontSize: 11,
    fontWeight: '700' as const,
    color: '#fff',
  },
  // Status sub-filter strip — shorter than the ownership chips, sits
  // immediately under them. Uses the same horizontal-scroll pattern.
  statusStrip: {
    flexGrow: 0,
    paddingBottom: 8,
  },
  statusStripContent: {
    paddingHorizontal: 16,
    gap: 6,
    alignItems: 'center',
  },
  statusChip: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 14,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statusChipActive: {
    backgroundColor: Colors.light.primary,
    borderColor: Colors.light.primary,
  },
  statusChipActiveDanger: {
    backgroundColor: '#C62828',
    borderColor: '#C62828',
  },
  statusChipText: {
    fontSize: 12,
    fontWeight: '500' as const,
    color: '#6B7280',
  },
  statusChipTextActive: {
    color: '#fff',
    fontWeight: '600' as const,
  },
  statusDotRed: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#C62828',
  },
  eventCard: {
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
  eventCardCancelled: {
    opacity: 0.7,
  },
  eventCardDraft: {
    borderWidth: 2,
    borderColor: '#CFD8DC',
    borderStyle: 'dashed',
  },
  draftBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ECEFF1',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    marginBottom: 12,
    gap: 8,
  },
  draftBannerText: {
    fontSize: 12,
    color: '#78909C',
    fontWeight: '500' as const,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  editButton: {
    padding: 6,
    borderRadius: 6,
    backgroundColor: Colors.light.lightBlue,
  },
  quickActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#E0E0E0',
  },
  quickActionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.light.primary,
    backgroundColor: Colors.light.background,
  },
  quickActionText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.light.primary,
  },
  quickActionButtonPrimary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: Colors.light.primary,
  },
  quickActionTextPrimary: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: '#fff',
  },
  eventHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  eventName: {
    fontSize: 18,
    fontWeight: 'bold' as const,
    color: Colors.light.text,
    flex: 1,
    marginRight: 8,
  },
  eventNameCancelled: {
    textDecorationLine: 'line-through',
    color: Colors.light.textSecondary,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600' as const,
  },
  eventDetails: {
    gap: 8,
    marginBottom: 12,
  },
  eventDetail: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  eventDetailText: {
    fontSize: 14,
    color: Colors.light.textSecondary,
  },
  eventCategory: {
    backgroundColor: Colors.light.lightBlue,
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    marginBottom: 12,
  },
  progressOverallWrap: {
    marginBottom: 12,
  },
  progressOverallHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  progressOverallLabel: {
    fontSize: 12,
    color: Colors.light.textSecondary,
    fontWeight: '600' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.4,
  },
  progressOverallValue: {
    fontSize: 14,
    fontWeight: '700' as const,
  },
  progressBarTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: '#ECEFF1',
    overflow: 'hidden' as const,
  },
  progressBarFill: {
    height: '100%' as const,
    borderRadius: 3,
  },
  slaPill: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  slaPillText: {
    fontSize: 11,
    fontWeight: '700' as const,
    letterSpacing: 0.2,
  },
  categoryText: {
    fontSize: 12,
    color: Colors.light.primary,
    fontWeight: '600' as const,
  },
  eventTargets: {
    flexDirection: 'row',
    gap: 16,
  },
  targetItem: {
    flex: 1,
  },
  targetLabel: {
    fontSize: 12,
    color: Colors.light.textSecondary,
    marginBottom: 4,
  },
  targetValue: {
    fontSize: 20,
    fontWeight: 'bold' as const,
    color: Colors.light.primary,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  targetDivider: {
    fontSize: 16,
    color: Colors.light.textSecondary,
    marginHorizontal: 2,
  },
  targetTotal: {
    fontSize: 14,
    color: Colors.light.textSecondary,
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
  creatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    gap: 8,
  },
  creatorLabel: {
    fontSize: 12,
    color: Colors.light.textSecondary,
  },
  creatorInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  creatorName: {
    fontSize: 12,
    color: Colors.light.text,
    fontWeight: '500' as const,
  },
  miniAvatar: {
    width: 22,
    height: 22,
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
  },
  miniAvatarText: {
    fontSize: 10,
    fontWeight: '600' as const,
    color: '#fff',
  },
  teamAvatarsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    gap: 8,
  },
  teamLabel: {
    fontSize: 12,
    color: Colors.light.textSecondary,
  },
  avatarStack: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stackedAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  stackedAvatarText: {
    fontSize: 10,
    fontWeight: '600' as const,
    color: '#fff',
  },
  moreAvatar: {
    backgroundColor: Colors.light.textSecondary,
  },
  moreAvatarText: {
    fontSize: 9,
    fontWeight: '600' as const,
    color: '#fff',
  },
  teamDetailSection: {
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#E8EDF2',
  },
  teamDetailLabel: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.light.textSecondary,
    marginBottom: 8,
  },
  teamMemberDetailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 6,
    gap: 8,
  },
  miniAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 1,
  },
  miniAvatarText: {
    fontSize: 9,
    fontWeight: '700' as const,
    color: '#fff',
  },
  memberDetailName: {
    fontSize: 12,
    fontWeight: '500' as const,
    color: Colors.light.text,
  },
  memberChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    maxWidth: '60%' as any,
  },
  memberChip: {
    fontSize: 10,
    fontWeight: '600' as const,
    color: Colors.light.primary,
    backgroundColor: Colors.light.lightBlue || '#E3F2FD',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
  },
});
