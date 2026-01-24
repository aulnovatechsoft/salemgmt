import createContextHook from '@nkzw/create-context-hook';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useState, useEffect, useCallback } from 'react';
import { Employee } from '@/types';
import { setCurrentEmployeeId } from '@/lib/trpc';

const AUTH_KEY = 'bsnl_auth';
const EMPLOYEE_KEY = 'bsnl_employee';

export const [AuthProvider, useAuth] = createContextHook(() => {
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  const loadAuth = async () => {
    try {
      const [authToken, employeeData] = await Promise.all([
        AsyncStorage.getItem(AUTH_KEY),
        AsyncStorage.getItem(EMPLOYEE_KEY),
      ]);

      if (authToken && employeeData) {
        const parsedEmployee = JSON.parse(employeeData);
        setEmployee(parsedEmployee);
        setIsAuthenticated(true);
        setCurrentEmployeeId(parsedEmployee.id);
      }
    } catch (error) {
      console.error('Failed to load auth:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadAuth();
  }, []);

  useEffect(() => {
    setCurrentEmployeeId(employee?.id || null);
  }, [employee]);

  const login = useCallback(async (employeeData: Employee) => {
    try {
      await AsyncStorage.setItem(AUTH_KEY, 'authenticated');
      await AsyncStorage.setItem(EMPLOYEE_KEY, JSON.stringify(employeeData));
      setEmployee(employeeData);
      setIsAuthenticated(true);
      setCurrentEmployeeId(employeeData.id);
    } catch (error) {
      console.error('Failed to save auth:', error);
      throw error;
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await AsyncStorage.multiRemove([AUTH_KEY, EMPLOYEE_KEY]);
      setEmployee(null);
      setIsAuthenticated(false);
      setCurrentEmployeeId(null);
    } catch (error) {
      console.error('Failed to logout:', error);
    }
  }, []);

  return {
    employee,
    isAuthenticated,
    isLoading,
    login,
    logout,
  };
});
