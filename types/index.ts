export type UserRole = 'GM' | 'CGM' | 'DGM' | 'AGM' | 'SD_JTO' | 'SALES_STAFF';

export type EventCategory = 
  | 'Cultural' 
  | 'Religious' 
  | 'Sports' 
  | 'Exhibition' 
  | 'Fair'
  | 'Festival'
  | 'Agri-Tourism'
  | 'Eco-Tourism'
  | 'Trade/Religious';

export type Circle = 
  | 'ANDAMAN_NICOBAR'
  | 'ANDHRA_PRADESH'
  | 'ASSAM'
  | 'BIHAR'
  | 'CHHATTISGARH'
  | 'GUJARAT'
  | 'HARYANA'
  | 'HIMACHAL_PRADESH'
  | 'JAMMU_KASHMIR'
  | 'JHARKHAND'
  | 'KARNATAKA'
  | 'KERALA'
  | 'MADHYA_PRADESH'
  | 'MAHARASHTRA'
  | 'NORTH_EAST_I'
  | 'NORTH_EAST_II'
  | 'ODISHA'
  | 'PUNJAB'
  | 'RAJASTHAN'
  | 'TAMIL_NADU'
  | 'TELANGANA'
  | 'UTTARAKHAND'
  | 'UTTAR_PRADESH_EAST'
  | 'UTTAR_PRADESH_WEST'
  | 'WEST_BENGAL';

export type IssueType = 
  | 'MATERIAL_SHORTAGE'
  | 'SITE_ACCESS'
  | 'EQUIPMENT'
  | 'NETWORK_PROBLEM'
  | 'OTHER';

export type IssueStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';

export interface Employee {
  id: string;
  name: string;
  email: string;
  phone: string;
  password?: string;
  role: UserRole;
  circle: Circle;
  division: string;
  buildingName?: string;
  officeName?: string;
  reportingOfficerId?: string;
  employeeNo?: string;
  designation: string;
  createdAt: string;
}

export interface Event {
  id: string;
  name: string;
  location: string;
  circle: Circle;
  zone: string;
  dateRange: {
    startDate: string;
    endDate: string;
  };
  category: EventCategory;
  targetSim: number;
  targetFtth: number;
  assignedTeam: string[];
  allocatedSim: number;
  allocatedFtth: number;
  assignedTo?: string;
  assignedToEmployee?: Employee;
  createdBy: string;
  createdAt: string;
  keyInsight?: string;
  status?: EventStatus;
}

export interface SalesReport {
  id: string;
  eventId: string;
  salesStaffId: string;
  simsSold: number;
  simsActivated: number;
  activatedMobileNumbers?: string[];
  ftthLeads: number;
  ftthInstalled: number;
  activatedFtthIds?: string[];
  customerType: 'B2C' | 'B2B' | 'Government' | 'Enterprise';
  photos: string[];
  gpsLocation?: {
    latitude: number;
    longitude: number;
  };
  remarks: string;
  createdAt: string;
  synced: boolean;
  status: SalesReportStatus;
  reviewedBy?: string;
  reviewedAt?: string;
  reviewRemarks?: string;
  salesStaffName?: string;
  eventName?: string;
}

export interface Resource {
  id: string;
  type: 'SIM' | 'FTTH';
  circle: Circle;
  total: number;
  allocated: number;
  used: number;
  remaining: number;
  updatedAt: string;
}

export interface Issue {
  id: string;
  eventId: string;
  raisedBy: string;
  type: IssueType;
  description: string;
  status: IssueStatus;
  escalatedTo?: string;
  resolvedBy?: string;
  resolvedAt?: string;
  createdAt: string;
  timeline: {
    action: string;
    performedBy: string;
    timestamp: string;
  }[];
}

export interface AuditLog {
  id: string;
  action: string;
  entityType: 'EVENT' | 'SALES' | 'RESOURCE' | 'ISSUE' | 'EMPLOYEE';
  entityId: string;
  performedBy: string;
  timestamp: string;
  details: Record<string, any>;
}

export interface OTPVerification {
  identifier: string;
  type: 'email' | 'mobile';
  otp: string;
  expiresAt: string;
}

export interface EventAssignment {
  id: string;
  eventId: string;
  employeeId: string;
  simTarget: number;
  ftthTarget: number;
  simSold: number;
  ftthSold: number;
  assignedBy?: string;
  assignedAt: string;
  updatedAt: string;
}

export interface EventSalesEntry {
  id: string;
  eventId: string;
  employeeId: string;
  simsSold: number;
  simsActivated: number;
  ftthSold: number;
  ftthActivated: number;
  customerType: 'B2C' | 'B2B' | 'Government' | 'Enterprise';
  photos: GeoTaggedPhoto[];
  gpsLatitude?: string;
  gpsLongitude?: string;
  remarks?: string;
  createdAt: string;
}

export interface GeoTaggedPhoto {
  uri: string;
  latitude?: string;
  longitude?: string;
  timestamp: string;
}

export interface TeamMemberWithAllocation extends EventAssignment {
  employee?: Employee;
  actualSimSold: number;
  actualFtthSold: number;
  salesEntries: EventSalesEntry[];
}

export interface EventWithDetails extends Event {
  teamWithAllocations: TeamMemberWithAllocation[];
  salesEntries: EventSalesEntry[];
  subtasks: EventSubtask[];
  summary: {
    totalSimsSold: number;
    totalFtthSold: number;
    totalEntries: number;
    teamCount: number;
    subtaskStats: {
      total: number;
      completed: number;
      pending: number;
      inProgress: number;
    };
  };
}

export type SubtaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';
export type SubtaskPriority = 'low' | 'medium' | 'high' | 'urgent';
export type EventStatus = 'draft' | 'active' | 'paused' | 'completed' | 'cancelled';
export type SalesReportStatus = 'pending' | 'approved' | 'rejected';

export interface EventSubtask {
  id: string;
  eventId: string;
  title: string;
  description?: string;
  assignedTo?: string;
  assignedEmployee?: Employee;
  status: SubtaskStatus;
  priority: SubtaskPriority;
  dueDate?: string;
  completedAt?: string;
  completedBy?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
