import { authReady, authorizedFetch, requireRole, signOut } from '/auth.js';

const toggleButton = document.querySelector('#online-toggle');
const toggleLabel = document.querySelector('#online-label');
const driverName = document.querySelector('#driver-name');
const availabilityStat = document.querySelector('#availability-stat');
const activeCount = document.querySelector('#active-count');
const earningsStat = document.querySelector('#earnings-stat');
const requestCount = document.querySelector('#request-count');
const activePill = document.querySelector('#active-pill');
const requestList = document.querySelector('#request-list');
const activeList = document.querySelector('#active-list');
const requestEmpty = document.querySelector('#request-empty');
const activeEmpty = document.querySelector('#active-empty');
const message = document.querySelector('#driver-message');
const locationStatus = document.querySelector('#location-status');
const signOutButton = document.querySelector('#sign-out');

const vehicleNames = { car: 'Car', bike: 'Bike' };
const statusNames = { accepted: 'Accepted', en_route: 'Driver en route', in_progress: 'Ride in progress' };
const nextActions = {
    accepted: { label: 'Start pickup', next: 'advance' },
    en_route: { label: 'Start ride', next: 'advance' },
    in_progress: { label: 'Confirm fare & complete', next: 'advance' }
};

let online = false;
let refreshTimer;
let positionWatch;
let locationTimer;
let lastPositionSent = 0;
let busy = false;
async function requestJson(url, options = {}) {
    return authorizedFetch(url, options);
}

function showError(error) {
    message.textContent = error.message;
    message.hidden = false;
}

function makeElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
}

