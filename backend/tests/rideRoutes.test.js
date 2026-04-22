// tests/rideRoutes.test.js
// Integration tests for ride REST endpoints using Supertest
// Firebase and Socket.IO are mocked

jest.mock("../config/firebase");
jest.mock("../services/matchingService");

const request = require("supertest");
const { app } = require("../server");
const matchingService = require("../services/matchingService");

const sampleRide = {
  id: "ride-001",
  passengerId: "p001",
  passengerName: "Ravi Kumar",
  pickupStop: "Station Road",
  destinationStop: "College Gate",
  seats: 1,
  status: "pending",
  driverId: null,
  driverName: null,
  eta: null,
  createdAt: Date.now(),
};

describe("POST /api/rides", () => {
  it("should create a ride request and return 201", async () => {
    matchingService.createRideRequest.mockResolvedValue(sampleRide);

    const res = await request(app).post("/api/rides").send({
      passengerId: "p001",
      passengerName: "Ravi Kumar",
      pickupStop: "Station Road",
      destinationStop: "College Gate",
      seats: 1,
    });

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe("pending");
    expect(res.body.data.passengerId).toBe("p001");
  });

  it("should return 400 if required fields are missing", async () => {
    const res = await request(app).post("/api/rides").send({
      passengerId: "p001",
      // missing passengerName, pickupStop, destinationStop
    });

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("should return 400 if pickup equals destination", async () => {
    const res = await request(app).post("/api/rides").send({
      passengerId: "p001",
      passengerName: "Ravi",
      pickupStop: "Station Road",
      destinationStop: "Station Road",
    });

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/different/i);
  });
});

describe("PUT /api/rides/:rideId/accept", () => {
  it("should accept a ride and return updated data", async () => {
    const acceptedRide = {
      ...sampleRide,
      status: "accepted",
      driverId: "d001",
      driverName: "Suresh",
      eta: "5 min",
    };
    matchingService.acceptRideRequest.mockResolvedValue(acceptedRide);

    const res = await request(app).put("/api/rides/ride-001/accept").send({
      driverId: "d001",
      driverName: "Suresh",
      vehicleNumber: "JH05-1234",
    });

    expect(res.statusCode).toBe(200);
    expect(res.body.data.status).toBe("accepted");
    expect(res.body.data.driverName).toBe("Suresh");
  });

  it("should return 400 if driverId is missing", async () => {
    const res = await request(app).put("/api/rides/ride-001/accept").send({
      driverName: "Suresh",
    });

    expect(res.statusCode).toBe(400);
  });
});

describe("GET /api/rides/pending", () => {
  it("should return list of pending rides", async () => {
    matchingService.getPendingRideRequests.mockResolvedValue([sampleRide]);

    const res = await request(app).get("/api/rides/pending");

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data[0].status).toBe("pending");
  });
});

describe("PUT /api/rides/:rideId/cancel", () => {
  it("should cancel a ride", async () => {
    matchingService.cancelRideRequest.mockResolvedValue({ id: "ride-001", status: "cancelled" });

    const res = await request(app).put("/api/rides/ride-001/cancel");

    expect(res.statusCode).toBe(200);
    expect(res.body.data.status).toBe("cancelled");
  });
});

describe("GET /api/rides/:rideId", () => {
  it("should return a ride by ID", async () => {
    matchingService.getRideById.mockResolvedValue(sampleRide);

    const res = await request(app).get("/api/rides/ride-001");

    expect(res.statusCode).toBe(200);
    expect(res.body.data.id).toBe("ride-001");
  });

  it("should return 500 if ride not found (service throws)", async () => {
    matchingService.getRideById.mockRejectedValue(new Error("Ride request not found"));

    const res = await request(app).get("/api/rides/nonexistent");

    expect(res.statusCode).toBe(500);
    expect(res.body.success).toBe(false);
  });
});

describe("PUT /api/rides/:rideId/complete", () => {
  it("should complete a ride and return status completed", async () => {
    matchingService.completeRideRequest.mockResolvedValue({
      id: "ride-001",
      status: "completed",
    });

    const res = await request(app).put("/api/rides/ride-001/complete").send({
      driverId: "d001",
    });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe("completed");
  });

  it("should return 400 if driverId is missing", async () => {
    const res = await request(app)
      .put("/api/rides/ride-001/complete")
      .send({});

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/driverId/i);
  });

  it("should return 500 if service throws (e.g. ride not found)", async () => {
    matchingService.completeRideRequest.mockRejectedValue(
      new Error("Ride request not found")
    );

    const res = await request(app).put("/api/rides/nonexistent/complete").send({
      driverId: "d001",
    });

    expect(res.statusCode).toBe(500);
    expect(res.body.success).toBe(false);
  });

  it("should return 500 if driver is not authorized to complete the ride", async () => {
    matchingService.completeRideRequest.mockRejectedValue(
      new Error("Not authorized to complete this ride")
    );

    const res = await request(app).put("/api/rides/ride-001/complete").send({
      driverId: "d999",
    });

    expect(res.statusCode).toBe(500);
    expect(res.body.error).toMatch(/not authorized/i);
  });
});

describe("GET /api/rides/driver/:driverId/active", () => {
  it("should return active rides for a driver", async () => {
    matchingService.getActiveRidesForDriver.mockResolvedValue([{
      id: "ride-001",
      passengerId: "p001",
      status: "accepted",
      driverId: "d001",
    }]);

    const res = await request(app).get("/api/rides/driver/d001/active");

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data[0].driverId).toBe("d001");
  });

  it("should return an empty array if driver has no active rides", async () => {
    matchingService.getActiveRidesForDriver.mockResolvedValue([]);

    const res = await request(app).get("/api/rides/driver/d001/active");

    expect(res.statusCode).toBe(200);
    expect(res.body.data).toEqual([]);
  });
});

describe("GET /api/rides/passenger/:passengerId/active", () => {
  it("should return the active ride for a passenger", async () => {
    matchingService.getActiveRideForPassenger.mockResolvedValue({
      id: "ride-001",
      passengerId: "p001",
      status: "accepted",
    });

    const res = await request(app).get("/api/rides/passenger/p001/active");

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.passengerId).toBe("p001");
  });

  it("should return null if passenger has no active ride", async () => {
    matchingService.getActiveRideForPassenger.mockResolvedValue(null);

    const res = await request(app).get("/api/rides/passenger/p001/active");

    expect(res.statusCode).toBe(200);
    expect(res.body.data).toBeNull();
  });
});
