import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { Stack } from 'expo-router';
import { FileText, User, Calendar } from 'lucide-react-native';
import { useApp } from '@/contexts/app';
import Colors from '@/constants/colors';

export default function AuditLogsScreen() {
  const { auditLogs, employees } = useApp();

  const sortedLogs = [...auditLogs].sort((a, b) => 
    new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  return (
    <>
      <Stack.Screen 
        options={{ 
          title: 'Audit Logs',
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
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Activity Log</Text>
          <Text style={styles.headerSubtitle}>{sortedLogs.length} total actions</Text>
        </View>

        <View style={styles.logsContainer}>
          {sortedLogs.length > 0 ? (
            sortedLogs.map((log) => {
              const performer = employees.find(emp => emp.id === log.performedBy);
              return (
                <View key={log.id} style={styles.logCard}>
                  <View style={styles.logIcon}>
                    <FileText size={20} color={Colors.light.primary} />
                  </View>
                  <View style={styles.logContent}>
                    <Text style={styles.logAction}>{log.action}</Text>
                    <View style={styles.logMeta}>
                      <View style={styles.logMetaItem}>
                        <User size={14} color={Colors.light.textSecondary} />
                        <Text style={styles.logMetaText}>
                          {performer?.name || 'Unknown User'}
                        </Text>
                      </View>
                      <View style={styles.logMetaItem}>
                        <Calendar size={14} color={Colors.light.textSecondary} />
                        <Text style={styles.logMetaText}>
                          {new Date(log.timestamp).toLocaleString('en-IN', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.logTypeBadge}>
                      <Text style={styles.logTypeText}>{log.entityType}</Text>
                    </View>
                  </View>
                </View>
              );
            })
          ) : (
            <View style={styles.emptyState}>
              <FileText size={64} color={Colors.light.textSecondary} />
              <Text style={styles.emptyTitle}>No Audit Logs</Text>
              <Text style={styles.emptySubtitle}>
                Activity logs will appear here as actions are performed
              </Text>
            </View>
          )}
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
  header: {
    backgroundColor: Colors.light.primary,
    padding: 20,
    paddingTop: 30,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold' as const,
    color: Colors.light.background,
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 14,
    color: Colors.light.background,
    opacity: 0.9,
  },
  logsContainer: {
    padding: 16,
  },
  logCard: {
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
  logIcon: {
    marginRight: 12,
    marginTop: 2,
  },
  logContent: {
    flex: 1,
  },
  logAction: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.light.text,
    marginBottom: 8,
  },
  logMeta: {
    gap: 6,
    marginBottom: 8,
  },
  logMetaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  logMetaText: {
    fontSize: 13,
    color: Colors.light.textSecondary,
  },
  logTypeBadge: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.light.lightBlue,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  logTypeText: {
    fontSize: 11,
    color: Colors.light.primary,
    fontWeight: '600' as const,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    paddingHorizontal: 40,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: 'bold' as const,
    color: Colors.light.text,
    marginTop: 16,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: Colors.light.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  bottomSpacer: {
    height: 20,
  },
});
