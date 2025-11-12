import {RestClient, IRestResponse} from "typed-rest-client/RestClient";
import { QuattApiError } from './errors';

// Firebase Configuration
const FIREBASE_API_KEY = "AIzaSyDM4PIXYDS9x53WUj-tDjOVAb6xKgzxX9Y";
const FIREBASE_APP_ID = "1:1074628551428:android:20ddeaf85c3cfec3336651";
const FIREBASE_PROJECT_ID = "quatt-production";
const FIREBASE_INSTANCE_ID = "dwNCvvXLQrqvmUJlZajYzG";
const ANDROID_PACKAGE = "io.quatt.mobile.android";
const ANDROID_CERT_HASH = "1110A8F9B0DE16D417086A4BDBCF956070F0FD97";

// API Endpoints
const FIREBASE_INSTALLATIONS_URL = `https://firebaseinstallations.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/installations`;
const FIREBASE_REMOTE_CONFIG_URL = "https://firebaseremoteconfig.googleapis.com/v1/projects/1074628551428/namespaces/firebase:fetch";
const FIREBASE_SIGNUP_URL = "https://www.googleapis.com/identitytoolkit/v3/relyingparty/signupNewUser";
const FIREBASE_ACCOUNT_INFO_URL = "https://www.googleapis.com/identitytoolkit/v3/relyingparty/getAccountInfo";
const FIREBASE_TOKEN_URL = "https://securetoken.googleapis.com/v1/token";
const QUATT_API_BASE_URL = "https://mobile-api.quatt.io/api/v1";

interface FirebaseInstallationResponse {
    name: string;
    fid: string;
    refreshToken: string;
    authToken: {
        token: string;
        expiresIn: string;
    };
}

interface FirebaseSignupResponse {
    idToken: string;
    refreshToken: string;
    expiresIn: string;
    localId: string;
}

interface FirebaseTokenRefreshResponse {
    id_token: string;
    refresh_token: string;
    expires_in: string;
}

interface QuattUser {
    cicIds: string[];
    installationIds: string[];
}

interface QuattInstallation {
    id: string;
    cicId: string;
}

export interface QuattTokens {
    idToken: string;
    refreshToken: string;
    expiresAt: number;
}

export interface QuattRemoteSettings {
    dayMaxSoundLevel?: string;
    nightMaxSoundLevel?: string;
    usePricingLimitingHeatPump?: boolean;
}

/**
 * Client for interacting with the Quatt Remote API
 */
export class QuattRemoteApiClient {
    private readonly appVersion: string;
    private client: RestClient;
    private tokens: QuattTokens | null = null;
    private cicId: string | null = null;
    private installationId: string | null = null;

    constructor(appVersion: string, tokens?: QuattTokens, cicId?: string, installationId?: string) {
        this.appVersion = appVersion;
        this.client = new RestClient(`Homey Quatt App/${this.appVersion}`);
        if (tokens) {
            this.tokens = tokens;
        }
        if (cicId) {
            this.cicId = cicId;
        }
        if (installationId) {
            this.installationId = installationId;
        }
    }

