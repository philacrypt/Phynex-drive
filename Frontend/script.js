import { authorizedFetch, getPublicConfig, requireRole, signOut } from './auth.js';

const form = document.querySelector('#ride-form');
const formMessage = document.querySelector('#form-message');
const serviceMessage = document.querySelector('#service-message');
const bookButton = document.querySelector('#book-button');
const bookingCard = document.querySelector('#booking-card');
const trackingCard = document.querySelector('#tracking-card');
const trackingError = document.querySelector('#tracking-error');
const cancelButton = document.querySelector('#cancel-ride');
const anotherButton = document.querySelector('#book-another');
const mpesaOption = document.querySelector('#mpesa-option');
const signOutButton = document.querySelector('#sign-out');
const currentLocationButton = document.querySelector('#use-current-location');
const pickupSearchButton = document.querySelector('#search-pickup-location');
const destinationSearchButton = document.querySelector('#search-destination-location');
const locationMessage = document.querySelector('#location-message');
const locationResults = document.querySelector('#location-results');
const distanceSummary = document.querySelector('#distance-summary');
const driverPicker = document.querySelector('#driver-picker');
const driverPickerMessage = document.querySelector('#driver-picker-message');
const driverOptions = document.querySelector('#driver-options');
const pickupMapButton = document.querySelector('#select-pickup-map');
const destinationMapButton = document.querySelector('#select-destination-map');
const mapAttribution = document.querySelector('#map-attribution');
const vehicleNames = { car: 'Car', bike: 'Bike' };
const statusNames = {
    requested: 'Finding a driver',
    accepted: 'Driver assigned',
    en_route: 'Driver en route',
    in_progress: 'Ride in progress',
    completed: 'Ride completed',
    cancelled: 'Ride cancelled'
};
const rideTitles = {
    requested: 'Your ride is being matched',
    accepted: 'Your ride is on its way',
    en_route: 'Your ride is on its way',
    in_progress: 'Your ride is on its way',
    completed: 'Thanks for riding with us',
    cancelled: 'This request was cancelled'
};
const rideMessages = {
    requested: 'We are finding a nearby driver for you.',
    accepted: 'Your driver has accepted the ride and is preparing to set off.',
    en_route: 'Your driver is heading to your pickup point.',
    in_progress: 'You are on your way. Have a safe ride!',
    completed: 'Your trip is complete. We hope you had a great ride.',
    cancelled: 'You can request another ride whenever you are ready.'
};

let profile;
let mapConfig;
let bookingMap;
let trackingMap;
let bookingLeafletMap;
let trackingLeafletMap;
let bookingDirections;
let trackingDirections;
let pickupAutocomplete;
let destinationAutocomplete;
let pickupMarker;
let destinationMarker;
let driverMarker;
let leafletPickupMarker;
let leafletDestinationMarker;
let leafletTrackingPickupMarker;
let leafletTrackingDestinationMarker;
let leafletTrackingDriverMarker;
let bookingLeafletRoute;
let trackingLeafletRoute;
let activeRideId = '';
let refreshTimer;
let rideClockTimer;
let bookingSubmitting = false;
let tripStartedAt;
let tripCompletedAt;
let trackedRouteRideId = '';
let serviceReady = false;
let estimatePending = false;
let fareEstimates;
let estimateKey = '';
let estimateRequest = 0;
let selectedMapTarget = 'pickup';
let bookingRouteRequest = 0;
let trackingRouteRequest = 0;
let driverListRequest = 0;
let availableDrivers = [];
let selectedDriverUid = '';
let geocoderLastRequest = 0;

function updateBookButton() {
    bookButton.disabled = bookingSubmitting;
}

function updateFareDisplay() {
    const selectedVehicle = form.elements.vehicleType.value;
    for (const option of document.querySelectorAll('input[name="vehicleType"]')) {
        const row = option.closest('.vehicle-option');
        const estimate = fareEstimates?.estimates.find((item) => item.vehicleType === option.value);
        row.querySelector('.vehicle-price').textContent = estimate
            ? `KSh ${estimate.fareKsh.toLocaleString()}`
            : 'Set your route';
    }
    if (fareEstimates) {
        const selected = fareEstimates.estimates.find((estimate) => estimate.vehicleType === selectedVehicle);
        const duration = formatDuration(fareEstimates.duration);
        distanceSummary.textContent = `Driving route: ${fareEstimates.distanceKm.toFixed(2)} km (${fareEstimates.billableKm} billed km).${duration ? ` Est. drive: ${duration}.` : ''} ${selected ? `${vehicleNames[selectedVehicle]} fare: KSh ${selected.fareKsh.toLocaleString()}.` : ''}`;
    }
    updateBookButton();
}

function formatDuration(duration) {
    const seconds = Number.parseFloat(String(duration || '').match(/\d+(?:\.\d+)?/)?.[0] || '');
    if (!Number.isFinite(seconds) || seconds <= 0) return '';
    const totalMinutes = Math.max(1, Math.ceil(seconds / 60));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return hours ? `${hours} hr${hours === 1 ? '' : 's'}${minutes ? ` ${minutes} min` : ''}` : `${totalMinutes} min`;
}

