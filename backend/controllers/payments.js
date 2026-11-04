const rideModel = require('../models/rides');
const paymentModel = require('../models/payments');
const mpesa = require('../services/mpesa');
const { createHttpError } = require('./rides');

async function startMpesaPayment(req, res) {
    const ride = await rideModel.getCustomerRide(req.params.id, req.profile.id);
    if (!ride) throw createHttpError(404, 'Ride not found.');
    if (ride.paymentMethod !== 'mpesa') throw createHttpError(409, 'This ride was not booked with M-Pesa.');
    if (ride.status === 'cancelled' || ride.status === 'completed') {
        throw createHttpError(409, 'Payment cannot be started for this ride.');
    }
    if (ride.paymentStatus === 'paid') {
        return res.json({ payment: { status: 'paid' } });
    }

    const payment = await paymentModel.getForCustomerRide(ride.id, req.profile.id);
    if (!payment || payment.status !== 'pending') {
        throw createHttpError(409, 'This payment request has expired. Contact support before trying again.');
    }
    try {
        const checkout = await mpesa.startStkPush({
            phone: payment.customerPhone,
            amountKsh: payment.amountKsh,
            rideId: ride.id
        });
        if (!await paymentModel.setCheckoutDetails(payment.id, checkout)) {
            throw createHttpError(409, 'The payment request changed. Refresh your ride.');
        }
        res.status(202).json({
            payment: {
                status: 'pending',
                message: 'Approve the M-Pesa prompt on your phone. The ride will be offered to drivers after confirmation.'
            }
        });
    } catch (error) {
        await paymentModel.markFailed(payment.id);
        if (error.status) throw error;
        console.error('M-Pesa checkout failed:', error);
        throw createHttpError(502, 'M-Pesa could not start the payment. Contact support before retrying.');
    }
}

function getCallbackMetadata(callback) {
    const items = callback?.CallbackMetadata?.Item;
    if (!Array.isArray(items)) return {};
    return Object.fromEntries(items.map((item) => [item.Name, item.Value]));
}

async function handleMpesaCallback(req, res) {
    const callback = req.body?.Body?.stkCallback;
    const checkoutRequestId = callback?.CheckoutRequestID;
    if (!checkoutRequestId || !Number.isInteger(Number(callback.ResultCode))) {
        throw createHttpError(400, 'Invalid M-Pesa callback.');
    }

    const payment = await paymentModel.findByCheckoutRequestId(checkoutRequestId);
    if (!payment) throw createHttpError(404, 'M-Pesa payment request not found.');
    if (Number(callback.ResultCode) !== 0) {
        await paymentModel.markFailed(payment.id);
        return res.json({ ResultCode: 0, ResultDesc: 'Payment result recorded.' });
    }

    const metadata = getCallbackMetadata(callback);
    const receipt = metadata.MpesaReceiptNumber;
    const callbackAmount = Number(metadata.Amount);
    let callbackPhone;
    try {
        callbackPhone = mpesa.normalizeKenyanPhone(String(metadata.PhoneNumber || ''));
    } catch {
        throw createHttpError(400, 'M-Pesa callback did not include a valid payer number.');
    }
    if (!receipt || callbackAmount !== payment.amountKsh) {
        throw createHttpError(400, 'M-Pesa callback amount or receipt did not match the payment.');
    }
    if (callbackPhone !== mpesa.normalizeKenyanPhone(payment.customerPhone)) {
        throw createHttpError(400, 'M-Pesa callback payer did not match the ride account.');
    }

    const verified = await mpesa.verifyStkPayment(checkoutRequestId);
    if (String(verified.ResultCode) !== '0') {
        throw createHttpError(409, 'M-Pesa has not confirmed this payment.');
    }
    await paymentModel.markPaid(payment.id, receipt);
    res.json({ ResultCode: 0, ResultDesc: 'Payment confirmed.' });
}

module.exports = { handleMpesaCallback, startMpesaPayment };
