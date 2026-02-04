import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Plus, Search, Calendar, MapPin, Users, Play, Pause, CheckCircle, XCircle, FileText, Edit3, ChevronRight, ChevronDown, ChevronUp, Zap, Briefcase } from 'lucide-react-native';
import { useAuth } from '@/contexts/auth';
import { useApp } from '@/contexts/app';
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
  
  type EventWithOwnership = Event & { ownershipCategory: 'created_by_me' | 'assigned_to_me' | 'subordinate_task' | 'draft_task' };
  
  const events: EventWithOwnership[] = useMemo(() => {
    if (!myEventsData) return [];
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
      ownershipCategory: e.ownershipCategory || 'subordinate_task',
    }));
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
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    created_by_me: true,
    assigned_to_me: true,
    subordinate_task: true,
    draft_task: true,
  });

  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const filteredEvents = useMemo(() => {
    let filtered = events;

    if (searchQuery.trim()) {
      filtered = filtered.filter(e =>
        e.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        e.location.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    return filtered.sort((a, b) => 
      new Date(b.dateRange.startDate).getTime() - new Date(a.dateRange.startDate).getTime()
    );
  }, [events, searchQuery]);

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

  const CATEGORY_CONFIG = {
    created_by_me: { label: 'Created by Me', icon: Edit3, color: '#1565C0', bg: '#E3F2FD' },
    assigned_to_me: { label: 'Assigned to Me', icon: Users, color: '#2E7D32', bg: '#E8F5E9' },
    subordinate_task: { label: 'Team Tasks', icon: Users, color: '#7B1FA2', bg: '#F3E5F5' },
    draft_task: { label: 'My Drafts', icon: FileText, color: '#78909C', bg: '#ECEFF1' },
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

        <View style={styles.categorySummary}>
          <View style={styles.categoryChipsRow}>
            <TouchableOpacity 
              style={[styles.categoryChip, activeCategory === 'all' && styles.categoryChipActive]}
              onPress={() => setActiveCategory('all')}
            >
              <Text style={[styles.categoryChipText, activeCategory === 'all' && styles.categoryChipTextActive]}>
                All ({categoryCounts.all})
              </Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.categoryChip, activeCategory === 'created_by_me' && styles.categoryChipActive, { borderColor: '#1565C0' }]}
              onPress={() => setActiveCategory('created_by_me')}
            >
              <Text style={[styles.categoryChipText, activeCategory === 'created_by_me' && styles.categoryChipTextActive]}>
                Created ({categoryCounts.created_by_me})
              </Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.categoryChip, activeCategory === 'assigned_to_me' && styles.categoryChipActive, { borderColor: '#2E7D32' }]}
              onPress={() => setActiveCategory('assigned_to_me')}
            >
              <Text style={[styles.categoryChipText, activeCategory === 'assigned_to_me' && styles.categoryChipTextActive]}>
                Assigned ({categoryCounts.assigned_to_me})
              </Text>
            </TouchableOpacity>
          </View>
          <View style={styles.categoryChipsRow}>
            <TouchableOpacity 
              style={[styles.categoryChip, activeCategory === 'subordinate_task' && styles.categoryChipActive, { borderColor: '#7B1FA2' }]}
              onPress={() => setActiveCategory('subordinate_task')}
            >
              <Text style={[styles.categoryChipText, activeCategory === 'subordinate_task' && styles.categoryChipTextActive]}>
                Team ({categoryCounts.subordinate_task})
              </Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.categoryChip, activeCategory === 'draft_task' && styles.categoryChipActive, { borderColor: '#78909C' }]}
              onPress={() => setActiveCategory('draft_task')}
            >
              <Text style={[styles.categoryChipText, activeCategory === 'draft_task' && styles.categoryChipTextActive]}>
                Drafts ({categoryCounts.draft_task})
              </Text>
            </TouchableOpacity>
          </View>
        </View>

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

          {filteredEvents.length > 0 && activeCategory !== 'all' && categoryCounts[activeCategory] === 0 && (
            <View style={styles.emptyState}>
              <FileText size={48} color={Colors.light.textSecondary} />
              <Text style={styles.emptyTitle}>No Tasks in This Category</Text>
              <Text style={styles.emptySubtitle}>
                Try selecting a different category or "All" to see all tasks
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
        <Text style={[styles.eventName, status === 'cancelled' && styles.eventNameCancelled]}>{event.name}</Text>
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
          <Text style={styles.eventDetailText}>{event.location}</Text>
        </View>
        <View style={styles.eventDetail}>
          <Calendar size={16} color={Colors.light.textSecondary} />
          <Text style={styles.eventDetailText}>
            {new Date(event.dateRange.startDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} - {new Date(event.dateRange.endDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
          </Text>
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

      {/* Team Member Avatars */}
      {event.teamMembers && event.teamMembers.length > 0 && (
        <View style={styles.teamAvatarsRow}>
          <Text style={styles.teamLabel}>Team:</Text>
          <View style={styles.avatarStack}>
            {event.teamMembers.slice(0, 5).map((member: { persNo: string; name: string }, index: number) => (
              <View 
                key={member.persNo} 
                style={[
                  styles.stackedAvatar, 
                  { backgroundColor: getAvatarColor(member.name), marginLeft: index > 0 ? -8 : 0, zIndex: 5 - index }
                ]}
              >
                <Text style={styles.stackedAvatarText}>{getInitials(member.name)}</Text>
              </View>
            ))}
            {event.teamMembers.length > 5 && (
              <View style={[styles.stackedAvatar, styles.moreAvatar, { marginLeft: -8 }]}>
                <Text style={styles.moreAvatarText}>+{event.teamMembers.length - 5}</Text>
              </View>
            )}
          </View>
        </View>
      )}

      <View style={styles.eventCategory}>
        <Text style={styles.categoryText}>{event.category}</Text>
      </View>

      {(event.category?.includes('SIM') || (event.category?.includes('FTTH') && !event.category?.includes('FTTH_DOWN'))) && (
        <View style={styles.eventTargets}>
          {event.category?.includes('SIM') && (
            <View style={styles.targetItem}>
              <Text style={styles.targetLabel}>SIM Progress</Text>
              <View style={styles.progressRow}>
                <Text style={styles.targetValue}>{event.simsSold || 0}</Text>
                <Text style={styles.targetDivider}>/</Text>
                <Text style={styles.targetTotal}>{event.allocatedSim || event.targetSim}</Text>
              </View>
            </View>
          )}
          {event.category?.includes('FTTH') && !event.category?.includes('FTTH_DOWN') && (
            <View style={styles.targetItem}>
              <Text style={styles.targetLabel}>FTTH Progress</Text>
              <View style={styles.progressRow}>
                <Text style={styles.targetValue}>{event.ftthSold || 0}</Text>
                <Text style={styles.targetDivider}>/</Text>
                <Text style={styles.targetTotal}>{event.allocatedFtth || event.targetFtth}</Text>
              </View>
            </View>
          )}
        </View>
      )}

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
  categorySummary: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
  },
  categoryChipsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  categoryChip: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: Colors.light.background,
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
    alignItems: 'center',
  },
  categoryChipActive: {
    backgroundColor: Colors.light.primary,
    borderColor: Colors.light.primary,
  },
  categoryChipText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: '#6B7280',
  },
  categoryChipTextActive: {
    color: Colors.light.background,
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
});
