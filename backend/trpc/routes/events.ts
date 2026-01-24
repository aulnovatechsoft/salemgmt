import { z } from "zod";
import { eq, and, desc, gte, lte, sql } from "drizzle-orm";
import { createTRPCRouter, publicProcedure } from "../create-context";
import { db, events, employees, auditLogs, eventAssignments, eventSalesEntries, eventSubtasks, employeeMaster, resources, resourceAllocations } from "@/backend/db";
import { notifyEventAssignment, notifySubtaskAssigned, notifySubtaskCompleted } from "@/backend/services/notification.service";

async function autoCompleteExpiredEvents(eventsList: typeof events.$inferSelect[]) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const expiredEventIds: string[] = [];
  for (const event of eventsList) {
    if (event.status === 'active' && event.endDate) {
      const endDate = new Date(event.endDate);
      endDate.setHours(23, 59, 59, 999);
      if (endDate < today) {
        expiredEventIds.push(event.id);
      }
    }
  }
  
  if (expiredEventIds.length > 0) {
    await Promise.all(expiredEventIds.map(id =>
      db.update(events)
        .set({ status: 'completed', updatedAt: new Date() })
        .where(eq(events.id, id))
    ));
    console.log(`Auto-completed ${expiredEventIds.length} expired works`);
  }
  
  return expiredEventIds;
}

