import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Plus, AlertCircle, Clock, CheckCircle, XCircle } from 'lucide-react-native';
import { useAuth } from '@/contexts/auth';
import { useApp } from '@/contexts/app';
import Colors from '@/constants/colors';
import { useMemo } from 'react';
import { Issue } from '@/types';
import { ISSUE_TYPES } from '@/constants/app';

export default function IssuesScreen() {
  const router = useRouter();
  const { employee } = useAuth();
  const { issues, events, employees, updateIssue } = useApp();

  const myIssues = useMemo(() => {
    if (employee?.role === 'SALES_STAFF') {
      return issues.filter(i => i.raisedBy === employee.id);
    }
    return issues.filter(i => i.escalatedTo === employee?.id);
  }, [issues, employee]);

  const openIssues = myIssues.filter(i => i.status === 'OPEN' || i.status === 'IN_PROGRESS');
  const closedIssues = myIssues.filter(i => i.status === 'RESOLVED' || i.status === 'CLOSED');

  const handleResolveIssue = async (issueId: string) => {
    Alert.alert(
      'Resolve Issue',
      'Mark this issue as resolved?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Resolve',
          onPress: async () => {
            await updateIssue(issueId, {
              status: 'RESOLVED',
              resolvedBy: employee?.id,
              resolvedAt: new Date().toISOString(),
            });
            Alert.alert('Success', 'Issue marked as resolved');
          },
        },
      ]
    );
  };

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
            employee?.role === 'SALES_STAFF' ? (
              <TouchableOpacity 
                onPress={() => router.push('/raise-issue')}
                style={styles.headerButton}
              >
                <Plus size={24} color={Colors.light.background} />
              </TouchableOpacity>
            ) : null
          ),
        }} 
      />
      <ScrollView style={styles.container}>
        {openIssues.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Open Issues</Text>
            {openIssues.map(issue => {
              const event = events.find(e => e.id === issue.eventId);
              const raisedByUser = employees.find(emp => emp.id === issue.raisedBy);
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
            <Text style={styles.sectionTitle}>Resolved Issues</Text>
            {closedIssues.map(issue => {
              const event = events.find(e => e.id === issue.eventId);
              const raisedByUser = employees.find(emp => emp.id === issue.raisedBy);
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
  issue: Issue; 
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
    }
  };

  const getStatusColor = () => {
    switch (issue.status) {
      case 'OPEN': return { bg: '#FFEBEE', text: Colors.light.error };
      case 'IN_PROGRESS': return { bg: '#FFF3E0', text: Colors.light.warning };
      case 'RESOLVED': return { bg: '#E8F5E9', text: Colors.light.success };
      case 'CLOSED': return { bg: '#F5F5F5', text: Colors.light.textSecondary };
    }
  };

  const statusColor = getStatusColor();
  const issueTypeLabel = ISSUE_TYPES.find(t => t.value === issue.type)?.label || issue.type;

  return (
    <View style={styles.issueCard}>
      <View style={styles.issueHeader}>
        <View style={styles.issueTypeContainer}>
          <Text style={styles.issueType}>{issueTypeLabel}</Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: statusColor.bg }]}>
          {getStatusIcon()}
          <Text style={[styles.statusText, { color: statusColor.text }]}>
            {issue.status.replace('_', ' ')}
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

      {issue.timeline.length > 0 && (
        <View style={styles.timeline}>
          <Text style={styles.timelineTitle}>Timeline:</Text>
          {issue.timeline.map((item, index) => (
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

      {canResolve && (issue.status === 'OPEN' || issue.status === 'IN_PROGRESS') && (
        <TouchableOpacity style={styles.resolveButton} onPress={onResolve}>
          <CheckCircle size={20} color={Colors.light.background} />
          <Text style={styles.resolveButtonText}>Mark as Resolved</Text>
        </TouchableOpacity>
      )}
    </View>
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
  section: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold' as const,
    color: Colors.light.text,
    marginBottom: 12,
  },
  issueCard: {
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
  issueHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  issueTypeContainer: {
    backgroundColor: Colors.light.lightBlue,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  issueType: {
    fontSize: 12,
    color: Colors.light.primary,
    fontWeight: '600' as const,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    gap: 6,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600' as const,
    textTransform: 'capitalize' as const,
  },
  eventName: {
    fontSize: 14,
    color: Colors.light.textSecondary,
    marginBottom: 8,
  },
  issueDescription: {
    fontSize: 16,
    color: Colors.light.text,
    lineHeight: 24,
    marginBottom: 12,
  },
  raisedBy: {
    fontSize: 13,
    color: Colors.light.textSecondary,
    marginBottom: 4,
  },
  issueDate: {
    fontSize: 12,
    color: Colors.light.textSecondary,
  },
  timeline: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
  },
  timelineTitle: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.light.text,
    marginBottom: 12,
  },
  timelineItem: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  timelineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.light.primary,
    marginTop: 6,
    marginRight: 12,
  },
  timelineContent: {
    flex: 1,
  },
  timelineAction: {
    fontSize: 14,
    color: Colors.light.text,
    marginBottom: 2,
  },
  timelineDate: {
    fontSize: 12,
    color: Colors.light.textSecondary,
  },
  resolveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.light.success,
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 12,
    gap: 8,
  },
  resolveButtonText: {
    color: Colors.light.background,
    fontSize: 16,
    fontWeight: '600' as const,
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
