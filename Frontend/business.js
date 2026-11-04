const STORAGE_KEY = 'phynex-business-fleet';
const BOOKINGS_KEY = 'phynex-business-bookings';
const fleetForm = document.querySelector('#fleet-form');
const fleetList = document.querySelector('#fleet-list');
const fleetMessage = document.querySelector('#fleet-message');
const listingTotal = document.querySelector('#listing-total');

function readFleet() {
    try {
        const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        return [];
    }
}

function writeFleet(listings) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(listings));
}

function readBookings() {
    try {
        const parsed = JSON.parse(localStorage.getItem(BOOKINGS_KEY) || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        return [];
    }
}

function writeBookings(bookings) {
    localStorage.setItem(BOOKINGS_KEY, JSON.stringify(bookings));
}

function formatCurrency(value) {
    return new Intl.NumberFormat('en-KE', {
        style: 'currency',
        currency: 'KES',
        maximumFractionDigits: 0
    }).format(Number(value || 0));
}

function renderFleet() {
    const listings = readFleet();
    listingTotal.textContent = String(listings.length);

    if (listings.length === 0) {
        fleetList.innerHTML = '<div class="empty-state">No cars have been posted yet. Add a vehicle to create a live hire listing.</div>';
        return;
    }

    fleetList.innerHTML = listings.map((listing) => `
        <article class="fleet-card">
            <div class="fleet-card-header">
                <h3>${escapeHtml(listing.name)}</h3>
                <span class="status-pill ${listing.status}">${listing.status === 'available' ? 'Available' : 'Reserved'}</span>
            </div>
            <div class="meta-grid">
                <div>
                    <span>Model</span>
                    <strong>${escapeHtml(listing.model)}</strong>
                </div>
                <div>
                    <span>Seats</span>
                    <strong>${listing.seats}</strong>
                </div>
                <div>
                    <span>Location</span>
                    <strong>${escapeHtml(listing.location)}</strong>
                </div>
            </div>
            <p>${escapeHtml(listing.description)}</p>
            <div class="fleet-card-actions">
                <span class="fleet-price">${formatCurrency(listing.rate)} / day</span>
                <button type="button" class="book-btn" data-id="${listing.id}" ${listing.status === 'reserved' ? 'disabled' : ''}>Book now</button>
            </div>
        </article>
    `).join('');

    fleetList.querySelectorAll('.book-btn').forEach((button) => {
        button.addEventListener('click', () => {
            const id = button.dataset.id;
            const listing = readFleet().find((item) => item.id === id);
            if (!listing || listing.status === 'reserved') return;

            const bookings = readBookings();
            bookings.unshift({
                id: `${Date.now()}`,
                carId: listing.id,
                carName: listing.name,
                rate: listing.rate,
                customerName: 'Customer booking',
                bookedAt: new Date().toISOString()
            });
            writeBookings(bookings);

            const updated = readFleet().map((item) => item.id === id ? { ...item, status: 'reserved' } : item);
            writeFleet(updated);
            renderFleet();
            fleetMessage.hidden = false;
            fleetMessage.textContent = `Booking request sent for ${listing.name}. The admin can confirm it from the business listings.`;
        });
    });
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

fleetForm.addEventListener('submit', (event) => {
    event.preventDefault();

    const formData = new FormData(fleetForm);
    const listing = {
        id: `car-${Date.now()}`,
        name: String(formData.get('carName') || '').trim(),
        model: String(formData.get('carModel') || '').trim(),
        seats: Number(formData.get('carSeats') || 0),
        rate: Number(formData.get('carRate') || 0),
        location: String(formData.get('carLocation') || '').trim(),
        status: String(formData.get('carStatus') || 'available'),
        description: String(formData.get('carDescription') || '').trim()
    };

    if (!listing.name || !listing.model || !listing.location || !listing.description || !listing.rate) {
        fleetMessage.hidden = false;
        fleetMessage.textContent = 'Please complete all required fields before posting the vehicle.';
        return;
    }

    const listings = readFleet();
    listings.unshift(listing);
    writeFleet(listings);
    fleetForm.reset();
    fleetMessage.hidden = false;
    fleetMessage.textContent = 'Car posted successfully. It is now live for customers to book.';
    document.querySelector('#car-seats').value = '5';
    document.querySelector('#car-rate').value = '12000';
    renderFleet();
});

renderFleet();
