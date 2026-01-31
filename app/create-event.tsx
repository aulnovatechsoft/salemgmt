import { useState, useEffect, useMemo } from 'react';
import { View, Text, TextInput, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator, Platform } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useAuth } from '@/contexts/auth';
import { useApp } from '@/contexts/app';
import Colors from '@/constants/colors';
import { Event, Circle } from '@/types';
import { CIRCLES_FALLBACK } from '@/constants/app';
import { trpc } from '@/lib/trpc';
import { mapCircleNameToEnum } from '@/lib/circleUtils';
import { Calendar, ChevronLeft, ChevronRight, Check, Phone, CheckCircle, User, X, BadgeCheck, Users, Trash2 } from 'lucide-react-native';
import TeamHierarchyPicker from '@/components/TeamHierarchyPicker';

interface TaskAssignment {
  employeePersNo: string;
  employeeName: string;
  employeeDesignation: string | null;
  linkedEmployeeId: string | null;
  taskIds: string[];
}

const TASK_TYPES = [
  { id: 'SIM', label: 'SIM', description: 'SIM card sales' },
  { id: 'FTTH', label: 'FTTH', description: 'Fiber to the Home' },
  { id: 'LEASE_CIRCUIT', label: 'Lease Circuit', description: 'Leased line connections' },
  { id: 'EB', label: 'EB', description: 'Exchange based task' },
  { id: 'BTS_DOWN', label: 'BTS-Down', description: 'Base station maintenance' },
  { id: 'FTTH_DOWN', label: 'FTTH-Down', description: 'FTTH maintenance' },
  { id: 'ROUTE_FAIL', label: 'Route-Fail', description: 'Route failure resolution' },
  { id: 'OFC_FAIL', label: 'OFC-Fail', description: 'Optical fiber cable failure' },
];

