import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, ActivityIndicator, Modal, TextInput } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Plus, AlertCircle, Clock, CheckCircle, XCircle, X, MessageSquare, Send, Briefcase, MapPin } from 'lucide-react-native';
import { useAuth } from '@/contexts/auth';
import Colors from '@/constants/colors';
import { useMemo, useCallback, useState } from 'react';
import { ISSUE_TYPES } from '@/constants/app';
import { trpc } from '@/lib/trpc';

// ────────────────────────────────────────────────────────────────────────
// Priority styling — matches the picker on raise-issue.tsx so colours
// are consistent end-to-end. 'urgent' is red so a manager can spot it
// in a busy queue at a glance.
// ────────────────────────────────────────────────────────────────────────
const PRIORITY_STYLES: Record<string, { label: string; color: string; bg: string }> = {
  low:    { label: 'Low',    color: '#2E7D32', bg: '#E8F5E9' },
  medium: { label: 'Medium', color: '#1565C0', bg: '#E3F2FD' },
  high:   { label: 'High',   color: '#E65100', bg: '#FFF3E0' },
  urgent: { label: 'Urgent', color: '#C62828', bg: '#FFEBEE' },
};

export default function IssuesScreen() {
  const router = useRouter();
  const { employee } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  // Resolve modal state — replaces the unreliable window.confirm /
  // Alert.alert([buttons]) flow. Also collects optional resolution
  // notes that get appended to the issue timeline.
  const [resolveTargetId, setResolveTargetId] = useState<string | null>(null);
  const [resolveNotes, setResolveNotes] = useState('');
  // Withdraw modal — raiser-only. Keeps a separate state from
  // resolve so the same card can offer BOTH actions when relevant
  // (it never does today, but the separation makes intent obvious).
  const [withdrawTargetId, setWithdrawTargetId] = useState<string | null>(null);
  const [withdrawReason, setWithdrawReason] = useState('');
  // Result toast modal — replaces window.alert for both success and
  // error cases. window.alert is blocked inside the Replit preview
  // iframe and many embedded webviews.
  const [resultModal, setResultModal] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  // Which issue's comments thread is open. Single-open at a time keeps
  // the list tidy and avoids loading every thread on first render.
  const [commentsOpenForId, setCommentsOpenForId] = useState<string | null>(null);

  const utils = trpc.useUtils();
  const { data: allIssues, isLoading, refetch } = trpc.issues.getAll.useQuery(undefined, {
    enabled: !!employee?.id,
  });

  const closeResolveModal = useCallback(() => {
    setResolveTargetId(null);
    setResolveNotes('');
  }, []);
  const closeWithdrawModal = useCallback(() => {
    setWithdrawTargetId(null);
    setWithdrawReason('');
  }, []);

  const updateStatusMutation = trpc.issues.updateStatus.useMutation({
    onSuccess: async (updated) => {
      closeResolveModal();
      if (updated?.id) {
        utils.issues.getAll.setData(undefined, (prev) => {
          if (!Array.isArray(prev)) return prev;
          return prev.map((i) => (i.id === updated.id ? { ...i, ...updated } : i));
        });
      }
      await utils.issues.getAll.invalidate();
      await refetch();
      setResultModal({ kind: 'success', message: 'Issue resolved successfully' });
    },
    onError: (error) => {
      setResultModal({ kind: 'error', message: error.message || 'Failed to resolve issue' });
    },
  });

  const withdrawMutation = trpc.issues.withdraw.useMutation({
    onSuccess: async (updated) => {
      closeWithdrawModal();
      if (updated?.id) {
        utils.issues.getAll.setData(undefined, (prev) => {
          if (!Array.isArray(prev)) return prev;
          return prev.map((i) => (i.id === updated.id ? { ...i, ...updated } : i));
        });
      }
      await utils.issues.getAll.invalidate();
      await refetch();
      setResultModal({ kind: 'success', message: 'Issue withdrawn' });
    },
    onError: (error) => {
      setResultModal({ kind: 'error', message: error.message || 'Failed to withdraw issue' });
    },
  });

  const myIssues = useMemo(() => {
    if (!allIssues || !employee) return [];
    if (employee.role === 'SALES_STAFF' || employee.role === 'SD_JTO') {
      return allIssues.filter(i => i.raisedBy === employee.id);
    }
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
    setResolveNotes('');
    setResolveTargetId(issueId);
  };
  const handleWithdrawIssue = (issueId: string) => {
    setWithdrawReason('');
    setWithdrawTargetId(issueId);
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
  const submitWithdraw = () => {
    if (!withdrawTargetId) return;
    withdrawMutation.mutate({
      id: withdrawTargetId,
      reason: withdrawReason.trim() || undefined,
    });
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

  // Per-card permission rules — mirrored on the server. UI rules here
  // are purely cosmetic; the server is the actual security boundary.
  //   · canResolve: only escalated-to / task creator / task manager /
  //     ADMIN/CMD. The raiser can NOT resolve their own issue.
  //   · canWithdraw: only the raiser, and only while the issue is OPEN
  //     or IN_PROGRESS.
  //   · canComment: anyone with a card visible (i.e. anyone the server
  //     would let through loadAndAuthorize).
  const computePerms = (issue: any) => {
    const role = employee?.role;
    const isPriv = role === 'ADMIN' || role === 'CMD';
    const isRaiser = issue.raisedBy === employee?.id;
    const isEscalatedTo = issue.escalatedTo === employee?.id;
    const isCreator = issue.event?.createdBy === employee?.id;
    const isManager = issue.event?.assignedTo === employee?.id;
    const isClosed = issue.status === 'RESOLVED' || issue.status === 'CLOSED';
    return {
      canResolve: !isClosed && (isPriv || isEscalatedTo || isCreator || isManager) && !(isRaiser && !isEscalatedTo && !isCreator && !isManager && !isPriv),
      canWithdraw: !isClosed && isRaiser,
      canComment: true,
    };
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Issues',
          headerStyle: { backgroundColor: Colors.light.primary },
          headerTintColor: Colors.light.background,
          headerTitleStyle: { fontWeight: 'bold' as const },
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
              const perms = computePerms(issue);
              return (
                <IssueCard
                  key={issue.id}
                  issue={issue}
                  permissions={perms}
                  commentsOpen={commentsOpenForId === issue.id}
                  onToggleComments={() => setCommentsOpenForId(prev => prev === issue.id ? null : issue.id)}
                  onResolve={() => handleResolveIssue(issue.id)}
                  onWithdraw={() => handleWithdrawIssue(issue.id)}
                  onTaskPress={() => issue.event?.id && router.push({ pathname: '/event-detail', params: { id: issue.event.id } })}
                />
              );
            })}
          </View>
        )}

        {closedIssues.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Resolved Issues ({closedIssues.length})</Text>
            {closedIssues.map(issue => {
              const perms = computePerms(issue);
              return (
                <IssueCard
                  key={issue.id}
                  issue={issue}
                  permissions={perms}
                  commentsOpen={commentsOpenForId === issue.id}
                  onToggleComments={() => setCommentsOpenForId(prev => prev === issue.id ? null : issue.id)}
                  onTaskPress={() => issue.event?.id && router.push({ pathname: '/event-detail', params: { id: issue.event.id } })}
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

      {/* Result toast */}
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

      {/* Resolve modal */}
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

      {/* Withdraw modal */}
      <Modal
        visible={!!withdrawTargetId}
        animationType="slide"
        transparent
        onRequestClose={closeWithdrawModal}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Withdraw Issue</Text>
              <TouchableOpacity onPress={closeWithdrawModal} disabled={withdrawMutation.isPending}>
                <X size={24} color={Colors.light.text} />
              </TouchableOpacity>
            </View>
            <View style={styles.modalBody}>
              <Text style={styles.modalHint}>
                This will close the issue without a resolution. Your manager will be notified.
              </Text>
              <Text style={styles.modalLabel}>Reason (optional)</Text>
              <TextInput
                style={styles.modalTextArea}
                placeholder="e.g. resolved offline, no longer relevant…"
                placeholderTextColor={Colors.light.textSecondary}
                value={withdrawReason}
                onChangeText={setWithdrawReason}
                multiline
                numberOfLines={3}
                textAlignVertical="top"
                editable={!withdrawMutation.isPending}
              />
              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={[styles.modalCancelBtn, withdrawMutation.isPending && styles.modalBtnDisabled]}
                  onPress={closeWithdrawModal}
                  disabled={withdrawMutation.isPending}
                >
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalConfirmBtn, { backgroundColor: Colors.light.warning }, withdrawMutation.isPending && styles.modalBtnDisabled]}
                  onPress={submitWithdraw}
                  disabled={withdrawMutation.isPending}
                >
                  {withdrawMutation.isPending ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <>
                      <XCircle size={18} color="#fff" />
                      <Text style={styles.modalConfirmText}>Withdraw</Text>
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

// ────────────────────────────────────────────────────────────────────────
// IssueCard
// ────────────────────────────────────────────────────────────────────────
function IssueCard({
  issue,
  permissions,
  commentsOpen,
  onToggleComments,
  onResolve,
  onWithdraw,
  onTaskPress,
}: {
  issue: any;
  permissions: { canResolve: boolean; canWithdraw: boolean; canComment: boolean };
  commentsOpen: boolean;
  onToggleComments: () => void;
  onResolve?: () => void;
  onWithdraw?: () => void;
  onTaskPress?: () => void;
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
  const shortId = issue.displayId || `ISS-${String(issue.id).slice(0, 8).toUpperCase()}`;
  const priority = PRIORITY_STYLES[issue.priority || 'medium'] || PRIORITY_STYLES.medium;

  // Server-joined refs — these come pre-populated from `issues.getAll`
  // so the card renders with zero side-table lookups. Falls back
  // gracefully if the join missed (deleted employee, etc.).
  const event = issue.event;
  const raisedBy = issue.raisedByEmployee;
  const escalatedTo = issue.escalatedToEmployee;
  const resolvedBy = issue.resolvedByEmployee;

  return (
    <View style={styles.issueCard}>
      <View style={styles.issueHeader}>
        <View style={styles.issueHeaderLeft}>
          <Text style={styles.issueId}>{shortId}</Text>
          <View style={styles.issueTypeContainer}>
            <Text style={styles.issueType}>{issueTypeLabel}</Text>
          </View>
          <View style={[styles.priorityBadge, { backgroundColor: priority.bg }]}>
            <Text style={[styles.priorityBadgeText, { color: priority.color }]}>{priority.label}</Text>
          </View>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: statusColor.bg }]}>
          {getStatusIcon()}
          <Text style={[styles.statusText, { color: statusColor.text }]}>
            {issue.status?.replace('_', ' ') || 'UNKNOWN'}
          </Text>
        </View>
      </View>

      {/* Related task chip — every card now shows its task. Tappable
          when an event id is present so users can jump straight to
          the task page. */}
      {event ? (
        <TouchableOpacity style={styles.taskChip} onPress={onTaskPress} activeOpacity={0.7} disabled={!onTaskPress}>
          <Briefcase size={14} color={Colors.light.primary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.taskChipTitle} numberOfLines={1}>
              {event.displayId ? `${event.displayId} · ` : ''}{event.name}
            </Text>
            {event.location ? (
              <View style={styles.taskChipLocationRow}>
                <MapPin size={11} color={Colors.light.textSecondary} />
                <Text style={styles.taskChipLocation} numberOfLines={1}>{event.location}</Text>
              </View>
            ) : null}
          </View>
        </TouchableOpacity>
      ) : (
        <Text style={styles.taskChipMissing}>(Related task no longer available)</Text>
      )}

      <Text style={styles.issueDescription}>{issue.description}</Text>

      <Text style={styles.raisedBy}>
        Raised by: {raisedBy ? `${raisedBy.name} (${raisedBy.role})` : 'Unknown'}
      </Text>
      {escalatedTo && (
        <Text style={styles.raisedBy}>
          Escalated to: {escalatedTo.name} ({escalatedTo.role})
        </Text>
      )}
      {(issue.status === 'RESOLVED' || issue.status === 'CLOSED') && resolvedBy && (
        <Text style={styles.raisedBy}>
          {issue.status === 'CLOSED' ? 'Withdrawn by: ' : 'Resolved by: '}
          {resolvedBy.name} ({resolvedBy.role})
        </Text>
      )}

      <Text style={styles.issueDate}>
        {new Date(issue.createdAt).toLocaleDateString('en-IN', {
          day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
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
                    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                  })}
                </Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Actions row — Comments toggle is always present; Resolve and
          Withdraw are gated by the per-card permissions object. */}
      <View style={styles.actionsRow}>
        <TouchableOpacity style={styles.commentsToggle} onPress={onToggleComments}>
          <MessageSquare size={16} color={Colors.light.primary} />
          <Text style={styles.commentsToggleText}>{commentsOpen ? 'Hide comments' : 'Comments'}</Text>
        </TouchableOpacity>

        {permissions.canWithdraw && onWithdraw && (
          <TouchableOpacity style={styles.withdrawButton} onPress={onWithdraw}>
            <XCircle size={16} color={Colors.light.warning} />
            <Text style={styles.withdrawButtonText}>Withdraw</Text>
          </TouchableOpacity>
        )}
        {permissions.canResolve && onResolve && (
          <TouchableOpacity style={styles.resolveButton} onPress={onResolve}>
            <CheckCircle size={16} color="#fff" />
            <Text style={styles.resolveButtonText}>Mark Resolved</Text>
          </TouchableOpacity>
        )}
      </View>

      {commentsOpen && <CommentsThread issueId={issue.id} />}
    </View>
  );
}

// ────────────────────────────────────────────────────────────────────────
// CommentsThread — list + add. Only mounted when the parent card has
// the comments section open, so we don't fetch comments for issues
// the user never expands.
// ────────────────────────────────────────────────────────────────────────
function CommentsThread({ issueId }: { issueId: string }) {
  const utils = trpc.useUtils();
  const [body, setBody] = useState('');
  const { data: comments, isLoading } = trpc.issues.listComments.useQuery({ issueId });
  const addCommentMutation = trpc.issues.addComment.useMutation({
    onSuccess: async () => {
      setBody('');
      await utils.issues.listComments.invalidate({ issueId });
    },
  });

  const onSend = () => {
    const trimmed = body.trim();
    if (!trimmed) return;
    addCommentMutation.mutate({ issueId, body: trimmed });
  };

  return (
    <View style={styles.commentsBlock}>
      <Text style={styles.commentsHeader}>Discussion</Text>
      {isLoading ? (
        <ActivityIndicator color={Colors.light.primary} style={{ marginVertical: 12 }} />
      ) : !comments || comments.length === 0 ? (
        <Text style={styles.commentsEmpty}>No comments yet. Start the conversation.</Text>
      ) : (
        comments.map((c: any) => (
          <View key={c.id} style={styles.commentRow}>
            <View style={styles.commentAvatar}>
              <Text style={styles.commentAvatarText}>
                {(c.authorName || '?').charAt(0).toUpperCase()}
              </Text>
            </View>
            <View style={styles.commentBody}>
              <Text style={styles.commentAuthor}>
                {c.authorName ?? 'Unknown'}
                {c.authorRole ? ` · ${c.authorRole}` : ''}
              </Text>
              <Text style={styles.commentText}>{c.body}</Text>
              <Text style={styles.commentDate}>
                {new Date(c.createdAt).toLocaleDateString('en-IN', {
                  day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                })}
              </Text>
            </View>
          </View>
        ))
      )}

      <View style={styles.commentInputRow}>
        <TextInput
          style={styles.commentInput}
          placeholder="Add a comment…"
          placeholderTextColor={Colors.light.textSecondary}
          value={body}
          onChangeText={setBody}
          multiline
          editable={!addCommentMutation.isPending}
        />
        <TouchableOpacity
          style={[styles.commentSendBtn, (!body.trim() || addCommentMutation.isPending) && styles.commentSendBtnDisabled]}
          onPress={onSend}
          disabled={!body.trim() || addCommentMutation.isPending}
        >
          {addCommentMutation.isPending
            ? <ActivityIndicator color="#fff" />
            : <Send size={16} color="#fff" />}
        </TouchableOpacity>
      </View>
      {addCommentMutation.error && (
        <Text style={styles.commentError}>{addCommentMutation.error.message}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.light.background },
  loadingText: { marginTop: 12, fontSize: 16, color: Colors.light.textSecondary },
  headerButton: { marginRight: 16, padding: 4 },
  section: { padding: 16 },
  sectionTitle: { fontSize: 18, fontWeight: 'bold', color: Colors.light.text, marginBottom: 12 },
  emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 80 },
  emptyTitle: { fontSize: 20, fontWeight: 'bold', color: Colors.light.text, marginTop: 16 },
  emptySubtitle: { fontSize: 14, color: Colors.light.textSecondary, marginTop: 8, textAlign: 'center' },
  bottomSpacer: { height: 100 },

  issueCard: {
    backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 12,
    borderLeftWidth: 4, borderLeftColor: Colors.light.primary,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 3,
  },
  issueHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 8 },
  issueHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1, flexWrap: 'wrap' },
  issueId: { fontSize: 12, fontWeight: '700', color: Colors.light.textSecondary, letterSpacing: 0.5 },
  issueTypeContainer: { backgroundColor: '#E3F2FD', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12 },
  issueType: { fontSize: 12, fontWeight: '600', color: Colors.light.primary },
  priorityBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  priorityBadgeText: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },

  statusBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, gap: 4 },
  statusText: { fontSize: 12, fontWeight: '600' },

  taskChip: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#F5F9FF', borderRadius: 8, padding: 10,
    marginBottom: 10, borderWidth: 1, borderColor: '#E0E9F5',
  },
  taskChipTitle: { fontSize: 13, fontWeight: '600', color: Colors.light.primary },
  taskChipLocationRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  taskChipLocation: { fontSize: 11, color: Colors.light.textSecondary, flex: 1 },
  taskChipMissing: { fontSize: 12, fontStyle: 'italic', color: Colors.light.textSecondary, marginBottom: 8 },

  issueDescription: { fontSize: 14, color: Colors.light.text, marginBottom: 12, lineHeight: 20 },
  raisedBy: { fontSize: 12, color: Colors.light.textSecondary, marginBottom: 4 },
  issueDate: { fontSize: 12, color: Colors.light.textSecondary },

  timeline: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#eee' },
  timelineTitle: { fontSize: 12, fontWeight: '600', color: Colors.light.text, marginBottom: 8 },
  timelineItem: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 },
  timelineDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.light.primary, marginTop: 4, marginRight: 8 },
  timelineContent: { flex: 1 },
  timelineAction: { fontSize: 12, color: Colors.light.text },
  timelineDate: { fontSize: 10, color: Colors.light.textSecondary },

  actionsRow: {
    flexDirection: 'row', gap: 8, marginTop: 12, alignItems: 'center', flexWrap: 'wrap',
  },
  commentsToggle: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8,
    borderWidth: 1, borderColor: '#E0E9F5', backgroundColor: '#F5F9FF',
  },
  commentsToggleText: { color: Colors.light.primary, fontSize: 13, fontWeight: '600' },
  withdrawButton: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8,
    borderWidth: 1, borderColor: Colors.light.warning, backgroundColor: '#FFF8E1',
  },
  withdrawButtonText: { color: Colors.light.warning, fontSize: 13, fontWeight: '600' },
  resolveButton: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8,
    backgroundColor: Colors.light.success, marginLeft: 'auto',
  },
  resolveButtonText: { color: '#fff', fontSize: 13, fontWeight: '600' },

  // Comments
  commentsBlock: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#eee' },
  commentsHeader: { fontSize: 13, fontWeight: '700', color: Colors.light.text, marginBottom: 8 },
  commentsEmpty: { fontSize: 12, color: Colors.light.textSecondary, fontStyle: 'italic', marginBottom: 8 },
  commentRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  commentAvatar: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: Colors.light.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  commentAvatarText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  commentBody: { flex: 1 },
  commentAuthor: { fontSize: 12, fontWeight: '600', color: Colors.light.text },
  commentText: { fontSize: 13, color: Colors.light.text, marginTop: 2, lineHeight: 18 },
  commentDate: { fontSize: 10, color: Colors.light.textSecondary, marginTop: 2 },
  commentInputRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-end', marginTop: 8 },
  commentInput: {
    flex: 1, minHeight: 38, maxHeight: 120, borderWidth: 1, borderColor: '#ddd', borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 8, fontSize: 13, color: Colors.light.text, backgroundColor: '#fff',
  },
  commentSendBtn: {
    width: 38, height: 38, borderRadius: 8, backgroundColor: Colors.light.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  commentSendBtnDisabled: { backgroundColor: '#B0BEC5' },
  commentError: { fontSize: 12, color: Colors.light.error, marginTop: 4 },

  // Modals
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  resultOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  modalContent: {
    backgroundColor: Colors.light.background, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 24,
  },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 16, borderBottomWidth: 1, borderBottomColor: '#eee',
  },
  modalTitle: { fontSize: 18, fontWeight: 'bold', color: Colors.light.text },
  modalBody: { padding: 16 },
  modalHint: { fontSize: 13, color: Colors.light.textSecondary, marginBottom: 12, lineHeight: 18 },
  modalLabel: { fontSize: 14, fontWeight: '600', color: Colors.light.text, marginBottom: 8 },
  modalTextArea: {
    backgroundColor: '#fff', borderRadius: 8, padding: 14, borderWidth: 1, borderColor: '#ddd',
    fontSize: 15, color: Colors.light.text, minHeight: 100,
  },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 20 },
  modalCancelBtn: {
    flex: 1, paddingVertical: 12, borderRadius: 8, borderWidth: 1, borderColor: '#ddd', alignItems: 'center',
  },
  modalCancelText: { color: Colors.light.text, fontSize: 14, fontWeight: '600' },
  modalConfirmBtn: {
    flex: 2, flexDirection: 'row', paddingVertical: 12, borderRadius: 8,
    backgroundColor: Colors.light.success, alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  modalConfirmText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  modalBtnDisabled: { opacity: 0.6 },

  // Result modal extras
  resultModalCard: {
    width: '85%', maxWidth: 360, backgroundColor: Colors.light.background, borderRadius: 14,
    padding: 24, alignItems: 'center', gap: 12,
  },
  resultIconWrap: { marginBottom: 4 },
  resultTitle: { fontSize: 18, fontWeight: '700', color: Colors.light.text },
  resultMessage: { fontSize: 14, color: Colors.light.textSecondary, textAlign: 'center', marginBottom: 8 },
});