function renderAvailableDrivers() {
    const noPreference = document.createElement('button');
    noPreference.type = 'button';
    noPreference.className = `driver-option${selectedDriverUid ? '' : ' is-selected'}`;
    noPreference.setAttribute('aria-pressed', String(!selectedDriverUid));
    noPreference.textContent = 'Let PHYNEX find a driver';
    noPreference.addEventListener('click', () => {
        selectedDriverUid = '';
        renderAvailableDrivers();
    });

    driverOptions.replaceChildren(noPreference);
    for (const driver of availableDrivers) {
        const option = document.createElement('button');
        option.type = 'button';
        option.className = `driver-option${selectedDriverUid === driver.id ? ' is-selected' : ''}`;
        option.setAttribute('aria-pressed', String(selectedDriverUid === driver.id));
        const name = document.createElement('strong');
        name.textContent = driver.displayName || 'PHYNEX driver';
        const distance = document.createElement('small');
        distance.textContent = `About ${Number(driver.distanceKm).toFixed(1)} km away`;
        option.append(name, distance);
        option.addEventListener('click', () => {
            selectedDriverUid = driver.id;
            renderAvailableDrivers();
        });
        driverOptions.append(option);
    }
}

async function requestAvailableDrivers() {
    const pickup = locationFromInputs('pickup');
    const destination = locationFromInputs('destination');
    const requestId = ++driverListRequest;
    if (!pickup || !destination) {
        driverPicker.hidden = true;
        selectedDriverUid = '';
        availableDrivers = [];
        driverOptions.replaceChildren();
        return;
    }
    driverPicker.hidden = false;
    if (!serviceReady) {
        driverPickerMessage.textContent = 'Driver selection will be available when the ride service is ready.';
        availableDrivers = [];
        selectedDriverUid = '';
        renderAvailableDrivers();
        return;
    }

    driverPickerMessage.textContent = 'Finding nearby available drivers…';
    try {
        const params = new URLSearchParams({
            pickupLat: String(pickup.lat),
            pickupLng: String(pickup.lng)
        });
        const result = await authorizedFetch(`/api/rides/drivers?${params}`);
        if (requestId !== driverListRequest) return;
        availableDrivers = result.drivers;
        if (selectedDriverUid && !availableDrivers.some((driver) => driver.id === selectedDriverUid)) {
            selectedDriverUid = '';
            driverPickerMessage.textContent = 'Your selected driver is no longer available. Choose another or let PHYNEX find one.';
        } else {
            driverPickerMessage.textContent = availableDrivers.length
                ? 'Choose a nearby driver or let PHYNEX match you. Distance is approximate.'
                : 'No nearby drivers are online right now. You can still request automatic matching.';
        }
        renderAvailableDrivers();
    } catch (error) {
        if (requestId !== driverListRequest) return;
        availableDrivers = [];
        selectedDriverUid = '';
        renderAvailableDrivers();
        driverPickerMessage.textContent = `Could not load drivers: ${error.message} You can still request automatic matching.`;
    }
}

function displayFareRules(rules) {
    for (const [vehicleType, rule] of Object.entries(rules || {})) {
        const option = document.querySelector(`input[name="vehicleType"][value="${vehicleType}"]`);
        if (!option) continue;
        option.closest('.vehicle-option').querySelector('.vehicle-rate').textContent =
            `KSh ${rule.ratePerKmKsh}/km · min ${rule.minimumFareKsh}`;
    }
}

async function requestFareEstimate() {
    const pickup = locationFromInputs('pickup');
    const destination = locationFromInputs('destination');
    requestAvailableDrivers();
    const key = pickup && destination
        ? [pickup.lat, pickup.lng, destination.lat, destination.lng].join(',')
        : '';
    if (!key) {
        estimateRequest += 1;
        estimateKey = '';
        fareEstimates = undefined;
        estimatePending = false;
        distanceSummary.textContent = 'Choose a pickup and destination to see the distance and fare.';
        updateFareDisplay();
        return;
    }
    if (!serviceReady) {
        distanceSummary.textContent = 'Fare estimates are unavailable until the service is configured.';
        return;
    }
    if (key === estimateKey && (fareEstimates || estimatePending)) return;

    estimateKey = key;
    const requestId = ++estimateRequest;
    estimatePending = true;
    fareEstimates = undefined;
    distanceSummary.textContent = 'Calculating driving distance and fares…';
    updateFareDisplay();
    try {
        const result = await authorizedFetch('/api/rides/estimate', {
            method: 'POST',
            body: JSON.stringify({
                pickupLat: pickup.lat,
                pickupLng: pickup.lng,
                destinationLat: destination.lat,
                destinationLng: destination.lng
            })
        });
        if (requestId !== estimateRequest) return;
        fareEstimates = result;
        distanceSummary.textContent = '';
        updateFareDisplay();
    } catch (error) {
        if (requestId !== estimateRequest) return;
        estimateKey = '';
        distanceSummary.textContent = 'Could not calculate a fare for this route.';
        showMessage(formMessage, error.message);
    } finally {
        if (requestId === estimateRequest) {
            estimatePending = false;
            updateBookButton();
        }
    }
}

async function loadGoogleMaps(apiKey) {
    if (window.google?.maps?.places) return;
    await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places`;
        script.async = true;
        script.onload = resolve;
        script.onerror = () => reject(new Error('Google Maps could not be loaded. Check the Maps API key and billing settings.'));
        document.head.append(script);
    });
    if (!window.google?.maps?.places) {
        throw new Error('Google Maps Places is not enabled for this project.');
    }
}

function locationFromInputs(prefix) {
    const latitude = Number(document.querySelector(`#${prefix}-lat`).value);
    const longitude = Number(document.querySelector(`#${prefix}-lng`).value);
    return Number.isFinite(latitude) && Number.isFinite(longitude) && (
        document.querySelector(`#${prefix}-lat`).value !== ''
        && document.querySelector(`#${prefix}-lng`).value !== ''
    ) ? { lat: latitude, lng: longitude } : null;
}

