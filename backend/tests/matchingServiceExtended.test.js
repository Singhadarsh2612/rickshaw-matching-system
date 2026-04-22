// tests/matchingServiceExtended.test.js
// Unit tests for the remaining matchingService functions:
//   completeRideRequest, getActiveRidesForDriver, getActiveRideForPassenger
// Firebase is mocked — no real DB calls are made.

jest.mock("../config/firebase");

const { getDb } = require("../config/firebase");

// ── Shared mock data ──────────────────────────────────────────────────────

const mockPendingRide = {
  id: "ride-001",
  passengerId: "p001",
  passengerName: "Ravi",
  pickupStop: "Station Road",
  destinationStop: "College Gate",
  seats: 1,
  status: "pending",
  driverId: null,
  driverName: null,
  eta: null,
  createdAt: Date.now(),
};

const mockAcceptedRide = {
  ...mockPendingRide,
  status: "accepted",
  driverId: "d001",
  driverName: "Suresh",
  vehicleNumber: "JH05-1234",
  eta: "5 min",
  acceptedAt: Date.now(),
};

let mockDb;

beforeEach(() => {
  mockDb = {
    ref: jest.fn().mockReturnValue({
      set: jest.fn().mockResolvedValue(true),
      update: jest.fn().mockResolvedValue(true),
      once: jest.fn().mockResolvedValue({
        exists: () => true,
        val: () => ({ ...mockAcceptedRide }),
      }),
      orderByChild: jest.fn().mockReturnThis(),
      equalTo: jest.fn().mockReturnThis(),
      transaction: jest.fn().mockResolvedValue({ committed: true }),
    }),
  };
  getDb.mockReturnValue(mockDb);
});

const matchingService = require("../services/matchingService");

// ── completeRideRequest ───────────────────────────────────────────────────

describe("matchingService - completeRideRequest", () => {
  it("should update ride status to completed", async () => {
    const rideRef = {
      once: jest.fn().mockResolvedValue({
        exists: () => true,
        val: () => ({ ...mockAcceptedRide }),
      }),
      update: jest.fn().mockResolvedValue(true),
    };

    const driverRef = {
      transaction: jest.fn().mockResolvedValue({ committed: true }),
    };

    mockDb.ref.mockImplementation((path) => {
      if (path === `rideRequests/${mockAcceptedRide.id}`) return rideRef;
      if (path.startsWith("drivers/")) return driverRef;
      return { once: jest.fn(), update: jest.fn() };
    });

    const result = await matchingService.completeRideRequest(
      mockAcceptedRide.id,
      "d001"
    );

    expect(result.status).toBe("completed");
    expect(result.id).toBe(mockAcceptedRide.id);
    expect(rideRef.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "completed" })
    );
  });

  it("should throw if ride does not exist", async () => {
    mockDb.ref.mockReturnValue({
      once: jest.fn().mockResolvedValue({ exists: () => false, val: () => null }),
    });

    await expect(
      matchingService.completeRideRequest("nonexistent", "d001")
    ).rejects.toThrow("Ride request not found");
  });

  it("should throw if ride is not in accepted state", async () => {
    mockDb.ref.mockReturnValue({
      once: jest.fn().mockResolvedValue({
        exists: () => true,
        val: () => ({ ...mockPendingRide }), // still pending
      }),
    });

    await expect(
      matchingService.completeRideRequest(mockPendingRide.id, "d001")
    ).rejects.toThrow("Ride request is not in progress");
  });

  it("should throw if driverId does not match the ride's assigned driver", async () => {
    mockDb.ref.mockReturnValue({
      once: jest.fn().mockResolvedValue({
        exists: () => true,
        val: () => ({ ...mockAcceptedRide }), // driverId is "d001"
      }),
    });

    await expect(
      matchingService.completeRideRequest(mockAcceptedRide.id, "d999") // wrong driver
    ).rejects.toThrow("Not authorized to complete this ride");
  });

  it("should restore driver seats via a transaction after completion", async () => {
    const rideRef = {
      once: jest.fn().mockResolvedValue({
        exists: () => true,
        val: () => ({ ...mockAcceptedRide }),
      }),
      update: jest.fn().mockResolvedValue(true),
    };

    const driverRef = {
      transaction: jest.fn().mockResolvedValue({ committed: true }),
    };

    mockDb.ref.mockImplementation((path) => {
      if (path === `rideRequests/${mockAcceptedRide.id}`) return rideRef;
      if (path.startsWith("drivers/")) return driverRef;
      return {};
    });

    await matchingService.completeRideRequest(mockAcceptedRide.id, "d001");

    expect(driverRef.transaction).toHaveBeenCalled();
  });
});

