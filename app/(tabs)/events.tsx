import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Plus, Search, Calendar, MapPin, Users, Play, Pause, CheckCircle, XCircle, FileText, Edit3, ChevronRight, Zap } from 'lucide-react-native';
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
  const { events, refetchEvents } = useApp();
  const [searchQuery, setSearchQuery] = useState('');
  
  const updateStatusMutation = trpc.events.updateEventStatus.useMutation({
    onSuccess: () => {
      Alert.alert('Success', 'Work activated successfully! Team members can now submit sales.');
      refetchEvents?.();
    },
    onError: (error) => {
      Alert.alert('Error', error.message);
    },
  });

  const handleActivateEvent = (eventId: string) => {
    if (!employee?.id) return;
    Alert.alert(
      'Activate Work?',
      'This will make the work active and visible to team members. Sales can be submitted once activated.',
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

  const filteredEvents = useMemo(() => {
    let filtered = events;

    // Management roles (GM, CGM, DGM, AGM) see all events
    // SD_JTO sees events in their circle or assigned to them
    // SALES_STAFF only sees events they're specifically assigned to
    const managementRoles = ['GM', 'CGM', 'DGM', 'AGM'];
    const isManagement = managementRoles.includes(employee?.role || '');
    const isSalesStaff = employee?.role === 'SALES_STAFF';
    
    if (!isManagement) {
      filtered = filtered.filter(e => {
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
    }

    if (searchQuery.trim()) {
      filtered = filtered.filter(e =>
        e.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        e.location.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    return filtered.sort((a, b) => 
      new Date(b.dateRange.startDate).getTime() - new Date(a.dateRange.startDate).getTime()
    );
  }, [events, employee, searchQuery]);

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

  const draftEvents = filteredEvents.filter(e => e.status === 'draft');
  const activeEvents = filteredEvents.filter(e => {
    const status = e.status as EventStatus;
    if (status === 'draft' || status === 'paused' || status === 'completed' || status === 'cancelled') return false;
    const today = new Date();
    const startDate = new Date(e.dateRange.startDate);
    const endDate = new Date(e.dateRange.endDate);
    return startDate <= today && endDate >= today;
  });
  const pausedEvents = filteredEvents.filter(e => e.status === 'paused');
  const upcomingEvents = filteredEvents.filter(e => {
    const status = e.status as EventStatus;
    if (status === 'draft' || status === 'paused' || status === 'completed' || status === 'cancelled') return false;
    const today = new Date();
    const startDate = new Date(e.dateRange.startDate);
    return startDate > today;
  });
  const completedEvents = filteredEvents.filter(e => e.status === 'completed');
  const cancelledEvents = filteredEvents.filter(e => e.status === 'cancelled');
  const pastEvents = filteredEvents.filter(e => {
    const status = e.status as EventStatus;
    if (status === 'draft' || status === 'paused' || status === 'completed' || status === 'cancelled') return false;
    const today = new Date();
    const endDate = new Date(e.dateRange.endDate);
    return endDate < today;
  });

  return (
    <>
      <Stack.Screen 
        options={{ 
          title: 'Works',
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
            placeholder="Search works..."
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
        </View>

        <ScrollView style={styles.scrollView}>
          {draftEvents.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <FileText size={18} color="#78909C" />
                <Text style={styles.sectionTitle}>Draft Works ({draftEvents.length})</Text>
              </View>
              {draftEvents.map(event => (
                <EventCard key={event.id} event={event} getDisplayStatus={getEventDisplayStatus} canEdit={canEditEvent} onActivate={handleActivateEvent} />
              ))}
            </View>
          )}

          {activeEvents.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Play size={18} color="#2E7D32" />
                <Text style={styles.sectionTitle}>Active Works ({activeEvents.length})</Text>
              </View>
              {activeEvents.map(event => (
                <EventCard key={event.id} event={event} getDisplayStatus={getEventDisplayStatus} canEdit={canEditEvent} />
              ))}
            </View>
          )}

          {pausedEvents.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Pause size={18} color="#EF6C00" />
                <Text style={styles.sectionTitle}>Paused Works ({pausedEvents.length})</Text>
              </View>
              {pausedEvents.map(event => (
                <EventCard key={event.id} event={event} getDisplayStatus={getEventDisplayStatus} canEdit={canEditEvent} />
              ))}
            </View>
          )}

          {upcomingEvents.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Calendar size={18} color="#7B1FA2" />
                <Text style={styles.sectionTitle}>Upcoming Works ({upcomingEvents.length})</Text>
              </View>
              {upcomingEvents.map(event => (
                <EventCard key={event.id} event={event} getDisplayStatus={getEventDisplayStatus} canEdit={canEditEvent} />
              ))}
            </View>
          )}

          {completedEvents.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <CheckCircle size={18} color="#1565C0" />
                <Text style={styles.sectionTitle}>Completed Works ({completedEvents.length})</Text>
              </View>
              {completedEvents.map(event => (
                <EventCard key={event.id} event={event} getDisplayStatus={getEventDisplayStatus} canEdit={canEditEvent} />
              ))}
            </View>
          )}

          {pastEvents.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Calendar size={18} color="#546E7A" />
                <Text style={styles.sectionTitle}>Past Due Works ({pastEvents.length})</Text>
              </View>
              {pastEvents.map(event => (
                <EventCard key={event.id} event={event} getDisplayStatus={getEventDisplayStatus} canEdit={canEditEvent} />
              ))}
            </View>
          )}

          {cancelledEvents.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <XCircle size={18} color="#C62828" />
                <Text style={styles.sectionTitle}>Cancelled Works ({cancelledEvents.length})</Text>
              </View>
              {cancelledEvents.map(event => (
                <EventCard key={event.id} event={event} getDisplayStatus={getEventDisplayStatus} canEdit={canEditEvent} />
              ))}
            </View>
          )}

          {filteredEvents.length === 0 && (
            <View style={styles.emptyState}>
              <Calendar size={64} color={Colors.light.textSecondary} />
              <Text style={styles.emptyTitle}>No Works Found</Text>
              <Text style={styles.emptySubtitle}>
                {canCreateEvents(employee?.role || 'SALES_STAFF')
                  ? 'Tap the + button to create your first work'
                  : 'Check back later for upcoming works'}
              </Text>
            </View>
          )}

          <View style={styles.bottomSpacer} />
        </ScrollView>
      </View>
    </>
  );
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
        <View style={styles.eventDetail}>
          <Users size={16} color={Colors.light.textSecondary} />
          <Text style={styles.eventDetailText}>{event.assignedTeam.length} team members</Text>
        </View>
      </View>

      <View style={styles.eventCategory}>
        <Text style={styles.categoryText}>{event.category}</Text>
      </View>

      <View style={styles.eventTargets}>
        <View style={styles.targetItem}>
          <Text style={styles.targetLabel}>SIM Progress</Text>
          <View style={styles.progressRow}>
            <Text style={styles.targetValue}>{event.simsSold || 0}</Text>
            <Text style={styles.targetDivider}>/</Text>
            <Text style={styles.targetTotal}>{event.allocatedSim || event.targetSim}</Text>
          </View>
        </View>
        <View style={styles.targetItem}>
          <Text style={styles.targetLabel}>FTTH Progress</Text>
          <View style={styles.progressRow}>
            <Text style={styles.targetValue}>{event.ftthSold || 0}</Text>
            <Text style={styles.targetDivider}>/</Text>
            <Text style={styles.targetTotal}>{event.allocatedFtth || event.targetFtth}</Text>
          </View>
        </View>
      </View>

      {isDraft && canEdit && (
        <View style={styles.quickActions}>
          <TouchableOpacity style={styles.quickActionButton} onPress={handleEdit}>
            <Edit3 size={16} color={Colors.light.primary} />
            <Text style={styles.quickActionText}>Edit Details</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.quickActionButtonPrimary} onPress={handleActivate}>
            <Zap size={16} color="#fff" />
            <Text style={styles.quickActionTextPrimary}>Activate Work</Text>
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
    gap: 8,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold' as const,
    color: Colors.light.text,
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
});
