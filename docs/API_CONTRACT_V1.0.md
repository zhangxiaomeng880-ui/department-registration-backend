# Department Registration API Contract V1.0

## Business chain

City → Hospital → Campus → Department → Doctor → Date/Slot → Registration

## Endpoints

### GET /health
Returns service health.

### GET /api/cities
Returns available cities.

### GET /api/hospitals?cityId={cityId}
Returns hospitals in a city.

### GET /api/campuses?hospitalId={hospitalId}
Returns campuses for a hospital.

### GET /api/departments?campusId={campusId}
Returns enabled departments sorted by `sort`.

### GET /api/doctors?departmentId={departmentId}
Returns enabled doctors sorted by `sort`.

### GET /api/slots?doctorId={doctorId}
Returns available appointment slots.

### POST /api/registrations
Request body:
```json
{"doctorId":"doctor-1","slotId":"slot-1"}
```
Success: HTTP 201 with a registration object.
Conflict: HTTP 409 with `SLOT_UNAVAILABLE` when the slot is already occupied.
Bad request: HTTP 400 with `DOCTOR_MISMATCH` when the doctor and slot do not match.

## Contract rules

- IDs are opaque strings.
- Filtering must preserve the requested parent relationship.
- Disabled departments/doctors are not returned.
- Slot registration is single-consumption.
- A successful registration changes the slot from available to unavailable.
