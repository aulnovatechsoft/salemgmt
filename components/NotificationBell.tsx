import { TouchableOpacity, View, Text, StyleSheet, Animated } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/contexts/auth';
import { useEffect, useRef } from 'react';

export default function NotificationBell() {
  const router = useRouter();
  const { employee } = useAuth();
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const prevCount = useRef(0);

  const unreadCountQuery = trpc.notifications.getUnreadCount.useQuery(
    undefined,
    { 
      enabled: !!employee?.id,
      refetchInterval: 15000,
      staleTime: 10000,
      retry: 2,
    }
  );

  const unreadCount = unreadCountQuery.data?.count || 0;

  useEffect(() => {
    if (unreadCount > prevCount.current && prevCount.current > 0) {
      Animated.sequence([
        Animated.timing(scaleAnim, {
          toValue: 1.3,
          duration: 150,
          useNativeDriver: true,
        }),
        Animated.timing(scaleAnim, {
          toValue: 1,
          duration: 150,
          useNativeDriver: true,
        }),
      ]).start();
    }
    prevCount.current = unreadCount;
  }, [unreadCount, scaleAnim]);

  return (
    <TouchableOpacity 
      style={styles.container}
      onPress={() => router.push('/notifications')}
      activeOpacity={0.7}
      accessibilityLabel={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ''}`}
      accessibilityRole="button"
    >
      <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
        <Ionicons 
          name={unreadCount > 0 ? "notifications" : "notifications-outline"} 
          size={24} 
          color="#ffffff" 
        />
      </Animated.View>
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
    marginRight: 8,
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
