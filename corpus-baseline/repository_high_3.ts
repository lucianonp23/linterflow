import { Injectable, NotFoundException, BadRequestException, ConflictException, UnprocessableEntityException } from '@nestjs/common';

export enum JobPriority {
  CRITICAL = 'CRITICAL',
  HIGH = 'HIGH',
  MEDIUM = 'MEDIUM',
  LOW = 'LOW',
}

export enum JobStatus {
  PENDING = 'PENDING',
  ASSIGNED = 'ASSIGNED',
  IN_TRANSIT = 'IN_TRANSIT',
  DELIVERED = 'DELIVERED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

export enum VehicleStatus {
  IDLE = 'IDLE',
  ON_ROUTE = 'ON_ROUTE',
  MAINTENANCE = 'MAINTENANCE',
  OFF_DUTY = 'OFF_DUTY',
}

export enum CargoType {
  STANDARD = 'STANDARD',
  HAZMAT = 'HAZMAT',
  REFRIGERATED = 'REFRIGERATED',
  FRAGILE = 'FRAGILE',
  OVERSIZED = 'OVERSIZED',
}

export interface GeoLocation {
  latitude: number;
  longitude: number;
}

export interface TimeWindow {
  startTime: Date;
  endTime: Date;
}

export interface MaintenanceWindow {
  startTime: Date;
  endTime: Date;
  reason: string;
}

export interface CargoDetails {
  weightKg: number;
  volumeM3: number;
  type: CargoType;
  requiresSpecialHandling: boolean;
  minTemperatureC?: number;
  maxTemperatureC?: number;
}

export interface DispatchJob {
  id: string;
  title: string;
  priority: JobPriority;
  status: JobStatus;
  cargo: CargoDetails;
  pickupLocation: GeoLocation;
  pickupWindow: TimeWindow;
  deliveryLocation: GeoLocation;
  deliveryWindow: TimeWindow;
  serviceDurationMinutes: number;
  prerequisiteJobIds: string[];
  assignedVehicleId?: string;
  assignedRouteId?: string;
  slaDeadline: Date;
  penaltyPerMinuteLate: number;
  maxDelayMinutesAllowed: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface Vehicle {
  id: string;
  licensePlate: string;
  status: VehicleStatus;
  maxWeightKg: number;
  maxVolumeM3: number;
  supportedCargoTypes: CargoType[];
  hasRefrigeration: boolean;
  hasHazmatPermit: boolean;
  currentLocation: GeoLocation;
  shiftWindow: TimeWindow;
  maintenanceBlackouts: MaintenanceWindow[];
  maxDrivingMinutesPerDay: number;
  currentDrivingMinutes: number;
  maxStopsPerRoute: number;
  assignedRouteId?: string;
}

export interface RouteStop {
  sequenceOrder: number;
  jobId: string;
  stopType: 'PICKUP' | 'DELIVERY';
  location: GeoLocation;
  estimatedArrival: Date;
  estimatedDeparture: Date;
  actualArrival?: Date;
  actualDeparture?: Date;
  waitDurationMinutes: number;
  slaViolated: boolean;
  calculatedPenalty: number;
}

export interface DispatchRoute {
  id: string;
  vehicleId: string;
  stops: RouteStop[];
  totalWeightKg: number;
  totalVolumeM3: number;
  totalDistanceKm: number;
  totalDurationMinutes: number;
  totalPenaltyCost: number;
  isFeasible: boolean;
  validationErrors: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface OptimizationResult {
  assignedJobCount: number;
  unassignedJobIds: string[];
  generatedRouteIds: string[];
  totalFleetPenaltyCost: number;
  executionTimestamp: Date;
}

const EARTH_RADIUS_KM = 6371;
const AVERAGE_SPEED_KMH = 50;
const MAX_CONTINUOUS_DRIVING_MINS = 240;
const REST_BREAK_MINS = 30;
const MS_PER_MINUTE = 60000;

const PRIORITY_ORDER: Record<JobPriority, number> = {
  [JobPriority.CRITICAL]: 0,
  [JobPriority.HIGH]: 1,
  [JobPriority.MEDIUM]: 2,
  [JobPriority.LOW]: 3,
};

@Injectable()
export class LogisticsDispatchRepository {
  private readonly jobs = new Map<string, DispatchJob>();
  private readonly vehicles = new Map<string, Vehicle>();
  private readonly routes = new Map<string, DispatchRoute>();

