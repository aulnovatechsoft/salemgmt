import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, RefreshControl, ActivityIndicator } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Plus, AlertCircle, Clock, CheckCircle, XCircle } from 'lucide-react-native';
import { useAuth } from '@/contexts/auth';
import Colors from '@/constants/colors';
import { useMemo, useCallback, useState } from 'react';
import { ISSUE_TYPES } from '@/constants/app';
import { trpc } from '@/lib/trpc';

export default function IssuesScreen() {
  const router = useRouter();
  const { employee } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  
  // Fetch issues from database using tRPC
  const { data: allIssues, isLoading, refetch } = trpc.issues.getAll.useQuery(undefined, {
    enabled: !!employee?.id,
  });

  // Fetch events for issue context
  const { data: myEventsData } = trpc.events.getMyEvents.useQuery(
    { employeeId: employee?.id || '' },
    { enabled: !!employee?.id }
  );

  // Fetch employees for display
  const { data: allEmployees } = trpc.employees.getAll.useQuery(undefined, {
    enabled: !!employee?.id,
  });

  const updateStatusMutation = trpc.issues.updateStatus.useMutation({
    onSuccess: () => {
      Alert.alert('Success', 'Issue resolved successfully');
      refetch();
    },
    onError: (error) => {
      Alert.alert('Error', error.message || 'Failed to resolve issue');
    },
  });

  const myIssues = useMemo(() => {
    if (!allIssues || !employee) return [];
    
    if (employee.role === 'SALES_STAFF') {
      // Sales staff sees issues they raised
      return allIssues.filter(i => i.raisedBy === employee.id);
    }
    // Managers see issues escalated to them
    return allIssues.filter(i => i.escalatedTo === employee.id);
  }, [allIssues, employee]);

  const openIssues = myIssues.filter(i => i.status === 'OPEN' || i.status === 'IN_PROGRESS');
  const closedIssues = myIssues.filter(i => i.status === 'RESOLVED' || i.status === 'CLOSED');

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const handleResolveIssue = async (issueId: string) => {
    Alert.alert(
      'Resolve Issue',
      'Mark this issue as resolved?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Resolve',
          onPress: () => {
            updateStatusMutation.mutate({
              id: issueId,
              status: 'RESOLVED',
              updatedBy: employee?.id || '',
            });
          },
        },
      ]
    );
  };

  const getEventForIssue = (eventId: string | null) => {
    if (!eventId || !myEventsData?.events) return undefined;
    return myEventsData.events.find(e => e.id === eventId);
  };

  const getEmployeeForIssue = (employeeId: string | null) => {
    if (!employeeId || !allEmployees) return undefined;
    return allEmployees.find(emp => emp.id === employeeId);
  };

  if (isLoading) {
    return (
      <>
        <Stack.Screen 
          options={{ 
            title: 'Issues',
            headerStyle: { backgroundColor: Colors.light.primary },
            headerTintColor: Colors.light.background,
            headerTitleStyle: { fontWeight: 'bold' as const },
            headerShown: true,
          }} 
        />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.light.primary} />
          <Text style={styles.loadingText}>Loading issues...</Text>
        </View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen 
        options={{ 
          title: 'Issues',
          headerStyle: {
            backgroundColor: Colors.light.primary,
          },
          headerTintColor: Colors.light.background,
          headerTitleStyle: {
            fontWeight: 'bold' as const,
          },
          headerShown: true,
          headerRight: () => (
            <TouchableOpacity 
              onPress={() => router.push('/raise-issue')}
              style={styles.headerButton}
            >
              <Plus size={24} color={Colors.light.background} />
            </TouchableOpacity>
          ),
        }} 
      />
      <ScrollView 
        style={styles.container}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[Colors.light.primary]} />
        }
      >
        {openIssues.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Open Issues ({openIssues.length})</Text>
            {openIssues.map(issue => {
              const event = getEventForIssue(issue.eventId);
              const raisedByUser = getEmployeeForIssue(issue.raisedBy);
              return (
                <IssueCard 
                  key={issue.id} 
                  issue={issue} 
                  event={event}
                  raisedByUser={raisedByUser}
                  canResolve={employee?.role !== 'SALES_STAFF'}
                  onResolve={() => handleResolveIssue(issue.id)}
                />
              );
            })}
          </View>
        )}

        {closedIssues.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Resolved Issues ({closedIssues.length})</Text>
            {closedIssues.map(issue => {
              const event = getEventForIssue(issue.eventId);
              const raisedByUser = getEmployeeForIssue(issue.raisedBy);
              return (
                <IssueCard 
                  key={issue.id} 
                  issue={issue} 
                  event={event}
                  raisedByUser={raisedByUser}
                  canResolve={false}
                />
              );
            })}
          </View>
        )}

        {myIssues.length === 0 && (
          <View style={styles.emptyState}>
            <AlertCircle size={64} color={Colors.light.textSecondary} />
            <Text style={styles.emptyTitle}>No Issues</Text>
            <Text style={styles.emptySubtitle}>
              {employee?.role === 'SALES_STAFF'
                ? 'Tap the + button to raise an issue'
                : 'No issues have been escalated to you'}
            </Text>
          </View>
        )}

        <View style={styles.bottomSpacer} />
      </ScrollView>
    </>
  );
}