function setLocationCoordinates(prefix, latitude, longitude, label) {
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90
        || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
        throw new Error('That location could not be selected. Please try another place.');
    }
    document.querySelector(`#${prefix}-lat`).value = String(latitude);
    document.querySelector(`#${prefix}-lng`).value = String(longitude);
    document.querySelector(`#${prefix}`).value = label;
    locationResults.replaceChildren();
    locationResults.hidden = true;
    formMessage.hidden = true;
    updateBookingMap();
    requestFareEstimate();
}

function setLocation(prefix, place, input) {
    const point = place.geometry?.location;
    if (!point) {
        document.querySelector(`#${prefix}-lat`).value = '';
        document.querySelector(`#${prefix}-lng`).value = '';
        showMessage(formMessage, 'Choose a location from the Google Maps suggestions.');
        updateBookingMap();
        requestFareEstimate();
        return;
    }
    setLocationCoordinates(
        prefix,
        typeof point.lat === 'function' ? point.lat() : point.lat,
        typeof point.lng === 'function' ? point.lng() : point.lng,
        place.formatted_address || place.name || input.value
    );
}

function getCurrentPosition() {
    if (!navigator.geolocation) {
        return Promise.reject(new Error('This device does not support GPS location.'));
    }
    return new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
            (position) => resolve({
                lat: position.coords.latitude,
                lng: position.coords.longitude
            }),
            () => reject(new Error('Location permission was denied or unavailable. You can still search for a pickup or tap the map.')),
            { enableHighAccuracy: true, maximumAge: 15_000, timeout: 15_000 }
        );
    });
}