  public createJob(jobData: Omit<DispatchJob, 'id' | 'createdAt' | 'updatedAt' | 'status'>): DispatchJob {
    this.validateJobPayload(jobData);

    const now = new Date();
    const id = this.generateUniqueId('JOB');

    const job: DispatchJob = {
      ...jobData,
      id,
      status: JobStatus.PENDING,
      createdAt: now,
      updatedAt: now,
    };

    this.jobs.set(id, job);
    return { ...job };
  }

  public getJobById(id: string): DispatchJob {
    const job = this.jobs.get(id);
    if (!job) {
      throw new NotFoundException(`Job with ID ${id} not found`);
    }
    return { ...job };
  }

  public updateJob(id: string, updates: Partial<Omit<DispatchJob, 'id' | 'createdAt' | 'updatedAt'>>): DispatchJob {
    const existing = this.getJobById(id);

    if (existing.status === JobStatus.DELIVERED || existing.status === JobStatus.CANCELLED) {
      throw new ConflictException(`Cannot update job in ${existing.status} status`);
    }

    const updated: DispatchJob = {
      ...existing,
      ...updates,
      updatedAt: new Date(),
    };

    this.validateJobPayload(updated);

    if (updates.status && updates.status !== existing.status) {
      this.validateStatusTransition(existing.status, updates.status);
    }

    this.jobs.set(id, updated);
    return { ...updated };
  }

  public deleteJob(id: string): boolean {
    const job = this.getJobById(id);
    if (job.status === JobStatus.IN_TRANSIT) {
      throw new ConflictException(`Cannot delete job ${id} while it is IN_TRANSIT`);
    }

    for (const otherJob of this.jobs.values()) {
      if (otherJob.prerequisiteJobIds.includes(id)) {
        throw new UnprocessableEntityException(`Cannot delete job ${id} because job ${otherJob.id} depends on it`);
      }
    }

    if (job.assignedRouteId) {
      this.removeJobFromRoute(job.assignedRouteId, id);
    }

    return this.jobs.delete(id);
  }

  public listJobs(filters?: { status?: JobStatus; priority?: JobPriority; vehicleId?: string }): DispatchJob[] {
    let result = Array.from(this.jobs.values());

    if (filters) {
      if (filters.status) {
        result = result.filter(j => j.status === filters.status);
      }
      if (filters.priority) {
        result = result.filter(j => j.priority === filters.priority);
      }
      if (filters.vehicleId) {
        result = result.filter(j => j.assignedVehicleId === filters.vehicleId);
      }
    }

    return result.map(j => ({ ...j }));
  }

  public createVehicle(vehicleData: Omit<Vehicle, 'id' | 'currentDrivingMinutes'>): Vehicle {
    this.validateVehiclePayload(vehicleData);

    const id = this.generateUniqueId('VEH');
    const vehicle: Vehicle = {
      ...vehicleData,
      id,
      currentDrivingMinutes: 0,
    };

    this.vehicles.set(id, vehicle);
    return { ...vehicle };
  }

  public getVehicleById(id: string): Vehicle {
    const vehicle = this.vehicles.get(id);
    if (!vehicle) {
      throw new NotFoundException(`Vehicle with ID ${id} not found`);
    }
    return { ...vehicle };
  }

  public updateVehicle(id: string, updates: Partial<Omit<Vehicle, 'id'>>): Vehicle {
    const existing = this.getVehicleById(id);

    const updated: Vehicle = {
      ...existing,
      ...updates,
    };

    this.validateVehiclePayload(updated);
    this.vehicles.set(id, updated);
    return { ...updated };
  }

  public deleteVehicle(id: string): boolean {
    const vehicle = this.getVehicleById(id);
    if (vehicle.status === VehicleStatus.ON_ROUTE) {
      throw new ConflictException(`Cannot delete vehicle ${id} while ON_ROUTE`);
    }

    if (vehicle.assignedRouteId) {
      this.routes.delete(vehicle.assignedRouteId);
    }

    return this.vehicles.delete(id);
  }

  public listVehicles(filters?: { status?: VehicleStatus; cargoType?: CargoType }): Vehicle[] {
    let result = Array.from(this.vehicles.values());

    if (filters) {
      if (filters.status) {
        result = result.filter(v => v.status === filters.status);
      }
      if (filters.cargoType) {
        result = result.filter(v => v.supportedCargoTypes.includes(filters.cargoType));
      }
    }

    return result.map(v => ({ ...v }));
  }