    /**
     * Authenticate with Quatt Mobile API and pair with CIC device
     * User must press the button on the CIC device within 60 seconds
     */
    async authenticate(firstName: string, lastName: string, cicId: string): Promise<{tokens: QuattTokens, installationId: string}> {
        try {
            console.log('[QuattRemote] Step 1: Getting Firebase Installation ID');
            // Step 1: Get Firebase Installation ID
            const installationData = await this._getFirebaseInstallation();
            const firebaseToken = installationData.authToken.token;

            console.log('[QuattRemote] Step 2: Getting Firebase Remote Config');
            // Step 2: Get Firebase Remote Config (not strictly needed but follows HA pattern)
            await this._getFirebaseRemoteConfig(firebaseToken);

            console.log('[QuattRemote] Step 3: Creating anonymous Firebase user');
            // Step 3: Create anonymous Firebase user
            const firebaseUser = await this._signupFirebaseUser();

            this.tokens = {
                idToken: firebaseUser.idToken,
                refreshToken: firebaseUser.refreshToken,
                expiresAt: Date.now() + (parseInt(firebaseUser.expiresIn) * 1000)
            };

            console.log('[QuattRemote] Step 4: Updating user profile');
            // Step 4: Update user profile with name
            await this._updateUserProfile(firstName, lastName);

            console.log('[QuattRemote] Step 5: Requesting pairing with CIC device');
            // Step 5: Request pairing with CIC device
            await this._requestPairing(cicId);

            console.log('[QuattRemote] Step 6: Waiting for button press on CIC device');
            // Step 6: Wait for user to press button on CIC device (60 second timeout)
            await this._waitForPairing(cicId);

            console.log('[QuattRemote] Step 7: Getting installation ID');
            // Step 7: Get installation ID
            const installation = await this._getInstallation(cicId);

            this.cicId = cicId;
            this.installationId = installation.id;

            console.log('[QuattRemote] Authentication successful');
            return {
                tokens: this.tokens,
                installationId: installation.id
            };
        } catch (error) {
            console.error('[QuattRemote] Authentication error:', error);
            if (error instanceof Error) {
                throw new QuattApiError(`Authentication failed: ${error.message}`);
            }
            throw new QuattApiError('Authentication failed with unknown error');
        }
    }