// ── getActiveRidesForDriver ───────────────────────────────────────────────

describe("matchingService - getActiveRidesForDriver", () => {
  it("should return only accepted rides for the given driver", async () => {
    const rides = {
      "ride-001": { ...mockAcceptedRide },
      "ride-002": { ...mockAcceptedRide, id: "ride-002", status: "completed" },
    };

    mockDb.ref.mockReturnValue({
      orderByChild: jest.fn().mockReturnThis(),
      equalTo: jest.fn().mockReturnThis(),
      once: jest.fn().mockResolvedValue({
        val: () => rides,
      }),
    });

    const result = await matchingService.getActiveRidesForDriver("d001");

    // Only the accepted ride should be returned
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("accepted");
  });

  it("should return an empty array if driver has no active rides", async () => {
    mockDb.ref.mockReturnValue({
      orderByChild: jest.fn().mockReturnThis(),
      equalTo: jest.fn().mockReturnThis(),
      once: jest.fn().mockResolvedValue({ val: () => null }),
    });

    const result = await matchingService.getActiveRidesForDriver("d001");
    expect(result).toEqual([]);
  });
});

// ── getActiveRideForPassenger ─────────────────────────────────────────────

describe("matchingService - getActiveRideForPassenger", () => {
  it("should return the most recent pending or accepted ride for the passenger", async () => {
    const olderRide = {
      ...mockPendingRide,
      id: "ride-old",
      createdAt: Date.now() - 10000,
    };
    const newerRide = {
      ...mockPendingRide,
      id: "ride-new",
      createdAt: Date.now(),
    };

    mockDb.ref.mockReturnValue({
      orderByChild: jest.fn().mockReturnThis(),
      equalTo: jest.fn().mockReturnThis(),
      once: jest.fn().mockResolvedValue({
        val: () => ({ "ride-old": olderRide, "ride-new": newerRide }),
      }),
    });

    const result = await matchingService.getActiveRideForPassenger("p001");

    // Should return the newest ride
    expect(result.id).toBe("ride-new");
  });

  it("should return null if passenger has no active rides", async () => {
    mockDb.ref.mockReturnValue({
      orderByChild: jest.fn().mockReturnThis(),
      equalTo: jest.fn().mockReturnThis(),
      once: jest.fn().mockResolvedValue({ val: () => null }),
    });

    const result = await matchingService.getActiveRideForPassenger("p001");
    expect(result).toBeNull();
  });

  it("should ignore completed and cancelled rides", async () => {
    const completedRide = { ...mockAcceptedRide, status: "completed" };
    const cancelledRide = { ...mockPendingRide, id: "ride-002", status: "cancelled" };

    mockDb.ref.mockReturnValue({
      orderByChild: jest.fn().mockReturnThis(),
      equalTo: jest.fn().mockReturnThis(),
      once: jest.fn().mockResolvedValue({
        val: () => ({
          "ride-001": completedRide,
          "ride-002": cancelledRide,
        }),
      }),
    });

    const result = await matchingService.getActiveRideForPassenger("p001");
    expect(result).toBeNull();
  });
});