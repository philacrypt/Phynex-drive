const defaultFareRules = {
    car: { ratePerKmKsh: 50, minimumFareKsh: 250 },
    bike: { ratePerKmKsh: 30, minimumFareKsh: 150 }
};

function positiveIntegerSetting(name, fallback) {
    const value = process.env[name];
    if (value === undefined || value.trim() === '') return fallback;
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number <= 0) {
        throw new Error(`${name} must be a positive whole number of Kenyan shillings.`);
    }
    return number;
}

function getFareRules() {
    return Object.fromEntries(
        Object.entries(defaultFareRules).map(([vehicleType, defaults]) => {
            const prefix = vehicleType.toUpperCase();
            return [vehicleType, {
                ratePerKmKsh: positiveIntegerSetting(`${prefix}_FARE_PER_KM_KSH`, defaults.ratePerKmKsh),
                minimumFareKsh: positiveIntegerSetting(`${prefix}_MINIMUM_FARE_KSH`, defaults.minimumFareKsh)
            }];
        })
    );
}

function calculateFare(distanceMeters, vehicleType) {
    const rules = getFareRules()[vehicleType];
    if (!rules) throw new Error('Unsupported vehicle type.');
    if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) {
        throw new Error('Route distance must be a positive number.');
    }

    const billableKm = Math.ceil(distanceMeters / 1000);
    return {
        distanceKm: Math.round(distanceMeters / 10) / 100,
        billableKm,
        ratePerKmKsh: rules.ratePerKmKsh,
        minimumFareKsh: rules.minimumFareKsh,
        fareKsh: Math.max(rules.minimumFareKsh, billableKm * rules.ratePerKmKsh)
    };
}

module.exports = { calculateFare, getFareRules };
