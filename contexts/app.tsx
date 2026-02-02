import createContextHook from '@nkzw/create-context-hook';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useState, useEffect, useCallback } from 'react';
import { SalesReport, Resource, Issue, AuditLog, Employee } from '@/types';
import { trpc } from '@/lib/trpc';

const SALES_KEY = 'bsnl_sales';
const RESOURCES_KEY = 'bsnl_resources';
const ISSUES_KEY = 'bsnl_issues';
const AUDIT_KEY = 'bsnl_audit';
const EMPLOYEES_KEY = 'bsnl_employees';

export const [AppProvider, useApp] = createContextHook(() => {
  const [salesReports, setSalesReports] = useState<SalesReport[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const resourcesQuery = trpc.resources.getAll.useQuery(undefined, {
    retry: 1,
    refetchOnWindowFocus: true,
    refetchInterval: 15000,
    staleTime: 10000,
  });

  const issuesQuery = trpc.issues.getAll.useQuery(undefined, {
    retry: 1,
    refetchOnWindowFocus: true,
    refetchInterval: 15000,
    staleTime: 10000,
  });

  useEffect(() => {
    if (resourcesQuery.data) {
      const formattedResources: Resource[] = resourcesQuery.data.map((r: any) => ({
        id: r.id,
        type: r.type,
        circle: r.circle,
        total: r.total,
        allocated: r.allocated,
        used: r.used,
        remaining: r.remaining,
        updatedAt: r.updatedAt,
      }));
      setResources(formattedResources);
      AsyncStorage.setItem(RESOURCES_KEY, JSON.stringify(formattedResources));
    }
  }, [resourcesQuery.data]);

  useEffect(() => {
    if (issuesQuery.data) {
      const formattedIssues: Issue[] = issuesQuery.data.map((i: any) => ({
        id: i.id,
        eventId: i.eventId,
        raisedBy: i.raisedBy,
        type: i.type,
        description: i.description,
        status: i.status,
        escalatedTo: i.escalatedTo,
        resolvedBy: i.resolvedBy,
        resolvedAt: i.resolvedAt,
        timeline: i.timeline,
        createdAt: i.createdAt,
        updatedAt: i.updatedAt,
      }));
      setIssues(formattedIssues);
      AsyncStorage.setItem(ISSUES_KEY, JSON.stringify(formattedIssues));
    }
  }, [issuesQuery.data]);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [salesData, resourcesData, issuesData, auditData, employeesData] = await Promise.all([
        AsyncStorage.getItem(SALES_KEY),
        AsyncStorage.getItem(RESOURCES_KEY),
        AsyncStorage.getItem(ISSUES_KEY),
        AsyncStorage.getItem(AUDIT_KEY),
        AsyncStorage.getItem(EMPLOYEES_KEY),
      ]);

      if (salesData) setSalesReports(JSON.parse(salesData));
      if (resourcesData) setResources(JSON.parse(resourcesData));
      if (issuesData) setIssues(JSON.parse(issuesData));
      if (auditData) setAuditLogs(JSON.parse(auditData));
      if (employeesData) setEmployees(JSON.parse(employeesData));
    } catch (error) {
      console.error('Failed to load app data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const refetchResources = useCallback(() => {
    resourcesQuery.refetch();
  }, [resourcesQuery]);

  const refetchIssues = useCallback(() => {
    issuesQuery.refetch();
  }, [issuesQuery]);

  const addSalesReport = useCallback(async (report: SalesReport) => {
    const updated = [...salesReports, report];
    setSalesReports(updated);
    await AsyncStorage.setItem(SALES_KEY, JSON.stringify(updated));
  }, [salesReports]);

  const updateResource = useCallback(async (resourceId: string, updates: Partial<Resource>) => {
    const updated = resources.map(r => r.id === resourceId ? { ...r, ...updates } : r);
    setResources(updated);
    await AsyncStorage.setItem(RESOURCES_KEY, JSON.stringify(updated));
  }, [resources]);

  const addIssue = useCallback(async (issue: Issue) => {
    const updated = [...issues, issue];
    setIssues(updated);
    await AsyncStorage.setItem(ISSUES_KEY, JSON.stringify(updated));
  }, [issues]);

  const updateIssue = useCallback(async (issueId: string, updates: Partial<Issue>) => {
    const updated = issues.map(i => i.id === issueId ? { ...i, ...updates } : i);
    setIssues(updated);
    await AsyncStorage.setItem(ISSUES_KEY, JSON.stringify(updated));
  }, [issues]);

  const addAuditLog = useCallback(async (log: AuditLog) => {
    const updated = [...auditLogs, log];
    setAuditLogs(updated);
    await AsyncStorage.setItem(AUDIT_KEY, JSON.stringify(updated));
  }, [auditLogs]);

  const addEmployees = useCallback(async (newEmployees: Employee[]) => {
    const updated = [...employees, ...newEmployees];
    setEmployees(updated);
    await AsyncStorage.setItem(EMPLOYEES_KEY, JSON.stringify(updated));
  }, [employees]);

  const clearAllData = useCallback(async () => {
    setSalesReports([]);
    setResources([]);
    setIssues([]);
    setAuditLogs([]);
    await AsyncStorage.multiRemove([SALES_KEY, RESOURCES_KEY, ISSUES_KEY, AUDIT_KEY]);
  }, []);

  return {
    salesReports,
    resources,
    issues,
    auditLogs,
    employees,
    isLoading,
    isLoadingResources: resourcesQuery.isLoading,
    isLoadingIssues: issuesQuery.isLoading,
    addSalesReport,
    updateResource,
    addIssue,
    updateIssue,
    addAuditLog,
    addEmployees,
    clearAllData,
    refetchResources,
    refetchIssues,
  };
});
