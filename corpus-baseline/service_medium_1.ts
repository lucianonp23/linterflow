import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';

export enum VehicleType {
  MOTORCYCLE = 'MOTORCYCLE',
  COMPACT = 'COMPACT',
  LARGE = 'LARGE',
  ELECTRIC = 'ELECTRIC',
}

export enum SpotType {
  MOTORCYCLE = 'MOTORCYCLE',
  COMPACT = 'COMPACT',
  LARGE = 'LARGE',
  ELECTRIC = 'ELECTRIC',
}

export interface ParkingSpot {
  id: string;
  type: SpotType;
  isOccupied: boolean;
  occupiedByPlate?: string;
}

export interface AllocationRequest {
  licensePlate: string;
  vehicleType: VehicleType;
  requestedSpotId: string;
}

export interface AllocationReceipt {
  spotId: string;
  licensePlate: string;
  allocatedAt: Date;
}

const VEHICLE_SPOT_COMPATIBILITY: Record<VehicleType, ReadonlySet<SpotType>> = {
  [VehicleType.MOTORCYCLE]: new Set([SpotType.MOTORCYCLE, SpotType.COMPACT, SpotType.LARGE]),
  [VehicleType.COMPACT]: new Set([SpotType.COMPACT, SpotType.LARGE]),
  [VehicleType.LARGE]: new Set([SpotType.LARGE]),
  [VehicleType.ELECTRIC]: new Set([SpotType.ELECTRIC, SpotType.LARGE]),
};

const DEFAULT_PARKING_SPOTS: ReadonlyArray<ParkingSpot> = [
  { id: 'M1', type: SpotType.MOTORCYCLE, isOccupied: false },
  { id: 'C1', type: SpotType.COMPACT, isOccupied: false },
  { id: 'L1', type: SpotType.LARGE, isOccupied: false },
  { id: 'E1', type: SpotType.ELECTRIC, isOccupied: false },
];

const MIN_LICENSE_PLATE_LENGTH = 3;

@Injectable()
export class ParkingLotAllocationService {
  private isLotOperational = true;
  private readonly spots = new Map<string, ParkingSpot>();
  private readonly activeAllocations = new Map<string, AllocationReceipt>();
  private readonly restrictedPlates = new Set<string>();

  constructor() {
    this.initializeDefaultSpots();
  }

  public allocateSpot(request: AllocationRequest): AllocationReceipt {
    this.validateOperationalStatus();
    this.validateLicensePlate(request.licensePlate);

    const spot = this.getSpotOrThrow(request.requestedSpotId, 'Requested parking spot does not exist.');
    this.validateSpotAvailability(spot);

    if (!this.isSpotCompatible(request.vehicleType, spot.type)) {
      throw new BadRequestException(
        `Vehicle type ${request.vehicleType} is not compatible with spot type ${spot.type}.`,
      );
    }

    return this.executeAllocation(request, spot);
  }

  public releaseSpot(spotId: string): AllocationReceipt {
    const spot = this.getSpotOrThrow(spotId, 'Parking spot does not exist.');

    if (!spot.isOccupied || !spot.occupiedByPlate) {
      throw new BadRequestException('Parking spot is not currently occupied.');
    }

    const receipt = this.activeAllocations.get(spot.occupiedByPlate);
    if (!receipt) {
      throw new NotFoundException('Allocation record for this spot could not be found.');
    }

    this.activeAllocations.delete(spot.occupiedByPlate);
    spot.isOccupied = false;
    spot.occupiedByPlate = undefined;

    return receipt;
  }

  public setLotStatus(isOpen: boolean): void {
    this.isLotOperational = isOpen;
  }

  public addRestrictedPlate(licensePlate: string): void {
    this.restrictedPlates.add(licensePlate);
  }

  public removeRestrictedPlate(licensePlate: string): void {
    this.restrictedPlates.delete(licensePlate);
  }

  private validateOperationalStatus(): void {
    if (!this.isLotOperational) {
      throw new BadRequestException('Parking lot is currently closed for operation.');
    }
  }

  private validateLicensePlate(licensePlate: string): void {
    if (!licensePlate || licensePlate.trim().length < MIN_LICENSE_PLATE_LENGTH) {
      throw new BadRequestException('Invalid license plate provided.');
    }

    if (this.activeAllocations.has(licensePlate)) {
      throw new ConflictException('Vehicle with this license plate is already parked.');
    }

    if (this.restrictedPlates.has(licensePlate)) {
      throw new ForbiddenException('Vehicle has outstanding fines or active restrictions.');
    }
  }

  private getSpotOrThrow(spotId: string, errorMessage: string): ParkingSpot {
    const spot = this.spots.get(spotId);
    if (!spot) {
      throw new NotFoundException(errorMessage);
    }
    return spot;
  }

  private validateSpotAvailability(spot: ParkingSpot): void {
    if (spot.isOccupied) {
      throw new ConflictException('Requested parking spot is already occupied.');
    }
  }

  private executeAllocation(request: AllocationRequest, spot: ParkingSpot): AllocationReceipt {
    spot.isOccupied = true;
    spot.occupiedByPlate = request.licensePlate;

    const receipt: AllocationReceipt = {
      spotId: spot.id,
      licensePlate: request.licensePlate,
      allocatedAt: new Date(),
    };

    this.activeAllocations.set(request.licensePlate, receipt);
    return receipt;
  }

  private isSpotCompatible(vehicleType: VehicleType, spotType: SpotType): boolean {
    const compatibleSpotTypes = VEHICLE_SPOT_COMPATIBILITY[vehicleType];
    return compatibleSpotTypes ? compatibleSpotTypes.has(spotType) : false;
  }

  private initializeDefaultSpots(): void {
    for (const spot of DEFAULT_PARKING_SPOTS) {
      this.spots.set(spot.id, { ...spot });
    }
  }
}