export const eventsRouter = createTRPCRouter({
  getAll: publicProcedure
    .input(z.object({
      circle: z.string().optional(),
      zone: z.string().optional(),
      category: z.string().optional(),
      status: z.string().optional(),
    }).optional())
    .query(async ({ input }) => {
      console.log("Fetching all events", input);
      const results = await db.select().from(events).orderBy(desc(events.createdAt));
      
      // Get all event assignments to calculate sales progress
      const allAssignments = await db.select().from(eventAssignments);
      
      // Auto-complete expired events
      const expiredEventIds = await autoCompleteExpiredEvents(results);
      
      // Add sales progress to each event (with corrected status for expired ones)
      const eventsWithProgress = results.map(event => {
        const eventAssigns = allAssignments.filter(a => a.eventId === event.id);
        const simSold = eventAssigns.reduce((sum, a) => sum + a.simSold, 0);
        const ftthSold = eventAssigns.reduce((sum, a) => sum + a.ftthSold, 0);
        
        // Apply corrected status for expired events in this response
        const correctedStatus = expiredEventIds.includes(event.id) ? 'completed' : event.status;
        
        return {
          ...event,
          status: correctedStatus,
          simSold,
          ftthSold,
        };
      });
      
      return eventsWithProgress;
    }),

  getById: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      console.log("Fetching event by id:", input.id);
      const result = await db.select().from(events).where(eq(events.id, input.id));
      return result[0] || null;
    }),

  create: publicProcedure
    .input(z.object({
      name: z.string().min(1),
      location: z.string().min(1),
      circle: z.enum(['ANDAMAN_NICOBAR', 'ANDHRA_PRADESH', 'ASSAM', 'BIHAR', 'CHHATTISGARH', 'GUJARAT', 'HARYANA', 'HIMACHAL_PRADESH', 'JAMMU_KASHMIR', 'JHARKHAND', 'KARNATAKA', 'KERALA', 'MADHYA_PRADESH', 'MAHARASHTRA', 'NORTH_EAST_I', 'NORTH_EAST_II', 'ODISHA', 'PUNJAB', 'RAJASTHAN', 'TAMIL_NADU', 'TELANGANA', 'UTTARAKHAND', 'UTTAR_PRADESH_EAST', 'UTTAR_PRADESH_WEST', 'WEST_BENGAL']),
      zone: z.string().min(1),
      startDate: z.string(),
      endDate: z.string(),
      category: z.enum(['Cultural', 'Religious', 'Sports', 'Exhibition', 'Fair', 'Festival', 'Agri-Tourism', 'Eco-Tourism', 'Trade/Religious']),
      targetSim: z.number().min(0),
      targetFtth: z.number().min(0),
      assignedTeam: z.array(z.string()).optional(),
      allocatedSim: z.number().min(0),
      allocatedFtth: z.number().min(0),
      keyInsight: z.string().optional(),
      assignedTo: z.string().uuid().optional(),
      assignedToStaffId: z.string().optional(),
      createdBy: z.string().uuid(),
    }))
    .mutation(async ({ input }) => {
      console.log("Creating event:", input.name);
      
      let assignedToId = input.assignedTo;
      
      if (input.assignedToStaffId && !assignedToId) {
        const masterRecord = await db.select().from(employeeMaster)
          .where(eq(employeeMaster.purseId, input.assignedToStaffId));
        if (masterRecord[0]?.linkedEmployeeId) {
          assignedToId = masterRecord[0].linkedEmployeeId;
        }
      }
      
      const circleResources = await db.select().from(resources)
        .where(eq(resources.circle, input.circle));
      
      const simResource = circleResources.find(r => r.type === 'SIM');
      const ftthResource = circleResources.find(r => r.type === 'FTTH');
      
      if (input.allocatedSim > 0) {
        if (!simResource) {
          throw new Error(`No SIM inventory exists for circle ${input.circle}. Please set up circle resources first.`);
        }
        if (simResource.remaining < input.allocatedSim) {
          throw new Error(`Insufficient SIM resources. Available: ${simResource.remaining}, Requested: ${input.allocatedSim}`);
        }
      }
      
      if (input.allocatedFtth > 0) {
        if (!ftthResource) {
          throw new Error(`No FTTH inventory exists for circle ${input.circle}. Please set up circle resources first.`);
        }
        if (ftthResource.remaining < input.allocatedFtth) {
          throw new Error(`Insufficient FTTH resources. Available: ${ftthResource.remaining}, Requested: ${input.allocatedFtth}`);
        }
      }
      
      const result = await db.insert(events).values({
        name: input.name,
        location: input.location,
        circle: input.circle,
        zone: input.zone,
        startDate: new Date(input.startDate),
        endDate: new Date(input.endDate),
        category: input.category,
        targetSim: input.targetSim,
        targetFtth: input.targetFtth,
        assignedTeam: input.assignedTeam || [],
        allocatedSim: input.allocatedSim,
        allocatedFtth: input.allocatedFtth,
        keyInsight: input.keyInsight,
        assignedTo: assignedToId,
        createdBy: input.createdBy,
      }).returning();
      
      if (input.allocatedSim > 0 && simResource) {
        await db.update(resources)
          .set({
            allocated: simResource.allocated + input.allocatedSim,
            remaining: simResource.remaining - input.allocatedSim,
            updatedAt: new Date(),
          })
          .where(eq(resources.id, simResource.id));
        
        await db.insert(resourceAllocations).values({
          resourceId: simResource.id,
          eventId: result[0].id,
          quantity: input.allocatedSim,
          allocatedBy: input.createdBy,
        });
      }
      
      if (input.allocatedFtth > 0 && ftthResource) {
        await db.update(resources)
          .set({
            allocated: ftthResource.allocated + input.allocatedFtth,
            remaining: ftthResource.remaining - input.allocatedFtth,
            updatedAt: new Date(),
          })
          .where(eq(resources.id, ftthResource.id));
        
        await db.insert(resourceAllocations).values({
          resourceId: ftthResource.id,
          eventId: result[0].id,
          quantity: input.allocatedFtth,
          allocatedBy: input.createdBy,
        });
      }
      
      if (assignedToId) {
        const existingAssignment = await db.select().from(eventAssignments)
          .where(and(
            eq(eventAssignments.eventId, result[0].id),
            eq(eventAssignments.employeeId, assignedToId)
          ));
        
        if (!existingAssignment[0]) {
          await db.insert(eventAssignments).values({
            eventId: result[0].id,
            employeeId: assignedToId,
            simTarget: 0,
            ftthTarget: 0,
            assignedBy: input.createdBy,
          });
          
          await db.update(events)
            .set({ assignedTeam: [assignedToId], updatedAt: new Date() })
            .where(eq(events.id, result[0].id));
        }
      }

      await db.insert(auditLogs).values({
        action: 'CREATE_EVENT',
        entityType: 'EVENT',
        entityId: result[0].id,
        performedBy: input.createdBy,
        details: { eventName: input.name },
      });

      return result[0];
    }),

  update: publicProcedure
    .input(z.object({
      id: z.string().uuid(),
      name: z.string().min(1).optional(),
      location: z.string().min(1).optional(),
      circle: z.enum(['ANDAMAN_NICOBAR', 'ANDHRA_PRADESH', 'ASSAM', 'BIHAR', 'CHHATTISGARH', 'GUJARAT', 'HARYANA', 'HIMACHAL_PRADESH', 'JAMMU_KASHMIR', 'JHARKHAND', 'KARNATAKA', 'KERALA', 'MADHYA_PRADESH', 'MAHARASHTRA', 'NORTH_EAST_I', 'NORTH_EAST_II', 'ODISHA', 'PUNJAB', 'RAJASTHAN', 'TAMIL_NADU', 'TELANGANA', 'UTTARAKHAND', 'UTTAR_PRADESH_EAST', 'UTTAR_PRADESH_WEST', 'WEST_BENGAL']).optional(),
      zone: z.string().min(1).optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      category: z.enum(['Cultural', 'Religious', 'Sports', 'Exhibition', 'Fair', 'Festival', 'Agri-Tourism', 'Eco-Tourism', 'Trade/Religious']).optional(),
      targetSim: z.number().min(0).optional(),
      targetFtth: z.number().min(0).optional(),
      assignedTeam: z.array(z.string()).optional(),
      allocatedSim: z.number().min(0).optional(),
      allocatedFtth: z.number().min(0).optional(),
      keyInsight: z.string().optional(),
      status: z.string().optional(),
      assignedTo: z.string().uuid().nullable().optional(),
      updatedBy: z.string().uuid(),
    }))
    .mutation(async ({ input }) => {
      console.log("Updating event:", input.id);
      const { id, updatedBy, startDate, endDate, ...updateData } = input;
      
      const existingEvent = await db.select().from(events).where(eq(events.id, id));
      if (!existingEvent[0]) throw new Error("Event not found");
      
      if (input.allocatedSim !== undefined || input.allocatedFtth !== undefined) {
        const assignments = await db.select().from(eventAssignments)
          .where(eq(eventAssignments.eventId, id));
        
        const totalSimDistributed = assignments.reduce((sum, a) => sum + a.simTarget, 0);
        const totalFtthDistributed = assignments.reduce((sum, a) => sum + a.ftthTarget, 0);
        
        if (input.allocatedSim !== undefined && input.allocatedSim < totalSimDistributed) {
          throw new Error(`Cannot reduce SIM allocation below distributed amount (${totalSimDistributed}). Reduce team targets first.`);
        }
        
        if (input.allocatedFtth !== undefined && input.allocatedFtth < totalFtthDistributed) {
          throw new Error(`Cannot reduce FTTH allocation below distributed amount (${totalFtthDistributed}). Reduce team targets first.`);
        }
        
        const circleResources = await db.select().from(resources)
          .where(eq(resources.circle, existingEvent[0].circle));
        
        if (input.allocatedSim !== undefined && input.allocatedSim > existingEvent[0].allocatedSim) {
          const simResource = circleResources.find(r => r.type === 'SIM');
          const additionalNeeded = input.allocatedSim - existingEvent[0].allocatedSim;
          if (!simResource || simResource.remaining < additionalNeeded) {
            throw new Error(`Insufficient SIM resources. Available: ${simResource?.remaining || 0}, Additional needed: ${additionalNeeded}`);
          }
          
          await db.update(resources)
            .set({
              allocated: simResource.allocated + additionalNeeded,
              remaining: simResource.remaining - additionalNeeded,
              updatedAt: new Date(),
            })
            .where(eq(resources.id, simResource.id));
        } else if (input.allocatedSim !== undefined && input.allocatedSim < existingEvent[0].allocatedSim) {
          const simResource = circleResources.find(r => r.type === 'SIM');
          const returned = existingEvent[0].allocatedSim - input.allocatedSim;
          if (simResource) {
            await db.update(resources)
              .set({
                allocated: simResource.allocated - returned,
                remaining: simResource.remaining + returned,
                updatedAt: new Date(),
              })
              .where(eq(resources.id, simResource.id));
          }
        }
        
        if (input.allocatedFtth !== undefined && input.allocatedFtth > existingEvent[0].allocatedFtth) {
          const ftthResource = circleResources.find(r => r.type === 'FTTH');
          const additionalNeeded = input.allocatedFtth - existingEvent[0].allocatedFtth;
          if (!ftthResource || ftthResource.remaining < additionalNeeded) {
            throw new Error(`Insufficient FTTH resources. Available: ${ftthResource?.remaining || 0}, Additional needed: ${additionalNeeded}`);
          }
          
          await db.update(resources)
            .set({
              allocated: ftthResource.allocated + additionalNeeded,
              remaining: ftthResource.remaining - additionalNeeded,
              updatedAt: new Date(),
            })
            .where(eq(resources.id, ftthResource.id));
        } else if (input.allocatedFtth !== undefined && input.allocatedFtth < existingEvent[0].allocatedFtth) {
          const ftthResource = circleResources.find(r => r.type === 'FTTH');
          const returned = existingEvent[0].allocatedFtth - input.allocatedFtth;
          if (ftthResource) {
            await db.update(resources)
              .set({
                allocated: ftthResource.allocated - returned,
                remaining: ftthResource.remaining + returned,
                updatedAt: new Date(),
              })
              .where(eq(resources.id, ftthResource.id));
          }
        }
      }
      
      const updateValues: Record<string, unknown> = { ...updateData, updatedAt: new Date() };
      if (startDate) updateValues.startDate = new Date(startDate);
      if (endDate) updateValues.endDate = new Date(endDate);
      
      const result = await db.update(events)
        .set(updateValues)
        .where(eq(events.id, id))
        .returning();

      await db.insert(auditLogs).values({
        action: 'UPDATE_EVENT',
        entityType: 'EVENT',
        entityId: id,
        performedBy: updatedBy,
        details: updateData,
      });

      return result[0];
    }),

  delete: publicProcedure
    .input(z.object({ 
      id: z.string().uuid(),
      deletedBy: z.string().uuid(),
    }))
    .mutation(async ({ input }) => {
      console.log("Deleting event:", input.id);
      await db.update(events)
        .set({ status: 'deleted', updatedAt: new Date() })
        .where(eq(events.id, input.id));

      await db.insert(auditLogs).values({
        action: 'DELETE_EVENT',
        entityType: 'EVENT',
        entityId: input.id,
        performedBy: input.deletedBy,
        details: {},
      });

      return { success: true };
    }),

  getByCircle: publicProcedure
    .input(z.object({ 
      circle: z.enum(['ANDAMAN_NICOBAR', 'ANDHRA_PRADESH', 'ASSAM', 'BIHAR', 'CHHATTISGARH', 'GUJARAT', 'HARYANA', 'HIMACHAL_PRADESH', 'JAMMU_KASHMIR', 'JHARKHAND', 'KARNATAKA', 'KERALA', 'MADHYA_PRADESH', 'MAHARASHTRA', 'NORTH_EAST_I', 'NORTH_EAST_II', 'ODISHA', 'PUNJAB', 'RAJASTHAN', 'TAMIL_NADU', 'TELANGANA', 'UTTARAKHAND', 'UTTAR_PRADESH_EAST', 'UTTAR_PRADESH_WEST', 'WEST_BENGAL'])
    }))
    .query(async ({ input }) => {
      console.log("Fetching events by circle:", input.circle);
      const result = await db.select().from(events)
        .where(eq(events.circle, input.circle))
        .orderBy(desc(events.createdAt));
      
      // Auto-complete expired events
      const expiredIds = await autoCompleteExpiredEvents(result);
      
      return result.map(e => ({
        ...e,
        status: expiredIds.includes(e.id) ? 'completed' : e.status
      }));
    }),

  getActiveEvents: publicProcedure
    .query(async () => {
      console.log("Fetching active events");
      
      // First auto-complete any expired events in the database
      const allActive = await db.select().from(events)
        .where(eq(events.status, 'active'));
      await autoCompleteExpiredEvents(allActive);
      
      // Now fetch truly active events
      const now = new Date();
      const result = await db.select().from(events)
        .where(and(
          lte(events.startDate, now),
          gte(events.endDate, now),
          eq(events.status, 'active')
        ))
        .orderBy(desc(events.startDate));
      return result;
    }),

  getUpcomingEvents: publicProcedure
    .query(async () => {
      console.log("Fetching upcoming events");
      
      // First auto-complete any expired events
      const allActive = await db.select().from(events)
        .where(eq(events.status, 'active'));
      await autoCompleteExpiredEvents(allActive);
      
      const now = new Date();
      const result = await db.select().from(events)
        .where(and(
          gte(events.startDate, now),
          eq(events.status, 'active')
        ))
        .orderBy(events.startDate);
      return result;
    }),

  assignTeam: publicProcedure
    .input(z.object({
      eventId: z.string().uuid(),
      employeeIds: z.array(z.string().uuid()),
      assignedBy: z.string().uuid(),
    }))
    .mutation(async ({ input }) => {
      console.log("Assigning team to event:", input.eventId);
      
      for (const employeeId of input.employeeIds) {
        await db.insert(eventAssignments).values({
          eventId: input.eventId,
          employeeId: employeeId,
          assignedBy: input.assignedBy,
        }).onConflictDoNothing();
      }

      await db.update(events)
        .set({ assignedTeam: input.employeeIds, updatedAt: new Date() })
        .where(eq(events.id, input.eventId));

      await db.insert(auditLogs).values({
        action: 'ASSIGN_TEAM',
        entityType: 'EVENT',
        entityId: input.eventId,
        performedBy: input.assignedBy,
        details: { employeeIds: input.employeeIds },
      });

      return { success: true };
    }),

  getEventWithDetails: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      console.log("Fetching event with details - Input ID:", input.id);
      
      if (!input.id || input.id.trim() === '') {
        console.error("getEventWithDetails: Empty ID provided");
        throw new Error("Event ID is required");
      }
      
      try {
        const eventResult = await db.select().from(events).where(eq(events.id, input.id));
        console.log("Event query result:", eventResult.length > 0 ? "Found" : "Not found");
        
        if (!eventResult[0]) {
          console.log("No event found with ID:", input.id);
          return null;
        }
      
      const assignments = await db.select().from(eventAssignments)
        .where(eq(eventAssignments.eventId, input.id));
      
      const salesEntries = await db.select().from(eventSalesEntries)
        .where(eq(eventSalesEntries.eventId, input.id))
        .orderBy(desc(eventSalesEntries.createdAt));
      
      const subtasks = await db.select().from(eventSubtasks)
        .where(eq(eventSubtasks.eventId, input.id))
        .orderBy(desc(eventSubtasks.createdAt));
      
      const assignedEmployeeIds = assignments.map(a => a.employeeId);
      const subtaskAssigneeIds = subtasks.map(s => s.assignedTo).filter(Boolean) as string[];
      const allEmployeeIds = [...new Set([...assignedEmployeeIds, ...subtaskAssigneeIds])];
      
      let teamMembers: any[] = [];
      if (allEmployeeIds.length > 0) {
        teamMembers = await db.select().from(employees)
          .where(sql`${employees.id} IN ${allEmployeeIds}`);
      }
      
      const masterRecords = await db.select().from(employeeMaster);
      const purseIdMap = new Map<string, string>();
      masterRecords.forEach(m => {
        if (m.linkedEmployeeId) {
          purseIdMap.set(m.linkedEmployeeId, m.purseId);
        }
      });
      
      const teamWithAllocations = assignments.map(assignment => {
        const employee = teamMembers.find(e => e.id === assignment.employeeId);
        const memberSales = salesEntries.filter(s => s.employeeId === assignment.employeeId);
        const totalSimsSold = memberSales.reduce((sum, s) => sum + s.simsSold, 0);
        const totalFtthSold = memberSales.reduce((sum, s) => sum + s.ftthSold, 0);
        
        return {
          ...assignment,
          employee: employee ? { ...employee, purseId: purseIdMap.get(employee.id) || null } : undefined,
          actualSimSold: totalSimsSold,
          actualFtthSold: totalFtthSold,
          salesEntries: memberSales,
        };
      });
      
      const subtasksWithAssignees = subtasks.map(subtask => {
        const emp = subtask.assignedTo ? teamMembers.find(e => e.id === subtask.assignedTo) : undefined;
        return {
          ...subtask,
          assignedEmployee: emp ? { ...emp, purseId: purseIdMap.get(emp.id) || null } : undefined,
        };
      });
      
      const totalSimsSold = salesEntries.reduce((sum, s) => sum + s.simsSold, 0);
      const totalFtthSold = salesEntries.reduce((sum, s) => sum + s.ftthSold, 0);
      
      const subtaskStats = {
        total: subtasks.length,
        completed: subtasks.filter(s => s.status === 'completed').length,
        pending: subtasks.filter(s => s.status === 'pending').length,
        inProgress: subtasks.filter(s => s.status === 'in_progress').length,
      };
      
      let assignedToEmployee: any = undefined;
      if (eventResult[0].assignedTo) {
        const assignee = await db.select().from(employees)
          .where(eq(employees.id, eventResult[0].assignedTo));
        if (assignee[0]) {
          const managerPurseId = purseIdMap.get(assignee[0].id) || null;
          assignedToEmployee = { ...assignee[0], purseId: managerPurseId };
        }
      }
      
      const result = {
          ...eventResult[0],
          assignedToEmployee,
          teamWithAllocations,
          salesEntries,
          subtasks: subtasksWithAssignees,
          summary: {
            totalSimsSold,
            totalFtthSold,
            totalEntries: salesEntries.length,
            teamCount: assignments.length,
            subtaskStats,
          },
        };
        
        console.log("Returning event details for:", result.name);
        return result;
      } catch (error) {
        console.error("Error fetching event details:", error);
        throw error;
      }
    }),

  getEventResourceStatus: publicProcedure
    .input(z.object({ eventId: z.string().uuid() }))
    .query(async ({ input }) => {
      const event = await db.select().from(events).where(eq(events.id, input.eventId));
      if (!event[0]) throw new Error("Event not found");
      
      const assignments = await db.select().from(eventAssignments)
        .where(eq(eventAssignments.eventId, input.eventId));
      
      const totalSimDistributed = assignments.reduce((sum, a) => sum + a.simTarget, 0);
      const totalFtthDistributed = assignments.reduce((sum, a) => sum + a.ftthTarget, 0);
      const totalSimSold = assignments.reduce((sum, a) => sum + a.simSold, 0);
      const totalFtthSold = assignments.reduce((sum, a) => sum + a.ftthSold, 0);
      
      return {
        allocated: {
          sim: event[0].allocatedSim,
          ftth: event[0].allocatedFtth,
        },
        distributed: {
          sim: totalSimDistributed,
          ftth: totalFtthDistributed,
        },
        sold: {
          sim: totalSimSold,
          ftth: totalFtthSold,
        },
        remaining: {
          simToDistribute: event[0].allocatedSim - totalSimDistributed,
          ftthToDistribute: event[0].allocatedFtth - totalFtthDistributed,
          simUnsold: totalSimDistributed - totalSimSold,
          ftthUnsold: totalFtthDistributed - totalFtthSold,
        },
      };
    }),

  assignTeamMember: publicProcedure
    .input(z.object({
      eventId: z.string().uuid(),
      employeeId: z.string().uuid(),
      simTarget: z.number().min(0),
      ftthTarget: z.number().min(0),
      assignedBy: z.string().uuid(),
    }))
    .mutation(async ({ input }) => {
      console.log("Assigning team member with targets:", input);
      
      const event = await db.select().from(events).where(eq(events.id, input.eventId));
      if (!event[0]) throw new Error("Event not found");
      
      const allAssignments = await db.select().from(eventAssignments)
        .where(eq(eventAssignments.eventId, input.eventId));
      
      const existing = allAssignments.find(a => a.employeeId === input.employeeId);
      
      const otherAssignments = allAssignments.filter(a => a.employeeId !== input.employeeId);
      const currentSimDistributed = otherAssignments.reduce((sum, a) => sum + a.simTarget, 0);
      const currentFtthDistributed = otherAssignments.reduce((sum, a) => sum + a.ftthTarget, 0);
      
      const newTotalSim = currentSimDistributed + input.simTarget;
      const newTotalFtth = currentFtthDistributed + input.ftthTarget;
      
      if (newTotalSim > event[0].allocatedSim) {
        const available = event[0].allocatedSim - currentSimDistributed;
        throw new Error(`Cannot assign ${input.simTarget} SIMs. Only ${available} SIMs available for distribution.`);
      }
      
      if (newTotalFtth > event[0].allocatedFtth) {
        const available = event[0].allocatedFtth - currentFtthDistributed;
        throw new Error(`Cannot assign ${input.ftthTarget} FTTH. Only ${available} FTTH available for distribution.`);
      }
      
      if (existing) {
        await db.update(eventAssignments)
          .set({
            simTarget: input.simTarget,
            ftthTarget: input.ftthTarget,
            updatedAt: new Date(),
          })
          .where(eq(eventAssignments.id, existing.id));
      } else {
        await db.insert(eventAssignments).values({
          eventId: input.eventId,
          employeeId: input.employeeId,
          simTarget: input.simTarget,
          ftthTarget: input.ftthTarget,
          assignedBy: input.assignedBy,
        });
        
        const currentTeam = (event[0].assignedTeam || []) as string[];
        if (!currentTeam.includes(input.employeeId)) {
          await db.update(events)
            .set({ assignedTeam: [...currentTeam, input.employeeId], updatedAt: new Date() })
            .where(eq(events.id, input.eventId));
        }
      }

      await db.insert(auditLogs).values({
        action: 'ASSIGN_TEAM_MEMBER',
        entityType: 'EVENT',
        entityId: input.eventId,
        performedBy: input.assignedBy,
        details: { employeeId: input.employeeId, simTarget: input.simTarget, ftthTarget: input.ftthTarget },
      });

      // Send notification to the assigned team member
      if (!existing) {
        const assignedByEmployee = await db.select().from(employees).where(eq(employees.id, input.assignedBy));
        const assignerName = assignedByEmployee[0]?.name || 'Manager';
        await notifyEventAssignment(input.employeeId, event[0].name, input.eventId, assignerName);
      }

      return { success: true };
    }),

  removeTeamMember: publicProcedure
    .input(z.object({
      eventId: z.string().uuid(),
      employeeId: z.string().uuid(),
      removedBy: z.string().uuid(),
    }))
    .mutation(async ({ input }) => {
      console.log("Removing team member:", input);
      
      const assignment = await db.select().from(eventAssignments)
        .where(and(
          eq(eventAssignments.eventId, input.eventId),
          eq(eventAssignments.employeeId, input.employeeId)
        ));
      
      if (assignment[0] && (assignment[0].simSold > 0 || assignment[0].ftthSold > 0)) {
        throw new Error(`Cannot remove team member with recorded sales. SIM sold: ${assignment[0].simSold}, FTTH sold: ${assignment[0].ftthSold}. Please reassign sales first.`);
      }
      
      await db.delete(eventAssignments)
        .where(and(
          eq(eventAssignments.eventId, input.eventId),
          eq(eventAssignments.employeeId, input.employeeId)
        ));
      
      const event = await db.select().from(events).where(eq(events.id, input.eventId));
      if (event[0]) {
        const currentTeam = (event[0].assignedTeam || []) as string[];
        const updatedTeam = currentTeam.filter(id => id !== input.employeeId);
        await db.update(events)
          .set({ assignedTeam: updatedTeam, updatedAt: new Date() })
          .where(eq(events.id, input.eventId));
      }

      await db.insert(auditLogs).values({
        action: 'REMOVE_TEAM_MEMBER',
        entityType: 'EVENT',
        entityId: input.eventId,
        performedBy: input.removedBy,
        details: { employeeId: input.employeeId },
      });

      return { success: true };
    }),

  submitEventSales: publicProcedure
    .input(z.object({
      eventId: z.string().uuid(),
      employeeId: z.string().uuid(),
      simsSold: z.number().min(0),
      simsActivated: z.number().min(0),
      ftthSold: z.number().min(0),
      ftthActivated: z.number().min(0),
      customerType: z.enum(['B2C', 'B2B', 'Government', 'Enterprise']),
      photos: z.array(z.object({
        uri: z.string(),
        latitude: z.string().optional(),
        longitude: z.string().optional(),
        timestamp: z.string(),
      })).optional(),
      gpsLatitude: z.string().optional(),
      gpsLongitude: z.string().optional(),
      remarks: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      console.log("Submitting event sales:", input);
      
      const event = await db.select().from(events).where(eq(events.id, input.eventId));
      if (!event[0]) throw new Error("Event not found");
      
      if (event[0].status === 'completed' || event[0].status === 'cancelled') {
        throw new Error(`Cannot submit sales for ${event[0].status} event`);
      }
      
      const assignment = await db.select().from(eventAssignments)
        .where(and(
          eq(eventAssignments.eventId, input.eventId),
          eq(eventAssignments.employeeId, input.employeeId)
        ));
      
      if (!assignment[0]) {
        throw new Error("You are not assigned to this event. Please contact the event manager.");
      }
      
      const newTotalSim = assignment[0].simSold + input.simsSold;
      const newTotalFtth = assignment[0].ftthSold + input.ftthSold;
      
      if (newTotalSim > assignment[0].simTarget) {
        const remaining = assignment[0].simTarget - assignment[0].simSold;
        throw new Error(`Cannot sell ${input.simsSold} SIMs. Only ${remaining} remaining in your target. Contact manager to increase target.`);
      }
      
      if (newTotalFtth > assignment[0].ftthTarget) {
        const remaining = assignment[0].ftthTarget - assignment[0].ftthSold;
        throw new Error(`Cannot sell ${input.ftthSold} FTTH. Only ${remaining} remaining in your target. Contact manager to increase target.`);
      }
      
      const result = await db.insert(eventSalesEntries).values({
        eventId: input.eventId,
        employeeId: input.employeeId,
        simsSold: input.simsSold,
        simsActivated: input.simsActivated,
        ftthSold: input.ftthSold,
        ftthActivated: input.ftthActivated,
        customerType: input.customerType,
        photos: input.photos || [],
        gpsLatitude: input.gpsLatitude,
        gpsLongitude: input.gpsLongitude,
        remarks: input.remarks,
      }).returning();
      
      await db.update(eventAssignments)
        .set({
          simSold: newTotalSim,
          ftthSold: newTotalFtth,
          updatedAt: new Date(),
        })
        .where(eq(eventAssignments.id, assignment[0].id));
      
      if (input.simsSold > 0) {
        const simResource = await db.select().from(resources)
          .where(and(
            eq(resources.circle, event[0].circle),
            eq(resources.type, 'SIM')
          ));
        if (simResource[0]) {
          await db.update(resources)
            .set({
              used: simResource[0].used + input.simsSold,
              updatedAt: new Date(),
            })
            .where(eq(resources.id, simResource[0].id));
        }
      }
      
      if (input.ftthSold > 0) {
        const ftthResource = await db.select().from(resources)
          .where(and(
            eq(resources.circle, event[0].circle),
            eq(resources.type, 'FTTH')
          ));
        if (ftthResource[0]) {
          await db.update(resources)
            .set({
              used: ftthResource[0].used + input.ftthSold,
              updatedAt: new Date(),
            })
            .where(eq(resources.id, ftthResource[0].id));
        }
      }

      await db.insert(auditLogs).values({
        action: 'SUBMIT_EVENT_SALES',
        entityType: 'SALES',
        entityId: result[0].id,
        performedBy: input.employeeId,
        details: { eventId: input.eventId, simsSold: input.simsSold, ftthSold: input.ftthSold },
      });

      return result[0];
    }),

  getEventSalesEntries: publicProcedure
    .input(z.object({ eventId: z.string().uuid() }))
    .query(async ({ input }) => {
      console.log("Fetching event sales entries:", input.eventId);
      const entries = await db.select().from(eventSalesEntries)
        .where(eq(eventSalesEntries.eventId, input.eventId))
        .orderBy(desc(eventSalesEntries.createdAt));
      return entries;
    }),

  getMyAssignedEvents: publicProcedure
    .input(z.object({ employeeId: z.string().uuid() }))
    .query(async ({ input }) => {
      console.log("Fetching assigned events for employee:", input.employeeId);
      
      const assignments = await db.select().from(eventAssignments)
        .where(eq(eventAssignments.employeeId, input.employeeId));
      
      const eventIds = assignments.map(a => a.eventId);
      if (eventIds.length === 0) return [];
      
      const assignedEvents = await db.select().from(events)
        .where(sql`${events.id} IN ${eventIds}`)
        .orderBy(desc(events.startDate));
      
      return assignedEvents.map(event => {
        const assignment = assignments.find(a => a.eventId === event.id);
        return {
          ...event,
          assignment,
        };
      });
    }),

  getAvailableTeamMembers: publicProcedure
    .input(z.object({ 
      circle: z.enum(['ANDAMAN_NICOBAR', 'ANDHRA_PRADESH', 'ASSAM', 'BIHAR', 'CHHATTISGARH', 'GUJARAT', 'HARYANA', 'HIMACHAL_PRADESH', 'JAMMU_KASHMIR', 'JHARKHAND', 'KARNATAKA', 'KERALA', 'MADHYA_PRADESH', 'MAHARASHTRA', 'NORTH_EAST_I', 'NORTH_EAST_II', 'ODISHA', 'PUNJAB', 'RAJASTHAN', 'TAMIL_NADU', 'TELANGANA', 'UTTARAKHAND', 'UTTAR_PRADESH_EAST', 'UTTAR_PRADESH_WEST', 'WEST_BENGAL']),
      eventId: z.string().uuid().optional(),
      managerPurseId: z.string().optional(),
    }))
    .query(async ({ input }) => {
      console.log("Fetching available team members for circle:", input.circle, "manager:", input.managerPurseId);
      
      const masterRecords = await db.select().from(employeeMaster);
      const purseIdMap = new Map<string, string>();
      const linkedEmployeeMap = new Map<string, string>();
      masterRecords.forEach(m => {
        if (m.linkedEmployeeId) {
          purseIdMap.set(m.linkedEmployeeId, m.purseId);
          linkedEmployeeMap.set(m.purseId, m.linkedEmployeeId);
        }
      });
      
      let directReportPurseIds: string[] = [];
      if (input.managerPurseId) {
        directReportPurseIds = masterRecords
          .filter(m => m.reportingPurseId === input.managerPurseId)
          .map(m => m.purseId);
        console.log("Direct reports of", input.managerPurseId, ":", directReportPurseIds.length);
      }
      
      const directReportEmployeeIds = directReportPurseIds
        .map(pid => linkedEmployeeMap.get(pid))
        .filter((id): id is string => id !== undefined);
      
      let circleEmployees = await db.select().from(employees)
        .where(and(
          eq(employees.circle, input.circle),
          eq(employees.isActive, true)
        ));
      
      if (input.managerPurseId && directReportEmployeeIds.length > 0) {
        circleEmployees = circleEmployees.filter(emp => directReportEmployeeIds.includes(emp.id));
      } else if (input.managerPurseId && directReportEmployeeIds.length === 0) {
        circleEmployees = [];
      }
      
      let assignedIds: string[] = [];
      if (input.eventId) {
        const assignments = await db.select().from(eventAssignments)
          .where(eq(eventAssignments.eventId, input.eventId));
        assignedIds = assignments.map(a => a.employeeId);
      }
      
      return circleEmployees.map(emp => ({
        ...emp,
        purseId: purseIdMap.get(emp.id) || null,
        isAssigned: assignedIds.includes(emp.id),
      }));
    }),

  updateEventStatus: publicProcedure
    .input(z.object({
      eventId: z.string().uuid(),
      status: z.enum(['draft', 'active', 'paused', 'completed', 'cancelled']),
      updatedBy: z.string().uuid(),
    }))
    .mutation(async ({ input }) => {
      console.log("Updating event status:", input);
      
      const result = await db.update(events)
        .set({ status: input.status, updatedAt: new Date() })
        .where(eq(events.id, input.eventId))
        .returning();

      await db.insert(auditLogs).values({
        action: 'UPDATE_EVENT_STATUS',
        entityType: 'EVENT',
        entityId: input.eventId,
        performedBy: input.updatedBy,
        details: { status: input.status },
      });

      return result[0];
    }),

  createSubtask: publicProcedure
    .input(z.object({
      eventId: z.string().uuid(),
      title: z.string().min(1),
      description: z.string().optional(),
      assignedTo: z.string().uuid().optional(),
      staffId: z.string().optional(),
      priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
      dueDate: z.string().optional(),
      simAllocated: z.number().int().min(0).default(0),
      ftthAllocated: z.number().int().min(0).default(0),
      createdBy: z.string().uuid(),
    }))
    .mutation(async ({ input }) => {
      console.log("Creating subtask:", input);
      
      let assignedEmployeeId = input.assignedTo;
      
      if (input.staffId && !assignedEmployeeId) {
        const masterRecord = await db.select().from(employeeMaster)
          .where(eq(employeeMaster.purseId, input.staffId));
        if (masterRecord[0]?.linkedEmployeeId) {
          assignedEmployeeId = masterRecord[0].linkedEmployeeId;
        }
      }
      
      if (assignedEmployeeId) {
        const existingAssignment = await db.select().from(eventAssignments)
          .where(and(
            eq(eventAssignments.eventId, input.eventId),
            eq(eventAssignments.employeeId, assignedEmployeeId)
          ));
        
        if (!existingAssignment[0]) {
          await db.insert(eventAssignments).values({
            eventId: input.eventId,
            employeeId: assignedEmployeeId,
            simTarget: 0,
            ftthTarget: 0,
            assignedBy: input.createdBy,
          });
          
          const event = await db.select().from(events).where(eq(events.id, input.eventId));
          if (event[0]) {
            const currentTeam = (event[0].assignedTeam || []) as string[];
            if (!currentTeam.includes(assignedEmployeeId)) {
              await db.update(events)
                .set({ assignedTeam: [...currentTeam, assignedEmployeeId], updatedAt: new Date() })
                .where(eq(events.id, input.eventId));
            }
          }
          
          await db.insert(auditLogs).values({
            action: 'AUTO_ASSIGN_TEAM_MEMBER',
            entityType: 'EVENT',
            entityId: input.eventId,
            performedBy: input.createdBy,
            details: { employeeId: assignedEmployeeId, reason: 'subtask_assignment' },
          });
        }
      }
      
      const result = await db.insert(eventSubtasks).values({
        eventId: input.eventId,
        title: input.title,
        description: input.description,
        assignedTo: assignedEmployeeId,
        priority: input.priority,
        dueDate: input.dueDate ? new Date(input.dueDate) : undefined,
        simAllocated: input.simAllocated,
        ftthAllocated: input.ftthAllocated,
        createdBy: input.createdBy,
      }).returning();

      await db.insert(auditLogs).values({
        action: 'CREATE_SUBTASK',
        entityType: 'EVENT',
        entityId: input.eventId,
        performedBy: input.createdBy,
        details: { subtaskId: result[0].id, title: input.title, assignedTo: assignedEmployeeId },
      });

      // Send notification to assignee
      if (assignedEmployeeId) {
        const creatorEmployee = await db.select().from(employees).where(eq(employees.id, input.createdBy));
        const event = await db.select().from(events).where(eq(events.id, input.eventId));
        const creatorName = creatorEmployee[0]?.name || 'Manager';
        const eventName = event[0]?.name || 'Unknown Event';
        await notifySubtaskAssigned(
          assignedEmployeeId, 
          result[0].id, 
          input.title, 
          eventName, 
          creatorName, 
          input.dueDate
        );
      }

      return result[0];
    }),

  updateSubtask: publicProcedure
    .input(z.object({
      subtaskId: z.string().uuid(),
      title: z.string().min(1).optional(),
      description: z.string().optional(),
      assignedTo: z.string().uuid().nullable().optional(),
      status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']).optional(),
      priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
      dueDate: z.string().nullable().optional(),
      simAllocated: z.number().int().min(0).optional(),
      ftthAllocated: z.number().int().min(0).optional(),
      simSold: z.number().int().min(0).optional(),
      ftthSold: z.number().int().min(0).optional(),
      updatedBy: z.string().uuid(),
    }))
    .mutation(async ({ input }) => {
      console.log("Updating subtask:", input);
      
      const { subtaskId, updatedBy, dueDate, ...updateData } = input;
      
      const updateValues: Record<string, unknown> = { ...updateData, updatedAt: new Date() };
      if (dueDate !== undefined) {
        updateValues.dueDate = dueDate ? new Date(dueDate) : null;
      }
      
      if (input.status === 'completed') {
        updateValues.completedAt = new Date();
        updateValues.completedBy = updatedBy;
      }
      
      const result = await db.update(eventSubtasks)
        .set(updateValues)
        .where(eq(eventSubtasks.id, subtaskId))
        .returning();

      if (result[0]) {
        await db.insert(auditLogs).values({
          action: 'UPDATE_SUBTASK',
          entityType: 'EVENT',
          entityId: result[0].eventId,
          performedBy: updatedBy,
          details: { subtaskId, changes: updateData },
        });

        // Notify task creator when subtask is completed
        if (input.status === 'completed' && result[0].createdBy && result[0].createdBy !== updatedBy) {
          const completedByEmployee = await db.select().from(employees).where(eq(employees.id, updatedBy));
          const completedByName = completedByEmployee[0]?.name || 'Team Member';
          await notifySubtaskCompleted(result[0].createdBy, subtaskId, result[0].title, completedByName);
        }
      }

      return result[0];
    }),

  deleteSubtask: publicProcedure
    .input(z.object({
      subtaskId: z.string().uuid(),
      deletedBy: z.string().uuid(),
    }))
    .mutation(async ({ input }) => {
      console.log("Deleting subtask:", input.subtaskId);
      
      const subtask = await db.select().from(eventSubtasks).where(eq(eventSubtasks.id, input.subtaskId));
      
      await db.delete(eventSubtasks).where(eq(eventSubtasks.id, input.subtaskId));

      if (subtask[0]) {
        await db.insert(auditLogs).values({
          action: 'DELETE_SUBTASK',
          entityType: 'EVENT',
          entityId: subtask[0].eventId,
          performedBy: input.deletedBy,
          details: { subtaskId: input.subtaskId, title: subtask[0].title },
        });
      }

      return { success: true };
    }),

  updateTeamMemberTargets: publicProcedure
    .input(z.object({
      eventId: z.string().uuid(),
      employeeId: z.string().uuid(),
      simTarget: z.number().min(0),
      ftthTarget: z.number().min(0),
      updatedBy: z.string().uuid(),
    }))
    .mutation(async ({ input }) => {
      console.log("Updating team member targets:", input);
      
      const event = await db.select().from(events).where(eq(events.id, input.eventId));
      if (!event[0]) throw new Error("Event not found");
      
      const allAssignments = await db.select().from(eventAssignments)
        .where(eq(eventAssignments.eventId, input.eventId));
      
      const currentAssignment = allAssignments.find(a => a.employeeId === input.employeeId);
      if (!currentAssignment) throw new Error("Team member assignment not found");
      
      if (input.simTarget < currentAssignment.simSold) {
        throw new Error(`Cannot set SIM target below already sold amount (${currentAssignment.simSold})`);
      }
      if (input.ftthTarget < currentAssignment.ftthSold) {
        throw new Error(`Cannot set FTTH target below already sold amount (${currentAssignment.ftthSold})`);
      }
      
      const otherAssignments = allAssignments.filter(a => a.employeeId !== input.employeeId);
      const currentSimDistributed = otherAssignments.reduce((sum, a) => sum + a.simTarget, 0);
      const currentFtthDistributed = otherAssignments.reduce((sum, a) => sum + a.ftthTarget, 0);
      
      const newTotalSim = currentSimDistributed + input.simTarget;
      const newTotalFtth = currentFtthDistributed + input.ftthTarget;
      
      if (newTotalSim > event[0].allocatedSim) {
        const available = event[0].allocatedSim - currentSimDistributed;
        throw new Error(`Cannot assign ${input.simTarget} SIMs. Only ${available} SIMs available for distribution.`);
      }
      
      if (newTotalFtth > event[0].allocatedFtth) {
        const available = event[0].allocatedFtth - currentFtthDistributed;
        throw new Error(`Cannot assign ${input.ftthTarget} FTTH. Only ${available} FTTH available for distribution.`);
      }
      
      const result = await db.update(eventAssignments)
        .set({
          simTarget: input.simTarget,
          ftthTarget: input.ftthTarget,
          updatedAt: new Date(),
        })
        .where(and(
          eq(eventAssignments.eventId, input.eventId),
          eq(eventAssignments.employeeId, input.employeeId)
        ))
        .returning();

      await db.insert(auditLogs).values({
        action: 'UPDATE_TEAM_TARGETS',
        entityType: 'EVENT',
        entityId: input.eventId,
        performedBy: input.updatedBy,
        details: { employeeId: input.employeeId, simTarget: input.simTarget, ftthTarget: input.ftthTarget },
      });

      return result[0];
    }),

  getCircleResourceDashboard: publicProcedure
    .input(z.object({ 
      circle: z.enum(['ANDAMAN_NICOBAR', 'ANDHRA_PRADESH', 'ASSAM', 'BIHAR', 'CHHATTISGARH', 'GUJARAT', 'HARYANA', 'HIMACHAL_PRADESH', 'JAMMU_KASHMIR', 'JHARKHAND', 'KARNATAKA', 'KERALA', 'MADHYA_PRADESH', 'MAHARASHTRA', 'NORTH_EAST_I', 'NORTH_EAST_II', 'ODISHA', 'PUNJAB', 'RAJASTHAN', 'TAMIL_NADU', 'TELANGANA', 'UTTARAKHAND', 'UTTAR_PRADESH_EAST', 'UTTAR_PRADESH_WEST', 'WEST_BENGAL'])
    }))
    .query(async ({ input }) => {
      console.log("Fetching circle resource dashboard:", input.circle);
      
      const circleResources = await db.select().from(resources)
        .where(eq(resources.circle, input.circle));
      
      const simResource = circleResources.find(r => r.type === 'SIM');
      const ftthResource = circleResources.find(r => r.type === 'FTTH');
      
      const circleEvents = await db.select().from(events)
        .where(eq(events.circle, input.circle));
      
      const eventIds = circleEvents.map(e => e.id);
      let allAssignments: any[] = [];
      if (eventIds.length > 0) {
        allAssignments = await db.select().from(eventAssignments)
          .where(sql`${eventAssignments.eventId} IN ${eventIds}`);
      }
      
      const eventSummaries = circleEvents.map(event => {
        const eventAssigns = allAssignments.filter(a => a.eventId === event.id);
        const simDistributed = eventAssigns.reduce((sum, a) => sum + a.simTarget, 0);
        const ftthDistributed = eventAssigns.reduce((sum, a) => sum + a.ftthTarget, 0);
        const simSold = eventAssigns.reduce((sum, a) => sum + a.simSold, 0);
        const ftthSold = eventAssigns.reduce((sum, a) => sum + a.ftthSold, 0);
        
        return {
          id: event.id,
          name: event.name,
          status: event.status,
          startDate: event.startDate,
          endDate: event.endDate,
          resources: {
            sim: { allocated: event.allocatedSim, distributed: simDistributed, sold: simSold, remaining: event.allocatedSim - simSold },
            ftth: { allocated: event.allocatedFtth, distributed: ftthDistributed, sold: ftthSold, remaining: event.allocatedFtth - ftthSold },
          },
        };
      });
      
      return {
        circle: input.circle,
        inventory: {
          sim: simResource ? { total: simResource.total, allocated: simResource.allocated, used: simResource.used, remaining: simResource.remaining } : null,
          ftth: ftthResource ? { total: ftthResource.total, allocated: ftthResource.allocated, used: ftthResource.used, remaining: ftthResource.remaining } : null,
        },
        events: eventSummaries,
        totals: {
          simAllocated: circleEvents.reduce((sum, e) => sum + e.allocatedSim, 0),
          ftthAllocated: circleEvents.reduce((sum, e) => sum + e.allocatedFtth, 0),
          simSold: allAssignments.reduce((sum, a) => sum + a.simSold, 0),
          ftthSold: allAssignments.reduce((sum, a) => sum + a.ftthSold, 0),
        },
      };
    }),

  getHierarchicalReport: publicProcedure
    .input(z.object({
      employeeId: z.string().uuid(),
    }))
    .query(async ({ input }) => {
      console.log("Fetching hierarchical report for employee:", input.employeeId);
      
      const employee = await db.select().from(employees).where(eq(employees.id, input.employeeId));
      if (!employee[0]) throw new Error("Employee not found");
      
      const createdEvents = await db.select().from(events)
        .where(eq(events.createdBy, input.employeeId));
      
      const managedEvents = await db.select().from(events)
        .where(eq(events.assignedTo, input.employeeId));
      
      const allEventIds = [...new Set([...createdEvents.map(e => e.id), ...managedEvents.map(e => e.id)])];
      
      let allAssignments: any[] = [];
      if (allEventIds.length > 0) {
        allAssignments = await db.select().from(eventAssignments)
          .where(sql`${eventAssignments.eventId} IN ${allEventIds}`);
      }
      
      const allEvents = [...createdEvents, ...managedEvents.filter(e => !createdEvents.find(c => c.id === e.id))];
      
      const eventReports = allEvents.map(event => {
        const eventAssigns = allAssignments.filter(a => a.eventId === event.id);
        const simDistributed = eventAssigns.reduce((sum, a) => sum + a.simTarget, 0);
        const ftthDistributed = eventAssigns.reduce((sum, a) => sum + a.ftthTarget, 0);
        const simSold = eventAssigns.reduce((sum, a) => sum + a.simSold, 0);
        const ftthSold = eventAssigns.reduce((sum, a) => sum + a.ftthSold, 0);
        
        return {
          id: event.id,
          name: event.name,
          circle: event.circle,
          status: event.status,
          startDate: event.startDate,
          endDate: event.endDate,
          isCreator: event.createdBy === input.employeeId,
          isManager: event.assignedTo === input.employeeId,
          teamCount: eventAssigns.length,
          resources: {
            sim: { allocated: event.allocatedSim, distributed: simDistributed, sold: simSold, remaining: event.allocatedSim - simSold },
            ftth: { allocated: event.allocatedFtth, distributed: ftthDistributed, sold: ftthSold, remaining: event.allocatedFtth - ftthSold },
          },
        };
      });
      
      return {
        employee: { id: employee[0].id, name: employee[0].name, role: employee[0].role, circle: employee[0].circle },
        eventsManaged: eventReports.length,
        summary: {
          totalSimAllocated: eventReports.reduce((sum, e) => sum + e.resources.sim.allocated, 0),
          totalFtthAllocated: eventReports.reduce((sum, e) => sum + e.resources.ftth.allocated, 0),
          totalSimSold: eventReports.reduce((sum, e) => sum + e.resources.sim.sold, 0),
          totalFtthSold: eventReports.reduce((sum, e) => sum + e.resources.ftth.sold, 0),
        },
        events: eventReports,
      };
    }),
});