async function queryOpenStreetMap(path) {
    const wait = Math.max(0, 1100 - (Date.now() - geocoderLastRequest));
    if (wait) await new Promise((resolve) => window.setTimeout(resolve, wait));
    geocoderLastRequest = Date.now();
    const response = await fetch(`https://nominatim.openstreetmap.org/${path}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(12_000)
    });
    if (!response.ok) throw new Error('Map search is temporarily unavailable. Please try again.');
    return response.json();
}

function showLocationMessage(text) {
    locationMessage.textContent = text;
    locationMessage.hidden = false;
}

async function searchLocation(prefix) {
    const input = document.querySelector(`#${prefix}`);
    const query = input.value.trim();
    if (query.length < 3) {
        showLocationMessage('Enter at least 3 characters to search for a place.');
        return;
    }
    const button = prefix === 'pickup' ? pickupSearchButton : destinationSearchButton;
    button.disabled = true;
    showLocationMessage(`Searching for ${prefix}…`);
    locationResults.replaceChildren();
    locationResults.hidden = true;
    try {
        const results = await queryOpenStreetMap(
            `search?format=jsonv2&addressdetails=1&limit=5&countrycodes=ke&q=${encodeURIComponent(query)}`
        );
        if (!results.length) {
            showLocationMessage('No places found. Try a nearby landmark or a more specific address.');
            return;
        }
        for (const result of results) {
            const option = document.createElement('button');
            option.type = 'button';
            option.className = 'location-result';
            option.setAttribute('role', 'option');
            option.textContent = result.display_name;
            option.addEventListener('click', () => {
                setLocationCoordinates(prefix, Number(result.lat), Number(result.lon), result.display_name);
                showLocationMessage(`${prefix === 'pickup' ? 'Pickup' : 'Destination'} set.`);
                input.focus();
            });
            locationResults.append(option);
        }
        locationResults.hidden = false;
        locationMessage.hidden = true;
    } catch (error) {
        showLocationMessage(error.message || 'Map search is temporarily unavailable.');
    } finally {
        button.disabled = false;
    }
}

async function setLocationFromPoint(prefix, point) {
    const latitude = typeof point.lat === 'function' ? point.lat() : point.lat;
    const longitude = typeof point.lng === 'function' ? point.lng() : point.lng;
    const coordinates = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
    if (window.google?.maps?.Geocoder) {
        const geocoder = new google.maps.Geocoder();
        try {
            const result = await geocoder.geocode({ location: { lat: latitude, lng: longitude } });
            const place = result.results?.find((item) => item.formatted_address) || result.results?.[0];
            setLocationCoordinates(prefix, latitude, longitude, place?.formatted_address || coordinates);
        } catch (error) {
            setLocationCoordinates(prefix, latitude, longitude, coordinates);
            showLocationMessage(`Location saved as ${coordinates}; its address could not be loaded.`);
        }
        return;
    }

    setLocationCoordinates(prefix, latitude, longitude, coordinates);
    try {
        const results = await queryOpenStreetMap(
            `reverse?format=jsonv2&lat=${encodeURIComponent(latitude)}&lon=${encodeURIComponent(longitude)}`
        );
        if (results.display_name) {
            setLocationCoordinates(prefix, latitude, longitude, results.display_name);
        }
    } catch (error) {
        showLocationMessage(`Location saved as ${coordinates}; its address could not be loaded.`);
    }
}

async function useCurrentLocation(showFailure = true) {
    currentLocationButton.disabled = true;
    currentLocationButton.textContent = 'Getting your location…';
    locationMessage.hidden = true;
    try {
        const point = await getCurrentPosition();
        await setLocationFromPoint('pickup', point);
        showLocationMessage('Pickup set to your current location.');
    } catch (error) {
        if (showFailure) {
            showLocationMessage(error.message);
        }
    } finally {
        currentLocationButton.disabled = false;
        currentLocationButton.textContent = 'Use my current location';
    }
}

function updateBookingMap() {
    const pickup = locationFromInputs('pickup');
    const destination = locationFromInputs('destination');
    const requestId = ++bookingRouteRequest;
    if (bookingLeafletMap) {
        const makeMarker = (point, label, className) => L.marker(point, {
            icon: L.divIcon({
                className: '',
                html: `<span class="ride-map-marker ${className}"><span>${label}</span></span>`,
                iconSize: [28, 28],
                iconAnchor: [14, 28]
            })
        }).addTo(bookingLeafletMap);
        if (pickup) {
            if (leafletPickupMarker) leafletPickupMarker.setLatLng(pickup);
            else leafletPickupMarker = makeMarker(pickup, 'P', 'pickup-marker');
        } else if (leafletPickupMarker) {
            bookingLeafletMap.removeLayer(leafletPickupMarker);
            leafletPickupMarker = undefined;
        }
        if (destination) {
            if (leafletDestinationMarker) leafletDestinationMarker.setLatLng(destination);
            else leafletDestinationMarker = makeMarker(destination, 'D', 'destination-marker');
        } else if (leafletDestinationMarker) {
            bookingLeafletMap.removeLayer(leafletDestinationMarker);
            leafletDestinationMarker = undefined;
        }
        if (pickup && destination) {
            bookingLeafletMap.fitBounds([pickup, destination], { padding: [35, 35], maxZoom: 15 });
            if (bookingLeafletRoute) bookingLeafletMap.removeLayer(bookingLeafletRoute);
            document.querySelector('#booking-map-notice').textContent = 'Drawing the road route…';
            document.querySelector('#booking-map-notice').hidden = false;
            getRoadRoute(pickup, destination).then((coordinates) => {
                if (requestId !== bookingRouteRequest) return;
                bookingLeafletRoute = L.polyline(coordinates, {
                    color: '#078c3d',
                    weight: 5,
                    opacity: 0.88
                }).addTo(bookingLeafletMap);
                bookingLeafletMap.fitBounds(bookingLeafletRoute.getBounds(), { padding: [35, 35], maxZoom: 15 });
                document.querySelector('#booking-map-notice').hidden = true;
            }).catch((error) => {
                if (requestId !== bookingRouteRequest) return;
                document.querySelector('#booking-map-notice').textContent = error.message;
                document.querySelector('#booking-map-notice').hidden = false;
            });
        } else if (pickup || destination) {
            if (bookingLeafletRoute) {
                bookingLeafletMap.removeLayer(bookingLeafletRoute);
                bookingLeafletRoute = undefined;
            }
            bookingLeafletMap.setView(pickup || destination, 14);
        } else if (bookingLeafletRoute) {
            bookingLeafletMap.removeLayer(bookingLeafletRoute);
            bookingLeafletRoute = undefined;
        }
        return;
    }
    if (!bookingMap || !window.google?.maps) return;
    const bounds = new google.maps.LatLngBounds();

    if (pickup) {
        pickupMarker.setPosition(pickup);
        pickupMarker.setVisible(true);
        bounds.extend(pickup);
    } else {
        pickupMarker.setVisible(false);
    }
    if (destination) {
        destinationMarker.setPosition(destination);
        destinationMarker.setVisible(true);
        bounds.extend(destination);
    } else {
        destinationMarker.setVisible(false);
    }

    if (pickup && destination) {
        bookingMap.fitBounds(bounds, 50);
        bookingDirections.route({
            origin: pickup,
            destination,
            travelMode: google.maps.TravelMode.DRIVING
        }).then((result) => {
            if (requestId === bookingRouteRequest) bookingDirections.setDirections(result);
        }).catch(() => {
            if (requestId === bookingRouteRequest) {
                const notice = document.querySelector('#booking-map-notice');
                notice.textContent = 'Google Maps could not display this driving route. Check the locations and try again.';
                notice.hidden = false;
            }
        });
    } else if (pickup || destination) {
        if (bookingDirections) bookingDirections.set('directions', null);
        bookingMap.setCenter(pickup || destination);
        bookingMap.setZoom(14);
    } else if (bookingDirections) {
        bookingDirections.set('directions', null);
    }
}

function initializeBookingMap() {
    bookingMap = new google.maps.Map(document.querySelector('#booking-map'), {
        center: { lat: -1.286389, lng: 36.817223 },
        zoom: 12,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: true
    });
    pickupMarker = new google.maps.Marker({ map: bookingMap, label: 'P', visible: false });
    destinationMarker = new google.maps.Marker({ map: bookingMap, label: 'D', visible: false });
    bookingDirections = new google.maps.DirectionsRenderer({ map: bookingMap, suppressMarkers: true });

    const pickupInput = document.querySelector('#pickup');
    const destinationInput = document.querySelector('#destination');
    pickupAutocomplete = new google.maps.places.Autocomplete(pickupInput, {
        componentRestrictions: { country: 'ke' },
        fields: ['formatted_address', 'geometry', 'name']
    });
    destinationAutocomplete = new google.maps.places.Autocomplete(destinationInput, {
        componentRestrictions: { country: 'ke' },
        fields: ['formatted_address', 'geometry', 'name']
    });
    pickupAutocomplete.addListener('place_changed', () => setLocation('pickup', pickupAutocomplete.getPlace(), pickupInput));
    destinationAutocomplete.addListener('place_changed', () => setLocation('destination', destinationAutocomplete.getPlace(), destinationInput));
    bookingMap.addListener('click', (event) => {
        if (!event.latLng) return;
        setLocationFromPoint(selectedMapTarget, event.latLng).catch((error) => {
            showMessage(formMessage, error.message || 'That map location could not be selected.');
        });
    });

}

async function loadLeaflet() {
    if (window.L) return;
    const stylesheet = document.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    const styleLoaded = new Promise((resolve, reject) => {
        stylesheet.onload = resolve;
        stylesheet.onerror = () => reject(new Error('The map style could not be loaded.'));
    });
    document.head.append(stylesheet);
    await styleLoaded;

    await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
        script.async = true;
        script.onload = resolve;
        script.onerror = () => reject(new Error('The interactive map could not be loaded.'));
        document.head.append(script);
    });
    if (!window.L) throw new Error('The interactive map is unavailable.');
}

