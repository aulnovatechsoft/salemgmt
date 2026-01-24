import { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert, RefreshControl, Platform } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Upload, Users, Search, Trash2, Link, ChevronLeft, FileText, CheckCircle, XCircle, BarChart3, Calendar } from 'lucide-react-native';
import { useAuth } from '@/contexts/auth';
import Colors from '@/constants/colors';
import { trpc } from '@/lib/trpc';
import { canCreateEvents } from '@/constants/app';

export default function AdminScreen() {
  const router = useRouter();
  const { employee } = useAuth();
  
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterLinked, setFilterLinked] = useState<boolean | undefined>(undefined);
  const [csvText, setCsvText] = useState('');
  const [showUploadSection, setShowUploadSection] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0, imported: 0, updated: 0, errors: 0 });
  
  const [eventsCsvText, setEventsCsvText] = useState('');
  const [showEventsUploadSection, setShowEventsUploadSection] = useState(false);
  const [importingEvents, setImportingEvents] = useState(false);
  const [eventsImportProgress, setEventsImportProgress] = useState({ current: 0, total: 0, imported: 0, updated: 0, errors: 0 });
  
  const trpcUtils = trpc.useUtils();
  
  const { data: stats, refetch: refetchStats } = trpc.admin.getEmployeeMasterStats.useQuery();
  const { data: eventStats, refetch: refetchEventStats } = trpc.admin.getEventStats.useQuery();
  const { data: employeeList, isLoading, refetch } = trpc.admin.getEmployeeMasterList.useQuery({
    linked: filterLinked,
    limit: 100,
  });
  
  const importMutation = trpc.admin.importEmployeeMaster.useMutation({
    onSuccess: (result) => {
      Alert.alert(
        'Import Complete',
        `Imported: ${result.imported}\nUpdated: ${result.updated}\nErrors: ${result.errors.length}`,
        [{ text: 'OK' }]
      );
      setCsvText('');
      setShowUploadSection(false);
      refetch();
      refetchStats();
    },
    onError: (error) => {
      Alert.alert('Import Error', error.message);
    },
  });
  
  const importEventsMutation = trpc.admin.importEvents.useMutation({
    onSuccess: (result) => {
      Alert.alert(
        'Works Import Complete',
        `Imported: ${result.imported}\nUpdated: ${result.updated}\nErrors: ${result.errors.length}${result.errors.length > 0 ? '\n\nFirst errors:\n' + result.errors.slice(0, 3).join('\n') : ''}`,
        [{ text: 'OK' }]
      );
      setEventsCsvText('');
      setShowEventsUploadSection(false);
      refetchEventStats();
      trpcUtils.events.getAll.invalidate();
    },
    onError: (error) => {
      Alert.alert('Works Import Error', error.message);
    },
  });
  
  const clearMutation = trpc.admin.clearEmployeeMaster.useMutation({
    onSuccess: () => {
      Alert.alert('Success', 'Cleared all unlinked records');
      refetch();
      refetchStats();
    },
    onError: (error) => {
      Alert.alert('Error', error.message);
    },
  });
  
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refetch(), refetchStats(), refetchEventStats()]);
    setRefreshing(false);
  }, [refetch, refetchStats, refetchEventStats]);
  
  const isAdmin = canCreateEvents(employee?.role || 'SALES_STAFF');
  
  if (!isAdmin) {
    return (
      <>
        <Stack.Screen options={{ title: 'Admin Panel', headerStyle: { backgroundColor: Colors.light.primary }, headerTintColor: Colors.light.background }} />
        <View style={styles.container}>
          <View style={styles.accessDenied}>
            <XCircle size={48} color={Colors.light.error} />
            <Text style={styles.accessDeniedTitle}>Access Denied</Text>
            <Text style={styles.accessDeniedText}>You need manager privileges to access the Admin Panel.</Text>
            <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
              <Text style={styles.backButtonText}>Go Back</Text>
            </TouchableOpacity>
          </View>
        </View>
      </>
    );
  }
  
  const parseCSV = (text: string) => {
    const lines = text.trim().split('\n');
    if (lines.length < 2) {
      throw new Error('CSV must have a header row and at least one data row');
    }
    
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/\s+/g, '_'));
    
    const purseIdIdx = headers.findIndex(h => h.includes('employee_pers_no') || h.includes('pers_no') || h.includes('purse') || h.includes('purse_id'));
    const nameIdx = headers.findIndex(h => h.includes('emp_name') || h.includes('employee_name') || h === 'name');
    const circleIdx = headers.findIndex(h => h === 'circle');
    const zoneIdx = headers.findIndex(h => h.includes('ba_name') || h.includes('zone'));
    const designationIdx = headers.findIndex(h => h.includes('employee_designation') || h.includes('designation'));
    const empGroupIdx = headers.findIndex(h => h.includes('emp_group'));
    const reportingIdx = headers.findIndex(h => h.includes('controller_officer_pers_no') || h.includes('reporting'));
    const reportingNameIdx = headers.findIndex(h => h.includes('controller_officer_name'));
    const reportingDesigIdx = headers.findIndex(h => h.includes('controller_designation'));
    const divisionIdx = headers.findIndex(h => h.includes('division_of_employee') || h.includes('division'));
    const buildingIdx = headers.findIndex(h => h.includes('building_name'));
    const officeIdx = headers.findIndex(h => h.includes('office_name'));
    const shiftIdx = headers.findIndex(h => h.includes('shift_group'));
    const distanceIdx = headers.findIndex(h => h.includes('distance_limit'));
    const sortOrderIdx = headers.findIndex(h => h.includes('sort_order'));
    
    if (purseIdIdx === -1 || nameIdx === -1) {
      throw new Error('CSV must have Employee Pers No and Name columns');
    }
    
    const data = [];
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map(v => v.trim());
      if (values.length < 2) continue;
      
      const purseId = values[purseIdIdx];
      const name = values[nameIdx];
      
      if (!purseId || !name) continue;
      
      data.push({
        purseId,
        name,
        circle: circleIdx >= 0 ? values[circleIdx] : undefined,
        zone: zoneIdx >= 0 ? values[zoneIdx] : undefined,
        designation: designationIdx >= 0 ? values[designationIdx] : undefined,
        empGroup: empGroupIdx >= 0 ? values[empGroupIdx] : undefined,
        reportingPurseId: reportingIdx >= 0 ? values[reportingIdx] : undefined,
        reportingOfficerName: reportingNameIdx >= 0 ? values[reportingNameIdx] : undefined,
        reportingOfficerDesignation: reportingDesigIdx >= 0 ? values[reportingDesigIdx] : undefined,
        division: divisionIdx >= 0 ? values[divisionIdx] : undefined,
        buildingName: buildingIdx >= 0 ? values[buildingIdx] : undefined,
        officeName: officeIdx >= 0 ? values[officeIdx] : undefined,
        shiftGroup: shiftIdx >= 0 ? values[shiftIdx] : undefined,
        distanceLimit: distanceIdx >= 0 ? values[distanceIdx] : undefined,
        sortOrder: sortOrderIdx >= 0 ? parseInt(values[sortOrderIdx]) || undefined : undefined,
      });
    }
    
    return data;
  };
  
  const handleImport = async () => {
    if (!csvText.trim()) {
      Alert.alert('Error', 'Please paste CSV data');
      return;
    }
    
    try {
      const data = parseCSV(csvText);
      if (data.length === 0) {
        Alert.alert('Error', 'No valid data found in CSV');
        return;
      }
      
      const BATCH_SIZE = 500;
      const totalBatches = Math.ceil(data.length / BATCH_SIZE);
      
      Alert.alert(
        'Confirm Import',
        `Import ${data.length} employee records in ${totalBatches} batches?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Import',
            onPress: async () => {
              setImporting(true);
              setImportProgress({ current: 0, total: data.length, imported: 0, updated: 0, errors: 0 });
              
              let totalImported = 0;
              let totalUpdated = 0;
              let totalErrors = 0;
              
              for (let i = 0; i < data.length; i += BATCH_SIZE) {
                const batch = data.slice(i, i + BATCH_SIZE);
                const batchNum = Math.floor(i / BATCH_SIZE) + 1;
                
                try {
                  const result = await importMutation.mutateAsync({ 
                    data: batch, 
                    uploadedBy: employee?.id || '' 
                  });
                  totalImported += result.imported;
                  totalUpdated += result.updated;
                  totalErrors += result.errors.length;
                  
                  setImportProgress({
                    current: Math.min(i + BATCH_SIZE, data.length),
                    total: data.length,
                    imported: totalImported,
                    updated: totalUpdated,
                    errors: totalErrors,
                  });
                } catch (err: any) {
                  console.error(`Batch ${batchNum} failed:`, err);
                  totalErrors += batch.length;
                }
              }
              
              setImporting(false);
              Alert.alert(
                'Import Complete',
                `Imported: ${totalImported}\nUpdated: ${totalUpdated}\nErrors: ${totalErrors}`,
                [{ text: 'OK' }]
              );
              setCsvText('');
              setShowUploadSection(false);
              refetch();
              refetchStats();
            },
          },
        ]
      );
    } catch (error: any) {
      Alert.alert('Parse Error', error.message);
    }
  };
  
  const handleClearUnlinked = () => {
    Alert.alert(
      'Clear Unlinked Records',
      'This will delete all employee master records that are not linked to user accounts. Are you sure?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: () => clearMutation.mutate({ clearedBy: employee?.id || '' }),
        },
      ]
    );
  };
  
  const parseCSVLine = (line: string): string[] => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  };

  const parseDateRange = (dateStr: string): { startDate: string; endDate: string } | null => {
    if (!dateStr || !dateStr.trim()) return null;
    
    const cleanStr = dateStr.trim();
    
    const toMatch = cleanStr.match(/^(.+?)\s+to\s+(.+)$/i);
    if (toMatch) {
      const start = new Date(toMatch[1].trim());
      const end = new Date(toMatch[2].trim());
      if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
        return { startDate: start.toISOString(), endDate: end.toISOString() };
      }
    }
    
    const dashMatch = cleanStr.match(/^(\d{4}-\d{2}-\d{2})\s*[-–]\s*(\d{4}-\d{2}-\d{2})$/);
    if (dashMatch) {
      const start = new Date(dashMatch[1]);
      const end = new Date(dashMatch[2]);
      if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
        return { startDate: start.toISOString(), endDate: end.toISOString() };
      }
    }
    
    const singleDate = new Date(cleanStr);
    if (!isNaN(singleDate.getTime())) {
      return { 
        startDate: singleDate.toISOString(), 
        endDate: new Date(singleDate.getTime() + 24 * 60 * 60 * 1000).toISOString() 
      };
    }
    
    return null;
  };

  const parseEventsCSV = (text: string) => {
    const lines = text.trim().split('\n').filter(line => line.trim());
    if (lines.length < 2) {
      throw new Error('CSV must have a header row and at least one data row');
    }
    
    const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase().replace(/\s+/g, '_'));
    
    const dateRangeIdx = headers.findIndex(h => h.includes('date_range') || h === 'date');
    const nameIdx = headers.findIndex(h => h.includes('event_name') || h === 'name' || h === 'event');
    const locationIdx = headers.findIndex(h => h.includes('location') || h === 'venue' || h === 'place');
    const circleIdx = headers.findIndex(h => h.includes('circle') || h === 'state');
    const zoneIdx = headers.findIndex(h => h.includes('zone') || h.includes('ba_name') || h === 'area');
    const categoryIdx = headers.findIndex(h => h.includes('category') || h === 'type');
    const insightIdx = headers.findIndex(h => h.includes('key_insight') || h.includes('insight') || h.includes('remarks') || h.includes('notes'));
    
    if (nameIdx === -1) throw new Error('CSV must have "Event Name" or "Name" column');
    if (locationIdx === -1) throw new Error('CSV must have "Location" column');
    if (categoryIdx === -1) throw new Error('CSV must have "Category" column');
    
    const data = [];
    const parseErrors: string[] = [];
    
    for (let i = 1; i < lines.length; i++) {
      const rowNum = i + 1;
      const values = parseCSVLine(lines[i]);
      
      if (values.every(v => !v)) continue;
      
      const name = values[nameIdx]?.trim();
      const location = values[locationIdx]?.trim();
      const circle = circleIdx >= 0 ? values[circleIdx]?.trim() : '';
      const category = values[categoryIdx]?.trim();
      
      if (!name) { parseErrors.push(`Row ${rowNum}: Missing event name`); continue; }
      if (!location) { parseErrors.push(`Row ${rowNum}: Missing location`); continue; }
      if (!category) { parseErrors.push(`Row ${rowNum}: Missing category`); continue; }
      
      let startDate = new Date().toISOString();
      let endDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      
      if (dateRangeIdx >= 0 && values[dateRangeIdx]) {
        const parsed = parseDateRange(values[dateRangeIdx]);
        if (parsed) {
          startDate = parsed.startDate;
          endDate = parsed.endDate;
          if (new Date(endDate) < new Date(startDate)) {
            parseErrors.push(`Row ${rowNum}: End date is before start date`);
            continue;
          }
        }
      }
      
      data.push({
        name,
        location,
        circle,
        zone: zoneIdx >= 0 ? values[zoneIdx]?.trim() : undefined,
        startDate,
        endDate,
        category,
        keyInsight: insightIdx >= 0 ? values[insightIdx]?.trim() : undefined,
        rowNumber: rowNum,
      });
    }
    
    if (parseErrors.length > 0 && data.length === 0) {
      throw new Error(`Parse errors:\n${parseErrors.slice(0, 5).join('\n')}`);
    }
    
    return { data, parseErrors };
  };
  
  const handleEventsImport = async () => {
    if (!eventsCsvText.trim()) {
      Alert.alert('Error', 'Please paste CSV data');
      return;
    }
    
    try {
      const { data, parseErrors } = parseEventsCSV(eventsCsvText);
      if (data.length === 0) {
        Alert.alert('Error', `No valid data found in CSV${parseErrors.length > 0 ? '\n\nErrors:\n' + parseErrors.slice(0, 5).join('\n') : ''}`);
        return;
      }
      
      const BATCH_SIZE = 100;
      const totalBatches = Math.ceil(data.length / BATCH_SIZE);
      const parseWarning = parseErrors.length > 0 ? `\n\n${parseErrors.length} rows had issues and were skipped.` : '';
      
      Alert.alert(
        'Confirm Works Import',
        `Import ${data.length} events in ${totalBatches} batch(es)?${parseWarning}`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Import',
            onPress: async () => {
              setImportingEvents(true);
              setEventsImportProgress({ current: 0, total: data.length, imported: 0, updated: 0, errors: 0 });
              
              let totalImported = 0;
              let totalUpdated = 0;
              let totalErrors = 0;
              
              for (let i = 0; i < data.length; i += BATCH_SIZE) {
                const batch = data.slice(i, i + BATCH_SIZE);
                
                try {
                  const result = await importEventsMutation.mutateAsync({ 
                    data: batch, 
                    uploadedBy: employee?.id || '' 
                  });
                  totalImported += result.imported;
                  totalUpdated += result.updated;
                  totalErrors += result.errors.length;
                  
                  setEventsImportProgress({
                    current: Math.min(i + BATCH_SIZE, data.length),
                    total: data.length,
                    imported: totalImported,
                    updated: totalUpdated,
                    errors: totalErrors,
                  });
                } catch (err: any) {
                  console.error(`Events batch failed:`, err);
                  totalErrors += batch.length;
                }
              }
              
              setImportingEvents(false);
              const parseNote = parseErrors.length > 0 ? `\nSkipped (parse errors): ${parseErrors.length}` : '';
              Alert.alert(
                'Works Import Complete',
                `Imported: ${totalImported}\nUpdated: ${totalUpdated}\nErrors: ${totalErrors}${parseNote}`,
                [{ text: 'OK' }]
              );
              setEventsCsvText('');
              setShowEventsUploadSection(false);
              refetchEventStats();
              trpcUtils.events.getAll.invalidate();
            },
          },
        ]
      );
    } catch (error: any) {
      Alert.alert('Parse Error', error.message);
    }
  };
  
  const filteredList = employeeList?.data?.filter(item => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      item.purseId.toLowerCase().includes(query) ||
      item.name.toLowerCase().includes(query) ||
      item.circle?.toLowerCase().includes(query) ||
      item.zone?.toLowerCase().includes(query)
    );
  }) || [];

  return (
    <>
      <Stack.Screen 
        options={{ 
          title: 'Admin Panel',
          headerStyle: { backgroundColor: Colors.light.primary },
          headerTintColor: Colors.light.background,
          headerLeft: () => (
            <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn}>
              <ChevronLeft size={24} color={Colors.light.background} />
            </TouchableOpacity>
          ),
        }} 
      />
      <ScrollView 
        style={styles.container}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.statsSection}>
          <Text style={styles.sectionTitle}>Employee Master Statistics</Text>
          <View style={styles.statsRow}>
            <View style={styles.statCard}>
              <Users size={24} color={Colors.light.primary} />
              <Text style={styles.statValue}>{stats?.total || 0}</Text>
              <Text style={styles.statLabel}>Total Records</Text>
            </View>
            <View style={styles.statCard}>
              <CheckCircle size={24} color={Colors.light.success} />
              <Text style={styles.statValue}>{stats?.linked || 0}</Text>
              <Text style={styles.statLabel}>Linked</Text>
            </View>
            <View style={styles.statCard}>
              <XCircle size={24} color={Colors.light.textSecondary} />
              <Text style={styles.statValue}>{stats?.unlinked || 0}</Text>
              <Text style={styles.statLabel}>Unlinked</Text>
            </View>
          </View>
        </View>

        <View style={styles.actionsSection}>
          <TouchableOpacity 
            style={[styles.actionButton, styles.primaryAction]}
            onPress={() => setShowUploadSection(!showUploadSection)}
          >
            <Upload size={20} color={Colors.light.background} />
            <Text style={styles.actionButtonText}>Import CSV</Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={[styles.actionButton, styles.dangerAction]}
            onPress={handleClearUnlinked}
          >
            <Trash2 size={20} color={Colors.light.background} />
            <Text style={styles.actionButtonText}>Clear Unlinked</Text>
          </TouchableOpacity>
        </View>

        {showUploadSection && (
          <View style={styles.uploadSection}>
            <Text style={styles.uploadTitle}>Paste CSV Data</Text>
            <Text style={styles.uploadHint}>
              Required: Employee pers no, emp_name{'\n'}
              Optional: circle, ba_name, employee designation, controller_officer Pers no, etc.{'\n'}
              Large files (60K+ records) are processed in batches of 500.
            </Text>
            <TextInput
              style={styles.csvInput}
              multiline
              numberOfLines={10}
              placeholder="purse_id,name,circle,zone,designation,reporting_purse_id
101,John Doe,KARNATAKA,Bangalore,AGM,100
102,Jane Smith,KARNATAKA,Mysore,SD_JTO,101"
              value={csvText}
              onChangeText={setCsvText}
              textAlignVertical="top"
            />
            {importing && importProgress.total > 0 && (
              <View style={styles.progressSection}>
                <Text style={styles.progressText}>
                  Processing: {importProgress.current.toLocaleString()} / {importProgress.total.toLocaleString()} records
                </Text>
                <View style={styles.progressBar}>
                  <View 
                    style={[
                      styles.progressFill, 
                      { width: `${(importProgress.current / importProgress.total) * 100}%` }
                    ]} 
                  />
                </View>
                <Text style={styles.progressStats}>
                  Imported: {importProgress.imported} | Updated: {importProgress.updated} | Errors: {importProgress.errors}
                </Text>
              </View>
            )}
            <View style={styles.uploadActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => { setCsvText(''); setShowUploadSection(false); }} disabled={importing}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.importBtn, importing && styles.buttonDisabled]} 
                onPress={handleImport}
                disabled={importing}
              >
                <Text style={styles.importBtnText}>{importing ? 'Importing...' : 'Import Data'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Works Management Section */}
        <View style={styles.statsSection}>
          <Text style={styles.sectionTitle}>Works Statistics</Text>
          <View style={styles.statsRow}>
            <View style={styles.statCard}>
              <Calendar size={24} color={Colors.light.primary} />
              <Text style={styles.statValue}>{eventStats?.total || 0}</Text>
              <Text style={styles.statLabel}>Total Works</Text>
            </View>
            <View style={styles.statCard}>
              <CheckCircle size={24} color={Colors.light.success} />
              <Text style={styles.statValue}>{eventStats?.active || 0}</Text>
              <Text style={styles.statLabel}>Active</Text>
            </View>
            <View style={styles.statCard}>
              <FileText size={24} color={Colors.light.warning} />
              <Text style={styles.statValue}>{eventStats?.draft || 0}</Text>
              <Text style={styles.statLabel}>Draft</Text>
            </View>
          </View>
        </View>

        <View style={styles.actionsSection}>
          <TouchableOpacity 
            style={[styles.actionButton, styles.secondaryAction]}
            onPress={() => setShowEventsUploadSection(!showEventsUploadSection)}
          >
            <Calendar size={20} color={Colors.light.background} />
            <Text style={styles.actionButtonText}>Import Works CSV</Text>
          </TouchableOpacity>
        </View>

        {showEventsUploadSection && (
          <View style={styles.uploadSection}>
            <Text style={styles.uploadTitle}>Paste Works CSV Data</Text>
            <Text style={styles.uploadHint}>
              Required: Work Name, Location, Category{'\n'}
              Optional: Circle (auto-detected from location), Date Range, Zone, Key Insight{'\n'}
              Categories: Cultural, Religious, Sports, Exhibition, Fair, Festival, Agri-Tourism, Eco-Tourism, Trade/Religious
            </Text>
            <TextInput
              style={styles.csvInput}
              multiline
              numberOfLines={10}
              placeholder="event_name,location,circle,category,date_range,key_insight
Diwali Mela,Mumbai Central,MAHARASHTRA,Festival,2025-10-15 to 2025-10-20,Major festive sales opportunity
Harvest Fair,Bangalore,KARNATAKA,Agri-Tourism,2025-11-01 to 2025-11-05,Agricultural event"
              value={eventsCsvText}
              onChangeText={setEventsCsvText}
              textAlignVertical="top"
            />
            {importingEvents && eventsImportProgress.total > 0 && (
              <View style={styles.progressSection}>
                <Text style={styles.progressText}>
                  Processing: {eventsImportProgress.current.toLocaleString()} / {eventsImportProgress.total.toLocaleString()} events
                </Text>
                <View style={styles.progressBar}>
                  <View 
                    style={[
                      styles.progressFill, 
                      { width: `${(eventsImportProgress.current / eventsImportProgress.total) * 100}%` }
                    ]} 
                  />
                </View>
                <Text style={styles.progressStats}>
                  Imported: {eventsImportProgress.imported} | Updated: {eventsImportProgress.updated} | Errors: {eventsImportProgress.errors}
                </Text>
              </View>
            )}
            <View style={styles.uploadActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => { setEventsCsvText(''); setShowEventsUploadSection(false); }} disabled={importingEvents}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.importBtn, importingEvents && styles.buttonDisabled]} 
                onPress={handleEventsImport}
                disabled={importingEvents}
              >
                <Text style={styles.importBtnText}>{importingEvents ? 'Importing...' : 'Import Works'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        <View style={styles.listSection}>
          <View style={styles.listHeader}>
            <Text style={styles.sectionTitle}>Employee Master List</Text>
            <View style={styles.filterRow}>
              <TouchableOpacity 
                style={[styles.filterBtn, filterLinked === undefined && styles.filterBtnActive]}
                onPress={() => setFilterLinked(undefined)}
              >
                <Text style={[styles.filterBtnText, filterLinked === undefined && styles.filterBtnTextActive]}>All</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.filterBtn, filterLinked === true && styles.filterBtnActive]}
                onPress={() => setFilterLinked(true)}
              >
                <Text style={[styles.filterBtnText, filterLinked === true && styles.filterBtnTextActive]}>Linked</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.filterBtn, filterLinked === false && styles.filterBtnActive]}
                onPress={() => setFilterLinked(false)}
              >
                <Text style={[styles.filterBtnText, filterLinked === false && styles.filterBtnTextActive]}>Unlinked</Text>
              </TouchableOpacity>
            </View>
          </View>
          
          <View style={styles.searchRow}>
            <Search size={18} color={Colors.light.textSecondary} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search by name, purse ID, circle..."
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
          </View>
          
          {isLoading ? (
            <Text style={styles.loadingText}>Loading...</Text>
          ) : filteredList.length === 0 ? (
            <View style={styles.emptyList}>
              <FileText size={40} color={Colors.light.textSecondary} />
              <Text style={styles.emptyText}>No employee master records found</Text>
              <Text style={styles.emptyHint}>Import CSV data to get started</Text>
            </View>
          ) : (
            filteredList.map((item) => (
              <View key={item.id} style={styles.listItem}>
                <View style={styles.itemHeader}>
                  <View style={styles.itemMain}>
                    <Text style={styles.itemName}>{item.name}</Text>
                    <Text style={styles.itemPurseId}>Purse ID: {item.purseId}</Text>
                  </View>
                  <View style={[styles.statusBadge, item.isLinked ? styles.linkedBadge : styles.unlinkedBadge]}>
                    {item.isLinked ? <Link size={12} color={Colors.light.success} /> : null}
                    <Text style={[styles.statusText, item.isLinked ? styles.linkedText : styles.unlinkedText]}>
                      {item.isLinked ? 'Linked' : 'Unlinked'}
                    </Text>
                  </View>
                </View>
                <View style={styles.itemDetails}>
                  {item.circle && <Text style={styles.itemDetail}>Circle: {item.circle}</Text>}
                  {item.zone && <Text style={styles.itemDetail}>Zone: {item.zone}</Text>}
                  {item.designation && <Text style={styles.itemDetail}>Designation: {item.designation}</Text>}
                  {item.reportingPurseId && <Text style={styles.itemDetail}>Reports to: {item.reportingPurseId}</Text>}
                </View>
              </View>
            ))
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
    backgroundColor: Colors.light.background,
  },
  headerBtn: {
    padding: 8,
  },
  statsSection: {
    padding: 16,
    backgroundColor: '#fff',
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.light.text,
    marginBottom: 12,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  statCard: {
    flex: 1,
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#F5F5F5',
    borderRadius: 12,
    marginHorizontal: 4,
  },
  statValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: Colors.light.text,
    marginTop: 8,
  },
  statLabel: {
    fontSize: 12,
    color: Colors.light.textSecondary,
    marginTop: 4,
  },
  actionsSection: {
    flexDirection: 'row',
    padding: 16,
    gap: 12,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 14,
    borderRadius: 10,
    gap: 8,
  },
  primaryAction: {
    backgroundColor: Colors.light.primary,
  },
  secondaryAction: {
    backgroundColor: Colors.light.success,
  },
  dangerAction: {
    backgroundColor: Colors.light.error,
  },
  actionButtonText: {
    color: Colors.light.background,
    fontWeight: '600',
    fontSize: 14,
  },
  uploadSection: {
    margin: 16,
    padding: 16,
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  uploadTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.light.text,
    marginBottom: 8,
  },
  uploadHint: {
    fontSize: 12,
    color: Colors.light.textSecondary,
    marginBottom: 12,
    lineHeight: 18,
  },
  csvInput: {
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 8,
    padding: 12,
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    minHeight: 150,
    backgroundColor: '#FAFAFA',
  },
  progressSection: {
    marginTop: 16,
    padding: 12,
    backgroundColor: '#F0F7FF',
    borderRadius: 8,
  },
  progressText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.light.text,
    marginBottom: 8,
  },
  progressBar: {
    height: 8,
    backgroundColor: '#E0E0E0',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: Colors.light.primary,
    borderRadius: 4,
  },
  progressStats: {
    fontSize: 12,
    color: Colors.light.textSecondary,
    marginTop: 8,
  },
  uploadActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 12,
    gap: 12,
  },
  cancelBtn: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  cancelBtnText: {
    color: Colors.light.textSecondary,
    fontWeight: '500',
  },
  importBtn: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    backgroundColor: Colors.light.primary,
  },
  importBtnText: {
    color: Colors.light.background,
    fontWeight: '600',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  listSection: {
    padding: 16,
    backgroundColor: '#fff',
  },
  listHeader: {
    marginBottom: 12,
  },
  filterRow: {
    flexDirection: 'row',
    gap: 8,
  },
  filterBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: '#F0F0F0',
  },
  filterBtnActive: {
    backgroundColor: Colors.light.primary,
  },
  filterBtnText: {
    fontSize: 12,
    color: Colors.light.textSecondary,
  },
  filterBtnTextActive: {
    color: Colors.light.background,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F5F5F5',
    borderRadius: 10,
    paddingHorizontal: 12,
    marginBottom: 16,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 8,
    fontSize: 14,
  },
  loadingText: {
    textAlign: 'center',
    color: Colors.light.textSecondary,
    padding: 20,
  },
  emptyList: {
    alignItems: 'center',
    padding: 40,
  },
  emptyText: {
    fontSize: 16,
    color: Colors.light.textSecondary,
    marginTop: 12,
  },
  emptyHint: {
    fontSize: 14,
    color: Colors.light.textSecondary,
    marginTop: 4,
  },
  listItem: {
    padding: 16,
    backgroundColor: '#FAFAFA',
    borderRadius: 10,
    marginBottom: 10,
  },
  itemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  itemMain: {
    flex: 1,
  },
  itemName: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.light.text,
  },
  itemPurseId: {
    fontSize: 12,
    color: Colors.light.primary,
    marginTop: 2,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 12,
    gap: 4,
  },
  linkedBadge: {
    backgroundColor: '#E8F5E9',
  },
  unlinkedBadge: {
    backgroundColor: '#ECEFF1',
  },
  statusText: {
    fontSize: 11,
    fontWeight: '500',
  },
  linkedText: {
    color: Colors.light.success,
  },
  unlinkedText: {
    color: Colors.light.textSecondary,
  },
  itemDetails: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  itemDetail: {
    fontSize: 12,
    color: Colors.light.textSecondary,
    backgroundColor: '#EEEEEE',
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 4,
  },
  accessDenied: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  accessDeniedTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: Colors.light.text,
    marginTop: 16,
  },
  accessDeniedText: {
    fontSize: 14,
    color: Colors.light.textSecondary,
    textAlign: 'center',
    marginTop: 8,
  },
  backButton: {
    marginTop: 20,
    paddingVertical: 12,
    paddingHorizontal: 24,
    backgroundColor: Colors.light.primary,
    borderRadius: 8,
  },
  backButtonText: {
    color: Colors.light.background,
    fontWeight: '600',
  },
  bottomSpacer: {
    height: 40,
  },
});
