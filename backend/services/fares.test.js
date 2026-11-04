const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateFare } = require('./fares');

test('car fare applies the minimum and bills partial kilometres upward', () => {
    assert.deepEqual(calculateFare(1200, 'car'), {
        distanceKm: 1.2,
        billableKm: 2,
        ratePerKmKsh: 50,
        minimumFareKsh: 250,
        fareKsh: 250
    });
    assert.equal(calculateFare(5100, 'car').fareKsh, 300);
});

test('bike fare uses its own rate and minimum', () => {
    assert.equal(calculateFare(4000, 'bike').fareKsh, 150);
    assert.equal(calculateFare(5100, 'bike').fareKsh, 180);
});

test('fare calculation rejects missing distance and unsupported vehicles', () => {
    assert.throws(() => calculateFare(0, 'car'), /positive number/);
    assert.throws(() => calculateFare(1000, 'truck'), /Unsupported vehicle/);
});

test('fare rules can be set for each vehicle from environment configuration', (t) => {
    const keys = [
        'CAR_FARE_PER_KM_KSH',
        'CAR_MINIMUM_FARE_KSH',
        'BIKE_FARE_PER_KM_KSH',
        'BIKE_MINIMUM_FARE_KSH'
    ];
    const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    t.after(() => {
        for (const key of keys) {
            if (previous[key] === undefined) delete process.env[key];
            else process.env[key] = previous[key];
        }
    });
    process.env.CAR_FARE_PER_KM_KSH = '60';
    process.env.CAR_MINIMUM_FARE_KSH = '300';
    process.env.BIKE_FARE_PER_KM_KSH = '35';
    process.env.BIKE_MINIMUM_FARE_KSH = '175';

    assert.equal(calculateFare(5200, 'car').fareKsh, 360);
    assert.equal(calculateFare(5200, 'bike').fareKsh, 210);
});

test('invalid configured fare rules fail explicitly', (t) => {
    const previous = process.env.CAR_FARE_PER_KM_KSH;
    process.env.CAR_FARE_PER_KM_KSH = '0';
    t.after(() => {
        if (previous === undefined) delete process.env.CAR_FARE_PER_KM_KSH;
        else process.env.CAR_FARE_PER_KM_KSH = previous;
    });

    assert.throws(() => calculateFare(1000, 'car'), /CAR_FARE_PER_KM_KSH must be a positive whole number/);
});
