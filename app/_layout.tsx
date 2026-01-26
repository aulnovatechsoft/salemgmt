// template
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect } from "react";
import { View, Image, Text, StyleSheet, ActivityIndicator } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { AuthProvider } from "@/contexts/auth";
import { AppProvider } from "@/contexts/app";
import { trpc, trpcClient } from "@/lib/trpc";
import Colors from "@/constants/colors";

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

function LoadingScreen() {
  return (
    <View style={styles.loadingContainer}>
      <View style={styles.logoContainer}>
        <Image
          source={{ uri: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3d/BSNL_Logo.svg/1200px-BSNL_Logo.svg.png' }}
          style={styles.logo}
          resizeMode="contain"
        />
      </View>
      <Text style={styles.appName}>BSNL Sales & Event App</Text>
      <ActivityIndicator size="large" color={Colors.light.primary} style={styles.loader} />
    </View>
  );
}

function RootLayoutNav() {
  return (
    <Stack screenOptions={{ headerBackTitle: "Back" }}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="event-detail" options={{ headerShown: true }} />
      <Stack.Screen name="event-sales" options={{ headerShown: true }} />
      <Stack.Screen name="sales-approval" options={{ headerShown: true }} />
      <Stack.Screen name="resource-management" options={{ headerShown: true }} />
    </Stack>
  );
}

export default function RootLayout() {
  useEffect(() => {
    SplashScreen.hideAsync();
  }, []);

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <AppProvider>
            <GestureHandlerRootView>
              <RootLayoutNav />
            </GestureHandlerRootView>
          </AppProvider>
        </AuthProvider>
      </QueryClientProvider>
    </trpc.Provider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#ffffff',
  },
  logoContainer: {
    width: 180,
    height: 180,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  logo: {
    width: 140,
    height: 140,
  },
  appName: {
    fontSize: 22,
    fontWeight: 'bold' as const,
    color: '#1a1a2e',
    marginTop: 24,
  },
  loader: {
    marginTop: 32,
  },
});
