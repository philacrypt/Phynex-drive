import { authReady, authorizedFetch, requireRole, signOut } from '/auth.js';

const adminError = document.querySelector('#admin-error');
const rideRows = document.querySelector('#ride-rows');
const lastUpdated = document.querySelector('#last-updated');
const signOutButton = document.querySelector('#sign-out');

const statusLabels = {
    requested: 'Requested',
    accepted: 'Accepted',
    en_route: 'En route',
    in_progress: 'In progress',
    completed: 'Completed',
    cancelled: 'Cancelled'
};
const vehicleNames = { car: 'Car', bike: 'Bike' };

function setValue(id, value) {
    document.querySelector(`#${id}`).textContent = value;
}

function createCell(content, secondary) {
    const cell = document.createElement('td');
    if (secondary === undefined) {
        cell.textContent = content;
    } else {
        const primary = document.createElement('strong');
        primary.textContent = content;
        const detail = document.createElement('small');
        detail.textContent = secondary;
        cell.append(primary, detail);
    }
    return cell;
}

function renderRides(rides) {
    if (rides.length === 0) {
        const emptyRow = document.createElement('tr');
        const emptyCell = createCell('No rides have been requested yet.');
        emptyCell.colSpan = 6;
        emptyCell.className = 'table-empty';
        emptyRow.append(emptyCell);
        rideRows.replaceChildren(emptyRow);
        return;
    }

    const rows = rides.map((ride) => {
        const row = document.createElement('tr');
        row.append(
            createCell(ride.customerName, ride.customerPhone),
            createCell(ride.pickup, `→ ${ride.destination}`),
            createCell(vehicleNames[ride.vehicleType] || ride.vehicleType, ride.distanceKm != null && Number.isFinite(Number(ride.distanceKm)) ? `${Number(ride.distanceKm).toFixed(2)} km` : undefined),
            createCell(ride.driverName || 'Unassigned'),
            createCell(`KSh ${ride.fareKsh.toLocaleString()}`)
        );
        const statusCell = document.createElement('td');
        const badge = document.createElement('span');
        badge.className = `ride-status-badge ${['accepted', 'en_route', 'in_progress'].includes(ride.status) ? 'active' : ride.status}`;
        badge.textContent = statusLabels[ride.status] || ride.status;
        statusCell.append(badge);
        row.append(statusCell);
        return row;
    });
    rideRows.replaceChildren(...rows);
}

async function refreshDashboard() {
    try {
        const [{ summary }, { rides }] = await Promise.all([
            authorizedFetch('/api/admin/summary'),
            authorizedFetch('/api/admin/rides')
        ]);

        setValue('total-rides', summary.totalRides.toLocaleString());
        setValue('active-rides', summary.activeRides.toLocaleString());
        setValue('completed-rides', summary.completedRides.toLocaleString());
        setValue('revenue', `KSh ${summary.revenueKsh.toLocaleString()}`);
        setValue('online-drivers', summary.onlineDrivers.toLocaleString());
        setValue('total-drivers', summary.totalDrivers.toLocaleString());
        setValue('requested-rides', summary.requestedRides.toLocaleString());
        setValue('active-rides-status', summary.activeRides.toLocaleString());
        setValue('completed-rides-status', summary.completedRides.toLocaleString());
        setValue('cancelled-rides', summary.cancelledRides.toLocaleString());

        const onlinePercent = summary.totalDrivers
            ? Math.round((summary.onlineDrivers / summary.totalDrivers) * 100)
            : 0;
        document.querySelector('#fleet-progress').style.width = `${onlinePercent}%`;
        document.querySelector('#fleet-note').textContent = summary.totalDrivers
            ? `${summary.onlineDrivers} of ${summary.totalDrivers} drivers online`
            : 'No drivers registered yet';

        renderRides(rides);
        adminError.hidden = true;
        lastUpdated.textContent = `Updated ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    } catch (error) {
        adminError.textContent = error.message;
        adminError.hidden = false;
    }
}

async function initialize() {
    try {
        const { available } = await authReady;
        if (!available) throw new Error('Secure phone sign-in is not configured for this service.');
        const profile = await requireRole('admin');
        if (!profile) return;
        document.querySelector('#admin-name').textContent = profile.displayName || 'Operations';
        await refreshDashboard();
        window.setInterval(refreshDashboard, 15000);
    } catch (error) {
        adminError.textContent = error.message;
        adminError.hidden = false;
    }
}

signOutButton.addEventListener('click', async () => {
    signOutButton.disabled = true;
    try {
        await signOut();
    } catch (error) {
        adminError.textContent = error.message;
        adminError.hidden = false;
        signOutButton.disabled = false;
    }
});

initialize();