async function getRoadRoute(pickup, destination) {
    const coordinates = `${pickup.lng},${pickup.lat};${destination.lng},${destination.lat}`;
    const response = await fetch(
        `https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=false`,
        { signal: AbortSignal.timeout(12_000) }
    );
    if (!response.ok) throw new Error('Road directions are temporarily unavailable.');
    const result = await response.json();
    const route = result.code === 'Ok' ? result.routes?.[0] : null;
    if (!Array.isArray(route?.geometry?.coordinates) || route.geometry.coordinates.length < 2) {
        throw new Error('No road route was found between those locations.');
    }
    return route.geometry.coordinates.map(([longitude, latitude]) => [latitude, longitude]);
}

async function initializeOpenStreetMap() {
    await loadLeaflet();
    const center = [-1.286389, 36.817223];
    bookingLeafletMap = L.map(document.querySelector('#booking-map')).setView(center, 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>'
    }).addTo(bookingLeafletMap);
    bookingLeafletMap.on('click', (event) => {
        setLocationFromPoint(selectedMapTarget, event.latlng).catch((error) => {
            showLocationMessage(error.message || 'That map location could not be selected.');
        });
    });
    trackingLeafletMap = L.map(document.querySelector('#tracking-map'), {
        zoomControl: false,
        attributionControl: false
    }).setView(center, 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(trackingLeafletMap);
    document.querySelector('#booking-map-notice').hidden = true;
    document.querySelector('#tracking-map-notice').hidden = true;
    mapAttribution.textContent = 'Map data © OpenStreetMap contributors.';
    updateBookingMap();
}

function updateTrackingMap(ride) {
    const pickup = { lat: ride.pickupLat, lng: ride.pickupLng };
    const destination = { lat: ride.destinationLat, lng: ride.destinationLng };
    if (trackingLeafletMap && !window.google?.maps) {
        const makeMarker = (point, label, className) => L.marker(point, {
            icon: L.divIcon({
                className: '',
                html: `<span class="ride-map-marker ${className}"><span>${label}</span></span>`,
                iconSize: [28, 28],
                iconAnchor: [14, 28]
            })
        }).addTo(trackingLeafletMap);
        if (trackedRouteRideId !== ride.id) {
            trackingRouteRequest += 1;
            trackedRouteRideId = ride.id;
            for (const marker of [
                leafletTrackingPickupMarker,
                leafletTrackingDestinationMarker,
                leafletTrackingDriverMarker
            ]) {
                if (marker) trackingLeafletMap.removeLayer(marker);
            }
            if (trackingLeafletRoute) trackingLeafletMap.removeLayer(trackingLeafletRoute);
            leafletTrackingDriverMarker = undefined;
            leafletTrackingPickupMarker = makeMarker(pickup, 'P', 'pickup-marker');
            leafletTrackingDestinationMarker = makeMarker(destination, 'D', 'destination-marker');
            trackingLeafletMap.fitBounds([pickup, destination], { padding: [25, 25], maxZoom: 15 });
            const requestId = ++trackingRouteRequest;
            document.querySelector('#tracking-map-notice').textContent = 'Drawing the road route…';
            document.querySelector('#tracking-map-notice').hidden = false;
            getRoadRoute(pickup, destination).then((coordinates) => {
                if (requestId !== trackingRouteRequest) return;
                trackingLeafletRoute = L.polyline(coordinates, {
                    color: '#078c3d',
                    weight: 5,
                    opacity: 0.88
                }).addTo(trackingLeafletMap);
                trackingLeafletMap.fitBounds(trackingLeafletRoute.getBounds(), { padding: [25, 25], maxZoom: 15 });
                document.querySelector('#tracking-map-notice').hidden = true;
            }).catch((error) => {
                if (requestId !== trackingRouteRequest) return;
                document.querySelector('#tracking-map-notice').textContent = error.message;
                document.querySelector('#tracking-map-notice').hidden = false;
            });
        }
        const hasRecentLocation = ride.driverLat !== null
            && ride.driverLat !== undefined
            && ride.driverLng !== null
            && ride.driverLng !== undefined
            && ride.driverLocationAt
            && Date.now() - new Date(ride.driverLocationAt).getTime() < 120_000;
        if (hasRecentLocation) {
            const location = [ride.driverLat, ride.driverLng];
            if (leafletTrackingDriverMarker) leafletTrackingDriverMarker.setLatLng(location);
            else leafletTrackingDriverMarker = makeMarker(location, 'D', 'driver-marker');
        } else if (leafletTrackingDriverMarker) {
            trackingLeafletMap.removeLayer(leafletTrackingDriverMarker);
            leafletTrackingDriverMarker = undefined;
        }
        return;
    }
    if (!trackingMap || !window.google?.maps) return;
    if (trackedRouteRideId !== ride.id) {
        trackedRouteRideId = ride.id;
        const requestId = ++trackingRouteRequest;
        trackingDirections.route({
            origin: pickup,
            destination,
            travelMode: google.maps.TravelMode.DRIVING
        }).then((result) => {
            if (requestId === trackingRouteRequest) trackingDirections.setDirections(result);
        }).catch(() => {
            if (requestId !== trackingRouteRequest) return;
            const notice = document.querySelector('#tracking-map-notice');
            notice.textContent = 'Route directions are temporarily unavailable.';
            notice.hidden = false;
        });
    }

    const hasRecentLocation = ride.driverLat !== null
        && ride.driverLat !== undefined
        && ride.driverLng !== null
        && ride.driverLng !== undefined
        && ride.driverLocationAt
        && Date.now() - new Date(ride.driverLocationAt).getTime() < 120_000;
    if (hasRecentLocation) {
        const location = { lat: ride.driverLat, lng: ride.driverLng };
        if (!driverMarker) {
            driverMarker = new google.maps.Marker({
                map: trackingMap,
                title: 'Your driver',
                label: 'D',
                zIndex: 5
            });
        }
        driverMarker.setPosition(location);
        driverMarker.setVisible(true);
    } else if (driverMarker) {
        driverMarker.setVisible(false);
    }
}