  public getRouteById(id: string): DispatchRoute {
    const route = this.routes.get(id);
    if (!route) {
      throw new NotFoundException(`Route with ID ${id} not found`);
    }
    return { ...route };
  }

  public checkJobVehicleCompatibility(job: DispatchJob, vehicle: Vehicle): void {
    this.validateJobVehicleCompatibility(job, vehicle);
  }

  public assignJobToRoute(jobId: string, vehicleId: string, overrideCapacityCheck: boolean = false): DispatchRoute {
    const job = this.getJobById(jobId);
    const vehicle = this.getVehicleById(vehicleId);

    if (job.status === JobStatus.DELIVERED || job.status === JobStatus.CANCELLED) {
      throw new UnprocessableEntityException(`Cannot assign job in ${job.status} status`);
    }

    this.validateJobVehicleCompatibility(job, vehicle);

    let route = vehicle.assignedRouteId ? this.routes.get(vehicle.assignedRouteId) : undefined;

    if (!route) {
      route = {
        id: this.generateUniqueId('ROUTE'),
        vehicleId: vehicle.id,
        stops: [],
        totalWeightKg: 0,
        totalVolumeM3: 0,
        totalDistanceKm: 0,
        totalDurationMinutes: 0,
        totalPenaltyCost: 0,
        isFeasible: true,
        validationErrors: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      vehicle.assignedRouteId = route.id;
    }

    this.checkDependencyOrdering(job, route);

    const newWeight = route.totalWeightKg + job.cargo.weightKg;
    const newVolume = route.totalVolumeM3 + job.cargo.volumeM3;

    if (!overrideCapacityCheck) {
      const capacityMultiplier = job.priority === JobPriority.CRITICAL ? 1.15 : 1.0;
      const weightLimit = vehicle.maxWeightKg * capacityMultiplier;
      const volumeLimit = vehicle.maxVolumeM3 * capacityMultiplier;

      if (newWeight > weightLimit) {
        throw new BadRequestException(`Exceeds vehicle weight capacity limit (${newWeight}kg > ${weightLimit}kg)`);
      }
      if (newVolume > volumeLimit) {
        throw new BadRequestException(`Exceeds vehicle volume capacity limit (${newVolume}m3 > ${volumeLimit}m3)`);
      }
    }

    if (route.stops.length + 2 > vehicle.maxStopsPerRoute * 2) {
      throw new BadRequestException(`Vehicle maximum stop limit reached (${vehicle.maxStopsPerRoute} jobs max)`);
    }

    const pickupStop: RouteStop = {
      sequenceOrder: route.stops.length + 1,
      jobId: job.id,
      stopType: 'PICKUP',
      location: job.pickupLocation,
      estimatedArrival: job.pickupWindow.startTime,
      estimatedDeparture: new Date(job.pickupWindow.startTime.getTime() + job.serviceDurationMinutes * MS_PER_MINUTE),
      waitDurationMinutes: 0,
      slaViolated: false,
      calculatedPenalty: 0,
    };

    const deliveryStop: RouteStop = {
      sequenceOrder: route.stops.length + 2,
      jobId: job.id,
      stopType: 'DELIVERY',
      location: job.deliveryLocation,
      estimatedArrival: job.deliveryWindow.startTime,
      estimatedDeparture: new Date(job.deliveryWindow.startTime.getTime() + job.serviceDurationMinutes * MS_PER_MINUTE),
      waitDurationMinutes: 0,
      slaViolated: false,
      calculatedPenalty: 0,
    };

    route.stops.push(pickupStop, deliveryStop);
    route.totalWeightKg = newWeight;
    route.totalVolumeM3 = newVolume;

    this.recalculateRouteTimingsAndFeasibility(route, vehicle);

    job.status = JobStatus.ASSIGNED;
    job.assignedVehicleId = vehicle.id;
    job.assignedRouteId = route.id;
    job.updatedAt = new Date();

    vehicle.status = VehicleStatus.ON_ROUTE;

    this.jobs.set(job.id, job);
    this.vehicles.set(vehicle.id, vehicle);
    this.routes.set(route.id, route);

    return { ...route };
  }

  public optimiseDispatchPlan(vehicleIds: string[], candidateJobIds: string[]): OptimizationResult {
    const unassignedJobIds: string[] = [];
    const generatedRouteIds: string[] = [];
    let totalFleetPenaltyCost = 0;

    const availableVehicles = vehicleIds
      .map(id => this.getVehicleById(id))
      .filter(v => v.status === VehicleStatus.IDLE || v.status === VehicleStatus.ON_ROUTE);

    const pendingJobs = candidateJobIds
      .map(id => this.getJobById(id))
      .filter(j => j.status === JobStatus.PENDING)
      .sort((a, b) => {
        if (PRIORITY_ORDER[a.priority] !== PRIORITY_ORDER[b.priority]) {
          return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
        }
        return a.slaDeadline.getTime() - b.slaDeadline.getTime();
      });

    let assignedCount = 0;

    for (const job of pendingJobs) {
      let isAssigned = false;

      if (!this.arePrerequisitesMet(job)) {
        unassignedJobIds.push(job.id);
        continue;
      }

      for (const vehicle of availableVehicles) {
        try {
          const route = this.assignJobToRoute(job.id, vehicle.id, false);
          if (route.isFeasible) {
            isAssigned = true;
            assignedCount++;
            if (!generatedRouteIds.includes(route.id)) {
              generatedRouteIds.push(route.id);
            }
            break;
          } else {
            this.removeJobFromRoute(route.id, job.id);
          }
        } catch {
          continue;
        }
      }

      if (!isAssigned) {
        unassignedJobIds.push(job.id);
      }
    }

    for (const routeId of generatedRouteIds) {
      const r = this.routes.get(routeId);
      if (r) {
        totalFleetPenaltyCost += r.totalPenaltyCost;
      }
    }

    return {
      assignedJobCount: assignedCount,
      unassignedJobIds,
      generatedRouteIds,
      totalFleetPenaltyCost,
      executionTimestamp: new Date(),
    };
  }

  public rebalanceRouteOnDelay(routeId: string, delayedJobId: string, delayMinutes: number): DispatchRoute {
    const route = this.getRouteById(routeId);
    const vehicle = this.getVehicleById(route.vehicleId);

    let foundDelayPoint = false;

    for (const stop of route.stops) {
      if (stop.jobId === delayedJobId || foundDelayPoint) {
        foundDelayPoint = true;

        stop.estimatedArrival = new Date(stop.estimatedArrival.getTime() + delayMinutes * MS_PER_MINUTE);
        stop.estimatedDeparture = new Date(stop.estimatedDeparture.getTime() + delayMinutes * MS_PER_MINUTE);

        const job = this.getJobById(stop.jobId);

        if (stop.stopType === 'DELIVERY' && stop.estimatedArrival > job.slaDeadline) {
          const lateMinutes = (stop.estimatedArrival.getTime() - job.slaDeadline.getTime()) / MS_PER_MINUTE;
          if (lateMinutes > job.maxDelayMinutesAllowed) {
            if (job.priority === JobPriority.LOW || job.priority === JobPriority.MEDIUM) {
              this.removeJobFromRoute(route.id, job.id);
              job.status = JobStatus.PENDING;
              job.assignedVehicleId = undefined;
              job.assignedRouteId = undefined;
              this.jobs.set(job.id, job);
              return this.rebalanceRouteOnDelay(route.id, delayedJobId, 0);
            }
          }
          stop.slaViolated = true;
          stop.calculatedPenalty = lateMinutes * job.penaltyPerMinuteLate;
        }
      }
    }

    this.recalculateRouteTimingsAndFeasibility(route, vehicle);
    this.routes.set(route.id, route);
    return { ...route };
  }

  public updateJobStatus(jobId: string, newStatus: JobStatus): DispatchJob {
    const job = this.getJobById(jobId);
    this.validateStatusTransition(job.status, newStatus);

    job.status = newStatus;
    job.updatedAt = new Date();

    if ((newStatus === JobStatus.CANCELLED || newStatus === JobStatus.FAILED) && job.assignedRouteId) {
      this.removeJobFromRoute(job.assignedRouteId, job.id);
    }

    this.jobs.set(job.id, job);
    return { ...job };
  }

  private removeJobFromRoute(routeId: string, jobId: string): void {
    const route = this.routes.get(routeId);
    if (!route) return;

    const job = this.jobs.get(jobId);
    if (job) {
      route.totalWeightKg -= job.cargo.weightKg;
      route.totalVolumeM3 -= job.cargo.volumeM3;
    }

    route.stops = route.stops
      .filter(s => s.jobId !== jobId)
      .map((stop, idx) => ({ ...stop, sequenceOrder: idx + 1 }));

    if (route.stops.length === 0) {
      if (route.vehicleId) {
        const vehicle = this.vehicles.get(route.vehicleId);
        if (vehicle) {
          vehicle.assignedRouteId = undefined;
          vehicle.status = VehicleStatus.IDLE;
          this.vehicles.set(vehicle.id, vehicle);
        }
      }
      this.routes.delete(routeId);
    } else {
      const vehicle = this.vehicles.get(route.vehicleId);
      if (vehicle) {
        this.recalculateRouteTimingsAndFeasibility(route, vehicle);
        this.routes.set(route.id, route);
      }
    }
  }

  private recalculateRouteTimingsAndFeasibility(route: DispatchRoute, vehicle: Vehicle): void {
    route.validationErrors = [];
    route.totalDistanceKm = 0;
    route.totalDurationMinutes = 0;
    route.totalPenaltyCost = 0;
    route.isFeasible = true;

    let currentTime = new Date(vehicle.shiftWindow.startTime);
    let currentLocation = vehicle.currentLocation;
    let accumulatedDrivingMinutes = vehicle.currentDrivingMinutes;
    let continuousDrivingMinutes = 0;

    for (const stop of route.stops) {
      const job = this.jobs.get(stop.jobId);

      if (!job) {
        route.validationErrors.push(`Job ${stop.jobId} missing from data store`);
        route.isFeasible = false;
        continue;
      }

      const distance = this.calculateDistanceKm(currentLocation, stop.location);
      const travelTimeMinutes = Math.ceil((distance / AVERAGE_SPEED_KMH) * 60);

      route.totalDistanceKm += distance;
      accumulatedDrivingMinutes += travelTimeMinutes;
      continuousDrivingMinutes += travelTimeMinutes;

      if (continuousDrivingMinutes >= MAX_CONTINUOUS_DRIVING_MINS) {
        currentTime = new Date(currentTime.getTime() + REST_BREAK_MINS * MS_PER_MINUTE);
        route.totalDurationMinutes += REST_BREAK_MINS;
        continuousDrivingMinutes = 0;
      }

      currentTime = new Date(currentTime.getTime() + travelTimeMinutes * MS_PER_MINUTE);
      route.totalDurationMinutes += travelTimeMinutes;

      for (const blackout of vehicle.maintenanceBlackouts) {
        if (currentTime >= blackout.startTime && currentTime <= blackout.endTime) {
          route.validationErrors.push(`Route overlaps with maintenance blackout (${blackout.reason}) at stop ${stop.sequenceOrder}`);
          route.isFeasible = false;
        }
      }

      stop.estimatedArrival = new Date(currentTime);
      const targetWindow = stop.stopType === 'PICKUP' ? job.pickupWindow : job.deliveryWindow;

      if (stop.estimatedArrival < targetWindow.startTime) {
        stop.waitDurationMinutes = (targetWindow.startTime.getTime() - stop.estimatedArrival.getTime()) / MS_PER_MINUTE;
        currentTime = new Date(targetWindow.startTime);
      } else {
        stop.waitDurationMinutes = 0;
      }

      if (stop.estimatedArrival > targetWindow.endTime) {
        const breachMinutes = (stop.estimatedArrival.getTime() - targetWindow.endTime.getTime()) / MS_PER_MINUTE;
        const multiplier = job.priority === JobPriority.CRITICAL ? 2.0 : job.priority === JobPriority.HIGH ? 1.5 : 1.0;

        if (breachMinutes > job.maxDelayMinutesAllowed) {
          const prefix = job.priority === JobPriority.CRITICAL
            ? `CRITICAL Job ${job.id} breached max allowed SLA delay window by ${breachMinutes} mins`
            : job.priority === JobPriority.HIGH
            ? `HIGH Job ${job.id} breached max delay window`
            : `${job.priority} Job ${job.id} exceeded max window tolerance`;

          route.validationErrors.push(prefix);
          route.isFeasible = false;
        } else {
          stop.slaViolated = true;
          stop.calculatedPenalty = breachMinutes * job.penaltyPerMinuteLate * multiplier;
        }
      } else {
        stop.slaViolated = false;
        stop.calculatedPenalty = 0;
      }

      route.totalPenaltyCost += stop.calculatedPenalty;

      currentTime = new Date(currentTime.getTime() + job.serviceDurationMinutes * MS_PER_MINUTE);
      route.totalDurationMinutes += job.serviceDurationMinutes;
      stop.estimatedDeparture = new Date(currentTime);

      currentLocation = stop.location;
    }

    if (accumulatedDrivingMinutes > vehicle.maxDrivingMinutesPerDay) {
      route.validationErrors.push(`Total driving time (${accumulatedDrivingMinutes} mins) exceeds maximum daily limit (${vehicle.maxDrivingMinutesPerDay} mins)`);
      route.isFeasible = false;
    }

    if (currentTime > vehicle.shiftWindow.endTime) {
      route.validationErrors.push(`Route completion time (${currentTime.toISOString()}) exceeds vehicle shift end time (${vehicle.shiftWindow.endTime.toISOString()})`);
      route.isFeasible = false;
    }
  }

  private validateJobVehicleCompatibility(job: DispatchJob, vehicle: Vehicle): void {
    if (!vehicle.supportedCargoTypes.includes(job.cargo.type)) {
      throw new BadRequestException(`Vehicle ${vehicle.id} does not support cargo type ${job.cargo.type}`);
    }

    switch (job.cargo.type) {
      case CargoType.HAZMAT:
        if (!vehicle.hasHazmatPermit) {
          throw new BadRequestException(`Vehicle ${vehicle.id} lacks required HAZMAT permit for job ${job.id}`);
        }
        break;
      case CargoType.REFRIGERATED:
        if (!vehicle.hasRefrigeration) {
          throw new BadRequestException(`Vehicle ${vehicle.id} lacks refrigeration unit for job ${job.id}`);
        }
        if (job.cargo.minTemperatureC !== undefined && job.cargo.maxTemperatureC !== undefined) {
          if (job.cargo.minTemperatureC < -30 || job.cargo.maxTemperatureC > 15) {
            throw new UnprocessableEntityException(`Temperature range [${job.cargo.minTemperatureC}, ${job.cargo.maxTemperatureC}] outside operational limits`);
          }
        }
        break;
      case CargoType.OVERSIZED:
        if (job.cargo.weightKg > vehicle.maxWeightKg * 0.9 || job.cargo.volumeM3 > vehicle.maxVolumeM3 * 0.9) {
          throw new BadRequestException(`OVERSIZED cargo requires at least 10% safety margin headroom in vehicle ${vehicle.id}`);
        }
        break;
      case CargoType.FRAGILE:
      case CargoType.STANDARD:
        break;
      default:
        throw new BadRequestException(`Unknown cargo type specified`);
    }

    if (vehicle.status === VehicleStatus.MAINTENANCE || vehicle.status === VehicleStatus.OFF_DUTY) {
      throw new ConflictException(`Vehicle ${vehicle.id} is unavailable due to status: ${vehicle.status}`);
    }
  }

  private checkDependencyOrdering(job: DispatchJob, route: DispatchRoute): void {
    if (!job.prerequisiteJobIds || job.prerequisiteJobIds.length === 0) {
      return;
    }

    for (const prereqId of job.prerequisiteJobIds) {
      const prereqJob = this.jobs.get(prereqId);
      if (!prereqJob) {
        throw new UnprocessableEntityException(`Prerequisite job ${prereqId} does not exist`);
      }

      if (prereqJob.status === JobStatus.DELIVERED) {
        continue;
      }

      if (prereqJob.assignedRouteId !== route.id) {
        throw new ConflictException(`Prerequisite job ${prereqId} must be assigned to the same route and completed before job ${job.id}`);
      }

      const prereqDeliveryIdx = route.stops.findIndex(s => s.jobId === prereqId && s.stopType === 'DELIVERY');
      if (prereqDeliveryIdx === -1) {
        throw new ConflictException(`Prerequisite job ${prereqId} delivery stop not found in current route`);
      }
    }

    this.detectCircularDependencies(job.id, new Set<string>());
  }

  private detectCircularDependencies(currentJobId: string, visited: Set<string>): void {
    if (visited.has(currentJobId)) {
      throw new UnprocessableEntityException(`Circular dependency detected involving job ID: ${currentJobId}`);
    }

    visited.add(currentJobId);
    const job = this.jobs.get(currentJobId);

    if (job?.prerequisiteJobIds) {
      for (const parentId of job.prerequisiteJobIds) {
        this.detectCircularDependencies(parentId, new Set(visited));
      }
    }
  }

  private arePrerequisitesMet(job: DispatchJob): boolean {
    for (const prereqId of job.prerequisiteJobIds) {
      const prereq = this.jobs.get(prereqId);
      if (!prereq || (prereq.status !== JobStatus.DELIVERED && prereq.status !== JobStatus.ASSIGNED)) {
        return false;
      }
    }
    return true;
  }

  private validateStatusTransition(currentStatus: JobStatus, newStatus: JobStatus): void {
    switch (currentStatus) {
      case JobStatus.PENDING:
        if (newStatus !== JobStatus.ASSIGNED && newStatus !== JobStatus.CANCELLED) {
          throw new BadRequestException(`Invalid status transition from PENDING to ${newStatus}`);
        }
        break;
      case JobStatus.ASSIGNED:
        if (newStatus !== JobStatus.IN_TRANSIT && newStatus !== JobStatus.PENDING && newStatus !== JobStatus.CANCELLED) {
          throw new BadRequestException(`Invalid status transition from ASSIGNED to ${newStatus}`);
        }
        break;
      case JobStatus.IN_TRANSIT:
        if (newStatus !== JobStatus.DELIVERED && newStatus !== JobStatus.FAILED) {
          throw new BadRequestException(`Invalid status transition from IN_TRANSIT to ${newStatus}`);
        }
        break;
      case JobStatus.DELIVERED:
        throw new ConflictException(`Cannot transition from terminal status DELIVERED`);
      case JobStatus.FAILED:
        if (newStatus !== JobStatus.PENDING) {
          throw new BadRequestException(`FAILED jobs can only transition back to PENDING for retry`);
        }
        break;
      case JobStatus.CANCELLED:
        throw new ConflictException(`Cannot transition from terminal status CANCELLED`);
      default:
        throw new BadRequestException(`Unknown status: ${currentStatus}`);
    }
  }

  private validateJobPayload(jobData: Partial<DispatchJob>): void {
    if (jobData.cargo) {
      if (jobData.cargo.weightKg <= 0 || jobData.cargo.volumeM3 <= 0) {
        throw new BadRequestException(`Cargo weight and volume must be greater than zero`);
      }
    }

    if (jobData.pickupWindow && jobData.deliveryWindow) {
      if (jobData.pickupWindow.startTime >= jobData.pickupWindow.endTime) {
        throw new BadRequestException(`Pickup window start time must precede end time`);
      }
      if (jobData.deliveryWindow.startTime >= jobData.deliveryWindow.endTime) {
        throw new BadRequestException(`Delivery window start time must precede end time`);
      }
      if (jobData.pickupWindow.startTime >= jobData.deliveryWindow.startTime) {
        throw new BadRequestException(`Pickup start time must precede delivery start time`);
      }
    }

    if (jobData.serviceDurationMinutes !== undefined && jobData.serviceDurationMinutes < 0) {
      throw new BadRequestException(`Service duration cannot be negative`);
    }
  }

  private validateVehiclePayload(vehicleData: Partial<Vehicle>): void {
    if (vehicleData.maxWeightKg !== undefined && vehicleData.maxWeightKg <= 0) {
      throw new BadRequestException(`Max weight capacity must be positive`);
    }
    if (vehicleData.maxVolumeM3 !== undefined && vehicleData.maxVolumeM3 <= 0) {
      throw new BadRequestException(`Max volume capacity must be positive`);
    }
    if (vehicleData.shiftWindow && vehicleData.shiftWindow.startTime >= vehicleData.shiftWindow.endTime) {
      throw new BadRequestException(`Vehicle shift start time must precede shift end time`);
    }
    if (vehicleData.maintenanceBlackouts) {
      for (const blackout of vehicleData.maintenanceBlackouts) {
        if (blackout.startTime >= blackout.endTime) {
          throw new BadRequestException(`Maintenance blackout start time must precede end time`);
        }
      }
    }
  }

  private calculateDistanceKm(from: GeoLocation, to: GeoLocation): number {
    const dLat = this.toRadians(to.latitude - from.latitude);
    const dLon = this.toRadians(to.longitude - from.longitude);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRadians(from.latitude)) *
        Math.cos(this.toRadians(to.latitude)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Math.round(EARTH_RADIUS_KM * c * 100) / 100;
  }

  private toRadians(degrees: number): number {
    return degrees * (Math.PI / 180);
  }

  private generateUniqueId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
  }
}