import createContextHook from '@nkzw/create-context-hook';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useState, useEffect, useCallback } from 'react';
import { Event, SalesReport, Resource, Issue, AuditLog, Employee } from '@/types';
import { trpc } from '@/lib/trpc';

const EVENTS_KEY = 'bsnl_events';
const SALES_KEY = 'bsnl_sales';
const RESOURCES_KEY = 'bsnl_resources';
const ISSUES_KEY = 'bsnl_issues';
const AUDIT_KEY = 'bsnl_audit';
const EMPLOYEES_KEY = 'bsnl_employees';

export const [AppProvider, useApp] = createContextHook(() => {
  const [events, setEvents] = useState<Event[]>([]);
  const [salesReports, setSalesReports] = useState<SalesReport[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const eventsQuery = trpc.events.getAll.useQuery(undefined, {
    retry: 1,
    refetchOnWindowFocus: true,
    refetchInterval: 10000,
    staleTime: 5000,
  });

  const resourcesQuery = trpc.resources.getAll.useQuery(undefined, {
    retry: 1,
    refetchOnWindowFocus: true,
    refetchInterval: 15000,
    staleTime: 10000,
  });

  useEffect(() => {
    if (eventsQuery.data) {
      const formattedEvents: Event[] = eventsQuery.data.map((e: any) => ({
        id: e.id,
        name: e.name,
        location: e.location,
        circle: e.circle,
        zone: e.zone,
        dateRange: {
          startDate: e.startDate,
          endDate: e.endDate,
        },
        category: e.category,
        targetSim: e.targetSim,
        targetFtth: e.targetFtth,
        assignedTeam: e.assignedTeam || [],
        allocatedSim: e.allocatedSim,
        allocatedFtth: e.allocatedFtth,
        createdBy: e.createdBy,
        createdAt: e.createdAt,
        keyInsight: e.keyInsight,
        status: e.status || 'active',
        assignedTo: e.assignedTo,
        simsSold: e.simSold || 0,
        ftthSold: e.ftthSold || 0,
      }));
      console.log('Formatted events from backend:', formattedEvents.length);
      setEvents(formattedEvents);
      AsyncStorage.setItem(EVENTS_KEY, JSON.stringify(formattedEvents));
    }
  }, [eventsQuery.data]);

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
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [eventsData, salesData, resourcesData, issuesData, auditData, employeesData] = await Promise.all([
        AsyncStorage.getItem(EVENTS_KEY),
        AsyncStorage.getItem(SALES_KEY),
        AsyncStorage.getItem(RESOURCES_KEY),
        AsyncStorage.getItem(ISSUES_KEY),
        AsyncStorage.getItem(AUDIT_KEY),
        AsyncStorage.getItem(EMPLOYEES_KEY),
      ]);

      if (eventsData && !eventsQuery.data) setEvents(JSON.parse(eventsData));
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

  const refetchEvents = useCallback(() => {
    eventsQuery.refetch();
  }, [eventsQuery]);

  const refetchResources = useCallback(() => {
    resourcesQuery.refetch();
  }, [resourcesQuery]);

  const refetchAll = useCallback(() => {
    eventsQuery.refetch();
    resourcesQuery.refetch();
  }, [eventsQuery, resourcesQuery]);

  const addEvent = useCallback(async (event: Event) => {
    const updated = [...events, event];
    setEvents(updated);
    await AsyncStorage.setItem(EVENTS_KEY, JSON.stringify(updated));
  }, [events]);

  const updateEvent = useCallback(async (eventId: string, updates: Partial<Event>) => {
    const updated = events.map(e => e.id === eventId ? { ...e, ...updates } : e);
    setEvents(updated);
    await AsyncStorage.setItem(EVENTS_KEY, JSON.stringify(updated));
  }, [events]);

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
    setEvents([]);
    setSalesReports([]);
    setResources([]);
    setIssues([]);
    setAuditLogs([]);
    await AsyncStorage.multiRemove([EVENTS_KEY, SALES_KEY, RESOURCES_KEY, ISSUES_KEY, AUDIT_KEY]);
  }, []);

  return {
    events,
    salesReports,
    resources,
    issues,
    auditLogs,
    employees,
    isLoading,
    isLoadingEvents: eventsQuery.isLoading,
    isLoadingResources: resourcesQuery.isLoading,
    addEvent,
    updateEvent,
    addSalesReport,
    updateResource,
    addIssue,
    updateIssue,
    addAuditLog,
    addEmployees,
    clearAllData,
    refetchEvents,
    refetchResources,
    refetchAll,
  };
});
