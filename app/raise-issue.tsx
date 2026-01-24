import { useState } from 'react';
import { View, Text, TextInput, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useAuth } from '@/contexts/auth';
import { useApp } from '@/contexts/app';
import Colors from '@/constants/colors';
import { Issue } from '@/types';
import { ISSUE_TYPES } from '@/constants/app';

export default function RaiseIssueScreen() {
  const router = useRouter();
  const { employee } = useAuth();
  const { events, employees, addIssue, addAuditLog } = useApp();
  
  const [selectedEventId, setSelectedEventId] = useState('');
  const [issueType, setIssueType] = useState<any>('MATERIAL_SHORTAGE');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [showEventPicker, setShowEventPicker] = useState(false);
  const [showTypePicker, setShowTypePicker] = useState(false);

  const myEvents = events.filter(e => {
    const today = new Date();
    const endDate = new Date(e.dateRange.endDate);
    return endDate >= today;
  });

  const handleSubmit = async () => {
    if (!selectedEventId) {
      Alert.alert('Error', 'Please select an event');
      return;
    }
    if (!description.trim()) {
      Alert.alert('Error', 'Please describe the issue');
      return;
    }

    setIsSubmitting(true);

    const escalateTo = employee?.reportingOfficerId || employees.find(emp => 
      emp.role === 'AGM' || emp.role === 'DGM'
    )?.id;

    const newIssue: Issue = {
      id: Date.now().toString(),
      eventId: selectedEventId,
      raisedBy: employee?.id || '',
      type: issueType,
      description: description.trim(),
      status: 'OPEN',
      escalatedTo: escalateTo,
      createdAt: new Date().toISOString(),
      timeline: [
        {
          action: 'Issue raised',
          performedBy: employee?.id || '',
          timestamp: new Date().toISOString(),
        },
      ],
    };

    try {
      await addIssue(newIssue);
      await addAuditLog({
        id: Date.now().toString(),
        action: 'Raised Issue',
        entityType: 'ISSUE',
        entityId: newIssue.id,
        performedBy: employee?.id || '',
        timestamp: new Date().toISOString(),
        details: { type: newIssue.type, eventId: selectedEventId },
      });
      
      Alert.alert('Success', 'Issue raised successfully', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (error) {
      Alert.alert('Error', 'Failed to raise issue');
    } finally {
      setIsSubmitting(false);
    }
  };

  const selectedEvent = events.find(e => e.id === selectedEventId);
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
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Select Work *</Text>
            <TouchableOpacity 
              style={styles.picker}
              onPress={() => setShowEventPicker(!showEventPicker)}
            >
              <Text style={styles.pickerText}>
                {selectedEvent ? selectedEvent.name : 'Choose a work'}
              </Text>
            </TouchableOpacity>
            {showEventPicker && (
              <View style={styles.pickerOptions}>
                <ScrollView nestedScrollEnabled={true} showsVerticalScrollIndicator={true}>
                  {myEvents.map((event) => (
                    <TouchableOpacity
                      key={event.id}
                      style={styles.pickerOption}
                      onPress={() => {
                        setSelectedEventId(event.id);
                        setShowEventPicker(false);
                      }}
                    >
                      <Text style={styles.pickerOptionText}>{event.name}</Text>
                      <Text style={styles.pickerOptionSubtext}>{event.location}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Issue Type *</Text>
            <TouchableOpacity 
              style={styles.picker}
              onPress={() => setShowTypePicker(!showTypePicker)}
            >
              <Text style={styles.pickerText}>{issueTypeLabel}</Text>
            </TouchableOpacity>
            {showTypePicker && (
              <View style={styles.pickerOptions}>
                <ScrollView nestedScrollEnabled={true} showsVerticalScrollIndicator={true}>
                  {ISSUE_TYPES.map((type) => (
                    <TouchableOpacity
                      key={type.value}
                      style={styles.pickerOption}
                      onPress={() => {
                        setIssueType(type.value);
                        setShowTypePicker(false);
                      }}
                    >
                      <Text style={styles.pickerOptionText}>{type.label}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Description *</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="Describe the issue in detail..."
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={6}
              textAlignVertical="top"
            />
          </View>

          <View style={styles.infoCard}>
            <Text style={styles.infoTitle}>What happens next?</Text>
            <Text style={styles.infoText}>
              • Your issue will be escalated to your reporting officer
            </Text>
            <Text style={styles.infoText}>
              • You will receive updates on the resolution progress
            </Text>
            <Text style={styles.infoText}>
              • Check the Issues tab to track your issue status
            </Text>
          </View>

          <TouchableOpacity 
            style={[styles.submitButton, isSubmitting && styles.submitButtonDisabled]}
            onPress={handleSubmit}
            disabled={isSubmitting}
          >
            <Text style={styles.submitButtonText}>
              {isSubmitting ? 'Submitting...' : 'Raise Issue'}
            </Text>
          </TouchableOpacity>
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
  form: {
    padding: 16,
  },
  inputGroup: {
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.light.text,
    marginBottom: 8,
  },
  input: {
    backgroundColor: Colors.light.background,
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 8,
    padding: 14,
    fontSize: 16,
    color: Colors.light.text,
  },
  textArea: {
    minHeight: 150,
  },
  picker: {
    backgroundColor: Colors.light.background,
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 8,
    padding: 14,
  },
  pickerText: {
    fontSize: 16,
    color: Colors.light.text,
  },
  pickerOptions: {
    backgroundColor: Colors.light.background,
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 8,
    marginTop: 8,
    maxHeight: 200,
  },
  pickerOption: {
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  pickerOptionText: {
    fontSize: 16,
    color: Colors.light.text,
  },
  pickerOptionSubtext: {
    fontSize: 12,
    color: Colors.light.textSecondary,
    marginTop: 2,
  },
  infoCard: {
    backgroundColor: Colors.light.lightBlue,
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
  },
  infoTitle: {
    fontSize: 16,
    fontWeight: 'bold' as const,
    color: Colors.light.primary,
    marginBottom: 12,
  },
  infoText: {
    fontSize: 14,
    color: Colors.light.primary,
    marginBottom: 6,
    lineHeight: 20,
  },
  submitButton: {
    backgroundColor: Colors.light.error,
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
    marginTop: 10,
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    color: Colors.light.background,
    fontSize: 16,
    fontWeight: 'bold' as const,
  },
  bottomSpacer: {
    height: 20,
  },
});
