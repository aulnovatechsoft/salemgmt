import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { X, Users, ChevronDown, ChevronRight, Check, UserPlus } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { trpc } from '@/lib/trpc';

interface TaskType {
  id: string;
  label: string;
}

interface SubordinateEmployee {
  id: string;
  persNo: string;
  name: string;
  designation: string | null;
  circle: string | null;
  zone: string | null;
  division: string | null;
  officeName: string | null;
  isLinked: boolean;
  level: number;
  linkedEmployee: {
    id: string;
    email: string;
    phone: string;
    role: string;
  } | null;
  directReportsCount: number;
  subordinates?: SubordinateEmployee[];
}

interface TaskAssignment {
  employeePersNo: string;
  employeeName: string;
  employeeDesignation: string | null;
  linkedEmployeeId: string | null;
  taskIds: string[];
}

interface TeamHierarchyPickerProps {
  visible: boolean;
  onClose: () => void;
  employeeId: string;
  selectedTasks: TaskType[];
  onAssignmentsComplete: (assignments: TaskAssignment[]) => void;
  existingAssignments?: TaskAssignment[];
}

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

export default function TeamHierarchyPicker({
  visible,
  onClose,
  employeeId,
  selectedTasks,
  onAssignmentsComplete,
  existingAssignments = [],
}: TeamHierarchyPickerProps) {
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [assignments, setAssignments] = useState<Map<string, TaskAssignment>>(new Map());
  const [selectedEmployee, setSelectedEmployee] = useState<SubordinateEmployee | null>(null);

  const { data: hierarchyData, isLoading, refetch } = trpc.admin.getTwoLevelSubordinates.useQuery(
    { employeeId },
    { enabled: visible && !!employeeId }
  );

  useEffect(() => {
    if (visible && existingAssignments.length > 0) {
      const map = new Map<string, TaskAssignment>();
      existingAssignments.forEach(a => map.set(a.employeePersNo, a));
      setAssignments(map);
    }
  }, [visible, existingAssignments]);

  useEffect(() => {
    if (visible) {
      refetch();
    }
  }, [visible]);

  const toggleExpand = (persNo: string) => {
    setExpandedNodes(prev => {
      const next = new Set(prev);
      if (next.has(persNo)) {
        next.delete(persNo);
      } else {
        next.add(persNo);
      }
      return next;
    });
  };

  const toggleTaskForEmployee = (employee: SubordinateEmployee, taskId: string) => {
    setAssignments(prev => {
      const next = new Map(prev);
      const existing = next.get(employee.persNo);
      
      if (existing) {
        const taskIds = existing.taskIds.includes(taskId)
          ? existing.taskIds.filter(t => t !== taskId)
          : [...existing.taskIds, taskId];
        
        if (taskIds.length === 0) {
          next.delete(employee.persNo);
        } else {
          next.set(employee.persNo, { ...existing, taskIds });
        }
      } else {
        next.set(employee.persNo, {
          employeePersNo: employee.persNo,
          employeeName: employee.name,
          employeeDesignation: employee.designation,
          linkedEmployeeId: employee.linkedEmployee?.id || null,
          taskIds: [taskId],
        });
      }
      
      return next;
    });
  };

  const isTaskAssignedToEmployee = (persNo: string, taskId: string) => {
    const assignment = assignments.get(persNo);
    return assignment?.taskIds.includes(taskId) || false;
  };

  const getAssignedTaskCount = (persNo: string) => {
    return assignments.get(persNo)?.taskIds.length || 0;
  };

  const handleConfirm = () => {
    const assignmentList = Array.from(assignments.values());
    onAssignmentsComplete(assignmentList);
    onClose();
  };

  const handleCancel = () => {
    setAssignments(new Map());
    setSelectedEmployee(null);
    onClose();
  };

  const getInitials = (name: string) => {
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  };

  const renderEmployeeCard = (employee: SubordinateEmployee, isLevel2 = false) => {
    const hasSubordinates = employee.subordinates && employee.subordinates.length > 0;
    const isExpanded = expandedNodes.has(employee.persNo);
    const assignedCount = getAssignedTaskCount(employee.persNo);
    const isSelected = selectedEmployee?.persNo === employee.persNo;

    return (
      <View key={employee.persNo} style={[styles.employeeContainer, isLevel2 && styles.level2Container]}>
        <TouchableOpacity
          style={[
            styles.employeeCard,
            isSelected && styles.employeeCardSelected,
            assignedCount > 0 && styles.employeeCardAssigned,
          ]}
          onPress={() => setSelectedEmployee(isSelected ? null : employee)}
          activeOpacity={0.7}
        >
          <View style={styles.employeeLeft}>
            {hasSubordinates && (
              <TouchableOpacity
                style={styles.expandButton}
                onPress={() => toggleExpand(employee.persNo)}
              >
                {isExpanded ? (
                  <ChevronDown size={18} color={Colors.light.textSecondary} />
                ) : (
                  <ChevronRight size={18} color={Colors.light.textSecondary} />
                )}
              </TouchableOpacity>
            )}
            {!hasSubordinates && <View style={styles.expandPlaceholder} />}
            
            <View style={[styles.avatar, assignedCount > 0 && styles.avatarAssigned]}>
              <Text style={styles.avatarText}>{getInitials(employee.name)}</Text>
            </View>
            
            <View style={styles.employeeInfo}>
              <Text style={styles.employeeName} numberOfLines={1}>{employee.name}</Text>
              <Text style={styles.employeeMeta} numberOfLines={1}>
                {employee.persNo} {employee.designation ? `• ${employee.designation}` : ''}
              </Text>
              {employee.directReportsCount > 0 && (
                <View style={styles.teamBadge}>
                  <Users size={10} color={Colors.light.primary} />
                  <Text style={styles.teamBadgeText}>{employee.directReportsCount} reports</Text>
                </View>
              )}
            </View>
          </View>

          {assignedCount > 0 && (
            <View style={styles.assignedBadge}>
              <Text style={styles.assignedBadgeText}>{assignedCount}</Text>
            </View>
          )}
        </TouchableOpacity>

        {isSelected && selectedTasks.length > 0 && (
          <View style={styles.taskSelectionPanel}>
            <Text style={styles.taskSelectionTitle}>Assign Tasks:</Text>
            <View style={styles.taskChipsContainer}>
              {selectedTasks.map(task => {
                const isAssigned = isTaskAssignedToEmployee(employee.persNo, task.id);
                return (
                  <TouchableOpacity
                    key={task.id}
                    style={[styles.taskChip, isAssigned && styles.taskChipSelected]}
                    onPress={() => toggleTaskForEmployee(employee, task.id)}
                  >
                    {isAssigned && <Check size={14} color="#fff" style={styles.taskChipIcon} />}
                    <Text style={[styles.taskChipText, isAssigned && styles.taskChipTextSelected]}>
                      {task.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}

        {hasSubordinates && isExpanded && (
          <View style={styles.subordinatesList}>
            {employee.subordinates!.map(sub => renderEmployeeCard(sub, true))}
          </View>
        )}
      </View>
    );
  };

  const totalAssignments = assignments.size;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleCancel}
    >
      <View style={styles.container}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Users size={22} color={Colors.light.primary} />
            <Text style={styles.headerTitle}>Pick from Team</Text>
          </View>
          <TouchableOpacity style={styles.closeButton} onPress={handleCancel}>
            <X size={22} color={Colors.light.textSecondary} />
          </TouchableOpacity>
        </View>

        {selectedTasks.length > 0 && (
          <View style={styles.selectedTasksBar}>
            <Text style={styles.selectedTasksLabel}>Tasks to assign:</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.selectedTasksScroll}>
              {selectedTasks.map(task => (
                <View key={task.id} style={styles.selectedTaskPill}>
                  <Text style={styles.selectedTaskPillText}>{task.label}</Text>
                </View>
              ))}
            </ScrollView>
          </View>
        )}

        {selectedTasks.length === 0 && (
          <View style={styles.noTasksWarning}>
            <Text style={styles.noTasksWarningText}>
              Please select at least one task type before assigning team members.
            </Text>
          </View>
        )}

        <ScrollView style={styles.hierarchyList} contentContainerStyle={styles.hierarchyListContent}>
          {isLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={Colors.light.primary} />
              <Text style={styles.loadingText}>Loading team hierarchy...</Text>
            </View>
          ) : hierarchyData?.subordinates && hierarchyData.subordinates.length > 0 ? (
            hierarchyData.subordinates.map(emp => renderEmployeeCard(emp as SubordinateEmployee))
          ) : (
            <View style={styles.emptyContainer}>
              <Users size={48} color={Colors.light.textSecondary} />
              <Text style={styles.emptyTitle}>No Team Members Found</Text>
              <Text style={styles.emptyText}>
                You don't have any subordinates in the system. Team members will appear here once they are added under your hierarchy.
              </Text>
            </View>
          )}
        </ScrollView>

        <View style={styles.footer}>
          <View style={styles.footerInfo}>
            <UserPlus size={18} color={Colors.light.primary} />
            <Text style={styles.footerInfoText}>
              {totalAssignments === 0 
                ? 'Tap an employee to assign tasks'
                : `${totalAssignments} employee${totalAssignments > 1 ? 's' : ''} selected`
              }
            </Text>
          </View>
          <View style={styles.footerButtons}>
            <TouchableOpacity style={styles.cancelButton} onPress={handleCancel}>
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.confirmButton, totalAssignments === 0 && styles.confirmButtonDisabled]}
              onPress={handleConfirm}
              disabled={totalAssignments === 0}
            >
              <Check size={18} color="#fff" />
              <Text style={styles.confirmButtonText}>Confirm ({totalAssignments})</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.light.backgroundSecondary,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: Colors.light.background,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.light.text,
  },
  closeButton: {
    padding: 8,
  },
  selectedTasksBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: Colors.light.primary + '10',
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  selectedTasksLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.light.textSecondary,
    marginRight: 10,
  },
  selectedTasksScroll: {
    flex: 1,
  },
  selectedTaskPill: {
    backgroundColor: Colors.light.primary,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    marginRight: 8,
  },
  selectedTaskPillText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#fff',
  },
  noTasksWarning: {
    backgroundColor: Colors.light.warning + '20',
    padding: 12,
    margin: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.light.warning,
  },
  noTasksWarningText: {
    fontSize: 13,
    color: Colors.light.warning,
    textAlign: 'center',
  },
  hierarchyList: {
    flex: 1,
  },
  hierarchyListContent: {
    padding: 16,
    paddingBottom: 100,
  },
  loadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: Colors.light.textSecondary,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.light.text,
    marginTop: 16,
  },
  emptyText: {
    fontSize: 14,
    color: Colors.light.textSecondary,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 20,
  },
  employeeContainer: {
    marginBottom: 8,
  },
  level2Container: {
    marginLeft: 24,
  },
  employeeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.light.background,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  employeeCardSelected: {
    borderColor: Colors.light.primary,
    borderWidth: 2,
  },
  employeeCardAssigned: {
    backgroundColor: Colors.light.success + '10',
    borderColor: Colors.light.success,
  },
  employeeLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  expandButton: {
    padding: 4,
    marginRight: 4,
  },
  expandPlaceholder: {
    width: 26,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.light.primary + '20',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  avatarAssigned: {
    backgroundColor: Colors.light.success,
  },
  avatarText: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.light.primary,
  },
  employeeInfo: {
    flex: 1,
  },
  employeeName: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.light.text,
  },
  employeeMeta: {
    fontSize: 12,
    color: Colors.light.textSecondary,
    marginTop: 2,
  },
  teamBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 4,
  },
  teamBadgeText: {
    fontSize: 11,
    color: Colors.light.primary,
    fontWeight: '500',
  },
  assignedBadge: {
    backgroundColor: Colors.light.success,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  assignedBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#fff',
  },
  taskSelectionPanel: {
    backgroundColor: Colors.light.background,
    marginTop: -1,
    padding: 12,
    borderWidth: 1,
    borderTopWidth: 0,
    borderColor: Colors.light.primary,
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
  },
  taskSelectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.light.textSecondary,
    marginBottom: 8,
  },
  taskChipsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  taskChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: Colors.light.border,
    backgroundColor: '#fff',
  },
  taskChipSelected: {
    backgroundColor: Colors.light.primary,
    borderColor: Colors.light.primary,
  },
  taskChipIcon: {
    marginRight: 4,
  },
  taskChipText: {
    fontSize: 13,
    fontWeight: '500',
    color: Colors.light.text,
  },
  taskChipTextSelected: {
    color: '#fff',
  },
  subordinatesList: {
    marginTop: 8,
  },
  footer: {
    backgroundColor: Colors.light.background,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
  },
  footerInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    gap: 8,
  },
  footerInfoText: {
    fontSize: 13,
    color: Colors.light.textSecondary,
  },
  footerButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.light.border,
    alignItems: 'center',
  },
  cancelButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.light.textSecondary,
  },
  confirmButton: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: Colors.light.primary,
    gap: 8,
  },
  confirmButtonDisabled: {
    backgroundColor: Colors.light.border,
  },
  confirmButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
});
