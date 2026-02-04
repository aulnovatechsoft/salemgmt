import { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { User, Mail, Phone, Briefcase, MapPin, ArrowLeft, AlertTriangle, IndianRupee, Building2, Clock, FileText, ChevronDown, ChevronUp, Globe, RefreshCw } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/contexts/auth';
import { safeNumber, formatINRAmount, formatINRCrore, hasOutstandingAmount, getTotalOutstanding } from '@/lib/currency';
import React from "react";

const getInitials = (name: string) => {
  const parts = name.split(' ').filter(p => p.length > 0);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return name.substring(0, 2).toUpperCase();
};

const getAvatarColor = (name: string) => {
  const colors = ['#1976D2', '#388E3C', '#D32F2F', '#7B1FA2', '#F57C00', '#0097A7', '#5D4037', '#455A64'];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
};

const InfoItem = ({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) => (
  <View style={styles.infoItem}>
    <View style={styles.infoIcon}>{icon}</View>
    <View style={styles.infoContent}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  </View>
);

export default function EmployeeProfileScreen() {
  const router = useRouter();
  const { employee: currentUser } = useAuth();
  const { id, persNo } = useLocalSearchParams<{ id?: string; persNo?: string }>();

  // Check if current user has management role
  const isManagementRole = ['ADMIN', 'GM', 'CGM', 'DGM', 'AGM'].includes(currentUser?.role || '');

  // First try to fetch by ID (for registered employees)
  const { data: employee, isLoading: loadingById, error: errorById } = trpc.employees.getById.useQuery(
    { id: id || '' },
    { enabled: !!id }
  );

  // If persNo is provided, also fetch from employee_master (as fallback or additional data)
  const { data: masterEmployee, isLoading: loadingByPersNo, error: errorByPersNo } = trpc.employees.getMasterByPersNo.useQuery(
    { persNo: persNo || '' },
    { enabled: !!persNo }
  );

  // Use employee from employees table or construct from employee_master
  const displayEmployee = employee || (masterEmployee ? {
    id: masterEmployee.id || '',
    name: masterEmployee.name || 'Unknown',
    email: '',
    phone: '',
    role: masterEmployee.designation || 'N/A',
    designation: masterEmployee.designation || 'N/A',
    circle: masterEmployee.circle || 'N/A',
    zone: masterEmployee.zone || '',
    division: masterEmployee.division || '',
    persNo: masterEmployee.persNo || persNo || '',
    outstandingFtth: null,
    outstandingLc: null,
    managerId: masterEmployee.reportingPersNo || null,
  } : null);

  const isLoading = loadingById || loadingByPersNo;
  const error = id ? errorById : errorByPersNo;

  // Get the persNo for FTTH pending lookup
  const employeePersNo = displayEmployee?.persNo || persNo || '';

  const { data: ftthPendingOrders, isLoading: ftthLoading, error: ftthError } = trpc.ftthPending.getByPersNo.useQuery(
    { persNo: employeePersNo },
    { enabled: !!employeePersNo }
  );

  // Fetch circle-wise outstanding details for this employee (only for management users)
  const { 
    data: outstandingDetails, 
    isLoading: outstandingLoading,
    error: outstandingError,
    refetch: refetchOutstanding 
  } = trpc.admin.getEmployeeOutstandingDetails.useQuery(
    { persNo: employeePersNo, requesterId: currentUser?.id || '' },
    { 
      enabled: !!employeePersNo && isManagementRole && !!currentUser?.id,
      retry: 1,
    }
  );

  const [showCircleBreakdown, setShowCircleBreakdown] = useState(false);

  const totalFtthPending = ftthPendingOrders?.reduce((sum, order) => sum + order.totalFtthOrdersPending, 0) || 0;

  if (isLoading) {
    return (
      <>
        <Stack.Screen 
          options={{
            title: 'Employee Profile',
            headerStyle: { backgroundColor: Colors.light.primary },
            headerTintColor: Colors.light.background,
            headerTitleStyle: { fontWeight: 'bold' as const },
            headerShown: true,
          }} 
        />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.light.primary} />
          <Text style={styles.loadingText}>Loading employee profile...</Text>
        </View>
      </>
    );
  }

  // If not found in employees or employee_master but we have persNo, show basic profile with FTTH data
  if ((error && !displayEmployee) || (!isLoading && !displayEmployee)) {
    if (persNo && ftthPendingOrders && ftthPendingOrders.length > 0) {
      // Show basic profile with FTTH pending data only
      return (
        <>
          <Stack.Screen 
            options={{
              title: 'Employee Profile',
              headerStyle: { backgroundColor: Colors.light.primary },
              headerTintColor: Colors.light.background,
              headerTitleStyle: { fontWeight: 'bold' as const },
              headerShown: true,
            }} 
          />
          <ScrollView style={styles.container}>
            <View style={[styles.header, { backgroundColor: Colors.light.primary }]}>
              <View style={styles.headerContent}>
                <View style={[styles.avatar, { backgroundColor: 'rgba(255,255,255,0.2)' }]}>
                  <Text style={styles.avatarText}>??</Text>
                </View>
              </View>
              <Text style={styles.name}>Unknown Employee</Text>
              <Text style={styles.designation}>Not in Master Data</Text>
              <Text style={styles.circle}>Pers No: {persNo}</Text>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>FTTH Orders Pending</Text>
              <View style={styles.ftthSummary}>
                <View style={styles.ftthSummaryItem}>
                  <Text style={styles.ftthSummaryValue}>{totalFtthPending.toLocaleString()}</Text>
                  <Text style={styles.ftthSummaryLabel}>Total Pending</Text>
                </View>
                <View style={styles.ftthSummaryItem}>
                  <Text style={styles.ftthSummaryValue}>{ftthPendingOrders.length}</Text>
                  <Text style={styles.ftthSummaryLabel}>Business Areas</Text>
                </View>
              </View>
              <View style={styles.ftthList}>
                {ftthPendingOrders.map((order, index) => (
                  <View key={index} style={styles.ftthItem}>
                    <View style={styles.ftthItemLeft}>
                      <FileText size={16} color={Colors.light.primary} />
                      <Text style={styles.ftthBaName}>{order.ba}</Text>
                    </View>
                    <Text style={styles.ftthOrderCount}>{order.totalFtthOrdersPending.toLocaleString()}</Text>
                  </View>
                ))}
              </View>
            </View>

            <View style={styles.noticeCard}>
              <AlertTriangle size={20} color="#F57C00" />
              <Text style={styles.noticeText}>
                This employee is not in the Employee Master data. Please update your master data to see full profile details.
              </Text>
            </View>
          </ScrollView>
        </>
      );
    }

    return (
      <>
        <Stack.Screen 
          options={{
            title: 'Employee Profile',
            headerStyle: { backgroundColor: Colors.light.primary },
            headerTintColor: Colors.light.background,
            headerTitleStyle: { fontWeight: 'bold' as const },
            headerShown: true,
          }} 
        />
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>Employee not found</Text>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <ArrowLeft size={20} color={Colors.light.background} />
            <Text style={styles.backButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </>
    );
  }

  // At this point, displayEmployee is guaranteed to exist due to error checks above
  const emp = displayEmployee!;
  const avatarColor = getAvatarColor(emp.name);
  const initials = getInitials(emp.name);

  return (
    <>
      <Stack.Screen 
        options={{
          title: 'Employee Profile',
          headerStyle: { backgroundColor: Colors.light.primary },
          headerTintColor: Colors.light.background,
          headerTitleStyle: { fontWeight: 'bold' as const },
          headerShown: true,
        }} 
      />
      <ScrollView style={styles.container}>
        <View style={[styles.header, { backgroundColor: avatarColor }]}>
          <View style={styles.avatarContainer}>
            <View style={[styles.avatar, { backgroundColor: 'rgba(255,255,255,0.2)' }]}>
              <Text style={styles.avatarText}>{initials}</Text>
            </View>
          </View>
          <Text style={styles.name}>{emp.name}</Text>
          <Text style={styles.designation}>{emp.designation || 'Employee'}</Text>
          <Text style={styles.circle}>{emp.circle}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Personal Information</Text>
          <View style={styles.infoCard}>
            <InfoItem
              icon={<Briefcase size={20} color={Colors.light.primary} />}
              label="Pers Number"
              value={emp.persNo || 'N/A'}
            />
            <InfoItem
              icon={<Mail size={20} color={Colors.light.primary} />}
              label="Email"
              value={emp.email || 'Not set'}
            />
            <InfoItem
              icon={<Phone size={20} color={Colors.light.primary} />}
              label="Phone"
              value={emp.phone || 'Not set'}
            />
            <InfoItem
              icon={<MapPin size={20} color={Colors.light.primary} />}
              label="Circle"
              value={emp.circle || 'N/A'}
            />
            <InfoItem
              icon={<Building2 size={20} color={Colors.light.primary} />}
              label="Role"
              value={emp.role || 'N/A'}
            />
          </View>
        </View>

        {(hasOutstandingAmount(emp.outstandingFtth, emp.outstandingLc) || (outstandingDetails?.circleBreakdown && outstandingDetails.circleBreakdown.length > 0)) && (
          <View style={styles.section}>
            <View style={styles.outstandingHeader}>
              <AlertTriangle size={20} color="#D32F2F" />
              <Text style={styles.outstandingTitle}>Outstanding Dues</Text>
            </View>
            
            <View style={styles.outstandingCard}>
              {outstandingLoading ? (
                <View style={styles.outstandingLoading}>
                  <ActivityIndicator size="small" color="#D32F2F" />
                  <Text style={styles.outstandingLoadingText}>Loading outstanding details...</Text>
                </View>
              ) : outstandingError ? (
                <View style={styles.outstandingError}>
                  <AlertTriangle size={20} color="#D32F2F" />
                  <Text style={styles.outstandingErrorText}>Unable to load outstanding details</Text>
                  <TouchableOpacity 
                    style={styles.outstandingRetryButton}
                    onPress={() => refetchOutstanding()}
                  >
                    <RefreshCw size={14} color="#FFFFFF" />
                    <Text style={styles.outstandingRetryText}>Retry</Text>
                  </TouchableOpacity>
                </View>
              ) : outstandingDetails?.circleBreakdown && outstandingDetails.circleBreakdown.length > 0 ? (
                <>
                  {safeNumber(outstandingDetails.summary.totalFtth) > 0 && (
                    <View style={styles.outstandingItem}>
                      <View style={styles.outstandingLabelRow}>
                        <IndianRupee size={18} color="#D32F2F" />
                        <Text style={styles.outstandingLabel}>FTTH Outstanding</Text>
                      </View>
                      <Text style={styles.outstandingAmount}>
                        {formatINRCrore(outstandingDetails.summary.totalFtth)}
                      </Text>
                      <Text style={styles.outstandingAmountFull}>
                        {formatINRAmount(outstandingDetails.summary.totalFtth)}
                      </Text>
                    </View>
                  )}
                  
                  {safeNumber(outstandingDetails.summary.totalFtth) > 0 && safeNumber(outstandingDetails.summary.totalLc) > 0 && (
                    <View style={styles.outstandingDivider} />
                  )}
                  
                  {safeNumber(outstandingDetails.summary.totalLc) > 0 && (
                    <View style={styles.outstandingItem}>
                      <View style={styles.outstandingLabelRow}>
                        <IndianRupee size={18} color="#D32F2F" />
                        <Text style={styles.outstandingLabel}>LC Outstanding</Text>
                      </View>
                      <Text style={styles.outstandingAmount}>
                        {formatINRCrore(outstandingDetails.summary.totalLc)}
                      </Text>
                      <Text style={styles.outstandingAmountFull}>
                        {formatINRAmount(outstandingDetails.summary.totalLc)}
                      </Text>
                    </View>
                  )}
                  
                  <View style={styles.outstandingTotalRow}>
                    <View>
                      <Text style={styles.outstandingTotalLabel}>Total Outstanding</Text>
                      <Text style={styles.outstandingTotalAmountFull}>
                        {formatINRAmount(outstandingDetails.summary.totalOutstanding)}
                      </Text>
                    </View>
                    <Text style={styles.outstandingTotalAmount}>
                      {formatINRCrore(outstandingDetails.summary.totalOutstanding)}
                    </Text>
                  </View>

                  {outstandingDetails.circleBreakdown.length > 0 && (
                    <>
                      <TouchableOpacity 
                        style={styles.circleBreakdownToggle}
                        onPress={() => setShowCircleBreakdown(!showCircleBreakdown)}
                        activeOpacity={0.7}
                      >
                        <View style={styles.circleBreakdownToggleLeft}>
                          <Globe size={16} color="#D32F2F" />
                          <Text style={styles.circleBreakdownToggleText}>
                            Circle-wise Breakdown ({outstandingDetails.circleBreakdown.length} {outstandingDetails.circleBreakdown.length === 1 ? 'circle' : 'circles'})
                          </Text>
                        </View>
                        {showCircleBreakdown ? (
                          <ChevronUp size={20} color="#D32F2F" />
                        ) : (
                          <ChevronDown size={20} color="#D32F2F" />
                        )}
                      </TouchableOpacity>

                      {showCircleBreakdown && (
                        <View style={styles.circleBreakdownList}>
                          {outstandingDetails.circleBreakdown.map((item, index) => (
                            <View 
                              key={item.id} 
                              style={[
                                styles.circleBreakdownItem,
                                index === outstandingDetails.circleBreakdown.length - 1 && styles.circleBreakdownItemLast
                              ]}
                            >
                              <View style={styles.circleBreakdownHeader}>
                                <View style={styles.circleBreakdownBadge}>
                                  <Text style={styles.circleBreakdownBadgeText}>{item.circle}</Text>
                                </View>
                              </View>
                              <View style={styles.circleBreakdownAmounts}>
                                {safeNumber(item.ftth_amount) > 0 && (
                                  <View style={styles.circleBreakdownAmountRow}>
                                    <Text style={styles.circleBreakdownAmountLabel}>FTTH:</Text>
                                    <Text style={styles.circleBreakdownAmountValue}>
                                      {formatINRCrore(item.ftth_amount)}
                                    </Text>
                                  </View>
                                )}
                                {safeNumber(item.lc_amount) > 0 && (
                                  <View style={styles.circleBreakdownAmountRow}>
                                    <Text style={styles.circleBreakdownAmountLabel}>LC:</Text>
                                    <Text style={styles.circleBreakdownAmountValue}>
                                      {formatINRCrore(item.lc_amount)}
                                    </Text>
                                  </View>
                                )}
                                <View style={styles.circleBreakdownAmountRow}>
                                  <Text style={styles.circleBreakdownAmountLabelTotal}>Total:</Text>
                                  <Text style={styles.circleBreakdownAmountValueTotal}>
                                    {formatINRCrore(item.total_amount)}
                                  </Text>
                                </View>
                              </View>
                            </View>
                          ))}
                        </View>
                      )}
                    </>
                  )}
                </>
              ) : (
                <>
                  {safeNumber(emp.outstandingFtth) > 0 && (
                    <View style={styles.outstandingItem}>
                      <View style={styles.outstandingLabelRow}>
                        <IndianRupee size={18} color="#D32F2F" />
                        <Text style={styles.outstandingLabel}>FTTH Outstanding</Text>
                      </View>
                      <Text style={styles.outstandingAmount}>
                        {formatINRCrore(emp.outstandingFtth)}
                      </Text>
                      <Text style={styles.outstandingAmountFull}>
                        {formatINRAmount(emp.outstandingFtth)}
                      </Text>
                    </View>
                  )}
                  
                  {safeNumber(emp.outstandingFtth) > 0 && safeNumber(emp.outstandingLc) > 0 && (
                    <View style={styles.outstandingDivider} />
                  )}
                  
                  {safeNumber(emp.outstandingLc) > 0 && (
                    <View style={styles.outstandingItem}>
                      <View style={styles.outstandingLabelRow}>
                        <IndianRupee size={18} color="#D32F2F" />
                        <Text style={styles.outstandingLabel}>LC Outstanding</Text>
                      </View>
                      <Text style={styles.outstandingAmount}>
                        {formatINRCrore(emp.outstandingLc)}
                      </Text>
                      <Text style={styles.outstandingAmountFull}>
                        {formatINRAmount(emp.outstandingLc)}
                      </Text>
                    </View>
                  )}
                  
                  <View style={styles.outstandingTotalRow}>
                    <View>
                      <Text style={styles.outstandingTotalLabel}>Total Outstanding</Text>
                      <Text style={styles.outstandingTotalAmountFull}>
                        {formatINRAmount(getTotalOutstanding(emp.outstandingFtth, emp.outstandingLc))}
                      </Text>
                    </View>
                    <Text style={styles.outstandingTotalAmount}>
                      {formatINRCrore(getTotalOutstanding(emp.outstandingFtth, emp.outstandingLc))}
                    </Text>
                  </View>
                </>
              )}
            </View>
          </View>
        )}

        {employee?.persNo && (ftthLoading || ftthPendingOrders && ftthPendingOrders.length > 0) && (
          <View style={styles.section}>
            <View style={styles.ftthPendingHeader}>
              <Clock size={20} color="#FF6B00" />
              <Text style={styles.ftthPendingTitle}>FTTH Orders Pending</Text>
            </View>
            
            {ftthLoading && (
              <View style={styles.ftthPendingCard}>
                <View style={styles.ftthPendingLoading}>
                  <ActivityIndicator size="small" color="#FF6B00" />
                  <Text style={styles.ftthPendingLoadingText}>Loading pending orders...</Text>
                </View>
              </View>
            )}
            
            {ftthError && (
              <View style={styles.ftthPendingCard}>
                <Text style={styles.ftthPendingErrorText}>Unable to load pending orders</Text>
              </View>
            )}
            
            {!ftthLoading && !ftthError && ftthPendingOrders && ftthPendingOrders.length > 0 && (
            <View style={styles.ftthPendingCard}>
              <View style={styles.ftthPendingSummary}>
                <View style={styles.ftthPendingSummaryItem}>
                  <Text style={styles.ftthPendingSummaryValue}>{totalFtthPending}</Text>
                  <Text style={styles.ftthPendingSummaryLabel}>Total Pending</Text>
                </View>
                <View style={styles.ftthPendingSummaryItem}>
                  <Text style={styles.ftthPendingSummaryValue}>{ftthPendingOrders.length}</Text>
                  <Text style={styles.ftthPendingSummaryLabel}>BA Count</Text>
                </View>
              </View>
              
              <View style={styles.ftthPendingDivider} />
              
              <Text style={styles.ftthPendingBaTitle}>Pending by Business Area (BA)</Text>
              
              {ftthPendingOrders.map((order, index) => (
                <View key={order.id} style={[
                  styles.ftthPendingBaItem,
                  index === ftthPendingOrders.length - 1 && styles.ftthPendingBaItemLast
                ]}>
                  <View style={styles.ftthPendingBaInfo}>
                    <View style={styles.ftthPendingBaBadge}>
                      <Text style={styles.ftthPendingBaBadgeText}>{order.ba}</Text>
                    </View>
                    <Text style={styles.ftthPendingBaLabel}>Business Area</Text>
                  </View>
                  <View style={styles.ftthPendingBaCount}>
                    <Text style={styles.ftthPendingBaCountValue}>{order.totalFtthOrdersPending}</Text>
                    <Text style={styles.ftthPendingBaCountLabel}>orders</Text>
                  </View>
                </View>
              ))}
            </View>
            )}
          </View>
        )}

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
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    color: Colors.light.textSecondary,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    gap: 16,
  },
  errorText: {
    fontSize: 16,
    color: Colors.light.error,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.light.primary,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    gap: 8,
  },
  backButtonText: {
    color: Colors.light.background,
    fontWeight: '600',
  },
  header: {
    paddingTop: 30,
    paddingBottom: 24,
    alignItems: 'center',
  },
  avatarContainer: {
    marginBottom: 12,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    fontSize: 28,
    fontWeight: 'bold',
    color: Colors.light.background,
  },
  name: {
    fontSize: 22,
    fontWeight: 'bold',
    color: Colors.light.background,
    marginBottom: 4,
  },
  designation: {
    fontSize: 16,
    color: Colors.light.background,
    opacity: 0.9,
    marginBottom: 2,
  },
  circle: {
    fontSize: 14,
    color: Colors.light.background,
    opacity: 0.8,
  },
  section: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold' as const,
    color: Colors.light.text,
    marginBottom: 12,
  },
  infoCard: {
    backgroundColor: Colors.light.card,
    borderRadius: 12,
    padding: 16,
  },
  infoItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  infoIcon: {
    marginRight: 16,
  },
  infoContent: {
    flex: 1,
  },
  infoLabel: {
    fontSize: 12,
    color: Colors.light.textSecondary,
    marginBottom: 4,
  },
  infoValue: {
    fontSize: 16,
    color: Colors.light.text,
    fontWeight: '600' as const,
  },
  outstandingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  outstandingTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#D32F2F',
  },
  outstandingCard: {
    backgroundColor: '#FFF5F5',
    borderRadius: 16,
    padding: 20,
    borderWidth: 2,
    borderColor: '#FFCDD2',
  },
  outstandingItem: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  outstandingLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  outstandingLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#B71C1C',
  },
  outstandingAmount: {
    fontSize: 28,
    fontWeight: '800',
    color: '#D32F2F',
    letterSpacing: 0.5,
  },
  outstandingAmountFull: {
    fontSize: 12,
    color: '#757575',
    marginTop: 4,
  },
  outstandingDivider: {
    height: 1,
    backgroundColor: '#FFCDD2',
    marginVertical: 12,
  },
  outstandingTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#FFEBEE',
    borderRadius: 12,
    padding: 16,
    marginTop: 16,
    borderWidth: 1,
    borderColor: '#FFCDD2',
  },
  outstandingTotalLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: '#B71C1C',
  },
  outstandingTotalAmount: {
    fontSize: 20,
    fontWeight: '800',
    color: '#D32F2F',
  },
  outstandingTotalAmountFull: {
    fontSize: 11,
    color: '#757575',
    marginTop: 2,
  },
  ftthPendingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  ftthPendingTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FF6B00',
  },
  ftthPendingCard: {
    backgroundColor: '#FFF8F0',
    borderRadius: 16,
    padding: 20,
    borderWidth: 2,
    borderColor: '#FFE0B2',
  },
  ftthPendingLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 20,
  },
  ftthPendingLoadingText: {
    fontSize: 14,
    color: '#FF6B00',
  },
  ftthPendingErrorText: {
    fontSize: 14,
    color: '#D32F2F',
    textAlign: 'center',
    paddingVertical: 20,
  },
  ftthPendingSummary: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 8,
  },
  ftthPendingSummaryItem: {
    alignItems: 'center',
  },
  ftthPendingSummaryValue: {
    fontSize: 32,
    fontWeight: '800',
    color: '#FF6B00',
  },
  ftthPendingSummaryLabel: {
    fontSize: 12,
    color: '#666',
    marginTop: 4,
  },
  ftthPendingDivider: {
    height: 1,
    backgroundColor: '#FFE0B2',
    marginVertical: 16,
  },
  ftthPendingBaTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
    marginBottom: 12,
  },
  ftthPendingBaItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#FFE0B2',
  },
  ftthPendingBaItemLast: {
    marginBottom: 0,
  },
  ftthPendingBaInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  ftthPendingBaBadge: {
    backgroundColor: '#FF6B00',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  ftthPendingBaBadgeText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  ftthPendingBaLabel: {
    fontSize: 12,
    color: '#666',
  },
  ftthPendingBaCount: {
    alignItems: 'flex-end',
  },
  ftthPendingBaCountValue: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FF6B00',
  },
  ftthPendingBaCountLabel: {
    fontSize: 11,
    color: '#999',
  },
  bottomSpacer: {
    height: 40,
  },
  noticeCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#FFF3E0',
    padding: 16,
    marginHorizontal: 16,
    marginVertical: 16,
    borderRadius: 12,
    gap: 12,
    borderWidth: 1,
    borderColor: '#FFE0B2',
  },
  noticeText: {
    flex: 1,
    fontSize: 14,
    color: '#E65100',
    lineHeight: 20,
  },
  headerContent: {
    alignItems: 'center',
    marginBottom: 12,
  },
  ftthSummary: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: '#E3F2FD',
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
  },
  ftthSummaryItem: {
    alignItems: 'center',
  },
  ftthSummaryValue: {
    fontSize: 24,
    fontWeight: '700',
    color: '#1565C0',
  },
  ftthSummaryLabel: {
    fontSize: 12,
    color: '#666',
    marginTop: 4,
  },
  ftthList: {
    gap: 8,
  },
  ftthItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  ftthItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  ftthBaName: {
    fontSize: 14,
    color: '#333',
    flex: 1,
  },
  ftthOrderCount: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1565C0',
  },
  outstandingLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 20,
  },
  outstandingLoadingText: {
    fontSize: 14,
    color: '#D32F2F',
  },
  outstandingError: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 20,
    gap: 12,
  },
  outstandingErrorText: {
    fontSize: 14,
    color: '#D32F2F',
    textAlign: 'center',
  },
  outstandingRetryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#D32F2F',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
  },
  outstandingRetryText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  circleBreakdownToggle: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#FFEBEE',
    borderRadius: 10,
    padding: 14,
    marginTop: 16,
    borderWidth: 1,
    borderColor: '#FFCDD2',
  },
  circleBreakdownToggleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  circleBreakdownToggleText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#D32F2F',
  },
  circleBreakdownList: {
    marginTop: 12,
  },
  circleBreakdownItem: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#FFCDD2',
  },
  circleBreakdownItemLast: {
    marginBottom: 0,
  },
  circleBreakdownHeader: {
    marginBottom: 10,
  },
  circleBreakdownBadge: {
    backgroundColor: '#D32F2F',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
  circleBreakdownBadgeText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 12,
  },
  circleBreakdownAmounts: {
    gap: 6,
  },
  circleBreakdownAmountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  circleBreakdownAmountLabel: {
    fontSize: 13,
    color: '#666',
  },
  circleBreakdownAmountValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#D32F2F',
  },
  circleBreakdownAmountLabelTotal: {
    fontSize: 14,
    fontWeight: '600',
    color: '#B71C1C',
  },
  circleBreakdownAmountValueTotal: {
    fontSize: 16,
    fontWeight: '700',
    color: '#B71C1C',
  },
});