function IssueCard({ issue, event, raisedByUser, canResolve, onResolve }: { 
  issue: any; 
  event?: any;
  raisedByUser?: any;
  canResolve: boolean;
  onResolve?: () => void;
}) {
  const getStatusIcon = () => {
    switch (issue.status) {
      case 'OPEN': return <AlertCircle size={20} color={Colors.light.error} />;
      case 'IN_PROGRESS': return <Clock size={20} color={Colors.light.warning} />;
      case 'RESOLVED': return <CheckCircle size={20} color={Colors.light.success} />;
      case 'CLOSED': return <XCircle size={20} color={Colors.light.textSecondary} />;
      default: return <AlertCircle size={20} color={Colors.light.textSecondary} />;
    }
  };

  const getStatusColor = () => {
    switch (issue.status) {
      case 'OPEN': return { bg: '#FFEBEE', text: Colors.light.error };
      case 'IN_PROGRESS': return { bg: '#FFF3E0', text: Colors.light.warning };
      case 'RESOLVED': return { bg: '#E8F5E9', text: Colors.light.success };
      case 'CLOSED': return { bg: '#F5F5F5', text: Colors.light.textSecondary };
      default: return { bg: '#F5F5F5', text: Colors.light.textSecondary };
    }
  };

  const statusColor = getStatusColor();
  const issueTypeLabel = ISSUE_TYPES.find(t => t.value === issue.type)?.label || issue.type;
  const timeline = Array.isArray(issue.timeline) ? issue.timeline : [];

  return (
    <View style={styles.issueCard}>
      <View style={styles.issueHeader}>
        <View style={styles.issueTypeContainer}>
          <Text style={styles.issueType}>{issueTypeLabel}</Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: statusColor.bg }]}>
          {getStatusIcon()}
          <Text style={[styles.statusText, { color: statusColor.text }]}>
            {issue.status?.replace('_', ' ') || 'UNKNOWN'}
          </Text>
        </View>
      </View>

      {event && (
        <Text style={styles.eventName}>{event.name} - {event.location}</Text>
      )}

      <Text style={styles.issueDescription}>{issue.description}</Text>

      {raisedByUser && (
        <Text style={styles.raisedBy}>
          Raised by: {raisedByUser.name} ({raisedByUser.role})
        </Text>
      )}

      <Text style={styles.issueDate}>
        {new Date(issue.createdAt).toLocaleDateString('en-IN', { 
          day: 'numeric', 
          month: 'short', 
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        })}
      </Text>

      {timeline.length > 0 && (
        <View style={styles.timeline}>
          <Text style={styles.timelineTitle}>Timeline:</Text>
          {timeline.map((item: any, index: number) => (
            <View key={index} style={styles.timelineItem}>
              <View style={styles.timelineDot} />
              <View style={styles.timelineContent}>
                <Text style={styles.timelineAction}>{item.action}</Text>
                <Text style={styles.timelineDate}>
                  {new Date(item.timestamp).toLocaleDateString('en-IN', { 
                    day: 'numeric', 
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit'
                  })}
                </Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {canResolve && issue.status !== 'RESOLVED' && issue.status !== 'CLOSED' && onResolve && (
        <TouchableOpacity style={styles.resolveButton} onPress={onResolve}>
          <CheckCircle size={18} color="#fff" />
          <Text style={styles.resolveButtonText}>Mark as Resolved</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.light.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.light.background,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: Colors.light.textSecondary,
  },
  headerButton: {
    marginRight: 16,
    padding: 4,
  },
  section: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: Colors.light.text,
    marginBottom: 12,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 80,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: Colors.light.text,
    marginTop: 16,
  },
  emptySubtitle: {
    fontSize: 14,
    color: Colors.light.textSecondary,
    marginTop: 8,
    textAlign: 'center',
  },
  bottomSpacer: {
    height: 100,
  },
  issueCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderLeftWidth: 4,
    borderLeftColor: Colors.light.primary,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  issueHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  issueTypeContainer: {
    backgroundColor: '#E3F2FD',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  issueType: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.light.primary,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
  },
  eventName: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.light.primary,
    marginBottom: 8,
  },
  issueDescription: {
    fontSize: 14,
    color: Colors.light.text,
    marginBottom: 12,
    lineHeight: 20,
  },
  raisedBy: {
    fontSize: 12,
    color: Colors.light.textSecondary,
    marginBottom: 4,
  },
  issueDate: {
    fontSize: 12,
    color: Colors.light.textSecondary,
  },
  timeline: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  timelineTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.light.text,
    marginBottom: 8,
  },
  timelineItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  timelineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.light.primary,
    marginTop: 4,
    marginRight: 8,
  },
  timelineContent: {
    flex: 1,
  },
  timelineAction: {
    fontSize: 12,
    color: Colors.light.text,
  },
  timelineDate: {
    fontSize: 10,
    color: Colors.light.textSecondary,
  },
  resolveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.light.success,
    paddingVertical: 10,
    borderRadius: 8,
    marginTop: 12,
    gap: 8,
  },
  resolveButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
});