function showMessage(element, message) {
    element.textContent = message;
    element.hidden = false;
}

function renderRide(ride) {
    bookingCard.hidden = true;
    trackingCard.hidden = false;
    trackingError.hidden = true;
    const mpesaFailed = ride.status === 'requested'
        && ride.paymentMethod === 'mpesa'
        && ride.paymentStatus === 'failed';
    const mpesaWaiting = ride.status === 'requested'
        && ride.paymentMethod === 'mpesa'
        && !['paid', 'failed'].includes(ride.paymentStatus);
    document.querySelector('#ride-status').textContent = mpesaFailed
        ? 'M-Pesa payment failed'
        : mpesaWaiting
            ? 'Waiting for M-Pesa payment'
            : statusNames[ride.status] || ride.status;
    document.querySelector('#tracking-title').textContent = mpesaFailed
        ? 'Payment was not confirmed'
        : mpesaWaiting
            ? 'Approve the payment request'
            : rideTitles[ride.status] || 'Your ride is on its way';
    document.querySelector('#tracking-pickup').textContent = ride.pickup;
    document.querySelector('#tracking-destination').textContent = ride.destination;
    document.querySelector('#tracking-vehicle').textContent = vehicleNames[ride.vehicleType] || ride.vehicleType;
    document.querySelector('#tracking-distance').textContent = Number.isFinite(Number(ride.distanceKm))
        ? `${Number(ride.distanceKm).toFixed(2)} km`
        : 'Not available';
    updateTripClock(ride);
    document.querySelector('#tracking-fare').textContent = `KSh ${ride.fareKsh.toLocaleString()}`;
    document.querySelector('#tracking-driver').textContent = ride.driverName || 'Your driver is on the way';
    document.querySelector('#driver-detail').hidden = !ride.driverName;
    document.querySelector('#tracking-payment').textContent = ride.paymentMethod === 'mpesa'
        ? ride.paymentStatus === 'failed'
            ? 'M-Pesa payment failed'
            : ride.paymentStatus === 'paid'
                ? `M-Pesa paid${ride.mpesaReceipt ? ` · ${ride.mpesaReceipt}` : ''}`
                : 'M-Pesa payment pending'
        : ride.paymentStatus === 'paid'
            ? 'Cash paid to driver'
            : 'Cash due to driver';
    const callDriver = document.querySelector('#call-driver');
    callDriver.hidden = !ride.driverPhone || !['accepted', 'en_route', 'in_progress'].includes(ride.status);
    if (!callDriver.hidden) {
        callDriver.href = `tel:${ride.driverPhone}`;
        callDriver.textContent = 'Call your driver';
    }
    document.querySelector('#tracking-message').textContent = mpesaFailed
        ? 'The payment was not confirmed. Cancel this request and book again, or contact PHYNEX RIDE support.'
        : mpesaWaiting
            ? 'Approve the M-Pesa prompt sent to your verified phone. Your ride will be offered to drivers after confirmation.'
            : rideMessages[ride.status] || 'You can request another ride whenever you are ready.';

    const order = ['requested', 'accepted', 'in_progress', 'completed'];
    const currentIndex = ride.status === 'en_route' ? 1 : order.indexOf(ride.status);
    document.querySelectorAll('.progress-step').forEach((step) => {
        const index = order.indexOf(step.dataset.status);
        step.classList.toggle('is-done', currentIndex >= 0 && index < currentIndex);
        step.classList.toggle('is-current', index === currentIndex);
    });

    cancelButton.hidden = ride.status !== 'requested' || ride.paymentProcessing;
    anotherButton.hidden = !['completed', 'cancelled'].includes(ride.status);
    updateTrackingMap(ride);
    if (trackingMap) google.maps.event.trigger(trackingMap, 'resize');
    else if (trackingLeafletMap) trackingLeafletMap.invalidateSize();
}

