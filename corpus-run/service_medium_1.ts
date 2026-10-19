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

@Injectable()
export class ParkingLotAllocationService {
  private isLotOperational: boolean = true;
  private spots: Map<string, ParkingSpot> = new Map();
  private activeAllocations: Map<string, AllocationReceipt> = new Map();
  private restrictedPlates: Set<string> = new Set();

  constructor() {
    this.initializeDefaultSpots();
  }

  public allocateSpot(request: AllocationRequest): AllocationReceipt {
    if (!this.isLotOperational) {
      throw new BadRequestException('Parking lot is currently closed for operation.');
    }

    if (!request.licensePlate || request.licensePlate.trim().length < 3) {
      throw new BadRequestException('Invalid license plate provided.');
    }

    if (this.activeAllocations.has(request.licensePlate)) {
      throw new ConflictException('Vehicle with this license plate is already parked.');
    }

    if (this.restrictedPlates.has(request.licensePlate)) {
      throw new ForbiddenException('Vehicle has outstanding fines or active restrictions.');
    }

    const spot = this.spots.get(request.requestedSpotId);
    if (!spot) {
      throw new NotFoundException('Requested parking spot does not exist.');
    }

    if (spot.isOccupied) {
      throw new ConflictException('Requested parking spot is already occupied.');
    }

    if (!this.isSpotCompatible(request.vehicleType, spot.type)) {
      throw new BadRequestException(
        `Vehicle type ${request.vehicleType} is not compatible with spot type ${spot.type}.`,
      );
    }

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

  public releaseSpot(spotId: string): AllocationReceipt {
    const spot = this.spots.get(spotId);
    if (!spot) {
      throw new NotFoundException('Parking spot does not exist.');
    }

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

  private isSpotCompatible(vehicleType: VehicleType, spotType: SpotType): boolean {
    if (vehicleType === VehicleType.MOTORCYCLE) {
      return (
        spotType === SpotType.MOTORCYCLE ||
        spotType === SpotType.COMPACT ||
        spotType === SpotType.LARGE
      );
    }

    if (vehicleType === VehicleType.COMPACT) {
      return spotType === SpotType.COMPACT || spotType === SpotType.LARGE;
    }

    if (vehicleType === VehicleType.LARGE) {
      return spotType === SpotType.LARGE;
    }

    if (vehicleType === VehicleType.ELECTRIC) {
      return spotType === SpotType.ELECTRIC || spotType === SpotType.LARGE;
    }

    return false;
  }

  private initializeDefaultSpots(): void {
    const defaultSpots: ParkingSpot[] = [
      { id: 'M1', type: SpotType.MOTORCYCLE, isOccupied: false },
      { id: 'C1', type: SpotType.COMPACT, isOccupied: false },
      { id: 'L1', type: SpotType.LARGE, isOccupied: false },
      { id: 'E1', type: SpotType.ELECTRIC, isOccupied: false },
    ];

    for (const spot of defaultSpots) {
      this.spots.set(spot.id, spot);
    }
  }
}
