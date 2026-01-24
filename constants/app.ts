import { UserRole, Circle, EventCategory, IssueType } from '@/types';

export const USER_ROLES: { label: string; value: UserRole }[] = [
  { label: 'GM (Multi-Circle)', value: 'GM' },
  { label: 'CGM (Circle)', value: 'CGM' },
  { label: 'DGM (Zone)', value: 'DGM' },
  { label: 'AGM (Team/Event)', value: 'AGM' },
  { label: 'SD/JTO', value: 'SD_JTO' },
  { label: 'Sales Staff', value: 'SALES_STAFF' },
];

export const CIRCLES: { label: string; value: Circle }[] = [
  { label: 'Andaman & Nicobar', value: 'ANDAMAN_NICOBAR' },
  { label: 'Andhra Pradesh', value: 'ANDHRA_PRADESH' },
  { label: 'Assam', value: 'ASSAM' },
  { label: 'Bihar', value: 'BIHAR' },
  { label: 'Chhattisgarh', value: 'CHHATTISGARH' },
  { label: 'Gujarat', value: 'GUJARAT' },
  { label: 'Haryana', value: 'HARYANA' },
  { label: 'Himachal Pradesh', value: 'HIMACHAL_PRADESH' },
  { label: 'Jammu & Kashmir', value: 'JAMMU_KASHMIR' },
  { label: 'Jharkhand', value: 'JHARKHAND' },
  { label: 'Karnataka', value: 'KARNATAKA' },
  { label: 'Kerala', value: 'KERALA' },
  { label: 'Madhya Pradesh', value: 'MADHYA_PRADESH' },
  { label: 'Maharashtra', value: 'MAHARASHTRA' },
  { label: 'North East-I', value: 'NORTH_EAST_I' },
  { label: 'North East-II', value: 'NORTH_EAST_II' },
  { label: 'Odisha', value: 'ODISHA' },
  { label: 'Punjab', value: 'PUNJAB' },
  { label: 'Rajasthan', value: 'RAJASTHAN' },
  { label: 'Tamil Nadu', value: 'TAMIL_NADU' },
  { label: 'Telangana', value: 'TELANGANA' },
  { label: 'Uttarakhand', value: 'UTTARAKHAND' },
  { label: 'Uttar Pradesh (East)', value: 'UTTAR_PRADESH_EAST' },
  { label: 'Uttar Pradesh (West)', value: 'UTTAR_PRADESH_WEST' },
  { label: 'West Bengal', value: 'WEST_BENGAL' },
];

export const EVENT_CATEGORIES: { label: string; value: EventCategory }[] = [
  { label: 'Cultural', value: 'Cultural' },
  { label: 'Religious', value: 'Religious' },
  { label: 'Sports', value: 'Sports' },
  { label: 'Exhibition', value: 'Exhibition' },
  { label: 'Fair', value: 'Fair' },
  { label: 'Festival', value: 'Festival' },
  { label: 'Agri-Tourism', value: 'Agri-Tourism' },
  { label: 'Eco-Tourism', value: 'Eco-Tourism' },
  { label: 'Trade/Religious', value: 'Trade/Religious' },
];

export const ISSUE_TYPES: { label: string; value: IssueType }[] = [
  { label: 'Material Shortage', value: 'MATERIAL_SHORTAGE' },
  { label: 'Site Access', value: 'SITE_ACCESS' },
  { label: 'Equipment Issue', value: 'EQUIPMENT' },
  { label: 'Network Problem', value: 'NETWORK_PROBLEM' },
  { label: 'Other', value: 'OTHER' },
];

export const CUSTOMER_TYPES = [
  { label: 'B2C', value: 'B2C' },
  { label: 'B2B', value: 'B2B' },
  { label: 'Government', value: 'Government' },
  { label: 'Enterprise', value: 'Enterprise' },
];

export const getRoleHierarchy = (role: UserRole): number => {
  const hierarchy: Record<UserRole, number> = {
    GM: 6,
    CGM: 5,
    DGM: 4,
    AGM: 3,
    SD_JTO: 2,
    SALES_STAFF: 1,
  };
  return hierarchy[role];
};

export const canCreateEvents = (role: UserRole): boolean => {
  return ['AGM', 'DGM', 'CGM', 'GM'].includes(role);
};

export const canViewAllCircles = (role: UserRole): boolean => {
  return ['GM'].includes(role);
};

export const canApprove = (role: UserRole): boolean => {
  return ['CGM', 'DGM', 'AGM', 'GM'].includes(role);
};

export const CIRCLES_FALLBACK = CIRCLES;

export const DIVISIONS_FALLBACK: { label: string; value: string }[] = [
  { label: 'Commercial', value: '1' },
  { label: 'Marketing', value: '2' },
  { label: 'Enterprise Business', value: '3' },
  { label: 'Retail Sales', value: '4' },
  { label: 'Business Development', value: '5' },
  { label: 'Customer Service', value: '6' },
  { label: 'Revenue & Billing', value: '7' },
  { label: 'Network Operations', value: '8' },
  { label: 'Transmission', value: '9' },
  { label: 'Switching', value: '10' },
  { label: 'Mobile Services', value: '11' },
  { label: 'Fixed Line', value: '12' },
  { label: 'FTTH / Broadband', value: '13' },
  { label: 'IP / MPLS', value: '14' },
  { label: 'NOC', value: '15' },
  { label: 'RF / Radio Planning', value: '16' },
  { label: 'Planning', value: '17' },
  { label: 'Project Management', value: '18' },
  { label: 'Infrastructure Development', value: '19' },
  { label: 'Optical Fiber (OFC)', value: '20' },
  { label: 'Civil Works', value: '21' },
  { label: 'Electrical', value: '22' },
  { label: 'Power & Energy', value: '23' },
  { label: 'IT', value: '24' },
  { label: 'Software / Applications', value: '25' },
  { label: 'Data Center', value: '26' },
  { label: 'Cyber Security', value: '27' },
  { label: 'ERP / SAP', value: '28' },
  { label: 'Digital Services', value: '29' },
  { label: 'HR / Personnel', value: '30' },
  { label: 'Administration', value: '31' },
  { label: 'Establishment', value: '32' },
  { label: 'Training', value: '33' },
  { label: 'ALTTC', value: '34' },
  { label: 'Vigilance', value: '35' },
  { label: 'Legal', value: '36' },
  { label: 'Finance', value: '37' },
  { label: 'Accounts', value: '38' },
  { label: 'Audit', value: '39' },
  { label: 'Budget & Costing', value: '40' },
  { label: 'Revenue Assurance', value: '41' },
  { label: 'Inspection', value: '42' },
  { label: 'Quality Assurance', value: '43' },
  { label: 'Performance Monitoring', value: '44' },
  { label: 'Stores', value: '45' },
  { label: 'Procurement', value: '46' },
  { label: 'Inventory', value: '47' },
  { label: 'Transport', value: '48' },
  { label: 'Security', value: '49' },
  { label: 'Corporate Office', value: '50' },
  { label: 'ITPC', value: '51' },
  { label: 'CN-TX', value: '52' },
  { label: 'Telecom Factory', value: '53' },
  { label: 'Special Projects', value: '54' },
  { label: 'R&D / Research', value: '55' },
];