const formatDateString = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const parseDate = (dateStr: string): Date | null => {
  if (!dateStr) return null;
  const [year, month, day] = dateStr.split('-').map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export default function CreateEventScreen() {
  const router = useRouter();
  const { employee } = useAuth();
  const { refetchResources } = useApp();
  
  const today = new Date();
  const todayStr = formatDateString(today);
  
  // Task name is derived from selected task types
  const getTaskName = () => selectedCategories.map(c => TASK_TYPES.find(t => t.id === c)?.label).filter(Boolean).join(', ');
  const [pinCode, setPinCode] = useState('');
  const [location, setLocation] = useState('');
  const [city, setCity] = useState('');
  const [circle, setCircle] = useState<string>(mapCircleNameToEnum(employee?.circle));
  const [zone, setZone] = useState('');
  const [startDate, setStartDate] = useState(todayStr);
  const [endDate, setEndDate] = useState('');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [targetSim, setTargetSim] = useState('');
  const [targetFtth, setTargetFtth] = useState('');
  const [targetLeaseCircuit, setTargetLeaseCircuit] = useState('');
  const [targetEb, setTargetEb] = useState('');
  const [maintenanceDetails, setMaintenanceDetails] = useState<Record<string, { priority: 'low' | 'medium' | 'high' | 'critical'; sites: string; hours: string }>>({
    BTS_DOWN: { priority: 'medium', sites: '', hours: '' },
    FTTH_DOWN: { priority: 'medium', sites: '', hours: '' },
    ROUTE_FAIL: { priority: 'medium', sites: '', hours: '' },
    OFC_FAIL: { priority: 'medium', sites: '', hours: '' },
  });
  const [keyInsight, setKeyInsight] = useState('');

  const updateMaintenanceDetail = (taskId: string, field: 'priority' | 'sites' | 'hours', value: string) => {
    setMaintenanceDetails(prev => ({
      ...prev,
      [taskId]: { ...prev[taskId], [field]: value }
    }));
  };

  const MAINTENANCE_TASKS = [
    { id: 'BTS_DOWN', label: 'BTS-Down' },
    { id: 'FTTH_DOWN', label: 'FTTH-Down' },
    { id: 'ROUTE_FAIL', label: 'Route-Fail' },
    { id: 'OFC_FAIL', label: 'OFC-Fail' },
  ];

  const selectedMaintenanceTasks = selectedCategories.filter(c => 
    ['BTS_DOWN', 'FTTH_DOWN', 'ROUTE_FAIL', 'OFC_FAIL'].includes(c)
  );
  const [mobileNumber, setMobileNumber] = useState('');
  const [assignedToStaffId, setAssignedToStaffId] = useState('');
  const [foundEmployee, setFoundEmployee] = useState<{ id: string; name: string; persNo: string; designation?: string; circle?: string; phone?: string } | null>(null);
  const [assignedEmployee, setAssignedEmployee] = useState<{ id: string; name: string; persNo: string; designation?: string; circle?: string } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSearchingStaff, setIsSearchingStaff] = useState(false);
  const [isSearchingByMobile, setIsSearchingByMobile] = useState(false);
  const [isLoadingPincode, setIsLoadingPincode] = useState(false);
  const [pincodeError, setPincodeError] = useState('');

  const [showCirclePicker, setShowCirclePicker] = useState(false);
  const [showStartCalendar, setShowStartCalendar] = useState(false);
  const [showEndCalendar, setShowEndCalendar] = useState(false);
  const [showTeamPicker, setShowTeamPicker] = useState(false);
  const [teamAssignments, setTeamAssignments] = useState<TaskAssignment[]>([]);
  const [startCalendarMonth, setStartCalendarMonth] = useState(today.getMonth());
  const [startCalendarYear, setStartCalendarYear] = useState(today.getFullYear());
  const [endCalendarMonth, setEndCalendarMonth] = useState(today.getMonth());
  const [endCalendarYear, setEndCalendarYear] = useState(today.getFullYear());

  const circlesQuery = trpc.circles.getAll.useQuery();
  
  const circlesList = circlesQuery.data && circlesQuery.data.length > 0 
    ? circlesQuery.data.map(c => ({ label: c.label, value: c.value }))
    : CIRCLES_FALLBACK;

  const stateToCircleMap: { [key: string]: string } = {
    'ANDHRA PRADESH': 'ANDHRA_PRADESH',
    'ARUNACHAL PRADESH': 'NORTH_EAST_I',
    'ASSAM': 'ASSAM',
    'BIHAR': 'BIHAR',
    'CHHATTISGARH': 'CHHATTISGARH',
    'GOA': 'MAHARASHTRA',
    'GUJARAT': 'GUJARAT',
    'HARYANA': 'HARYANA',
    'HIMACHAL PRADESH': 'HIMACHAL_PRADESH',
    'JHARKHAND': 'JHARKHAND',
    'KARNATAKA': 'KARNATAKA',
    'KERALA': 'KERALA',
    'MADHYA PRADESH': 'MADHYA_PRADESH',
    'MAHARASHTRA': 'MAHARASHTRA',
    'MANIPUR': 'NORTH_EAST_II',
    'MEGHALAYA': 'NORTH_EAST_I',
    'MIZORAM': 'NORTH_EAST_II',
    'NAGALAND': 'NORTH_EAST_II',
    'ODISHA': 'ODISHA',
    'PUNJAB': 'PUNJAB',
    'RAJASTHAN': 'RAJASTHAN',
    'SIKKIM': 'NORTH_EAST_I',
    'TAMIL NADU': 'TAMIL_NADU',
    'TELANGANA': 'TELANGANA',
    'TRIPURA': 'NORTH_EAST_I',
    'UTTAR PRADESH': 'UTTAR_PRADESH_EAST',
    'UTTARAKHAND': 'UTTARAKHAND',
    'WEST BENGAL': 'WEST_BENGAL',
    'DELHI': 'DELHI',
    'JAMMU AND KASHMIR': 'JAMMU_AND_KASHMIR',
    'LADAKH': 'JAMMU_AND_KASHMIR',
    'CHANDIGARH': 'PUNJAB',
    'PUDUCHERRY': 'TAMIL_NADU',
    'ANDAMAN AND NICOBAR': 'ANDAMAN_AND_NICOBAR',
    'LAKSHADWEEP': 'KERALA',
    'DADRA AND NAGAR HAVELI': 'GUJARAT',
    'DAMAN AND DIU': 'GUJARAT',
  };

  const upWestDivisions = [
    'GHAZIABAD', 'MEERUT', 'AGRA', 'BAREILLY', 'MORADABAD', 'SAHARANPUR',
    'ALIGARH', 'MATHURA', 'NOIDA', 'BULANDSHAHR', 'MUZAFFARNAGAR', 'BIJNOR',
    'RAMPUR', 'SHAHJAHANPUR', 'PILIBHIT', 'BUDAUN', 'ETAH', 'MAINPURI',
    'FIROZABAD', 'HATHRAS', 'KASGANJ', 'AMROHA', 'SAMBHAL', 'HAPUR',
    'GAUTAM BUDDHA NAGAR', 'BAGPAT'
  ];

  const fetchPincodeDetails = async (pin: string) => {
    if (pin.length !== 6) return;
    
    setIsLoadingPincode(true);
    setPincodeError('');
    
    try {
      const response = await fetch(`https://api.postalpincode.in/pincode/${pin}`);
      const data = await response.json();
      
      if (data[0]?.Status === 'Success' && data[0]?.PostOffice?.length > 0) {
        const postOffice = data[0].PostOffice[0];
        setLocation(postOffice.Name || '');
        setCity(postOffice.District || '');
        
        const stateUpper = (postOffice.State || '').toUpperCase();
        const divisionUpper = (postOffice.Division || '').toUpperCase();
        const districtUpper = (postOffice.District || '').toUpperCase();
        
        let mappedCircle = stateToCircleMap[stateUpper];
        
        if (stateUpper === 'UTTAR PRADESH') {
          const isWest = upWestDivisions.some(div => 
            divisionUpper.includes(div) || districtUpper.includes(div)
          );
          mappedCircle = isWest ? 'UTTAR_PRADESH_WEST' : 'UTTAR_PRADESH_EAST';
        }
        
        if (mappedCircle) {
          setCircle(mappedCircle);
        }
        setPincodeError('');
      } else {
        setPincodeError('Invalid PIN code');
      }
    } catch (error) {
      setPincodeError('Failed to fetch location');
    } finally {
      setIsLoadingPincode(false);
    }
  };

  const handlePinCodeChange = (text: string) => {
    const numericText = text.replace(/[^0-9]/g, '');
    setPinCode(numericText);
    setPincodeError('');
    
    if (numericText.length === 6) {
      fetchPincodeDetails(numericText);
    }
  };

  const staffSearchQuery = trpc.employees.getByStaffId.useQuery(
    { staffId: assignedToStaffId },
    { enabled: assignedToStaffId.length >= 3 && !isSearchingByMobile }
  );

  const mobileSearchQuery = trpc.employees.getByMobile.useQuery(
    { mobile: mobileNumber },
    { enabled: mobileNumber.length === 10 }
  );

  useEffect(() => {
    if (mobileSearchQuery.isSuccess && mobileNumber.length === 10) {
      const data = mobileSearchQuery.data;
      if (data) {
        setAssignedToStaffId(data.persNo || '');
        setFoundEmployee({ 
          id: data.id, 
          name: data.name, 
          persNo: data.persNo || '',
          designation: data.designation || '',
          circle: data.circle || '',
          phone: data.phone || '',
        });
      } else {
        setFoundEmployee(null);
      }
      setIsSearchingByMobile(false);
    } else if (mobileSearchQuery.isError) {
      setIsSearchingByMobile(false);
    }
  }, [mobileSearchQuery.data, mobileSearchQuery.isSuccess, mobileSearchQuery.isError, mobileNumber]);

  useEffect(() => {
    if (staffSearchQuery.isSuccess && !isSearchingByMobile) {
      const data = staffSearchQuery.data;
      if (data) {
        setFoundEmployee({ 
          id: data.id, 
          name: data.name, 
          persNo: data.persNo || '',
          designation: data.designation || '',
          circle: data.circle || '',
          phone: data.phone || '',
        });
      } else {
        setFoundEmployee(null);
      }
      setIsSearchingStaff(false);
    } else if (staffSearchQuery.isError) {
      setFoundEmployee(null);
      setIsSearchingStaff(false);
    }
  }, [staffSearchQuery.data, staffSearchQuery.isSuccess, staffSearchQuery.isError, isSearchingByMobile]);

  const handleMobileChange = (text: string) => {
    const cleaned = text.replace(/\D/g, '').slice(0, 10);
    setMobileNumber(cleaned);
    if (cleaned.length === 10) {
      setIsSearchingByMobile(true);
      setFoundEmployee(null);
      setAssignedEmployee(null);
      setAssignedToStaffId('');
    } else {
      setFoundEmployee(null);
    }
  };

  const confirmEmployee = () => {
    if (foundEmployee) {
      setAssignedEmployee({
        id: foundEmployee.id,
        name: foundEmployee.name,
        persNo: foundEmployee.persNo,
        designation: foundEmployee.designation,
        circle: foundEmployee.circle,
      });
      setFoundEmployee(null);
    }
  };

  const clearEmployee = () => {
    setAssignedToStaffId('');
    setMobileNumber('');
    setFoundEmployee(null);
    setAssignedEmployee(null);
  };

  const getInitials = (name: string) => {
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  };

  const handleStaffIdChange = (text: string) => {
    setAssignedToStaffId(text);
    setFoundEmployee(null);
    setAssignedEmployee(null);
    setMobileNumber('');
    if (text.length >= 3) {
      setIsSearchingStaff(true);
    }
  };

  const toggleCategory = (categoryId: string) => {
    setSelectedCategories(prev => {
      if (prev.includes(categoryId)) {
        return prev.filter(c => c !== categoryId);
      } else {
        return [...prev, categoryId];
      }
    });
  };

  const showSimTarget = selectedCategories.includes('SIM');
  const showFtthTarget = selectedCategories.includes('FTTH');
  const showLeaseCircuitTarget = selectedCategories.includes('LEASE_CIRCUIT');
  const showEbTarget = selectedCategories.includes('EB');
  const isMaintenance = selectedCategories.some(c => ['BTS_DOWN', 'FTTH_DOWN', 'ROUTE_FAIL', 'OFC_FAIL'].includes(c));
  const hasSalesTargets = showSimTarget || showFtthTarget || showLeaseCircuitTarget || showEbTarget;

  const generateCalendarDays = (month: number, year: number) => {
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startDayOfWeek = firstDay.getDay();
    
    const days: (number | null)[] = [];
    for (let i = 0; i < startDayOfWeek; i++) {
      days.push(null);
    }
    for (let i = 1; i <= daysInMonth; i++) {
      days.push(i);
    }
    return days;
  };

  const handleSelectStartDate = (day: number) => {
    const selected = new Date(startCalendarYear, startCalendarMonth, day);
    const dateStr = formatDateString(selected);
    setStartDate(dateStr);
    setShowStartCalendar(false);
    if (endDate && parseDate(endDate)! < selected) {
      setEndDate('');
    }
  };

  const handleSelectEndDate = (day: number) => {
    const selected = new Date(endCalendarYear, endCalendarMonth, day);
    const dateStr = formatDateString(selected);
    setEndDate(dateStr);
    setShowEndCalendar(false);
  };

  const isDateDisabled = (day: number, month: number, year: number, isEndDate: boolean) => {
    const date = new Date(year, month, day);
    const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    
    if (date < todayDate) {
      return true;
    }
    
    if (isEndDate && startDate) {
      const start = parseDate(startDate);
      return start ? date < start : false;
    }
    return false;
  };

  const formatDisplayDate = (dateStr: string) => {
    if (!dateStr) return '';
    const date = parseDate(dateStr);
    if (!date) return dateStr;
    return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  const getCircleLabel = (value: string) => {
    const found = circlesList.find(c => c.value === value);
    return found ? found.label : value;
  };

  const createEventMutation = trpc.events.create.useMutation({
    onSuccess: (data) => {
      console.log('Task created in database:', data.id);
      setIsSubmitting(false);
      Alert.alert('Success', 'Task created successfully', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    },
    onError: (error) => {
      console.error('Failed to create task:', error);
      setIsSubmitting(false);
      Alert.alert('Error', error.message || 'Failed to create task');
    },
  });

  const handleSubmit = async () => {
    if (selectedCategories.length === 0) {
      Alert.alert('Error', 'Please select at least one task type');
      return;
    }
    if (!location.trim()) {
      Alert.alert('Error', 'Please enter location');
      return;
    }
    if (!startDate.trim()) {
      Alert.alert('Error', 'Please enter start date');
      return;
    }
    if (!endDate.trim()) {
      Alert.alert('Error', 'Please enter end date');
      return;
    }
    if (!employee?.id) {
      Alert.alert('Error', 'You must be logged in to create a task');
      return;
    }

    setIsSubmitting(true);

    try {
      const categoryString = selectedCategories.join(',');
      
      const teamMemberPurseIds = teamAssignments.map(a => a.employeePersNo);
      
      createEventMutation.mutate({
        name: getTaskName(),
        location: location.trim(),
        circle: circle as any,
        zone: zone.trim() || 'Default',
        startDate: startDate,
        endDate: endDate,
        category: categoryString as any,
        targetSim: showSimTarget ? (parseInt(targetSim) || 0) : 0,
        targetFtth: showFtthTarget ? (parseInt(targetFtth) || 0) : 0,
        targetEb: showEbTarget ? (parseInt(targetEb) || 0) : 0,
        targetLease: showLeaseCircuitTarget ? (parseInt(targetLeaseCircuit) || 0) : 0,
        targetBtsDown: selectedCategories.includes('BTS_DOWN') ? (parseInt(maintenanceDetails.BTS_DOWN?.sites) || 0) : 0,
        targetFtthDown: selectedCategories.includes('FTTH_DOWN') ? (parseInt(maintenanceDetails.FTTH_DOWN?.sites) || 0) : 0,
        targetRouteFail: selectedCategories.includes('ROUTE_FAIL') ? (parseInt(maintenanceDetails.ROUTE_FAIL?.sites) || 0) : 0,
        targetOfcFail: selectedCategories.includes('OFC_FAIL') ? (parseInt(maintenanceDetails.OFC_FAIL?.sites) || 0) : 0,
        assignedTeam: teamMemberPurseIds,
        allocatedSim: 0,
        allocatedFtth: 0,
        keyInsight: keyInsight.trim() || undefined,
        assignedTo: assignedEmployee?.id,
        assignedToStaffId: assignedToStaffId.trim() || undefined,
        createdBy: employee.id,
        teamAssignments: teamAssignments.length > 0 ? JSON.stringify(teamAssignments) : undefined,
      });
    } catch (error) {
      console.error('Task creation error:', error);
      setIsSubmitting(false);
      Alert.alert('Error', 'Failed to create task');
    }
  };

  return (
    <>
      <Stack.Screen 
        options={{ 
          title: 'Create Task',
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
          <View style={styles.categorySection}>
            <Text style={styles.categorySectionTitle}>Task Name * (Select one or more)</Text>
            <View style={styles.categoryGrid}>
              {TASK_TYPES.map((taskType) => {
                const isSelected = selectedCategories.includes(taskType.id);
                return (
                  <TouchableOpacity
                    key={taskType.id}
                    style={[
                      styles.categoryChip,
                      isSelected && styles.categoryChipSelected
                    ]}
                    onPress={() => toggleCategory(taskType.id)}
                  >
                    {isSelected && <Check size={16} color="#FFFFFF" />}
                    <Text style={[
                      styles.categoryChipText,
                      isSelected && styles.categoryChipTextSelected
                    ]}>{taskType.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          <View style={styles.assignSection}>
            <Text style={styles.assignSectionTitle}>Assign Task</Text>
            
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Mobile Number</Text>
              <View style={styles.mobileInputContainer}>
                <Phone size={18} color={Colors.light.textSecondary} />
                <TextInput
                  style={styles.mobileInput}
                  placeholder="Enter 10-digit mobile number"
                  value={mobileNumber}
                  onChangeText={handleMobileChange}
                  keyboardType="phone-pad"
                  maxLength={10}
                />
              </View>
              <Text style={styles.helperText}>Enter mobile to auto-fill Pers No</Text>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Pers No *</Text>
              <TextInput
                style={styles.input}
                placeholder="Enter Pers No to assign task manager"
                value={assignedToStaffId}
                onChangeText={handleStaffIdChange}
                autoCapitalize="characters"
              />
              {(isSearchingStaff || isSearchingByMobile || staffSearchQuery.isLoading || mobileSearchQuery.isLoading) && (
                <View style={styles.staffSearching}>
                  <ActivityIndicator size="small" color={Colors.light.primary} />
                  <Text style={styles.staffSearchingText}>Searching employee...</Text>
                </View>
              )}
              
              {foundEmployee && !assignedEmployee && (
                <View style={styles.foundEmployeeCard}>
                  <View style={styles.foundEmployeeHeader}>
                    <Text style={styles.foundEmployeeLabel}>Employee Found</Text>
                  </View>
                  <View style={styles.foundEmployeeBody}>
                    <View style={styles.employeeAvatar}>
                      <Text style={styles.employeeAvatarText}>{getInitials(foundEmployee.name)}</Text>
                    </View>
                    <View style={styles.employeeDetails}>
                      <Text style={styles.employeeName}>{foundEmployee.name}</Text>
                      <View style={styles.employeeMetaRow}>
                        <Text style={styles.employeeMeta}>Pers No: {foundEmployee.persNo}</Text>
                      </View>
                      {foundEmployee.designation && (
                        <Text style={styles.employeeDesignation}>{foundEmployee.designation}</Text>
                      )}
                      {foundEmployee.circle && (
                        <Text style={styles.employeeCircle}>{foundEmployee.circle.replace(/_/g, ' ')}</Text>
                      )}
                    </View>
                  </View>
                  <View style={styles.foundEmployeeActions}>
                    <TouchableOpacity 
                      style={styles.rejectBtn}
                      onPress={clearEmployee}
                    >
                      <X size={18} color={Colors.light.error} />
                      <Text style={styles.rejectBtnText}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity 
                      style={styles.confirmBtn}
                      onPress={confirmEmployee}
                    >
                      <CheckCircle size={18} color={Colors.light.background} />
                      <Text style={styles.confirmBtnText}>Confirm</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {assignedEmployee && (
                <View style={styles.confirmedEmployeeCard}>
                  <View style={styles.confirmedHeader}>
                    <BadgeCheck size={16} color={Colors.light.success} />
                    <Text style={styles.confirmedLabel}>Task Manager Assigned</Text>
                  </View>
                  <View style={styles.confirmedBody}>
                    <View style={styles.confirmedAvatar}>
                      <Text style={styles.confirmedAvatarText}>{getInitials(assignedEmployee.name)}</Text>
                      <View style={styles.verifiedBadge}>
                        <Check size={10} color={Colors.light.background} />
                      </View>
                    </View>
                    <View style={styles.confirmedDetails}>
                      <Text style={styles.confirmedName}>{assignedEmployee.name}</Text>
                      <Text style={styles.confirmedMeta}>Pers No: {assignedEmployee.persNo}</Text>
                      {assignedEmployee.designation && (
                        <Text style={styles.confirmedDesignation}>{assignedEmployee.designation}</Text>
                      )}
                    </View>
                    <TouchableOpacity
                      style={styles.changeBtn}
                      onPress={clearEmployee}
                    >
                      <Text style={styles.changeBtnText}>Change</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {assignedToStaffId.length >= 3 && !foundEmployee && !assignedEmployee && !isSearchingStaff && !staffSearchQuery.isLoading && (
                <Text style={styles.staffNotFound}>No registered employee found with this Pers No</Text>
              )}
              <Text style={styles.helperText}>This person will manage the task and can create subtasks</Text>
            </View>

            <View style={styles.dividerContainer}>
              <View style={styles.divider} />
              <Text style={styles.dividerText}>OR</Text>
              <View style={styles.divider} />
            </View>

            <TouchableOpacity
              style={styles.pickFromTeamButton}
              onPress={() => setShowTeamPicker(true)}
            >
              <Users size={20} color={Colors.light.primary} />
              <View style={styles.pickFromTeamContent}>
                <Text style={styles.pickFromTeamTitle}>Pick from My Team</Text>
                <Text style={styles.pickFromTeamSubtitle}>
                  {teamAssignments.length === 0 
                    ? 'Select team members from your hierarchy'
                    : `${teamAssignments.length} team member${teamAssignments.length > 1 ? 's' : ''} assigned`
                  }
                </Text>
              </View>
              <ChevronRight size={20} color={Colors.light.textSecondary} />
            </TouchableOpacity>

            {teamAssignments.length > 0 && (
              <View style={styles.teamAssignmentsList}>
                <Text style={styles.teamAssignmentsTitle}>Team Assignments</Text>
                {teamAssignments.map((assignment) => (
                  <View key={assignment.employeePersNo} style={styles.teamAssignmentCard}>
                    <View style={styles.teamAssignmentLeft}>
                      <View style={styles.teamAssignmentAvatar}>
                        <Text style={styles.teamAssignmentAvatarText}>
                          {assignment.employeeName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
                        </Text>
                      </View>
                      <View style={styles.teamAssignmentInfo}>
                        <Text style={styles.teamAssignmentName}>{assignment.employeeName}</Text>
                        <Text style={styles.teamAssignmentMeta}>{assignment.employeePersNo}</Text>
                        <View style={styles.teamAssignmentTasks}>
                          {assignment.taskIds.map(taskId => {
                            const taskLabel = TASK_TYPES.find(t => t.id === taskId)?.label || taskId;
                            return (
                              <View key={taskId} style={styles.teamAssignmentTaskPill}>
                                <Text style={styles.teamAssignmentTaskText}>{taskLabel}</Text>
                              </View>
                            );
                          })}
                        </View>
                      </View>
                    </View>
                    <TouchableOpacity
                      style={styles.removeAssignmentBtn}
                      onPress={() => setTeamAssignments(prev => prev.filter(a => a.employeePersNo !== assignment.employeePersNo))}
                    >
                      <Trash2 size={16} color={Colors.light.error} />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
          </View>

          <View style={styles.locationSection}>
            <Text style={styles.locationSectionTitle}>Location</Text>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Pin Code</Text>
              <View style={styles.pincodeInputContainer}>
                <TextInput
                  style={[styles.input, styles.pincodeInput]}
                  placeholder="Enter 6-digit PIN code"
                  value={pinCode}
                  onChangeText={handlePinCodeChange}
                  keyboardType="numeric"
                  maxLength={6}
                />
                {isLoadingPincode && (
                  <ActivityIndicator size="small" color={Colors.light.primary} style={styles.pincodeLoader} />
                )}
              </View>
              {pincodeError ? (
                <Text style={styles.pincodeError}>{pincodeError}</Text>
              ) : pinCode.length === 6 && !isLoadingPincode && location ? (
                <Text style={styles.pincodeSuccess}>Location auto-filled</Text>
              ) : (
                <Text style={styles.helperText}>Enter PIN code to auto-fill location details</Text>
              )}
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Location *</Text>
              <TextInput
                style={styles.input}
                placeholder="Enter location"
                value={location}
                onChangeText={setLocation}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>City</Text>
              <TextInput
                style={styles.input}
                placeholder="Enter city"
                value={city}
                onChangeText={setCity}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Circle *</Text>
              <TouchableOpacity 
                style={styles.picker}
                onPress={() => setShowCirclePicker(!showCirclePicker)}
                disabled={circlesQuery.isLoading}
              >
                {circlesQuery.isLoading ? (
                  <ActivityIndicator size="small" color={Colors.light.primary} />
                ) : (
                  <Text style={styles.pickerText}>{getCircleLabel(circle)}</Text>
                )}
              </TouchableOpacity>
              {showCirclePicker && (
                <View style={styles.pickerOptions}>
                  <ScrollView nestedScrollEnabled={true} showsVerticalScrollIndicator={true}>
                    {circlesList.map((c) => (
                      <TouchableOpacity
                        key={c.value}
                        style={[
                          styles.pickerOption,
                          circle === c.value && styles.pickerOptionSelected
                        ]}
                        onPress={() => {
                          setCircle(c.value);
                          setShowCirclePicker(false);
                        }}
                      >
                        <Text style={[
                          styles.pickerOptionText,
                          circle === c.value && styles.pickerOptionTextSelected
                        ]}>{c.label}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              )}
            </View>

          </View>

          <View style={styles.dateSection}>
            <Text style={styles.dateSectionTitle}>Task Duration</Text>
            
            <View style={styles.dateRow}>
              <View style={styles.dateField}>
                <Text style={styles.dateLabel}>Start Date *</Text>
                <TouchableOpacity 
                  style={[styles.dateInput, showStartCalendar && styles.dateInputActive]}
                  onPress={() => {
                    setShowStartCalendar(!showStartCalendar);
                    setShowEndCalendar(false);
                  }}
                >
                  <Calendar size={18} color={Colors.light.primary} />
                  <Text style={[styles.dateInputText, !startDate && styles.dateInputPlaceholder]}>
                    {startDate ? formatDisplayDate(startDate) : 'Select date'}
                  </Text>
                </TouchableOpacity>
              </View>

              <View style={styles.dateField}>
                <Text style={styles.dateLabel}>End Date *</Text>
                <TouchableOpacity 
                  style={[styles.dateInput, showEndCalendar && styles.dateInputActive]}
                  onPress={() => {
                    setShowEndCalendar(!showEndCalendar);
                    setShowStartCalendar(false);
                    if (startDate) {
                      const start = parseDate(startDate);
                      if (start) {
                        setEndCalendarMonth(start.getMonth());
                        setEndCalendarYear(start.getFullYear());
                      }
                    }
                  }}
                >
                  <Calendar size={18} color={Colors.light.primary} />
                  <Text style={[styles.dateInputText, !endDate && styles.dateInputPlaceholder]}>
                    {endDate ? formatDisplayDate(endDate) : 'Select date'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {showStartCalendar && (
              <View style={styles.calendarContainer}>
                <View style={styles.calendarHeader}>
                  <TouchableOpacity 
                    style={styles.calendarNavBtn}
                    onPress={() => {
                      if (startCalendarMonth === 0) {
                        setStartCalendarMonth(11);
                        setStartCalendarYear(startCalendarYear - 1);
                      } else {
                        setStartCalendarMonth(startCalendarMonth - 1);
                      }
                    }}
                  >
                    <ChevronLeft size={20} color={Colors.light.text} />
                  </TouchableOpacity>
                  <Text style={styles.calendarTitle}>
                    {MONTHS[startCalendarMonth]} {startCalendarYear}
                  </Text>
                  <TouchableOpacity 
                    style={styles.calendarNavBtn}
                    onPress={() => {
                      if (startCalendarMonth === 11) {
                        setStartCalendarMonth(0);
                        setStartCalendarYear(startCalendarYear + 1);
                      } else {
                        setStartCalendarMonth(startCalendarMonth + 1);
                      }
                    }}
                  >
                    <ChevronRight size={20} color={Colors.light.text} />
                  </TouchableOpacity>
                </View>
                
                <View style={styles.weekdayRow}>
                  {WEEKDAYS.map(day => (
                    <Text key={day} style={styles.weekdayText}>{day}</Text>
                  ))}
                </View>
                
                <View style={styles.daysGrid}>
                  {generateCalendarDays(startCalendarMonth, startCalendarYear).map((day, index) => {
                    const isToday = day !== null && startCalendarMonth === today.getMonth() && 
                                    startCalendarYear === today.getFullYear() && day === today.getDate();
                    const isSelected = day !== null && startDate === formatDateString(new Date(startCalendarYear, startCalendarMonth, day));
                    const isDisabled = day !== null ? isDateDisabled(day, startCalendarMonth, startCalendarYear, false) : false;
                    
                    return (
                      <TouchableOpacity
                        key={index}
                        style={[
                          styles.dayCell,
                          isToday ? styles.dayCellToday : null,
                          isSelected ? styles.dayCellSelected : null,
                          isDisabled ? styles.dayCellDisabled : null,
                        ]}
                        onPress={() => day !== null && !isDisabled && handleSelectStartDate(day)}
                        disabled={day === null || isDisabled}
                      >
                        <Text style={[
                          styles.dayText,
                          isToday ? styles.dayTextToday : null,
                          isSelected ? styles.dayTextSelected : null,
                          isDisabled ? styles.dayTextDisabled : null,
                        ]}>
                          {day !== null ? day : ''}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            )}

            {showEndCalendar && (
              <View style={styles.calendarContainer}>
                <View style={styles.calendarHeader}>
                  <TouchableOpacity 
                    style={styles.calendarNavBtn}
                    onPress={() => {
                      if (endCalendarMonth === 0) {
                        setEndCalendarMonth(11);
                        setEndCalendarYear(endCalendarYear - 1);
                      } else {
                        setEndCalendarMonth(endCalendarMonth - 1);
                      }
                    }}
                  >
                    <ChevronLeft size={20} color={Colors.light.text} />
                  </TouchableOpacity>
                  <Text style={styles.calendarTitle}>
                    {MONTHS[endCalendarMonth]} {endCalendarYear}
                  </Text>
                  <TouchableOpacity 
                    style={styles.calendarNavBtn}
                    onPress={() => {
                      if (endCalendarMonth === 11) {
                        setEndCalendarMonth(0);
                        setEndCalendarYear(endCalendarYear + 1);
                      } else {
                        setEndCalendarMonth(endCalendarMonth + 1);
                      }
                    }}
                  >
                    <ChevronRight size={20} color={Colors.light.text} />
                  </TouchableOpacity>
                </View>
                
                <View style={styles.weekdayRow}>
                  {WEEKDAYS.map(day => (
                    <Text key={day} style={styles.weekdayText}>{day}</Text>
                  ))}
                </View>
                
                <View style={styles.daysGrid}>
                  {generateCalendarDays(endCalendarMonth, endCalendarYear).map((day, index) => {
                    const isToday = day !== null && endCalendarMonth === today.getMonth() && 
                                    endCalendarYear === today.getFullYear() && day === today.getDate();
                    const isSelected = day !== null && endDate === formatDateString(new Date(endCalendarYear, endCalendarMonth, day));
                    const isDisabled = day !== null ? isDateDisabled(day, endCalendarMonth, endCalendarYear, true) : false;
                    
                    return (
                      <TouchableOpacity
                        key={index}
                        style={[
                          styles.dayCell,
                          isToday ? styles.dayCellToday : null,
                          isSelected ? styles.dayCellSelected : null,
                          isDisabled ? styles.dayCellDisabled : null,
                        ]}
                        onPress={() => day !== null && !isDisabled && handleSelectEndDate(day)}
                        disabled={day === null || isDisabled}
                      >
                        <Text style={[
                          styles.dayText,
                          isToday ? styles.dayTextToday : null,
                          isSelected ? styles.dayTextSelected : null,
                          isDisabled ? styles.dayTextDisabled : null,
                        ]}>
                          {day !== null ? day : ''}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                
                {startDate && (
                  <Text style={styles.calendarHint}>
                    End date must be on or after {formatDisplayDate(startDate)}
                  </Text>
                )}
              </View>
            )}
          </View>

          {hasSalesTargets && (
            <View style={styles.targetSection}>
              <Text style={styles.targetSectionTitle}>Sales Targets</Text>
              <View style={styles.row}>
                {showSimTarget && (
                  <View style={[styles.inputGroup, styles.halfWidth]}>
                    <Text style={styles.label}>SIM Target</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="0"
                      value={targetSim}
                      onChangeText={setTargetSim}
                      keyboardType="number-pad"
                    />
                  </View>
                )}

                {showFtthTarget && (
                  <View style={[styles.inputGroup, styles.halfWidth]}>
                    <Text style={styles.label}>FTTH Target</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="0"
                      value={targetFtth}
                      onChangeText={setTargetFtth}
                      keyboardType="number-pad"
                    />
                  </View>
                )}
              </View>

              <View style={styles.row}>
                {showLeaseCircuitTarget && (
                  <View style={[styles.inputGroup, styles.halfWidth]}>
                    <Text style={styles.label}>Lease Circuit Target</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="0"
                      value={targetLeaseCircuit}
                      onChangeText={setTargetLeaseCircuit}
                      keyboardType="number-pad"
                    />
                  </View>
                )}

                {showEbTarget && (
                  <View style={[styles.inputGroup, styles.halfWidth]}>
                    <Text style={styles.label}>EB Target</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="0"
                      value={targetEb}
                      onChangeText={setTargetEb}
                      keyboardType="number-pad"
                    />
                  </View>
                )}
              </View>
            </View>
          )}

          {selectedMaintenanceTasks.map((taskId) => {
            const taskInfo = MAINTENANCE_TASKS.find(t => t.id === taskId);
            const details = maintenanceDetails[taskId];
            if (!taskInfo || !details) return null;
            
            return (
              <View key={taskId} style={styles.maintenanceSection}>
                <View style={styles.maintenanceSectionHeader}>
                  <Text style={styles.maintenanceSectionTitle}>{taskInfo.label} Details</Text>
                </View>
                
                <View style={styles.maintenanceContent}>
                  <Text style={styles.maintenanceLabel}>Priority Level *</Text>
                  <View style={styles.priorityContainer}>
                    {(['low', 'medium', 'high', 'critical'] as const).map((priority) => (
                      <TouchableOpacity
                        key={priority}
                        style={[
                          styles.priorityButton,
                          details.priority === priority && styles.priorityButtonSelected,
                          priority === 'critical' && details.priority === priority && styles.priorityButtonCritical,
                          priority === 'high' && details.priority === priority && styles.priorityButtonHigh,
                          priority === 'medium' && details.priority === priority && styles.priorityButtonMedium,
                          priority === 'low' && details.priority === priority && styles.priorityButtonLow,
                        ]}
                        onPress={() => updateMaintenanceDetail(taskId, 'priority', priority)}
                      >
                        <Text style={[
                          styles.priorityButtonText,
                          details.priority === priority && styles.priorityButtonTextSelected
                        ]}>
                          {priority.charAt(0).toUpperCase() + priority.slice(1)}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <View style={styles.maintenanceFieldsRow}>
                    <View style={styles.maintenanceFieldHalf}>
                      <Text style={styles.maintenanceLabel}>Sites to Attend</Text>
                      <TextInput
                        style={styles.maintenanceInput}
                        placeholder="Number of sites"
                        placeholderTextColor="#9CA3AF"
                        value={details.sites}
                        onChangeText={(value) => updateMaintenanceDetail(taskId, 'sites', value)}
                        keyboardType="number-pad"
                      />
                    </View>

                    <View style={styles.maintenanceFieldHalf}>
                      <Text style={styles.maintenanceLabel}>Est. Hours</Text>
                      <TextInput
                        style={styles.maintenanceInput}
                        placeholder="Hours"
                        placeholderTextColor="#9CA3AF"
                        value={details.hours}
                        onChangeText={(value) => updateMaintenanceDetail(taskId, 'hours', value)}
                        keyboardType="number-pad"
                      />
                    </View>
                  </View>
                </View>
              </View>
            );
          })}

          {isMaintenance && (
            <View style={styles.maintenanceInfo}>
              <Text style={styles.maintenanceInfoText}>
                Maintenance tasks require field team assignment. Use Notes for issue details.
              </Text>
            </View>
          )}

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Notes</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="Enter notes for this task"
              value={keyInsight}
              onChangeText={setKeyInsight}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
            />
          </View>

          <TouchableOpacity 
            style={[styles.submitButton, isSubmitting && styles.submitButtonDisabled]}
            onPress={handleSubmit}
            disabled={isSubmitting}
          >
            <Text style={styles.submitButtonText}>
              {isSubmitting ? 'Creating...' : 'Create Task'}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.bottomSpacer} />
      </ScrollView>

      <TeamHierarchyPicker
        visible={showTeamPicker}
        onClose={() => setShowTeamPicker(false)}
        employeeId={employee?.id || ''}
        selectedTasks={selectedCategories.map(id => ({
          id,
          label: TASK_TYPES.find(t => t.id === id)?.label || id,
        }))}
        onAssignmentsComplete={(assignments) => setTeamAssignments(assignments)}
        existingAssignments={teamAssignments}
      />
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
  inputText: {
    fontSize: 16,
    color: Colors.light.text,
  },
  textArea: {
    minHeight: 100,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  halfWidth: {
    flex: 1,
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
  pickerOptionSelected: {
    backgroundColor: Colors.light.primary + '15',
  },
  pickerOptionText: {
    fontSize: 16,
    color: Colors.light.text,
  },
  pickerOptionTextSelected: {
    color: Colors.light.primary,
    fontWeight: '600' as const,
  },
  categorySection: {
    backgroundColor: Colors.light.background,
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  categorySectionTitle: {
    fontSize: 16,
    fontWeight: 'bold' as const,
    color: Colors.light.text,
    marginBottom: 16,
  },
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'space-between',
  },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.light.backgroundSecondary,
    borderRadius: 25,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderWidth: 2,
    borderColor: Colors.light.border,
    gap: 8,
    width: '48%',
    marginBottom: 4,
  },
  categoryChipSelected: {
    backgroundColor: Colors.light.primary,
    borderColor: Colors.light.primary,
  },
  categoryCheckbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: Colors.light.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryCheckboxSelected: {
    backgroundColor: Colors.light.primary,
    borderColor: Colors.light.primary,
  },
  categoryChipText: {
    fontSize: 14,
    color: Colors.light.text,
    fontWeight: '600' as const,
    textAlign: 'center' as const,
  },
  categoryChipTextSelected: {
    color: '#FFFFFF',
    fontWeight: '700' as const,
  },
  selectedCategoriesInfo: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
  },
  selectedCategoriesText: {
    fontSize: 13,
    color: Colors.light.primary,
    fontWeight: '500' as const,
  },
  targetSection: {
    backgroundColor: Colors.light.background,
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  targetSectionTitle: {
    fontSize: 16,
    fontWeight: 'bold' as const,
    color: Colors.light.text,
    marginBottom: 16,
  },
  maintenanceInfo: {
    backgroundColor: Colors.light.warning + '15',
    borderRadius: 8,
    padding: 12,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: Colors.light.warning,
  },
  maintenanceInfoText: {
    fontSize: 13,
    color: Colors.light.warning,
    textAlign: 'center',
  },
  maintenanceSection: {
    backgroundColor: Colors.light.background,
    borderRadius: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.light.border,
    overflow: 'hidden',
  },
  maintenanceSectionHeader: {
    backgroundColor: Colors.light.primary + '10',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  maintenanceSectionTitle: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: Colors.light.primary,
  },
  maintenanceContent: {
    padding: 16,
  },
  maintenanceLabel: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.light.textSecondary,
    marginBottom: 10,
  },
  priorityContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 20,
  },
  priorityButton: {
    flex: 1,
    minWidth: '22%',
    maxWidth: '24%',
    paddingVertical: 10,
    marginRight: 8,
    marginBottom: 0,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: Colors.light.border,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  priorityButtonSelected: {
    borderColor: Colors.light.primary,
  },
  priorityButtonCritical: {
    backgroundColor: '#DC2626',
    borderColor: '#DC2626',
  },
  priorityButtonHigh: {
    backgroundColor: '#F97316',
    borderColor: '#F97316',
  },
  priorityButtonMedium: {
    backgroundColor: '#FBBF24',
    borderColor: '#FBBF24',
  },
  priorityButtonLow: {
    backgroundColor: '#22C55E',
    borderColor: '#22C55E',
  },
  priorityButtonText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.light.textSecondary,
  },
  priorityButtonTextSelected: {
    color: '#fff',
    fontWeight: '700' as const,
  },
  maintenanceFieldsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  maintenanceFieldHalf: {
    flex: 1,
  },
  maintenanceInput: {
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: Colors.light.text,
  },
  priorityRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  priorityChip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.light.border,
    backgroundColor: '#fff',
  },
  priorityChipSelected: {
    borderColor: Colors.light.primary,
  },
  priorityChipCritical: {
    backgroundColor: '#DC2626',
    borderColor: '#DC2626',
  },
  priorityChipHigh: {
    backgroundColor: '#F97316',
    borderColor: '#F97316',
  },
  priorityChipMedium: {
    backgroundColor: '#FBBF24',
    borderColor: '#FBBF24',
  },
  priorityChipLow: {
    backgroundColor: '#22C55E',
    borderColor: '#22C55E',
  },
  priorityChipText: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.light.textSecondary,
  },
  priorityChipTextSelected: {
    color: '#fff',
    fontWeight: '600',
  },
  assignSection: {
    backgroundColor: Colors.light.background,
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  locationSection: {
    backgroundColor: Colors.light.background,
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  locationSectionTitle: {
    fontSize: 16,
    fontWeight: 'bold' as const,
    color: Colors.light.text,
    marginBottom: 16,
  },
  assignSectionTitle: {
    fontSize: 16,
    fontWeight: 'bold' as const,
    color: Colors.light.text,
    marginBottom: 16,
  },
  mobileInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.light.background,
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 8,
    paddingHorizontal: 14,
    gap: 10,
  },
  mobileInput: {
    flex: 1,
    paddingVertical: 14,
    fontSize: 16,
    color: Colors.light.text,
  },
  submitButton: {
    backgroundColor: Colors.light.primary,
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
  staffSearching: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    gap: 8,
  },
  staffSearchingText: {
    fontSize: 14,
    color: Colors.light.textSecondary,
  },
  assignedEmployeeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.light.success + '15',
    borderWidth: 1,
    borderColor: Colors.light.success,
    borderRadius: 8,
    padding: 12,
    marginTop: 8,
  },
  assignedEmployeeInfo: {
    flex: 1,
  },
  assignedEmployeeName: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.light.text,
  },
  assignedEmployeeId: {
    fontSize: 13,
    color: Colors.light.textSecondary,
    marginTop: 2,
  },
  clearAssigneeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.light.error + '20',
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearAssigneeBtnText: {
    fontSize: 18,
    color: Colors.light.error,
    fontWeight: 'bold' as const,
  },
  staffNotFound: {
    fontSize: 13,
    color: Colors.light.error,
    marginTop: 8,
  },
  helperText: {
    fontSize: 12,
    color: Colors.light.textSecondary,
    marginTop: 6,
    fontStyle: 'italic' as const,
  },
  pincodeInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    position: 'relative' as const,
  },
  pincodeInput: {
    flex: 1,
    paddingRight: 40,
  },
  pincodeLoader: {
    position: 'absolute' as const,
    right: 12,
  },
  pincodeError: {
    fontSize: 12,
    color: Colors.light.error,
    marginTop: 6,
  },
  pincodeSuccess: {
    fontSize: 12,
    color: Colors.light.success,
    marginTop: 6,
  },
  foundEmployeeCard: {
    backgroundColor: Colors.light.background,
    borderRadius: 12,
    marginTop: 12,
    borderWidth: 2,
    borderColor: Colors.light.primary,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  foundEmployeeHeader: {
    backgroundColor: Colors.light.primary + '15',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.primary + '30',
  },
  foundEmployeeLabel: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.light.primary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  foundEmployeeBody: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 14,
  },
  employeeAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: Colors.light.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  employeeAvatarText: {
    fontSize: 18,
    fontWeight: 'bold' as const,
    color: Colors.light.background,
  },
  employeeDetails: {
    flex: 1,
  },
  employeeName: {
    fontSize: 17,
    fontWeight: '700' as const,
    color: Colors.light.text,
    marginBottom: 4,
  },
  employeeMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  employeeMeta: {
    fontSize: 13,
    color: Colors.light.textSecondary,
    fontWeight: '500' as const,
  },
  employeeDesignation: {
    fontSize: 13,
    color: Colors.light.primary,
    marginTop: 3,
    fontWeight: '500' as const,
  },
  employeeCircle: {
    fontSize: 12,
    color: Colors.light.textSecondary,
    marginTop: 2,
  },
  foundEmployeeActions: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
  },
  rejectBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    gap: 8,
    borderRightWidth: 1,
    borderRightColor: Colors.light.border,
    backgroundColor: Colors.light.error + '08',
  },
  rejectBtnText: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.light.error,
  },
  confirmBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    gap: 8,
    backgroundColor: Colors.light.success,
  },
  confirmBtnText: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.light.background,
  },
  confirmedEmployeeCard: {
    backgroundColor: Colors.light.success + '10',
    borderRadius: 12,
    marginTop: 12,
    borderWidth: 2,
    borderColor: Colors.light.success,
    overflow: 'hidden',
  },
  confirmedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: Colors.light.success + '20',
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.success + '40',
  },
  confirmedLabel: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.light.success,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  confirmedBody: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    gap: 12,
  },
  confirmedAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.light.success,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  confirmedAvatarText: {
    fontSize: 16,
    fontWeight: 'bold' as const,
    color: Colors.light.background,
  },
  verifiedBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: Colors.light.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: Colors.light.background,
  },
  confirmedDetails: {
    flex: 1,
  },
  confirmedName: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.light.text,
  },
  confirmedMeta: {
    fontSize: 13,
    color: Colors.light.textSecondary,
    marginTop: 2,
  },
  confirmedDesignation: {
    fontSize: 12,
    color: Colors.light.success,
    marginTop: 2,
    fontWeight: '500' as const,
  },
  changeBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: Colors.light.background,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  changeBtnText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.light.textSecondary,
  },
  dateSection: {
    backgroundColor: Colors.light.background,
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  dateSectionTitle: {
    fontSize: 16,
    fontWeight: 'bold' as const,
    color: Colors.light.text,
    marginBottom: 16,
  },
  dateRow: {
    flexDirection: 'row',
    gap: 12,
  },
  dateField: {
    flex: 1,
  },
  dateLabel: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.light.textSecondary,
    marginBottom: 8,
  },
  dateInput: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.light.backgroundSecondary,
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 10,
    padding: 14,
    gap: 10,
  },
  dateInputActive: {
    borderColor: Colors.light.primary,
    backgroundColor: Colors.light.lightBlue,
  },
  dateInputText: {
    fontSize: 14,
    color: Colors.light.text,
    fontWeight: '500' as const,
  },
  dateInputPlaceholder: {
    color: Colors.light.textSecondary,
    fontWeight: '400' as const,
  },
  calendarContainer: {
    backgroundColor: Colors.light.background,
    borderRadius: 12,
    padding: 16,
    marginTop: 16,
    borderWidth: 1,
    borderColor: Colors.light.primary + '30',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  calendarHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    paddingHorizontal: 4,
  },
  calendarNavBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.light.backgroundSecondary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  calendarTitle: {
    fontSize: 16,
    fontWeight: 'bold' as const,
    color: Colors.light.text,
  },
  weekdayRow: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  weekdayText: {
    flex: 1,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.light.textSecondary,
  },
  daysGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  dayCell: {
    width: '14.28%',
    aspectRatio: 1,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 20,
  },
  dayCellToday: {
    borderWidth: 2,
    borderColor: Colors.light.primary,
  },
  dayCellSelected: {
    backgroundColor: Colors.light.primary,
  },
  dayCellDisabled: {
    opacity: 0.3,
  },
  dayText: {
    fontSize: 14,
    color: Colors.light.text,
  },
  dayTextToday: {
    fontWeight: 'bold' as const,
    color: Colors.light.primary,
  },
  dayTextSelected: {
    color: Colors.light.background,
    fontWeight: 'bold' as const,
  },
  dayTextDisabled: {
    color: Colors.light.textSecondary,
  },
  calendarHint: {
    fontSize: 12,
    color: Colors.light.primary,
    textAlign: 'center',
    marginTop: 12,
    fontStyle: 'italic' as const,
  },
  dividerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 20,
  },
  divider: {
    flex: 1,
    height: 1,
    backgroundColor: Colors.light.border,
  },
  dividerText: {
    marginHorizontal: 16,
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.light.textSecondary,
  },
  pickFromTeamButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E3F2FD',
    borderWidth: 2,
    borderColor: Colors.light.primary,
    borderRadius: 12,
    padding: 16,
  },
  pickFromTeamContent: {
    flex: 1,
    marginLeft: 12,
  },
  pickFromTeamTitle: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.light.primary,
  },
  pickFromTeamSubtitle: {
    fontSize: 12,
    color: Colors.light.textSecondary,
    marginTop: 2,
  },
  teamAssignmentsList: {
    marginTop: 16,
    backgroundColor: Colors.light.success + '08',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.light.success + '30',
  },
  teamAssignmentsTitle: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.light.success,
    marginBottom: 12,
  },
  teamAssignmentCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.light.background,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  teamAssignmentLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  teamAssignmentAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.light.success,
    alignItems: 'center',
    justifyContent: 'center',
  },
  teamAssignmentAvatarText: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: '#fff',
  },
  teamAssignmentInfo: {
    flex: 1,
    marginLeft: 12,
  },
  teamAssignmentName: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.light.text,
  },
  teamAssignmentMeta: {
    fontSize: 12,
    color: Colors.light.textSecondary,
    marginTop: 2,
  },
  teamAssignmentTasks: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 6,
    gap: 4,
  },
  teamAssignmentTaskPill: {
    backgroundColor: Colors.light.primary,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  teamAssignmentTaskText: {
    fontSize: 10,
    fontWeight: '600' as const,
    color: '#fff',
  },
  removeAssignmentBtn: {
    padding: 8,
    marginLeft: 8,
  },
});
