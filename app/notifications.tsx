import { View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useState, useCallback, useMemo } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/contexts/auth';
import { trpc } from '@/lib/trpc';

type NotificationType = 
  | 'EVENT_ASSIGNED'
  | 'EVENT_STATUS_CHANGED'
  | 'ISSUE_RAISED'
  | 'ISSUE_ESCALATED'
  | 'ISSUE_RESOLVED'
  | 'ISSUE_STATUS_CHANGED'
  | 'SUBTASK_ASSIGNED'
  | 'SUBTASK_DUE_SOON'
  | 'SUBTASK_OVERDUE'
  | 'SUBTASK_COMPLETED';

interface Notification {
  id: string;
  recipientId: string;
  type: NotificationType;
  title: string;
  message: string;
  entityType: string | null;
  entityId: string | null;
  isRead: boolean;
  readAt: Date | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

const getNotificationIcon = (type: NotificationType): { name: keyof typeof Ionicons.glyphMap; color: string } => {
  switch (type) {
    case 'EVENT_ASSIGNED':
    case 'EVENT_STATUS_CHANGED':
      return { name: 'calendar', color: '#3b82f6' };
    case 'ISSUE_RAISED':
    case 'ISSUE_ESCALATED':
      return { name: 'alert-circle', color: '#ef4444' };
    case 'ISSUE_RESOLVED':
    case 'ISSUE_STATUS_CHANGED':
      return { name: 'checkmark-circle', color: '#22c55e' };
    case 'SUBTASK_ASSIGNED':
      return { name: 'list', color: '#8b5cf6' };
    case 'SUBTASK_DUE_SOON':
    case 'SUBTASK_OVERDUE':
      return { name: 'time', color: '#f59e0b' };
    case 'SUBTASK_COMPLETED':
      return { name: 'checkmark-done', color: '#22c55e' };
    default:
      return { name: 'notifications', color: '#6b7280' };
  }
};

const formatTimeAgo = (date: Date): string => {
  const now = new Date();
  const diffMs = now.getTime() - new Date(date).getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(date).toLocaleDateString();
};

export default function NotificationsScreen() {
  const router = useRouter();
  const { employee } = useAuth();
  const [refreshing, setRefreshing] = useState(false);

  const notificationsQuery = trpc.notifications.getAll.useQuery(
    { limit: 50 },
    { enabled: !!employee?.id }
  );

  const markAsReadMutation = trpc.notifications.markAsRead.useMutation({
    onSuccess: () => {
      notificationsQuery.refetch();
    },
  });

  const markAllAsReadMutation = trpc.notifications.markAllAsRead.useMutation({
    onSuccess: () => {
      notificationsQuery.refetch();
    },
  });

  const notifications = (notificationsQuery.data || []) as Notification[];

  const unreadCount = useMemo(() => {
    return notifications.filter(n => !n.isRead).length;
  }, [notifications]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await notificationsQuery.refetch();
    setRefreshing(false);
  }, [notificationsQuery]);

  const handleNotificationPress = async (notification: Notification) => {
    if (!notification.isRead) {
      await markAsReadMutation.mutateAsync({ notificationId: notification.id });
    }

    if (notification.entityType === 'EVENT' && notification.entityId) {
      router.push(`/event-detail?id=${notification.entityId}`);
    } else if (notification.entityType === 'ISSUE' && notification.entityId) {
      router.push('/(tabs)/issues');
    } else if (notification.entityType === 'SUBTASK' && notification.entityId) {
      router.push('/(tabs)/events');
    }
  };

  const handleMarkAllAsRead = async () => {
    if (employee?.id && unreadCount > 0) {
      await markAllAsReadMutation.mutateAsync();
    }
  };

  const renderNotification = ({ item }: { item: Notification }) => {
    const icon = getNotificationIcon(item.type);
    
    return (
      <TouchableOpacity 
        style={[styles.notificationItem, !item.isRead && styles.unreadNotification]}
        onPress={() => handleNotificationPress(item)}
        activeOpacity={0.7}
      >
        <View style={[styles.iconContainer, { backgroundColor: `${icon.color}20` }]}>
          <Ionicons name={icon.name} size={24} color={icon.color} />
        </View>
        <View style={styles.contentContainer}>
          <View style={styles.titleRow}>
            <Text style={[styles.title, !item.isRead && styles.unreadTitle]} numberOfLines={1}>
              {item.title}
            </Text>
            {!item.isRead && <View style={styles.unreadDot} />}
          </View>
          <Text style={styles.message} numberOfLines={2}>{item.message}</Text>
          <Text style={styles.time}>{formatTimeAgo(item.createdAt)}</Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color="#9ca3af" />
      </TouchableOpacity>
    );
  };

  if (notificationsQuery.isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#3b82f6" />
        <Text style={styles.loadingText}>Loading notifications...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#1f2937" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Notifications</Text>
        {unreadCount > 0 && (
          <TouchableOpacity onPress={handleMarkAllAsRead} style={styles.markAllButton}>
            <Text style={styles.markAllText}>Mark all read</Text>
          </TouchableOpacity>
        )}
      </View>

      {unreadCount > 0 && (
        <View style={styles.unreadBanner}>
          <Ionicons name="mail-unread" size={18} color="#3b82f6" />
          <Text style={styles.unreadBannerText}>{unreadCount} unread notification{unreadCount !== 1 ? 's' : ''}</Text>
        </View>
      )}

      <FlatList
        data={notifications}
        renderItem={renderNotification}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContainer}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="notifications-off-outline" size={64} color="#d1d5db" />
            <Text style={styles.emptyTitle}>No notifications</Text>
            <Text style={styles.emptyText}>You're all caught up! New notifications will appear here.</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f3f4f6',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f3f4f6',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: '#6b7280',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingTop: 50,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  backButton: {
    padding: 8,
    marginRight: 8,
  },
  headerTitle: {
    flex: 1,
    fontSize: 20,
    fontWeight: '700',
    color: '#1f2937',
  },
  markAllButton: {
    padding: 8,
  },
  markAllText: {
    fontSize: 14,
    color: '#3b82f6',
    fontWeight: '600',
  },
  unreadBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#eff6ff',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
  },
  unreadBannerText: {
    fontSize: 14,
    color: '#3b82f6',
    fontWeight: '500',
  },
  listContainer: {
    paddingVertical: 8,
  },
  notificationItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginHorizontal: 12,
    marginVertical: 4,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  unreadNotification: {
    backgroundColor: '#f0f9ff',
    borderLeftWidth: 3,
    borderLeftColor: '#3b82f6',
  },
  iconContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  contentContainer: {
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    color: '#374151',
    flex: 1,
  },
  unreadTitle: {
    color: '#1f2937',
    fontWeight: '700',
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#3b82f6',
  },
  message: {
    fontSize: 14,
    color: '#6b7280',
    marginTop: 2,
    lineHeight: 20,
  },
  time: {
    fontSize: 12,
    color: '#9ca3af',
    marginTop: 4,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    paddingHorizontal: 32,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#6b7280',
    marginTop: 16,
  },
  emptyText: {
    fontSize: 14,
    color: '#9ca3af',
    textAlign: 'center',
    marginTop: 8,
  },
});