    /**
     * Update CIC settings (sound levels, pricing limits)
     */
    async updateCicSettings(settings: QuattRemoteSettings): Promise<boolean> {
        if (!this.tokens || !this.cicId) {
            throw new QuattApiError('Not authenticated or CIC not paired');
        }

        // Refresh token if expired
        if (Date.now() >= this.tokens.expiresAt) {
            await this._refreshToken();
        }

        try {
            const response = await this.client.replace<any>(
                `${QUATT_API_BASE_URL}/me/cic/${this.cicId}`,
                settings,
                {
                    additionalHeaders: {
                        'Authorization': `Bearer ${this.tokens.idToken}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            return response.statusCode === 200;
        } catch (error) {
            // If token refresh fails, try one more time
            if (error instanceof Error && error.message.includes('401')) {
                await this._refreshToken();
                const response = await this.client.replace<any>(
                    `${QUATT_API_BASE_URL}/me/cic/${this.cicId}`,
                    settings,
                    {
                        additionalHeaders: {
                            'Authorization': `Bearer ${this.tokens!.idToken}`,
                            'Content-Type': 'application/json'
                        }
                    }
                );
                return response.statusCode === 200;
            }
            throw new QuattApiError(`Failed to update settings: ${error}`);
        }
    }

    /**
     * Get current CIC data from remote API
     */
    async getCicData(): Promise<any> {
        if (!this.tokens || !this.cicId) {
            throw new QuattApiError('Not authenticated or CIC not paired');
        }

        // Refresh token if expired
        if (Date.now() >= this.tokens.expiresAt) {
            await this._refreshToken();
        }

        const response = await this.client.get<any>(
            `${QUATT_API_BASE_URL}/me/cic/${this.cicId}`,
            {
                additionalHeaders: {
                    'Authorization': `Bearer ${this.tokens.idToken}`
                }
            }
        );

        if (response.statusCode !== 200) {
            throw new QuattApiError(`Failed to get CIC data: Status ${response.statusCode}`);
        }

        return response.result;
    }

    private async _getFirebaseInstallation(): Promise<FirebaseInstallationResponse> {
        const response = await this.client.create<FirebaseInstallationResponse>(
            FIREBASE_INSTALLATIONS_URL,
            {
                fid: FIREBASE_INSTANCE_ID,
                appId: FIREBASE_APP_ID,
                authVersion: "FIS_v2",
                sdkVersion: "a:16.3.5"
            },
            {
                additionalHeaders: {
                    'X-Goog-Api-Key': FIREBASE_API_KEY
                }
            }
        );

        if (response.statusCode !== 200 || !response.result) {
            throw new QuattApiError('Failed to get Firebase installation');
        }

        return response.result;
    }

    private async _getFirebaseRemoteConfig(token: string): Promise<void> {
        await this.client.create<any>(
            `${FIREBASE_REMOTE_CONFIG_URL}?key=${FIREBASE_API_KEY}`,
            {
                appId: FIREBASE_APP_ID,
                appInstanceId: FIREBASE_INSTANCE_ID,
                packageName: ANDROID_PACKAGE
            },
            {
                additionalHeaders: {
                    'X-Goog-Api-Key': FIREBASE_API_KEY,
                    'X-Android-Package': ANDROID_PACKAGE,
                    'X-Android-Cert': ANDROID_CERT_HASH,
                    'X-Goog-Firebase-Installations-Auth': token
                }
            }
        );
    }

    private async _signupFirebaseUser(): Promise<FirebaseSignupResponse> {
        const response = await this.client.create<FirebaseSignupResponse>(
            `${FIREBASE_SIGNUP_URL}?key=${FIREBASE_API_KEY}`,
            {
                returnSecureToken: true
            }
        );

        if (response.statusCode !== 200 || !response.result) {
            throw new QuattApiError('Failed to create Firebase user');
        }

        return response.result;
    }

    private async _updateUserProfile(firstName: string, lastName: string): Promise<void> {
        if (!this.tokens) {
            throw new QuattApiError('No tokens available');
        }

        const response = await this.client.replace<any>(
            `${QUATT_API_BASE_URL}/me`,
            {
                firstName,
                lastName
            },
            {
                additionalHeaders: {
                    'Authorization': `Bearer ${this.tokens.idToken}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        if (response.statusCode !== 200) {
            throw new QuattApiError('Failed to update user profile');
        }
    }

    private async _requestPairing(cicId: string): Promise<void> {
        if (!this.tokens) {
            throw new QuattApiError('No tokens available');
        }

        try {
            const response = await this.client.create<any>(
                `${QUATT_API_BASE_URL}/me/cic/${cicId}/requestPair`,
                {},
                {
                    additionalHeaders: {
                        'Authorization': `Bearer ${this.tokens.idToken}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            // 200, 201, 204 are all success codes (204 = No Content is valid for this endpoint)
            if (response.statusCode !== 200 && response.statusCode !== 201 && response.statusCode !== 204) {
                const errorMsg = response.result?.message || response.result?.error || 'Unknown error';
                throw new QuattApiError(`Failed to request pairing (status ${response.statusCode}): ${errorMsg}`);
            }

            console.log(`[QuattRemote] Pairing request successful (status ${response.statusCode})`);
        } catch (error) {
            if (error instanceof QuattApiError) {
                throw error;
            }
            throw new QuattApiError(`Failed to request pairing: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async _waitForPairing(cicId: string, timeoutSeconds: number = 60): Promise<void> {
        if (!this.tokens) {
            throw new QuattApiError('No tokens available');
        }

        const startTime = Date.now();
        const pollInterval = 2000; // 2 seconds
        const requestTimeout = 10000; // 10 second timeout for individual requests

        console.log(`[QuattRemote] Waiting for button press (${timeoutSeconds} seconds timeout)...`);
        console.log(`[QuattRemote] Looking for CIC ID: ${cicId}`);

        while (Date.now() - startTime < timeoutSeconds * 1000) {
            try {
                // Wrap the HTTP request with a timeout to prevent waiting the full 30s
                const response = await Promise.race([
                    this.client.get<any>(
                        `${QUATT_API_BASE_URL}/me`,
                        {
                            additionalHeaders: {
                                'Authorization': `Bearer ${this.tokens.idToken}`
                            }
                        }
                    ),
                    new Promise<never>((_, reject) =>
                        setTimeout(() => reject(new Error('Request timeout after 10s')), requestTimeout)
                    )
                ]);

                console.log(`[QuattRemote] Poll response status: ${response.statusCode}`);

                // Check both possible response structures
                let cicIds: string[] | undefined;

                // Structure 1: response.result.cicIds (if typed-rest-client extracts the result)
                if (response.result?.cicIds) {
                    cicIds = response.result.cicIds;
                    console.log(`[QuattRemote] Found cicIds in response.result.cicIds:`, cicIds);
                }
                // Structure 2: response.result.result.cicIds (if API returns {result: {cicIds: [...]}})
                else if (response.result?.result?.cicIds) {
                    cicIds = response.result.result.cicIds;
                    console.log(`[QuattRemote] Found cicIds in response.result.result.cicIds:`, cicIds);
                }

                if (response.statusCode === 200 && cicIds && cicIds.includes(cicId)) {
                    console.log('[QuattRemote] Button press detected! Pairing successful');
                    return; // Pairing successful
                } else {
                    console.log(`[QuattRemote] CIC ID ${cicId} not found in cicIds array, continuing to poll...`);
                }
            } catch (error) {
                // If individual request times out or fails, continue polling silently
                // Don't log the error details to avoid confusing users
                console.log('[QuattRemote] Poll request failed, retrying...');
            }

            // Wait before polling again
            await new Promise(resolve => setTimeout(resolve, pollInterval));
        }

        throw new QuattApiError('Pairing timeout - button was not pressed on CIC device within 60 seconds');
    }

    private async _getInstallation(cicId: string): Promise<QuattInstallation> {
        if (!this.tokens) {
            throw new QuattApiError('No tokens available');
        }

        console.log('[QuattRemote] Step 7: Getting installation ID');

        const response = await this.client.get<any>(
            `${QUATT_API_BASE_URL}/me/installations`,
            {
                additionalHeaders: {
                    'Authorization': `Bearer ${this.tokens.idToken}`
                }
            }
        );

        console.log(`[QuattRemote] Installations response status: ${response.statusCode}`);
        console.log(`[QuattRemote] Installations response body:`, JSON.stringify(response.result, null, 2));

        if (response.statusCode !== 200 || !response.result) {
            throw new QuattApiError('Failed to get installations');
        }

        // The API returns: { "result": [...installations...] }
        // typed-rest-client puts the body in response.result, so we access response.result.result
        let installations: any[] | undefined;

        if (Array.isArray(response.result.result)) {
            installations = response.result.result;
            console.log('[QuattRemote] Found installations array in response.result.result');
        } else if (Array.isArray(response.result)) {
            // Fallback: sometimes response.result might be the array directly
            installations = response.result;
            console.log('[QuattRemote] Found installations array directly in response.result');
        } else {
            console.error('[QuattRemote] Could not find installations array in response');
            console.error('[QuattRemote] response.result type:', typeof response.result);
            console.error('[QuattRemote] response.result.result type:', typeof response.result?.result);
            throw new QuattApiError('Invalid response structure: installations array not found');
        }

        if (!installations || installations.length === 0) {
            throw new QuattApiError('No installations found in response');
        }

        console.log(`[QuattRemote] Looking for installation with CIC ID: ${cicId}`);
        console.log(`[QuattRemote] Available installations:`, JSON.stringify(installations, null, 2));

        // Try to find installation by cicId field
        let installation = installations.find((i: any) => i.cicId === cicId);

        if (!installation) {
            // Fallback: just take the first installation with a valid ID
            console.log('[QuattRemote] No installation matched CIC ID, taking first available installation');
            installation = installations.find((i: any) => i.id || i.externalId);
        }

        if (!installation) {
            throw new QuattApiError(`No valid installation found`);
        }

        console.log(`[QuattRemote] Found installation:`, JSON.stringify(installation, null, 2));

        // Return installation with normalized structure
        return {
            id: installation.id || installation.externalId,
            cicId: installation.cicId || cicId
        };
    }

    private async _refreshToken(): Promise<void> {
        if (!this.tokens) {
            throw new QuattApiError('No tokens to refresh');
        }

        const response = await this.client.create<FirebaseTokenRefreshResponse>(
            `${FIREBASE_TOKEN_URL}?key=${FIREBASE_API_KEY}`,
            {
                grant_type: 'refresh_token',
                refresh_token: this.tokens.refreshToken
            }
        );

        if (response.statusCode !== 200 || !response.result) {
            throw new QuattApiError('Failed to refresh token');
        }

        this.tokens = {
            idToken: response.result.id_token,
            refreshToken: response.result.refresh_token,
            expiresAt: Date.now() + (parseInt(response.result.expires_in) * 1000)
        };
    }

    /**
     * Get current tokens for storage
     */
    getTokens(): QuattTokens | null {
        return this.tokens;
    }

    /**
     * Get current CIC ID
     */
    getCicId(): string | null {
        return this.cicId;
    }

    /**
     * Get installation ID
     */
    getInstallationId(): string | null {
        return this.installationId;
    }
}