function updateTripClock(ride) {
    const timeDetail = document.querySelector('#ride-time-detail');
    const startedAt = Date.parse(ride.startedAt);
    if (!Number.isFinite(startedAt) || !['in_progress', 'completed'].includes(ride.status)) {
        window.clearInterval(rideClockTimer);
        rideClockTimer = undefined;
        timeDetail.hidden = true;
        return;
    }

    tripStartedAt = startedAt;
    tripCompletedAt = ride.status === 'completed' && ride.completedAt
        ? Date.parse(ride.completedAt)
        : undefined;
    const update = () => {
        const elapsedSeconds = Math.max(0, Math.floor(((tripCompletedAt || Date.now()) - tripStartedAt) / 1000));
        const hours = Math.floor(elapsedSeconds / 3600);
        const minutes = Math.floor((elapsedSeconds % 3600) / 60);
        const seconds = elapsedSeconds % 60;
        document.querySelector('#tracking-time').textContent = [
            String(hours).padStart(2, '0'),
            String(minutes).padStart(2, '0'),
            String(seconds).padStart(2, '0')
        ].join(':');
    };
    timeDetail.hidden = false;
    update();
    if (ride.status === 'completed') {
        window.clearInterval(rideClockTimer);
        rideClockTimer = undefined;
    } else if (!rideClockTimer) {
        rideClockTimer = window.setInterval(update, 1000);
    }
}

async function refreshRide() {
    if (!activeRideId) return;
    try {
        const { ride } = await authorizedFetch(`/api/rides/${encodeURIComponent(activeRideId)}`);
        renderRide(ride);
        if (['completed', 'cancelled'].includes(ride.status)) {
            window.clearInterval(refreshTimer);
            window.clearInterval(rideClockTimer);
            rideClockTimer = undefined;
        }
    } catch (error) {
        showMessage(trackingError, error.message);
        window.clearInterval(refreshTimer);
    }
}

function startTracking(rideId) {
    if (activeRideId !== rideId) trackedRouteRideId = '';
    activeRideId = rideId;
    window.localStorage.setItem(`phynexRide:${profile.id}`, rideId);
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set('ride', rideId);
    window.history.replaceState({}, '', nextUrl);
    bookingCard.hidden = true;
    trackingCard.hidden = false;
    window.clearInterval(refreshTimer);
    refreshRide();
    refreshTimer = window.setInterval(refreshRide, 5000);
}

async function initialize() {
    let config;
    try {
        config = await getPublicConfig();
        displayFareRules(config.fareRules);
        if (config.mapsReady) {
            try {
                await loadGoogleMaps(config.mapsBrowserApiKey);
                initializeBookingMap();
                trackingMap = new google.maps.Map(document.querySelector('#tracking-map'), {
                    center: { lat: -1.286389, lng: 36.817223 },
                    zoom: 12,
                    mapTypeControl: false,
                    streetViewControl: false,
                    fullscreenControl: false
                });
                trackingDirections = new google.maps.DirectionsRenderer({
                    map: trackingMap,
                    suppressMarkers: true
                });
                document.querySelector('#booking-map-notice').hidden = true;
                document.querySelector('#tracking-map-notice').hidden = true;
            } catch (error) {
                await initializeOpenStreetMap();
                showLocationMessage('Google Maps is unavailable. Using OpenStreetMap instead.');
            }
        } else {
            await initializeOpenStreetMap();
        }

        if (!config.databaseReady) {
            showMessage(serviceMessage, 'The service database is not configured or could not be reached. Booking is temporarily unavailable.');
            return;
        }
        if (!config.firebaseReady) {
            showMessage(serviceMessage, 'Secure sign-in is unavailable. Please contact PHYNEX RIDE support.');
            return;
        }
        profile = await requireRole('customer');
        if (!profile) return;
        serviceReady = Boolean(config.routesReady);
        document.querySelector('#account-name').textContent = profile.displayName || profile.phone;
        document.querySelector('#customer-name').value = profile.displayName;
        if (!profile.displayName) {
            showMessage(serviceMessage, 'Add your full name to your account before booking.');
        }
        if (!config.mpesaReady) {
            const mpesaInput = mpesaOption.querySelector('input');
            mpesaInput.disabled = true;
            mpesaOption.title = 'M-Pesa is not configured for this service.';
        }
        if (!config.routesReady) {
            showMessage(serviceMessage, 'Server-side route pricing is not configured. Location search and map selection are available, but booking is temporarily unavailable.');
        } else {
            serviceReady = true;
            await useCurrentLocation(false);
        }
        updateBookButton();

        const initialRideId = new URLSearchParams(window.location.search).get('ride')
            || window.localStorage.getItem(`phynexRide:${profile.id}`);
        if (initialRideId) startTracking(initialRideId);
    } catch (error) {
        serviceReady = false;
        try {
            if (!bookingLeafletMap && !bookingMap) await initializeOpenStreetMap();
        } catch (mapError) {
            document.querySelector('#booking-map-notice').textContent = 'The map could not be loaded. Search for a pickup or destination instead.';
            document.querySelector('#tracking-map-notice').textContent = 'The map is unavailable.';
            pickupMapButton.disabled = true;
            destinationMapButton.disabled = true;
        }
        showMessage(serviceMessage, 'Ride service settings could not be reached. Location selection is available; sign-in, fare estimates, and booking require the app server.');
        updateBookButton();
    }
}

