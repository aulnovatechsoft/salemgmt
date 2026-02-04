import createContextHook from '@nkzw/create-context-hook';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useState, useEffect, useCallback } from 'react';
import { Employee } from '@/types';
import { setEmployeeId } from '@/lib/trpc';

const AUTH_KEY = 'bsnl_auth';
const EMPLOYEE_KEY = 'bsnl_employee';

export const [AuthProvider, useAuth] = createContextHook(() => {
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    loadAuth();
  }, []);

  const loadAuth = async () => {
    try {
      const [authToken, employeeData] = await Promise.all([
        AsyncStorage.getItem(AUTH_KEY),
        AsyncStorage.getItem(EMPLOYEE_KEY),
      ]);

      if (authToken && employeeData) {
        const parsedEmployee = JSON.parse(employeeData);
        setEmployee(parsedEmployee);
        setEmployeeId(parsedEmployee.id);
        setIsAuthenticated(true);
      }
    } catch (error) {
      console.error('Failed to load auth:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const login = useCallback(async (employeeData: Employee) => {
    try {
      await AsyncStorage.setItem(AUTH_KEY, 'authenticated');
      await AsyncStorage.setItem(EMPLOYEE_KEY, JSON.stringify(employeeData));
      setEmployee(employeeData);
      setEmployeeId(employeeData.id);
      setIsAuthenticated(true);
    } catch (error) {
      console.error('Failed to save auth:', error);
      throw error;
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await AsyncStorage.multiRemove([AUTH_KEY, EMPLOYEE_KEY]);
      setEmployee(null);
      setEmployeeId(null);
      setIsAuthenticated(false);
    } catch (error) {
      console.error('Failed to logout:', error);
    }
  }, []);

  const refreshEmployee = useCallback(async () => {
    if (!employee?.id) return;
    try {
      const response = await fetch(`/api/trpc/employees.getById?input=${encodeURIComponent(JSON.stringify({ id: employee.id }))}`);
      const result = await response.json();
      if (result?.result?.data) {
        const updatedEmployee = result.result.data;
        await AsyncStorage.setItem(EMPLOYEE_KEY, JSON.stringify(updatedEmployee));
        setEmployee(updatedEmployee);
      }
    } catch (error) {
      console.error('Failed to refresh employee:', error);
    }
  }, [employee?.id]);

  const updateEmployee = useCallback(async (updates: Partial<Employee>) => {
    if (!employee) return;
    const updatedEmployee = { ...employee, ...updates };
    await AsyncStorage.setItem(EMPLOYEE_KEY, JSON.stringify(updatedEmployee));
    setEmployee(updatedEmployee);
  }, [employee]);

  return {
    employee,
    isAuthenticated,
    isLoading,
    login,
    logout,
    refreshEmployee,
    updateEmployee,
  };
});
