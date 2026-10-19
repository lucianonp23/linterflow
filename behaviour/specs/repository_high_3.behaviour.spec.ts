import { defineSubject } from '../harness';

/**
 * Note on the original: assignJobToRoute() calls this.checkJobVehicleCompatibility(), a
 * method that does not exist (the defined one is validateJobVehicleCompatibility). This is
 * the type error that makes the file fail compilation. At run time every assignment in the
 * original therefore throws a TypeError, which is the behaviour recorded here.
 */
defineSubject('repository_high_3', (h) => {
  const t = (hour: number, minute = 0) => new Date(Date.UTC(2026, 0, 15, hour, minute));
  const loc = (latitude: number, longitude: number) => ({ latitude, longitude });
  const cargoTypes = ['STANDARD', 'STANDARD', 'HAZMAT', 'REFRIGERATED', 'FRAGILE', 'OVERSIZED', 'LIVESTOCK'];

  const scenarios = [];
  for (let i = 0; i < 4500; i++) {
    const r = h.rng(20000 + i);
    const job = (valid: boolean) => {
      const pickupStart = r.pick([8, 9, 10, 13]);
      const type = r.pick(cargoTypes);
      return {
        title: 'Deliver goods',
        priority: r.pick(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']),
        cargo: { weightKg: valid ? r.pick([100, 800, 1900, 2300]) : r.pick([100, 0, -5]), volumeM3: valid ? r.pick([1, 6, 11]) : r.pick([1, 0]), type, requiresSpecialHandling: false, minTemperatureC: type === 'REFRIGERATED' ? r.pick([undefined, -20, -40]) : undefined, maxTemperatureC: type === 'REFRIGERATED' ? r.pick([undefined, 4, 20]) : undefined },
        pickupLocation: loc(41.15 + r.int(3) * 0.1, -8.61),
        pickupWindow: { startTime: t(pickupStart), endTime: valid ? t(pickupStart + 2) : r.pick([t(pickupStart + 2), t(pickupStart)]) },
        deliveryLocation: loc(41.15 + r.int(4) * 0.4, -8.61 + r.int(3) * 0.3),
        deliveryWindow: { startTime: valid ? t(pickupStart + 2) : r.pick([t(pickupStart + 2), t(pickupStart - 1)]), endTime: valid ? t(pickupStart + r.pick([3, 5])) : r.pick([t(pickupStart + 4), t(pickupStart + 2)]) },
        serviceDurationMinutes: valid ? r.pick([10, 30]) : r.pick([10, -1]),
        prerequisiteRefs: r.chance(0.2) ? [r.int(3)] : [],
        slaDeadline: t(pickupStart + r.pick([4, 6])),
        penaltyPerMinuteLate: r.pick([0.5, 2]),
        maxDelayMinutesAllowed: r.pick([0, 30, 240]),
      };
    };
    const vehicle = (valid: boolean) => ({
      licensePlate: 'AA-00-BB',
      status: r.pick(['IDLE', 'IDLE', 'IDLE', 'ON_ROUTE', 'MAINTENANCE', 'OFF_DUTY']),
      maxWeightKg: valid ? r.pick([1000, 2000, 5000]) : r.pick([2000, 0]),
      maxVolumeM3: valid ? r.pick([10, 12, 30]) : r.pick([12, -1]),
      supportedCargoTypes: r.pick([['STANDARD', 'FRAGILE'], ['STANDARD', 'HAZMAT', 'REFRIGERATED', 'FRAGILE', 'OVERSIZED'], ['STANDARD']]),
      hasRefrigeration: r.chance(0.5),
      hasHazmatPermit: r.chance(0.5),
      currentLocation: loc(41.15, -8.61),
      shiftWindow: { startTime: t(7), endTime: valid ? t(r.pick([12, 19])) : r.pick([t(19), t(7)]) },
      maintenanceBlackouts: r.pick([[], [], [{ startTime: t(9), endTime: t(11), reason: 'Tyres' }], valid ? [] : [{ startTime: t(11), endTime: t(9), reason: 'Bad' }]]),
      maxDrivingMinutesPerDay: r.pick([60, 540]),
      maxStopsPerRoute: r.pick([1, 2, 8]),
    });
    const ops: any[] = [];
    const vehicleCount = 1 + r.int(2);
    for (let k = 0; k < vehicleCount; k++) ops.push({ kind: 'createVehicle', data: vehicle(r.chance(0.9)) });
    const jobCount = 1 + r.int(4);
    for (let k = 0; k < jobCount; k++) ops.push({ kind: 'createJob', data: job(r.chance(0.85)) });
    const length = 3 + r.int(12);
    for (let k = 0; k < length; k++) {
      const kind = r.pick(['assign', 'assign', 'assign', 'optimise', 'optimise', 'status', 'status', 'updateJob', 'updateVehicle', 'deleteJob', 'deleteVehicle', 'list', 'rebalance', 'createJob', 'read']);
      if (kind === 'assign') ops.push({ kind, job: r.int(5), vehicle: r.int(3), override: r.pick([undefined, false, true]) });
      else if (kind === 'optimise') ops.push({ kind, vehicles: r.pick([[0], [0, 1], [1, 0], [], [0, 9]]), jobs: r.pick([[0, 1, 2, 3], [3, 2, 1, 0], [0], [], [0, 9]]) });
      else if (kind === 'status') ops.push({ kind, job: r.int(5), status: r.pick(['PENDING', 'ASSIGNED', 'IN_TRANSIT', 'DELIVERED', 'FAILED', 'CANCELLED', 'LOST']) });
      else if (kind === 'updateJob') ops.push({ kind, job: r.int(5), updates: r.pick([{ title: 'Renamed' }, { priority: 'CRITICAL' }, { status: 'ASSIGNED' }, { status: 'CANCELLED' }, { status: 'DELIVERED' }, { serviceDurationMinutes: -5 }, { cargo: { weightKg: 0, volumeM3: 1, type: 'STANDARD', requiresSpecialHandling: false } }, {}]) });
      else if (kind === 'updateVehicle') ops.push({ kind, vehicle: r.int(3), updates: r.pick([{ status: 'ON_ROUTE' }, { status: 'IDLE' }, { status: 'MAINTENANCE' }, { maxWeightKg: 0 }, { maxVolumeM3: 50 }, { hasHazmatPermit: true, hasRefrigeration: true }, {}]) });
      else if (kind === 'list') ops.push({ kind, jobFilter: r.pick([undefined, {}, { status: 'PENDING' }, { priority: 'HIGH' }, { vehicleId: 'x' }, { status: 'ASSIGNED', priority: 'CRITICAL' }]), vehicleFilter: r.pick([undefined, {}, { status: 'IDLE' }, { cargoType: 'HAZMAT' }, { status: 'ON_ROUTE', cargoType: 'STANDARD' }]) });
      else if (kind === 'rebalance') ops.push({ kind, job: r.int(5), minutes: r.pick([15, 120, 600]) });
      else if (kind === 'createJob') ops.push({ kind, data: job(r.chance(0.85)) });
      else ops.push({ kind, job: r.int(5), vehicle: r.int(3) });
    }
    scenarios.push({ label: `scenario-${i}`, ops });
  }

  const copy = (v: any): any => {
    if (v instanceof Date) return new Date(v.getTime());
    if (Array.isArray(v)) return v.map(copy);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, copy(x)]));
    return v;
  };

  return scenarios.map(({ label, ops }) => ({
    label,
    run: (mod) => {
      const repo = new mod.LogisticsDispatchRepository();
      const jobIds: string[] = [];
      const vehicleIds: string[] = [];
      const jobId = (ref: number) => (ref >= 4 || jobIds.length === 0 ? 'JOB-missing' : jobIds[ref % jobIds.length]);
      const vehicleId = (ref: number) => (ref >= 2 && vehicleIds.length < 3 ? 'VEH-missing' : vehicleIds.length ? vehicleIds[ref % vehicleIds.length] : 'VEH-missing');
      const routeIdOf = (ref: number) => {
        try { return repo.getVehicleById(vehicleId(ref)).assignedRouteId ?? 'ROUTE-missing'; } catch { return 'ROUTE-missing'; }
      };
      return ops.map((raw: any) => {
        const op = copy(raw);
        switch (op.kind) {
          case 'createVehicle': {
            const out: any = h.step(() => repo.createVehicle(op.data));
            if (out.ok?.id) vehicleIds.push(out.ok.id);
            return out;
          }
          case 'createJob': {
            const { prerequisiteRefs, ...data } = op.data;
            const out: any = h.step(() => repo.createJob({ ...data, prerequisiteJobIds: prerequisiteRefs.map((ref: number) => jobId(ref)) }));
            if (out.ok?.id) jobIds.push(out.ok.id);
            return out;
          }
          case 'assign': return h.step(() => (op.override === undefined ? repo.assignJobToRoute(jobId(op.job), vehicleId(op.vehicle)) : repo.assignJobToRoute(jobId(op.job), vehicleId(op.vehicle), op.override)));
          case 'optimise': return h.step(() => repo.optimiseDispatchPlan(op.vehicles.map(vehicleId), op.jobs.map(jobId)));
          case 'status': return h.step(() => repo.updateJobStatus(jobId(op.job), op.status));
          case 'updateJob': return h.step(() => repo.updateJob(jobId(op.job), op.updates));
          case 'updateVehicle': return h.step(() => repo.updateVehicle(vehicleId(op.vehicle), op.updates));
          case 'deleteJob': return h.step(() => repo.deleteJob(jobId(op.job ?? 0)));
          case 'deleteVehicle': return h.step(() => repo.deleteVehicle(vehicleId(op.vehicle ?? 0)));
          case 'list': return h.step(() => ({ jobs: repo.listJobs(op.jobFilter), vehicles: repo.listVehicles(op.vehicleFilter) }));
          case 'rebalance': return h.step(() => repo.rebalanceRouteOnDelay(routeIdOf(0), jobId(op.job), op.minutes));
          default: return { job: h.step(() => repo.getJobById(jobId(op.job))), vehicle: h.step(() => repo.getVehicleById(vehicleId(op.vehicle))), route: h.step(() => repo.getRouteById(routeIdOf(op.vehicle))) };
        }
      });
    },
  }));
});