form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!serviceReady) {
        showMessage(formMessage, 'Ride booking is unavailable because the service is not configured. Please try again later or contact support.');
        return;
    }
    if (estimatePending) {
        showMessage(formMessage, 'Your fare is still being calculated. Please wait a moment and try again.');
        return;
    }
    if (!fareEstimates) {
        showMessage(formMessage, 'Choose a pickup and destination and wait for the fare estimate before booking.');
        return;
    }
    formMessage.hidden = true;
    bookingSubmitting = true;
    updateBookButton();
    bookButton.textContent = 'Requesting ride…';
    const values = new FormData(form);

    try {
        const displayName = String(values.get('customerName') || '').trim();
        const { profile: updatedProfile } = await authorizedFetch('/api/auth/profile', {
            method: 'PATCH',
            body: JSON.stringify({ displayName })
        });
        profile = updatedProfile;
        document.querySelector('#account-name').textContent = profile.displayName;

        const { ride } = await authorizedFetch('/api/rides', {
            method: 'POST',
            body: JSON.stringify({
                pickup: values.get('pickup'),
                pickupLat: values.get('pickupLat'),
                pickupLng: values.get('pickupLng'),
                destination: values.get('destination'),
                destinationLat: values.get('destinationLat'),
                destinationLng: values.get('destinationLng'),
                vehicleType: values.get('vehicleType'),
                paymentMethod: values.get('paymentMethod'),
                driverUid: selectedDriverUid || undefined
            })
        });
        startTracking(ride.id);
        if (ride.paymentMethod === 'mpesa') {
            try {
                await authorizedFetch(`/api/rides/${encodeURIComponent(ride.id)}/mpesa-payment`, { method: 'POST' });
                await refreshRide();
            } catch (error) {
                showMessage(trackingError, error.message);
            }
        }
    } catch (error) {
        showMessage(formMessage, error.message);
    } finally {
        bookButton.innerHTML = 'Find a Driver <span aria-hidden="true">→</span>';
        bookingSubmitting = false;
        updateBookButton();
    }
});

currentLocationButton.addEventListener('click', () => useCurrentLocation());

function selectMapTarget(target) {
    selectedMapTarget = target;
    const pickupSelected = target === 'pickup';
    pickupMapButton.classList.toggle('is-selected', pickupSelected);
    pickupMapButton.setAttribute('aria-pressed', String(pickupSelected));
    destinationMapButton.classList.toggle('is-selected', !pickupSelected);
    destinationMapButton.setAttribute('aria-pressed', String(!pickupSelected));
}

pickupMapButton.addEventListener('click', () => selectMapTarget('pickup'));
destinationMapButton.addEventListener('click', () => selectMapTarget('destination'));
pickupSearchButton.addEventListener('click', () => searchLocation('pickup'));
destinationSearchButton.addEventListener('click', () => searchLocation('destination'));
for (const prefix of ['pickup', 'destination']) {
    document.querySelector(`#${prefix}`).addEventListener('input', () => {
        document.querySelector(`#${prefix}-lat`).value = '';
        document.querySelector(`#${prefix}-lng`).value = '';
        locationResults.replaceChildren();
        locationResults.hidden = true;
        updateBookingMap();
        requestFareEstimate();
    });
    document.querySelector(`#${prefix}`).addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !locationResults.hidden) {
            event.preventDefault();
            locationResults.querySelector('.location-result')?.click();
        }
    });
}
form.addEventListener('change', (event) => {
    if (event.target.matches('input[name="vehicleType"]')) updateFareDisplay();
});

cancelButton.addEventListener('click', async () => {
    cancelButton.disabled = true;
    try {
        const { ride } = await authorizedFetch(`/api/rides/${encodeURIComponent(activeRideId)}/cancel`, {
            method: 'PATCH'
        });
        renderRide(ride);
        window.clearInterval(refreshTimer);
    } catch (error) {
        showMessage(trackingError, error.message);
    } finally {
        cancelButton.disabled = false;
    }
});

anotherButton.addEventListener('click', () => {
    window.clearInterval(refreshTimer);
    window.localStorage.removeItem(`phynexRide:${profile.id}`);
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.delete('ride');
    window.history.replaceState({}, '', nextUrl);
    activeRideId = '';
    trackedRouteRideId = '';
    selectedDriverUid = '';
    availableDrivers = [];
    driverPicker.hidden = true;
    driverOptions.replaceChildren();
    window.clearInterval(rideClockTimer);
    rideClockTimer = undefined;
    fareEstimates = undefined;
    estimateKey = '';
    estimateRequest += 1;
    estimatePending = false;
    distanceSummary.textContent = 'Choose a pickup and destination to see the distance and fare.';
    for (const option of document.querySelectorAll('input[name="vehicleType"]')) {
        option.closest('.vehicle-option').querySelector('.vehicle-price').textContent = 'Set your route';
    }
    form.reset();
    document.querySelector('#pickup-lat').value = '';
    document.querySelector('#pickup-lng').value = '';
    document.querySelector('#destination-lat').value = '';
    document.querySelector('#destination-lng').value = '';
    document.querySelector('#customer-name').value = profile.displayName;
    bookingCard.hidden = false;
    trackingCard.hidden = true;
    formMessage.hidden = true;
    if (bookingMap || bookingLeafletMap) updateBookingMap();
    if (bookingDirections) bookingDirections.set('directions', null);
    requestAvailableDrivers();
    updateBookButton();
    window.scrollTo({ top: 0, behavior: 'smooth' });
});

signOutButton.addEventListener('click', async () => {
    signOutButton.disabled = true;
    try {
        await signOut();
    } catch (error) {
        showMessage(serviceMessage, error.message);
        signOutButton.disabled = false;
    }
});

updateBookButton();
initialize();
