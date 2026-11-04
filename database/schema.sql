CREATE TABLE IF NOT EXISTS profiles (
    firebase_uid TEXT PRIMARY KEY,
    display_name TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'customer'
        CHECK (role IN ('customer', 'driver', 'admin')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS drivers (
    firebase_uid TEXT PRIMARY KEY REFERENCES profiles(firebase_uid) ON DELETE CASCADE,
    online BOOLEAN NOT NULL DEFAULT FALSE,
    latitude DOUBLE PRECISION CHECK (latitude BETWEEN -90 AND 90),
    longitude DOUBLE PRECISION CHECK (longitude BETWEEN -180 AND 180),
    last_location_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rides (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_uid TEXT NOT NULL REFERENCES profiles(firebase_uid),
    pickup TEXT NOT NULL,
    pickup_lat DOUBLE PRECISION NOT NULL CHECK (pickup_lat BETWEEN -90 AND 90),
    pickup_lng DOUBLE PRECISION NOT NULL CHECK (pickup_lng BETWEEN -180 AND 180),
    destination TEXT NOT NULL,
    destination_lat DOUBLE PRECISION NOT NULL CHECK (destination_lat BETWEEN -90 AND 90),
    destination_lng DOUBLE PRECISION NOT NULL CHECK (destination_lng BETWEEN -180 AND 180),
    vehicle_type TEXT NOT NULL CONSTRAINT rides_vehicle_type_check CHECK (vehicle_type IN ('car', 'bike')),
    distance_km NUMERIC(8, 2) CHECK (distance_km > 0),
    fare_ksh INTEGER NOT NULL CHECK (fare_ksh > 0),
    status TEXT NOT NULL DEFAULT 'requested'
        CHECK (status IN ('requested', 'accepted', 'en_route', 'in_progress', 'completed', 'cancelled')),
    driver_uid TEXT REFERENCES drivers(firebase_uid),
    preferred_driver_uid TEXT REFERENCES drivers(firebase_uid),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    accepted_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ
);

ALTER TABLE rides ADD COLUMN IF NOT EXISTS distance_km NUMERIC(8, 2) CHECK (distance_km > 0);
ALTER TABLE rides ADD COLUMN IF NOT EXISTS preferred_driver_uid TEXT REFERENCES drivers(firebase_uid);
ALTER TABLE rides ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
ALTER TABLE rides DROP CONSTRAINT IF EXISTS rides_vehicle_type_check;
UPDATE rides SET vehicle_type = 'car'
WHERE vehicle_type IN ('economy', 'comfort', 'premium');
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'rides_vehicle_type_check'
            AND conrelid = 'rides'::regclass
    ) THEN
        ALTER TABLE rides ADD CONSTRAINT rides_vehicle_type_check
            CHECK (vehicle_type IN ('car', 'bike'));
    END IF;
END
$$;

CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ride_id UUID NOT NULL REFERENCES rides(id),
    customer_uid TEXT NOT NULL REFERENCES profiles(firebase_uid),
    method TEXT NOT NULL CHECK (method IN ('cash', 'mpesa')),
    amount_ksh INTEGER NOT NULL CHECK (amount_ksh > 0),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'paid', 'failed')),
    merchant_request_id TEXT,
    checkout_request_id TEXT UNIQUE,
    mpesa_receipt TEXT UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS one_pending_payment_per_ride
    ON payments (ride_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS rides_status_created_at ON rides(status, created_at DESC);
CREATE INDEX IF NOT EXISTS rides_driver_status ON rides(driver_uid, status);
CREATE INDEX IF NOT EXISTS rides_customer_created_at ON rides(customer_uid, created_at DESC);
CREATE INDEX IF NOT EXISTS payments_customer_created_at ON payments(customer_uid, created_at DESC);
