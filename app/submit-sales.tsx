import { useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import Colors from '@/constants/colors';

export default function SubmitSalesScreen() {
  const router = useRouter();

  useEffect(() => {
    const t = setTimeout(() => {
      router.replace('/(tabs)/my-tasks');
    }, 50);
    return () => clearTimeout(t);
  }, [router]);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Submit Sales' }} />
      <ActivityIndicator size="large" color={Colors.light.primary} />
      <Text style={styles.text}>Opening My Tasks…</Text>
      <Text style={styles.subtext}>
        Sales submission is now done from each event in the My Tasks tab.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: Colors.light.backgroundSecondary,
  },
  text: {
    marginTop: 16,
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.light.text,
  },
  subtext: {
    marginTop: 8,
    fontSize: 13,
    color: Colors.light.textSecondary,
    textAlign: 'center',
  },
});
