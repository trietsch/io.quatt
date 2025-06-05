// Wait for Homey to be ready
function onHomeyReady(Homey) {
    const ipAddressInput = document.getElementById('ipAddress');
    const saveButton = document.getElementById('saveButton');
    const statusMessageElement = document.getElementById('statusMessage');

    // Function to display status messages
    function showStatusMessage(message, isError = false) {
        statusMessageElement.textContent = message;
        statusMessageElement.className = 'status-message ' + (isError ? 'error' : 'success');
        statusMessageElement.style.display = 'block';
        setTimeout(() => {
            statusMessageElement.style.display = 'none';
        }, 5000); // Hide after 5 seconds
    }

    // Basic IP address validation (IPv4)
    function isValidIPAddress(ip) {
        if (typeof ip !== 'string') return false;
        const parts = ip.split('.');
        if (parts.length !== 4) return false;
        return parts.every(part => {
            const num = parseInt(part, 10);
            return num >= 0 && num <= 255 && String(num) === part;
        });
    }

    // Load saved IP address when the page loads
    async function loadSettings() {
        try {
            const savedIp = await Homey.getStoreValue('cicIPAddress');
            if (savedIp) {
                ipAddressInput.value = savedIp;
            }
        } catch (error) {
            console.error('Error loading settings:', error);
            showStatusMessage('Error loading saved IP address.', true);
        }
    }

    // Save IP address
    async function saveSettings() {
        const ipAddress = ipAddressInput.value.trim();

        if (ipAddress === "") { // Allow clearing the setting
            try {
                await Homey.unsetStoreValue('cicIPAddress');
                showStatusMessage('IP address cleared successfully.');
                ipAddressInput.value = ""; // Ensure field is empty
            } catch (error) {
                console.error('Error clearing IP address:', error);
                showStatusMessage('Error clearing IP address.', true);
            }
            return;
        }

        if (!isValidIPAddress(ipAddress)) {
            showStatusMessage('Invalid IP address format. Please enter a valid IPv4 address (e.g., 192.168.1.123).', true);
            return;
        }

        try {
            await Homey.setStoreValue('cicIPAddress', ipAddress);
            showStatusMessage('IP address saved successfully.');
        } catch (error) {
            console.error('Error saving settings:', error);
            showStatusMessage('Error saving IP address.', true);
        }
    }

    // Event listeners
    saveButton.addEventListener('click', saveSettings);

    // Initial load
    loadSettings();

    Homey.ready(); // Signal that the script is ready
}

// Check if Homey is already available, otherwise wait for 'homey:ready'
if (typeof Homey !== 'undefined') {
    onHomeyReady(Homey);
} else {
    window.addEventListener('homey:ready', () => {
        // Access Homey from window.Homey if it's available there, or just Homey globally
        onHomeyReady(window.Homey || Homey);
    }, { once: true });
}