function createRideCard(ride, active) {
    const card = makeElement('article', 'ride-card');
    const top = makeElement('div', 'ride-card-top');
    top.append(
        makeElement('strong', '', active ? (statusNames[ride.status] || 'Active ride') : `${ride.customerName} · ${vehicleNames[ride.vehicleType]}`),
        makeElement('span', 'ride-time', `#${ride.id.slice(0, 6).toUpperCase()}`)
    );
    card.append(top);

    const route = makeElement('div', 'ride-route');
    route.append(makeElement('span', '', ride.pickup), makeElement('span', '', ride.destination));
    card.append(route);

    const fare = makeElement('div', 'ride-fare-line');
    const distance = ride.distanceKm != null && Number.isFinite(Number(ride.distanceKm))
        ? `${Number(ride.distanceKm).toFixed(2)} km`
        : 'Distance unavailable';
    fare.append(
        makeElement('span', '', `${vehicleNames[ride.vehicleType] || ride.vehicleType} · ${distance}`),
        makeElement('strong', '', `KSh ${ride.fareKsh.toLocaleString()}`)
    );
    card.append(fare);

    if (active && ride.customerPhone) {
        const contact = makeElement('a', 'contact-link', 'Call rider');
        contact.href = `tel:${ride.customerPhone}`;
        card.append(contact);
    }

    const destination = active && ['in_progress'].includes(ride.status)
        ? `${ride.destinationLat},${ride.destinationLng}`
        : `${ride.pickupLat},${ride.pickupLng}`;
    const navigate = makeElement('a', 'navigate-link', active && ride.status === 'in_progress' ? 'Navigate to destination' : 'Navigate to pickup');
    navigate.href = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=driving`;
    navigate.target = '_blank';
    navigate.rel = 'noopener noreferrer';
    card.append(navigate);

    const action = active ? nextActions[ride.status] : { label: 'Accept ride', next: 'accept' };
    if (action) {
        const button = makeElement('button', `ride-action${active ? ' secondary-action' : ''}`, action.label);
        button.type = 'button';
        button.addEventListener('click', () => performRideAction(ride.id, action.next, button));
        card.append(button);
    }
    return card;
}

async function loadDashboard() {
    if (busy) return;
    try {
        const [rides, { summary, driver }] = await Promise.all([
            requestJson('/api/driver/rides'),
            requestJson('/api/driver/summary')
        ]);
        if (!driver) throw new Error('Your driver account is not activated. Contact PHYNEX RIDE operations.');
        online = Boolean(driver.online);
        driverName.textContent = driver.displayName || 'Driver';
        toggleButton.classList.toggle('is-online', online);
        toggleButton.setAttribute('aria-pressed', String(online));
        toggleLabel.textContent = online ? 'You are online' : 'Go online';
        availabilityStat.textContent = online ? 'Online' : 'Offline';
        locationStatus.textContent = online ? 'Your live location is shared while you are online.' : '';
        activeCount.textContent = String(summary.activeRides);
        earningsStat.textContent = Number(summary.completedFares).toLocaleString();
        requestCount.textContent = String(rides.available.length);
        activePill.textContent = String(rides.active.length);

        requestList.replaceChildren(...(online ? rides.available.map((ride) => createRideCard(ride, false)) : []));
        activeList.replaceChildren(...rides.active.map((ride) => createRideCard(ride, true)));
        requestEmpty.hidden = online && rides.available.length > 0;
        requestEmpty.querySelector('p').textContent = online
            ? 'New ride requests will appear here when customers book.'
            : 'Switch online to see nearby requests.';
        activeEmpty.hidden = rides.active.length > 0;
    } catch (error) {
        showError(error);
    }
}

function getCurrentPosition() {
    if (!navigator.geolocation) {
        return Promise.reject(new Error('This device does not support GPS location.'));
    }
    return new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
            (position) => resolve(position.coords),
            () => reject(new Error('Location permission is needed to go online. Enable location access and try again.')),
            { enableHighAccuracy: true, maximumAge: 10_000, timeout: 15_000 }
        );
    });
}

function startLocationUpdates() {
    if (!navigator.geolocation || positionWatch !== undefined) return;
    const sendLocation = async (coords) => {
        if (!online || Date.now() - lastPositionSent < 20_000) return;
        lastPositionSent = Date.now();
        try {
            await requestJson('/api/driver/location', {
                method: 'PUT',
                body: JSON.stringify({
                    latitude: coords.latitude,
                    longitude: coords.longitude
                })
            });
        } catch (error) {
            locationStatus.textContent = error.message;
        }
    };
    positionWatch = navigator.geolocation.watchPosition((position) => {
        sendLocation(position.coords);
    }, () => {
        locationStatus.textContent = 'GPS location stopped. Go offline and re-enable location before accepting trips.';
    }, { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 });
    locationTimer = window.setInterval(async () => {
        if (!online) return;
        try {
            const coords = await getCurrentPosition();
            await sendLocation(coords);
        } catch (error) {
            locationStatus.textContent = error.message;
        }
    }, 30_000);
}

function stopLocationUpdates() {
    if (positionWatch !== undefined) {
        navigator.geolocation.clearWatch(positionWatch);
        positionWatch = undefined;
    }
    window.clearInterval(locationTimer);
    locationTimer = undefined;
}

async function performRideAction(id, action, button) {
    message.hidden = true;
    button.disabled = true;
    busy = true;
    try {
        await requestJson(`/api/driver/rides/${encodeURIComponent(id)}/${action}`, { method: 'POST' });
        busy = false;
        await loadDashboard();
    } catch (error) {
        showError(error);
    } finally {
        busy = false;
        button.disabled = false;
    }
}

toggleButton.addEventListener('click', async () => {
    message.hidden = true;
    toggleButton.disabled = true;
    busy = true;
    try {
        const location = online ? null : await getCurrentPosition();
        await requestJson('/api/driver/online', {
            method: 'PUT',
            body: JSON.stringify({
                online: !online,
                ...(location ? {
                    latitude: location.latitude,
                    longitude: location.longitude
                } : {})
            })
        });
        online = !online;
        if (online) startLocationUpdates();
        else stopLocationUpdates();
        busy = false;
        await loadDashboard();
    } catch (error) {
        showError(error);
    } finally {
        busy = false;
        toggleButton.disabled = false;
    }
});

async function initialize() {
    try {
        const { available } = await authReady;
        if (!available) throw new Error('Secure phone sign-in is not configured for this service.');
        const profile = await requireRole('driver');
        if (!profile) return;
        driverName.textContent = profile.displayName || 'Driver';
        await loadDashboard();
        if (online) startLocationUpdates();
        refreshTimer = window.setInterval(loadDashboard, 15000);
    } catch (error) {
        showError(error);
    }
}

signOutButton.addEventListener('click', async () => {
    signOutButton.disabled = true;
    try {
        if (online) {
            await requestJson('/api/driver/online', {
                method: 'PUT',
                body: JSON.stringify({ online: false })
            });
            stopLocationUpdates();
            online = false;
        }
        await signOut();
    } catch (error) {
        showError(error);
        signOutButton.disabled = false;
    }
});

initialize();
window.addEventListener('pagehide', () => {
    window.clearInterval(refreshTimer);
    stopLocationUpdates();
});
