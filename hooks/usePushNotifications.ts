import { useState, useEffect, useRef, useCallback } from 'react';
import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useAuth } from '@/contexts/auth';
import { trpc } from '@/lib/trpc';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

function isExpoGo(): boolean {
  return Constants.appOwnership === 'expo';
}

async function registerForPushNotificationsAsync(): Promise<string | null> {
  if (Platform.OS === 'web') {
    console.log('Push notifications not fully supported on web');
    return null;
  }

  if (!Device.isDevice) {
    console.log('Push notifications require a physical device');
    return null;
  }

  if (isExpoGo()) {
    console.log('Push notifications require a development build (not Expo Go)');
    return null;
  }

  if (Platform.OS === 'android') {
    try {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#3b82f6',
      });
    } catch (error) {
      console.log('Failed to set notification channel:', error);
    }
  }

  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    
    if (finalStatus !== 'granted') {
      console.log('Push notification permission not granted');
      return null;
    }

    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    
    if (!projectId) {
      console.log('No projectId found - push notifications require EAS configuration');
      return null;
    }

    const tokenData = await Notifications.getExpoPushTokenAsync({
      projectId,
    });
    return tokenData.data;
  } catch (error) {
    console.log('Push notifications not available in this environment');
    return null;
  }
}

export function usePushNotifications() {
  const [expoPushToken, setExpoPushToken] = useState<string | null>(null);
  const [notification, setNotification] = useState<Notifications.Notification | null>(null);
  const notificationListener = useRef<Notifications.Subscription | null>(null);
  const responseListener = useRef<Notifications.Subscription | null>(null);
  const tokenRegistered = useRef(false);
  const { employee } = useAuth();
  const router = useRouter();

  const registerTokenMutation = trpc.notifications.registerPushToken.useMutation({
    onSuccess: () => {
      console.log('Push token registered successfully');
      tokenRegistered.current = true;
    },
    onError: (error: unknown) => {
      console.error('Failed to register push token:', error);
      tokenRegistered.current = false;
    },
  });

  const handleNotificationNavigation = useCallback((data: Record<string, unknown>) => {
    const entityType = data?.entityType as string | undefined;
    const entityId = data?.entityId as string | undefined;
    
    if (entityType === 'EVENT' && entityId) {
      router.push(`/event-detail?id=${entityId}`);
    } else if (entityType === 'ISSUE') {
      router.push('/(tabs)/issues');
    } else if (entityType === 'SUBTASK') {
      router.push('/(tabs)/events');
    } else {
      router.push('/notifications');
    }
  }, [router]);

  useEffect(() => {
    registerForPushNotificationsAsync().then((token) => {
      if (token) {
        setExpoPushToken(token);
        console.log('Expo push token:', token);
      }
    });

    notificationListener.current = Notifications.addNotificationReceivedListener((receivedNotification) => {
      setNotification(receivedNotification);
      console.log('Notification received:', receivedNotification.request.content.title);
    });

    responseListener.current = Notifications.addNotificationResponseReceivedListener((response) => {
      console.log('Notification tapped:', response.notification.request.content.title);
      const data = response.notification.request.content.data || {};
      handleNotificationNavigation(data);
    });

    return () => {
      if (notificationListener.current) {
        notificationListener.current.remove();
      }
      if (responseListener.current) {
        responseListener.current.remove();
      }
    };
  }, [handleNotificationNavigation]);

  useEffect(() => {
    if (expoPushToken && employee?.id && !tokenRegistered.current) {
      const platform = Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web';
      registerTokenMutation.mutate({
        token: expoPushToken,
        platform,
      });
    }
  }, [expoPushToken, employee?.id]);

  return {
    expoPushToken,
    notification,
  };
}
