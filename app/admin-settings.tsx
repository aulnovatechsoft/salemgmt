import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { Stack } from 'expo-router';
import { Upload, Users, Database, Settings as SettingsIcon } from 'lucide-react-native';
import { useApp } from '@/contexts/app';
import { useAuth } from '@/contexts/auth';
import Colors from '@/constants/colors';
import { Employee, Event, Resource } from '@/types';

export default function AdminSettingsScreen() {
  const { addEmployees, addEvent, updateResource, events, employees, resources } = useApp();
  const { employee } = useAuth();

  const loadSampleData = async () => {
    Alert.alert(
      'Load Sample Data',
      'This will add sample events and resources for testing. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Load',
          onPress: async () => {
            const sampleEvents: Event[] = [
              {
                id: '1',
                name: 'Kala Ghoda Arts Festival',
                location: 'South Mumbai',
                circle: 'MAHARASHTRA',
                zone: 'GENL-10.00-17.30-SSH',
                dateRange: {
                  startDate: '2026-01-31',
                  endDate: '2026-02-08',
                },
                category: 'Cultural',
                targetSim: 500,
                targetFtth: 100,
                assignedTeam: ['1'],
                allocatedSim: 600,
                allocatedFtth: 120,
                createdBy: employee?.id || '1',
                createdAt: new Date().toISOString(),
                keyInsight: 'Premium urban crowd + tourists; high ARPU prospects + enterprise leads',
              },
              {
                id: '2',
                name: 'Maghi Purnima Yatra',
                location: 'Jejuri (Pune Dist)',
                circle: 'MAHARASHTRA',
                zone: 'Pune District',
                dateRange: {
                  startDate: '2026-02-01',
                  endDate: '2026-02-01',
                },
                category: 'Religious',
                targetSim: 300,
                targetFtth: 50,
                assignedTeam: ['1'],
                allocatedSim: 350,
                allocatedFtth: 60,
                createdBy: employee?.id || '1',
                createdAt: new Date().toISOString(),
                keyInsight: 'Mass pilgrimage; prioritize network readiness + light-footprint kiosks',
              },
            ];

            for (const event of sampleEvents) {
              await addEvent(event);
            }

            Alert.alert('Success', 'Sample data loaded successfully');
          },
        },
      ]
    );
  };

  const initializeResources = async () => {
    Alert.alert(
      'Initialize Resources',
      'This will set up initial resource allocations for circles. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Initialize',
          onPress: async () => {
            const circles = ['MAHARASHTRA', 'KARNATAKA', 'TAMIL_NADU', 'GUJARAT'];
            
            for (const circle of circles) {
              await updateResource('sim_' + circle, {
                id: 'sim_' + circle,
                type: 'SIM',
                circle: circle as any,
                total: 10000,
                allocated: 0,
                used: 0,
                remaining: 10000,
                updatedAt: new Date().toISOString(),
              });

              await updateResource('ftth_' + circle, {
                id: 'ftth_' + circle,
                type: 'FTTH',
                circle: circle as any,
                total: 2000,
                allocated: 0,
                used: 0,
                remaining: 2000,
                updatedAt: new Date().toISOString(),
              });
            }

            Alert.alert('Success', 'Resources initialized successfully');
          },
        },
      ]
    );
  };

  return (
    <>
      <Stack.Screen 
        options={{ 
          title: 'Admin Settings',
          headerStyle: {
            backgroundColor: Colors.light.primary,
          },
          headerTintColor: Colors.light.background,
          headerTitleStyle: {
            fontWeight: 'bold' as const,
          },
        }} 
      />
      <ScrollView style={styles.container}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Data Management</Text>
          
          <TouchableOpacity style={styles.actionCard} onPress={loadSampleData}>
            <View style={styles.actionIcon}>
              <Database size={24} color={Colors.light.primary} />
            </View>
            <View style={styles.actionContent}>
              <Text style={styles.actionTitle}>Load Sample Data</Text>
              <Text style={styles.actionDescription}>
                Add sample events and data for testing
              </Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity style={styles.actionCard} onPress={initializeResources}>
            <View style={styles.actionIcon}>
              <SettingsIcon size={24} color={Colors.light.primary} />
            </View>
            <View style={styles.actionContent}>
              <Text style={styles.actionTitle}>Initialize Resources</Text>
              <Text style={styles.actionDescription}>
                Set up SIM and FTTH resource allocations
              </Text>
            </View>
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Statistics</Text>
          
          <View style={styles.statsGrid}>
            <View style={styles.statCard}>
              <Users size={24} color={Colors.light.primary} />
              <Text style={styles.statValue}>{employees.length}</Text>
              <Text style={styles.statLabel}>Employees</Text>
            </View>
            <View style={styles.statCard}>
              <Database size={24} color={Colors.light.info} />
              <Text style={styles.statValue}>{events.length}</Text>
              <Text style={styles.statLabel}>Events</Text>
            </View>
            <View style={styles.statCard}>
              <SettingsIcon size={24} color={Colors.light.success} />
              <Text style={styles.statValue}>{resources.length}</Text>
              <Text style={styles.statLabel}>Resources</Text>
            </View>
          </View>
        </View>

        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>CSV Employee Upload</Text>
          <Text style={styles.infoText}>
            For CSV upload functionality, this would typically integrate with a backend API to process and bulk import employee data.
          </Text>
          <Text style={[styles.infoText, { marginTop: 8 }]}>
            Required CSV format: Name, Email, Phone, Role, Circle, Zone, ReportingOfficerID
          </Text>
        </View>

        <View style={styles.bottomSpacer} />
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.light.backgroundSecondary,
  },
  section: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold' as const,
    color: Colors.light.text,
    marginBottom: 16,
  },
  actionCard: {
    flexDirection: 'row',
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
  actionIcon: {
    marginRight: 16,
  },
  actionContent: {
    flex: 1,
  },
  actionTitle: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.light.text,
    marginBottom: 4,
  },
  actionDescription: {
    fontSize: 14,
    color: Colors.light.textSecondary,
    lineHeight: 20,
  },
  statsGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  statCard: {
    flex: 1,
    backgroundColor: Colors.light.card,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  statValue: {
    fontSize: 28,
    fontWeight: 'bold' as const,
    color: Colors.light.text,
    marginTop: 8,
  },
  statLabel: {
    fontSize: 12,
    color: Colors.light.textSecondary,
    marginTop: 4,
  },
  infoCard: {
    backgroundColor: Colors.light.lightBlue,
    borderRadius: 12,
    padding: 16,
    margin: 16,
  },
  infoTitle: {
    fontSize: 16,
    fontWeight: 'bold' as const,
    color: Colors.light.primary,
    marginBottom: 8,
  },
  infoText: {
    fontSize: 14,
    color: Colors.light.primary,
    lineHeight: 20,
  },
  bottomSpacer: {
    height: 20,
  },
});
