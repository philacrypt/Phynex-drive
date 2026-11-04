import { authReady, sendPhoneCode, verifyPhoneCode } from './auth.js';

const form = document.querySelector('#sign-in-form');
const phoneStep = document.querySelector('#phone-step');
const codeStep = document.querySelector('#code-step');
const sendButton = document.querySelector('#send-code');
const verifyButton = document.querySelector('#verify-code');
const message = document.querySelector('#auth-message');
const phoneInput = document.querySelector('#phone-number');
const nameInput = document.querySelector('#display-name');
const codeInput = document.querySelector('#verification-code');

function showMessage(text) {
    message.textContent = text;
    message.hidden = false;
}

async function initialize() {
    try {
        const { available } = await authReady;
        if (!available) {
            showMessage('Secure phone sign-in is being configured. Please contact Phil-Ride support before trying again.');
            sendButton.disabled = true;
        }
    } catch (error) {
        showMessage(error.message);
        sendButton.disabled = true;
    }
}

async function sendCode() {
    message.hidden = true;
    sendButton.disabled = true;
    sendButton.textContent = 'Sending code…';
    try {
        await sendPhoneCode(phoneInput.value, document.querySelector('#recaptcha-container'));
        phoneStep.hidden = true;
        nameInput.disabled = true;
        phoneInput.disabled = true;
        codeStep.hidden = false;
        codeInput.focus();
    } catch (error) {
        showMessage(error.message);
    } finally {
        sendButton.disabled = false;
        sendButton.textContent = 'Send verification code';
    }
}

async function verifyCode() {
    if (!form.reportValidity()) return;
    message.hidden = true;
    verifyButton.disabled = true;
    verifyButton.textContent = 'Verifying…';
    try {
        const profile = await verifyPhoneCode(
            codeInput.value,
            nameInput.value
        );
        const requestedPath = new URLSearchParams(window.location.search).get('next');
        const nextPath = requestedPath && requestedPath.startsWith('/') && !requestedPath.startsWith('//')
            ? requestedPath
            : '';
        const requiredRole = nextPath.startsWith('/driver')
            ? 'driver'
            : nextPath.startsWith('/admin')
                ? 'admin'
                : 'customer';
        if (profile.role !== requiredRole) {
            if (nextPath) {
                showMessage('This phone number is not authorized for that workspace. Contact Phil-Ride support.');
                return;
            }
            window.location.replace(profile.role === 'driver' ? '/driver' : profile.role === 'admin' ? '/admin' : '/customer.html');
            return;
        }
        window.location.replace(nextPath || '/customer.html');
    } catch (error) {
        showMessage(error.message);
    } finally {
        verifyButton.disabled = false;
        verifyButton.textContent = 'Verify and continue';
    }
}

form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (codeStep.hidden) sendCode();
    else verifyCode();
});

verifyButton.addEventListener('click', verifyCode);

document.querySelector('#resend-code').addEventListener('click', () => {
    codeStep.hidden = true;
    phoneStep.hidden = false;
    nameInput.disabled = false;
    phoneInput.disabled = false;
    codeInput.value = '';
    nameInput.focus();
    message.hidden = true;
});

initialize();
