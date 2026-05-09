import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, RefreshControl, ActivityIndicator, Platform, Modal, TextInput } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Plus, AlertCircle, Clock, CheckCircle, XCircle, X } from 'lucide-react-native';
import { useAuth } from '@/contexts/auth';
import Colors from '@/constants/colors';
import { useMemo, useCallback, useState } from 'react';
import { ISSUE_TYPES } from '@/constants/app';
import { trpc } from '@/lib/trpc';

export default function IssuesScreen() {
  const router = useRouter();
  const { employee } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  // Resolve modal state — replaces the unreliable window.confirm /
  // Alert.alert([buttons]) flow that left users stuck without an actual
  // resolve. The modal also gives the resolver a place to record notes
  // (passed to the server as `remarks` and appended to the issue
  // timeline so the raiser can see WHY it was marked resolved).
  const [resolveTargetId, setResolveTargetId] = useState<string | null>(null);
  const [resolveNotes, setResolveNotes] = useState('');
  // Result toast modal — replaces window.alert (which shows the ugly
  // "<host> says" Chrome dialog) with the same in-screen Modal style
  // used everywhere else in the app.
  const [resultModal, setResultModal] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);

  const utils = trpc.useUtils();
  const { data: allIssues, isLoading, refetch } = trpc.issues.getAll.useQuery(undefined, {
    enabled: !!employee?.id,
  });

  const { data: myEventsData } = trpc.events.getMyEvents.useQuery(
    { employeeId: employee?.id || '' },
    { enabled: !!employee?.id }
  );

  const { data: allEmployees } = trpc.employees.getAll.useQuery(undefined, {
    enabled: !!employee?.id,
  });

  const closeResolveModal = useCallback(() => {
    setResolveTargetId(null);
    setResolveNotes('');
  }, []);

  const updateStatusMutation = trpc.issues.updateStatus.useMutation({
    onSuccess: async (updated) => {
      closeResolveModal();
      // Optimistic cache update so the card flips to RESOLVED instantly,
      // BEFORE the await refetch below completes. Without this, the
      // success modal pops on top of a card that still says OPEN, which
      // looks broken even though the server already accepted the change.
      if (updated?.id) {
        utils.issues.getAll.setData(undefined, (prev) => {
          if (!Array.isArray(prev)) return prev;
          return prev.map((i) => (i.id === updated.id ? { ...i, ...updated } : i));
        });
      }
      // Then re-pull from the server to pick up timeline / resolvedAt /
      // any concurrent edits. We invalidate so any other mounted
      // consumer of issues.getAll (e.g. notification badge) also refreshes.
      await utils.issues.getAll.invalidate();
      await refetch();
      // In-screen result modal (matches the rest of the app's style).
      setResultModal({ kind: 'success', message: 'Issue resolved successfully' });
    },
    onError: (error) => {
      setResultModal({ kind: 'error', message: error.message || 'Failed to resolve issue' });
    },
  });

  const myIssues = useMemo(() => {
    if (!allIssues || !employee) return [];

    if (employee.role === 'SALES_STAFF' || employee.role === 'SD_JTO') {
      // Sales staff sees issues they raised
      return allIssues.filter(i => i.raisedBy === employee.id);
    }
    // Managers see issues escalated to them OR issues they raised
    return allIssues.filter(i => i.escalatedTo === employee.id || i.raisedBy === employee.id);
  }, [allIssues, employee]);

  const openIssues = myIssues.filter(i => i.status === 'OPEN' || i.status === 'IN_PROGRESS');
  const closedIssues = myIssues.filter(i => i.status === 'RESOLVED' || i.status === 'CLOSED');

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const handleResolveIssue = (issueId: string) => {
    // Open the in-screen modal instead of using window.confirm /
    // Alert.alert([buttons]) — both are unreliable in our preview-iframe
    // / RN-Web stack and were leaving users with no working resolve
    // button. The modal also collects optional resolution notes.
    setResolveNotes('');
    setResolveTargetId(issueId);
  };

  const submitResolve = () => {
    if (!resolveTargetId || !employee?.id) return;
    updateStatusMutation.mutate({
      id: resolveTargetId,
      status: 'RESOLVED',
      updatedBy: employee.id,
      remarks: resolveNotes.trim() || undefined,
    });
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
              const escalatedToUser = getEmployeeForIssue(issue.escalatedTo);
              // Mirror the server's `updateStatus` authorization rule:
              // SALES_STAFF / SD_JTO are blocked from resolving issues
              // raised by OTHERS, but they can still resolve their own.
              // Anyone else (managers/ADMIN/CMD) can resolve. The server
              // is the actual security boundary; this is just so the UI
              // doesn't hide the button on issues the user can act on.
              const isOwnIssue = issue.raisedBy === employee?.id;
              const isSalesTier = employee?.role === 'SALES_STAFF' || employee?.role === 'SD_JTO';
              const canResolve = isOwnIssue || !isSalesTier;
              return (
                <IssueCard
                  key={issue.id}
                  issue={issue}
                  event={event}
                  raisedByUser={raisedByUser}
                  escalatedToUser={escalatedToUser}
                  canResolve={canResolve}
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
              const escalatedToUser = getEmployeeForIssue(issue.escalatedTo);
              return (
                <IssueCard
                  key={issue.id}
                  issue={issue}
                  event={event}
                  raisedByUser={raisedByUser}
                  escalatedToUser={escalatedToUser}
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

      {/* Result toast modal — same shell style as the Resolve modal,
          single OK button. Replaces window.alert. */}
      <Modal
        visible={!!resultModal}
        animationType="fade"
        transparent
        onRequestClose={() => setResultModal(null)}
      >
        <View style={styles.resultOverlay}>
          <View style={styles.resultModalCard}>
            <View style={styles.resultIconWrap}>
              {resultModal?.kind === 'success' ? (
                <CheckCircle size={36} color={Colors.light.success} />
              ) : (
                <AlertCircle size={36} color={Colors.light.error} />
              )}
            </View>
            <Text style={styles.resultTitle}>
              {resultModal?.kind === 'success' ? 'Success' : 'Something went wrong'}
            </Text>
            <Text style={styles.resultMessage}>{resultModal?.message}</Text>
            <TouchableOpacity
              style={[styles.modalConfirmBtn, { flex: 0, paddingHorizontal: 32, alignSelf: 'stretch' }]}
              onPress={() => setResultModal(null)}
            >
              <Text style={styles.modalConfirmText}>OK</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* In-screen Resolve modal — replaces the unreliable
          Alert.alert/window.confirm and adds a notes field. */}
      <Modal
        visible={!!resolveTargetId}
        animationType="slide"
        transparent
        onRequestClose={closeResolveModal}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Resolve Issue</Text>
              <TouchableOpacity onPress={closeResolveModal} disabled={updateStatusMutation.isPending}>
                <X size={24} color={Colors.light.text} />
              </TouchableOpacity>
            </View>
            <View style={styles.modalBody}>
              <Text style={styles.modalLabel}>Resolution notes (optional)</Text>
              <TextInput
                style={styles.modalTextArea}
                placeholder="Describe how the issue was resolved…"
                placeholderTextColor={Colors.light.textSecondary}
                value={resolveNotes}
                onChangeText={setResolveNotes}
                multiline
                numberOfLines={4}
                textAlignVertical="top"
                editable={!updateStatusMutation.isPending}
              />
              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={[styles.modalCancelBtn, updateStatusMutation.isPending && styles.modalBtnDisabled]}
                  onPress={closeResolveModal}
                  disabled={updateStatusMutation.isPending}
                >
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalConfirmBtn, updateStatusMutation.isPending && styles.modalBtnDisabled]}
                  onPress={submitResolve}
                  disabled={updateStatusMutation.isPending}
                >
                  {updateStatusMutation.isPending ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <>
                      <CheckCircle size={18} color="#fff" />
                      <Text style={styles.modalConfirmText}>Mark as Resolved</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

function IssueCard({ issue, event, raisedByUser, escalatedToUser, canResolve, onResolve }: {
  issue: any;
  event?: any;
  raisedByUser?: any;
  escalatedToUser?: any;
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
  // Display ID falls back to the first 8 chars of the UUID for legacy
  // rows that haven't been backfilled yet (or rows created before the
  // migration ran in dev). Always shows SOMETHING so the user has a
  // shareable handle.
  const shortId = issue.displayId || `ISS-${String(issue.id).slice(0, 8).toUpperCase()}`;

  return (
    <View style={styles.issueCard}>
      <View style={styles.issueHeader}>
        <View style={styles.issueHeaderLeft}>
          <Text style={styles.issueId}>{shortId}</Text>
          <View style={styles.issueTypeContainer}>
            <Text style={styles.issueType}>{issueTypeLabel}</Text>
          </View>
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

      {/* Always render Raised by line — fall back to "Unknown" rather
          than hiding the row when the employees lookup hasn't loaded
          or the raiser is outside the current viewer's hierarchy. */}
      <Text style={styles.raisedBy}>
        Raised by: {raisedByUser ? `${raisedByUser.name} (${raisedByUser.role})` : 'Unknown'}
      </Text>
      {escalatedToUser && (
        <Text style={styles.raisedBy}>
          Escalated to: {escalatedToUser.name} ({escalatedToUser.role})
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
    gap: 8,
  },
  issueHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 1,
  },
  issueId: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.light.textSecondary,
    letterSpacing: 0.5,
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
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  resultOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: Colors.light.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 24,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: Colors.light.text,
  },
  modalBody: {
    padding: 16,
  },
  modalLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.light.text,
    marginBottom: 8,
  },
  modalTextArea: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 14,
    borderWidth: 1,
    borderColor: '#ddd',
    fontSize: 15,
    color: Colors.light.text,
    minHeight: 100,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 20,
  },
  modalCancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    alignItems: 'center',
  },
  modalCancelText: {
    color: Colors.light.text,
    fontSize: 14,
    fontWeight: '600',
  },
  modalConfirmBtn: {
    flex: 2,
    flexDirection: 'row',
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: Colors.light.success,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  modalConfirmText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  modalBtnDisabled: {
    opacity: 0.6,
  },
  resultModalCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    margin: 24,
    alignItems: 'center',
    alignSelf: 'center',
    maxWidth: 360,
    width: '85%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
  },
  resultIconWrap: {
    marginBottom: 12,
  },
  resultTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.light.text,
    marginBottom: 8,
    textAlign: 'center',
  },
  resultMessage: {
    fontSize: 14,
    color: Colors.light.textSecondary,
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 20,
  },
});
