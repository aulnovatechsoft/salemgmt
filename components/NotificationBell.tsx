import { TouchableOpacity, View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/contexts/auth';

export default function NotificationBell() {
  const router = useRouter();
  const { employee } = useAuth();

  const unreadCountQuery = trpc.notifications.getUnreadCount.useQuery(
    undefined,
    { 
      enabled: !!employee?.id,
      refetchInterval: 30000,
    }
  );

  const unreadCount = unreadCountQuery.data?.count || 0;

  return (
    <TouchableOpacity 
      style={styles.container}
      onPress={() => router.push('/notifications')}
      activeOpacity={0.7}
    >
      <Ionicons name="notifications-outline" size={24} color="#ffffff" />
      {unreadCount > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>
            {unreadCount > 99 ? '99+' : unreadCount}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 8,
    position: 'relative',
  },
  badge: {
    position: 'absolute',
    top: 2,
    right: 2,
    backgroundColor: '#ef4444',
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
    borderWidth: 2,
    borderColor: '#fff',
  },
  badgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },
});
