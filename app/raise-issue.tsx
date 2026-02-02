import { useState } from 'react';
import { View, Text, TextInput, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator, Modal } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useAuth } from '@/contexts/auth';
import { useApp } from '@/contexts/app';
import Colors from '@/constants/colors';
import { ISSUE_TYPES } from '@/constants/app';
import { trpc } from '@/lib/trpc';
import { ChevronDown, Check, X } from 'lucide-react-native';

export default function RaiseIssueScreen() {
  const router = useRouter();
  const { employee } = useAuth();
  const { refetchIssues } = useApp();
  
  const [selectedEventId, setSelectedEventId] = useState('');
  const [issueType, setIssueType] = useState<'MATERIAL_SHORTAGE' | 'SITE_ACCESS' | 'EQUIPMENT' | 'NETWORK_PROBLEM' | 'OTHER'>('MATERIAL_SHORTAGE');
  const [description, setDescription] = useState('');

  const [showEventPicker, setShowEventPicker] = useState(false);
  const [showTypePicker, setShowTypePicker] = useState(false);

  // Fetch events assigned to this employee
  const { data: myEventsData, isLoading: eventsLoading } = trpc.events.getMyAssignedTasks.useQuery(
    { employeeId: employee?.id || '' },
    { enabled: !!employee?.id }
  );

  const createIssueMutation = trpc.issues.create.useMutation({
    onSuccess: () => {
      refetchIssues();
      Alert.alert('Success', 'Issue raised successfully', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    },
    onError: (error) => {
      Alert.alert('Error', error.message || 'Failed to raise issue');
    },
  });

  // Filter active events only
  const myEvents = (myEventsData || []).filter(e => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const endDate = new Date(e.endDate);
    endDate.setHours(23, 59, 59, 999);
    return endDate >= today || e.status === 'active';
  });

  const handleSubmit = async () => {
    if (!selectedEventId) {
      Alert.alert('Error', 'Please select a task');
      return;
    }
    if (!description.trim()) {
      Alert.alert('Error', 'Please describe the issue');
      return;
    }

    // Find the manager to escalate to (use event creator or current manager)
    const selectedEvent = myEvents.find(e => e.id === selectedEventId);
    const escalateTo = (selectedEvent as any)?.createdBy || undefined;

    createIssueMutation.mutate({
      eventId: selectedEventId,
      raisedBy: employee?.id || '',
      type: issueType,
      description: description.trim(),
      escalatedTo: escalateTo,
    });
  };

  const selectedEvent = myEvents.find(e => e.id === selectedEventId);
  const issueTypeLabel = ISSUE_TYPES.find(t => t.value === issueType)?.label || issueType;

  return (
    <>
      <Stack.Screen 
        options={{ 
          title: 'Raise Issue',
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
        <View style={styles.form}>
          <Text style={styles.label}>Select Task *</Text>
          <TouchableOpacity 
            style={styles.selector}
            onPress={() => setShowEventPicker(true)}
          >
            <Text style={selectedEvent ? styles.selectorText : styles.selectorPlaceholder}>
              {selectedEvent ? `${selectedEvent.name} - ${selectedEvent.location}` : 'Select a task'}
            </Text>
            <ChevronDown size={20} color={Colors.light.textSecondary} />
          </TouchableOpacity>

          <Text style={styles.label}>Issue Type *</Text>
          <TouchableOpacity 
            style={styles.selector}
            onPress={() => setShowTypePicker(true)}
          >
            <Text style={styles.selectorText}>{issueTypeLabel}</Text>
            <ChevronDown size={20} color={Colors.light.textSecondary} />
          </TouchableOpacity>

          <Text style={styles.label}>Description *</Text>
          <TextInput
            style={styles.textArea}
            placeholder="Describe the issue in detail..."
            placeholderTextColor={Colors.light.textSecondary}
            value={description}
            onChangeText={setDescription}
            multiline
            numberOfLines={5}
            textAlignVertical="top"
          />

          <View style={styles.infoBox}>
            <Text style={styles.infoText}>
              This issue will be escalated to your task manager or reporting manager for resolution.
            </Text>
          </View>

          <TouchableOpacity 
            style={[styles.submitButton, (!selectedEventId || !description.trim() || createIssueMutation.isPending) && styles.submitButtonDisabled]}
            onPress={handleSubmit}
            disabled={!selectedEventId || !description.trim() || createIssueMutation.isPending}
          >
            {createIssueMutation.isPending ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.submitButtonText}>Raise Issue</Text>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Event Picker Modal */}
      <Modal
        visible={showEventPicker}
        animationType="slide"
        transparent
        onRequestClose={() => setShowEventPicker(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Task</Text>
              <TouchableOpacity onPress={() => setShowEventPicker(false)}>
                <X size={24} color={Colors.light.text} />
              </TouchableOpacity>
            </View>
            
            {eventsLoading ? (
              <View style={styles.modalLoading}>
                <ActivityIndicator size="large" color={Colors.light.primary} />
              </View>
            ) : myEvents.length === 0 ? (
              <View style={styles.modalEmpty}>
                <Text style={styles.modalEmptyText}>No active tasks found</Text>
              </View>
            ) : (
              <ScrollView style={styles.modalList}>
                {myEvents.map(event => (
                  <TouchableOpacity
                    key={event.id}
                    style={[styles.modalItem, selectedEventId === event.id && styles.modalItemSelected]}
                    onPress={() => {
                      setSelectedEventId(event.id);
                      setShowEventPicker(false);
                    }}
                  >
                    <View style={styles.modalItemContent}>
                      <Text style={styles.modalItemTitle}>{event.name}</Text>
                      <Text style={styles.modalItemSubtitle}>{event.location}</Text>
                    </View>
                    {selectedEventId === event.id && (
                      <Check size={20} color={Colors.light.primary} />
                    )}
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* Issue Type Picker Modal */}
      <Modal
        visible={showTypePicker}
        animationType="slide"
        transparent
        onRequestClose={() => setShowTypePicker(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Issue Type</Text>
              <TouchableOpacity onPress={() => setShowTypePicker(false)}>
                <X size={24} color={Colors.light.text} />
              </TouchableOpacity>
            </View>
            
            <ScrollView style={styles.modalList}>
              {ISSUE_TYPES.map(type => (
                <TouchableOpacity
                  key={type.value}
                  style={[styles.modalItem, issueType === type.value && styles.modalItemSelected]}
                  onPress={() => {
                    setIssueType(type.value as any);
                    setShowTypePicker(false);
                  }}
                >
                  <Text style={styles.modalItemTitle}>{type.label}</Text>
                  {issueType === type.value && (
                    <Check size={20} color={Colors.light.primary} />
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.light.background,
  },
  form: {
    padding: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.light.text,
    marginBottom: 8,
    marginTop: 16,
  },
  selector: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 14,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  selectorText: {
    fontSize: 15,
    color: Colors.light.text,
    flex: 1,
  },
  selectorPlaceholder: {
    fontSize: 15,
    color: Colors.light.textSecondary,
    flex: 1,
  },
  textArea: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 14,
    borderWidth: 1,
    borderColor: '#ddd',
    fontSize: 15,
    color: Colors.light.text,
    minHeight: 120,
  },
  infoBox: {
    backgroundColor: '#E3F2FD',
    borderRadius: 8,
    padding: 12,
    marginTop: 20,
  },
  infoText: {
    fontSize: 13,
    color: Colors.light.primary,
    lineHeight: 18,
  },
  submitButton: {
    backgroundColor: Colors.light.primary,
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
    marginTop: 24,
  },
  submitButtonDisabled: {
    backgroundColor: '#ccc',
  },
  submitButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: Colors.light.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '70%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: Colors.light.text,
  },
  modalLoading: {
    padding: 40,
    alignItems: 'center',
  },
  modalEmpty: {
    padding: 40,
    alignItems: 'center',
  },
  modalEmptyText: {
    fontSize: 14,
    color: Colors.light.textSecondary,
  },
  modalList: {
    maxHeight: 400,
  },
  modalItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  modalItemSelected: {
    backgroundColor: '#E3F2FD',
  },
  modalItemContent: {
    flex: 1,
  },
  modalItemTitle: {
    fontSize: 15,
    fontWeight: '500',
    color: Colors.light.text,
  },
  modalItemSubtitle: {
    fontSize: 13,
    color: Colors.light.textSecondary,
    marginTop: 2,
  },
});
