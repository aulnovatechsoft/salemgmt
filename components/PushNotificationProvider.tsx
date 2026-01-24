import { useEffect } from 'react';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { useAuth } from '@/contexts/auth';

export function PushNotificationProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  
  if (isAuthenticated) {
    return <PushNotificationInitializer>{children}</PushNotificationInitializer>;
  }
  
  return <>{children}</>;
}

function PushNotificationInitializer({ children }: { children: React.ReactNode }) {
  const { expoPushToken, notification } = usePushNotifications();
  
  useEffect(() => {
    if (expoPushToken) {
      console.log('Push notifications initialized with token:', expoPushToken.substring(0, 20) + '...');
    }
  }, [expoPushToken]);

  useEffect(() => {
    if (notification) {
      console.log('New notification received in app');
    }
  }, [notification]);
  
  return <>{children}</>;
}
