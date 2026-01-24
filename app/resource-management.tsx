import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert, ActivityIndicator } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Package, Plus, Minus, TrendingUp, TrendingDown, RefreshCw, ChevronRight } from 'lucide-react-native';
import { useAuth } from '@/contexts/auth';
import { useApp } from '@/contexts/app';
import Colors from '@/constants/colors';
import { useState, useMemo, useCallback } from 'react';
import { trpc } from '@/lib/trpc';
import { useMutation, useQuery } from '@tanstack/react-query';
import React from "react";

type ResourceType = 'SIM' | 'FTTH';

export default function ResourceManagementScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ type?: string }>();
  const { employee } = useAuth();
  const { resources, updateResource } = useApp();
  
  const initialType: ResourceType = params.type === 'FTTH' ? 'FTTH' : 'SIM';
  const [selectedType, setSelectedType] = useState<ResourceType>(initialType);
  const [adjustmentAmount, setAdjustmentAmount] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);

  const resourcesQuery = trpc.resources.getAll.useQuery(undefined, {
    retry: 1,
    refetchOnWindowFocus: false,
  });

  const summaryQuery = trpc.resources.getSummary.useQuery(undefined, {
    retry: 1,
    refetchOnWindowFocus: false,
  });

  const updateStockMutation = trpc.resources.updateStock.useMutation({
    onSuccess: () => {
      Alert.alert('Success', 'Stock updated successfully');
      setAdjustmentAmount('');
      resourcesQuery.refetch();
      summaryQuery.refetch();
    },
    onError: (error) => {
      Alert.alert('Error', error.message || 'Failed to update stock');
    },
  });

  const currentResource = useMemo(() => {
    if (resourcesQuery.data) {
      return resourcesQuery.data.find(
        r => r.type === selectedType && r.circle === employee?.circle
      );
    }
    return resources.find(
      r => r.type === selectedType && r.circle === employee?.circle
    );
  }, [resourcesQuery.data, resources, selectedType, employee?.circle]);

  const summary = useMemo(() => {
    if (summaryQuery.data) {
      return summaryQuery.data[selectedType];
    }
    return {
      total: currentResource?.total || 0,
      allocated: currentResource?.allocated || 0,
      used: currentResource?.used || 0,
      remaining: currentResource?.remaining || 0,
    };
  }, [summaryQuery.data, selectedType, currentResource]);

  const circleResources = useMemo(() => {
    if (resourcesQuery.data) {
      return resourcesQuery.data.filter(r => r.type === selectedType);
    }
    return resources.filter(r => r.type === selectedType);
  }, [resourcesQuery.data, resources, selectedType]);

  const canManageStock = useMemo(() => {
    return ['GM', 'CGM', 'DGM'].includes(employee?.role || '');
  }, [employee?.role]);

  const handleUpdateStock = useCallback((operation: 'add' | 'subtract') => {
    const amount = parseInt(adjustmentAmount, 10);
    if (isNaN(amount) || amount <= 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid positive number');
      return;
    }

    if (!employee?.circle || !employee?.id) {
      Alert.alert('Error', 'User information not available');
      return;
    }

    const currentTotal = currentResource?.total || 0;
    const newTotal = operation === 'add' ? currentTotal + amount : currentTotal - amount;

    if (newTotal < 0) {
      Alert.alert('Invalid Operation', 'Cannot reduce stock below zero');
      return;
    }

    Alert.alert(
      'Confirm Update',
      `Are you sure you want to ${operation === 'add' ? 'add' : 'remove'} ${amount} ${selectedType === 'SIM' ? 'SIMs' : 'FTTH units'} ${operation === 'add' ? 'to' : 'from'} stock?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          onPress: () => {
            updateStockMutation.mutate({
              circle: employee.circle,
              type: selectedType,
              total: newTotal,
              updatedBy: employee.id,
            });
          },
        },
      ]
    );
  }, [adjustmentAmount, currentResource, employee, selectedType, updateStockMutation]);

  const handleRefresh = useCallback(() => {
    resourcesQuery.refetch();
    summaryQuery.refetch();
  }, [resourcesQuery, summaryQuery]);

  const isLoading = resourcesQuery.isLoading || summaryQuery.isLoading;

  return (
    <>
      <Stack.Screen 
        options={{ 
          title: selectedType === 'SIM' ? 'SIM Stock Management' : 'FTTH Capacity Management',
          headerStyle: {
            backgroundColor: Colors.light.primary,
          },
          headerTintColor: Colors.light.background,
          headerTitleStyle: {
            fontWeight: 'bold' as const,
          },
          headerRight: () => (
            <TouchableOpacity onPress={handleRefresh} style={styles.headerButton}>
              <RefreshCw size={20} color={Colors.light.background} />
            </TouchableOpacity>
          ),
        }} 
      />
      <ScrollView style={styles.container}>
        <View style={styles.typeSelector}>
          <TouchableOpacity
            style={[styles.typeButton, selectedType === 'SIM' && styles.typeButtonActive]}
            onPress={() => setSelectedType('SIM')}
          >
            <Package size={20} color={selectedType === 'SIM' ? Colors.light.background : Colors.light.primary} />
            <Text style={[styles.typeButtonText, selectedType === 'SIM' && styles.typeButtonTextActive]}>
              SIM Stock
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.typeButton, selectedType === 'FTTH' && styles.typeButtonActive]}
            onPress={() => setSelectedType('FTTH')}
          >
            <Package size={20} color={selectedType === 'FTTH' ? Colors.light.background : Colors.light.secondary} />
            <Text style={[styles.typeButtonText, selectedType === 'FTTH' && styles.typeButtonTextActive]}>
              FTTH Capacity
            </Text>
          </TouchableOpacity>
        </View>

        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={Colors.light.primary} />
            <Text style={styles.loadingText}>Loading resources...</Text>
          </View>
        ) : (
          <>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryTitle}>
                {employee?.circle ? employee.circle.replace(/_/g, ' ') : 'Your Circle'} - {selectedType}
              </Text>
              <View style={styles.summaryGrid}>
                <View style={styles.summaryItem}>
                  <Text style={styles.summaryValue}>{currentResource?.total || 0}</Text>
                  <Text style={styles.summaryLabel}>Total Stock</Text>
                </View>
                <View style={styles.summaryItem}>
                  <Text style={[styles.summaryValue, { color: Colors.light.info }]}>
                    {currentResource?.allocated || 0}
                  </Text>
                  <Text style={styles.summaryLabel}>Allocated</Text>
                </View>
                <View style={styles.summaryItem}>
                  <Text style={[styles.summaryValue, { color: Colors.light.warning }]}>
                    {currentResource?.used || 0}
                  </Text>
                  <Text style={styles.summaryLabel}>Used</Text>
                </View>
                <View style={styles.summaryItem}>
                  <Text style={[styles.summaryValue, { color: Colors.light.success }]}>
                    {currentResource?.remaining || 0}
                  </Text>
                  <Text style={styles.summaryLabel}>Available</Text>
                </View>
              </View>
            </View>

            <View style={styles.progressSection}>
              <Text style={styles.sectionTitle}>Utilization</Text>
              <View style={styles.progressContainer}>
                <View style={styles.progressBar}>
                  <View 
                    style={[
                      styles.progressFill,
                      { 
                        width: `${currentResource?.total ? ((currentResource.used || 0) / currentResource.total) * 100 : 0}%`,
                        backgroundColor: Colors.light.warning,
                      }
                    ]} 
                  />
                  <View 
                    style={[
                      styles.progressFillOverlay,
                      { 
                        width: `${currentResource?.total ? ((currentResource.allocated || 0) / currentResource.total) * 100 : 0}%`,
                        backgroundColor: Colors.light.info,
                        opacity: 0.5,
                      }
                    ]} 
                  />
                </View>
                <View style={styles.progressLegend}>
                  <View style={styles.legendItem}>
                    <View style={[styles.legendDot, { backgroundColor: Colors.light.warning }]} />
                    <Text style={styles.legendText}>Used</Text>
                  </View>
                  <View style={styles.legendItem}>
                    <View style={[styles.legendDot, { backgroundColor: Colors.light.info }]} />
                    <Text style={styles.legendText}>Allocated</Text>
                  </View>
                  <View style={styles.legendItem}>
                    <View style={[styles.legendDot, { backgroundColor: Colors.light.success }]} />
                    <Text style={styles.legendText}>Available</Text>
                  </View>
                </View>
              </View>
            </View>

            {canManageStock && (
              <View style={styles.adjustmentSection}>
                <Text style={styles.sectionTitle}>Adjust Stock</Text>
                <View style={styles.adjustmentCard}>
                  <TextInput
                    style={styles.adjustmentInput}
                    placeholder="Enter quantity"
                    placeholderTextColor={Colors.light.textSecondary}
                    keyboardType="numeric"
                    value={adjustmentAmount}
                    onChangeText={setAdjustmentAmount}
                  />
                  <View style={styles.adjustmentButtons}>
                    <TouchableOpacity
                      style={[styles.adjustButton, styles.addButton]}
                      onPress={() => handleUpdateStock('add')}
                      disabled={updateStockMutation.isPending}
                    >
                      <Plus size={20} color={Colors.light.background} />
                      <Text style={styles.adjustButtonText}>Add Stock</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.adjustButton, styles.subtractButton]}
                      onPress={() => handleUpdateStock('subtract')}
                      disabled={updateStockMutation.isPending}
                    >
                      <Minus size={20} color={Colors.light.background} />
                      <Text style={styles.adjustButtonText}>Remove Stock</Text>
                    </TouchableOpacity>
                  </View>
                  {updateStockMutation.isPending && (
                    <ActivityIndicator style={styles.updateLoader} color={Colors.light.primary} />
                  )}
                </View>
              </View>
            )}

            <View style={styles.allCirclesSection}>
              <Text style={styles.sectionTitle}>All Circles - {selectedType}</Text>
              {circleResources.length === 0 ? (
                <View style={styles.emptyState}>
                  <Package size={48} color={Colors.light.textSecondary} />
                  <Text style={styles.emptyText}>No {selectedType} resources found</Text>
                </View>
              ) : (
                circleResources.map((resource) => (
                  <View key={resource.id} style={styles.circleCard}>
                    <View style={styles.circleHeader}>
                      <Text style={styles.circleName}>
                        {resource.circle.replace(/_/g, ' ')}
                      </Text>
                      {resource.circle === employee?.circle && (
                        <View style={styles.yourCircleBadge}>
                          <Text style={styles.yourCircleText}>Your Circle</Text>
                        </View>
                      )}
                    </View>
                    <View style={styles.circleStats}>
                      <View style={styles.circleStat}>
                        <Text style={styles.circleStatValue}>{resource.total}</Text>
                        <Text style={styles.circleStatLabel}>Total</Text>
                      </View>
                      <View style={styles.circleStat}>
                        <Text style={[styles.circleStatValue, { color: Colors.light.success }]}>
                          {resource.remaining}
                        </Text>
                        <Text style={styles.circleStatLabel}>Available</Text>
                      </View>
                      <View style={styles.circleStat}>
                        <Text style={[styles.circleStatValue, { color: Colors.light.warning }]}>
                          {resource.used}
                        </Text>
                        <Text style={styles.circleStatLabel}>Used</Text>
                      </View>
                    </View>
                  </View>
                ))
              )}
            </View>

            <View style={styles.bottomSpacer} />
          </>
        )}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.light.backgroundSecondary,
  },
  headerButton: {
    marginRight: 8,
    padding: 8,
  },
  typeSelector: {
    flexDirection: 'row',
    padding: 16,
    gap: 12,
  },
  typeButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: Colors.light.card,
    borderWidth: 2,
    borderColor: Colors.light.border,
  },
  typeButtonActive: {
    backgroundColor: Colors.light.primary,
    borderColor: Colors.light.primary,
  },
  typeButtonText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.light.text,
  },
  typeButtonTextActive: {
    color: Colors.light.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: Colors.light.textSecondary,
  },
  summaryCard: {
    backgroundColor: Colors.light.card,
    marginHorizontal: 16,
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  summaryTitle: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.light.text,
    marginBottom: 16,
    textAlign: 'center',
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  summaryItem: {
    flex: 1,
    minWidth: '45%',
    alignItems: 'center',
    padding: 12,
    backgroundColor: Colors.light.backgroundSecondary,
    borderRadius: 12,
  },
  summaryValue: {
    fontSize: 28,
    fontWeight: 'bold' as const,
    color: Colors.light.text,
  },
  summaryLabel: {
    fontSize: 12,
    color: Colors.light.textSecondary,
    marginTop: 4,
  },
  progressSection: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.light.text,
    marginBottom: 12,
  },
  progressContainer: {
    backgroundColor: Colors.light.card,
    borderRadius: 12,
    padding: 16,
  },
  progressBar: {
    height: 12,
    backgroundColor: Colors.light.success,
    borderRadius: 6,
    overflow: 'hidden',
    position: 'relative',
  },
  progressFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: 6,
  },
  progressFillOverlay: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: 6,
  },
  progressLegend: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    marginTop: 12,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendText: {
    fontSize: 12,
    color: Colors.light.textSecondary,
  },
  adjustmentSection: {
    padding: 16,
    paddingTop: 0,
  },
  adjustmentCard: {
    backgroundColor: Colors.light.card,
    borderRadius: 12,
    padding: 16,
  },
  adjustmentInput: {
    backgroundColor: Colors.light.backgroundSecondary,
    borderRadius: 10,
    padding: 14,
    fontSize: 16,
    color: Colors.light.text,
    marginBottom: 12,
    textAlign: 'center',
  },
  adjustmentButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  adjustButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 10,
  },
  addButton: {
    backgroundColor: Colors.light.success,
  },
  subtractButton: {
    backgroundColor: Colors.light.error,
  },
  adjustButtonText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.light.background,
  },
  updateLoader: {
    marginTop: 12,
  },
  allCirclesSection: {
    padding: 16,
    paddingTop: 0,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyText: {
    marginTop: 12,
    fontSize: 14,
    color: Colors.light.textSecondary,
  },
  circleCard: {
    backgroundColor: Colors.light.card,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  circleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  circleName: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.light.text,
    flex: 1,
  },
  yourCircleBadge: {
    backgroundColor: Colors.light.primary + '20',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  yourCircleText: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: Colors.light.primary,
  },
  circleStats: {
    flexDirection: 'row',
    gap: 12,
  },
  circleStat: {
    flex: 1,
    alignItems: 'center',
    padding: 10,
    backgroundColor: Colors.light.backgroundSecondary,
    borderRadius: 8,
  },
  circleStatValue: {
    fontSize: 18,
    fontWeight: 'bold' as const,
    color: Colors.light.text,
  },
  circleStatLabel: {
    fontSize: 11,
    color: Colors.light.textSecondary,
    marginTop: 2,
  },
  bottomSpacer: {
    height: 40,
  },
});
