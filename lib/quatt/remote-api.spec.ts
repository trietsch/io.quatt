import {RestClient} from 'typed-rest-client/RestClient';
import {QuattRemoteApiClient, QuattTokens} from './remote-api';
import {QuattTokenStore, QuattSettingsStorage} from './token-store';

jest.mock('typed-rest-client/RestClient');

const MockedRestClient = RestClient as jest.MockedClass<typeof RestClient>;

const mockGet = jest.fn();
const mockCreate = jest.fn();
const mockReplace = jest.fn();

MockedRestClient.mockImplementation(() => ({
  get: mockGet,
  create: mockCreate,
  replace: mockReplace,
} as unknown as RestClient));

class FakeSettings implements QuattSettingsStorage {
  private values: Record<string, any> = {};

  get(key: string): any {
    return this.values[key];
  }

  set(key: string, value: any): void {
    this.values[key] = value;
  }
}

/** Mimics typed-rest-client, which rejects with an Error carrying a statusCode. */
const httpError = (statusCode: number): Error => {
  const error = new Error(`Failed request: (${statusCode})`);
  (error as any).statusCode = statusCode;
  return error;
};

const refreshResponse = (idToken: string) => ({
  statusCode: 200,
  result: {
    id_token: idToken,
    refresh_token: 'refresh-token',
    expires_in: '3600',
  },
});

const chillsResponse = {
  statusCode: 200,
  result: {chills: [{uuid: 'chill-1', name: 'Quatt Chill'}]},
};

const validTokens = (): QuattTokens => ({
  idToken: 'valid-id-token',
  refreshToken: 'refresh-token',
  expiresAt: Date.now() + 3_600_000,
});

const expiredTokens = (): QuattTokens => ({
  idToken: 'expired-id-token',
  refreshToken: 'refresh-token',
  expiresAt: Date.now() - 1_000,
});

const authHeaderOf = (call: any[]): string => call[call.length - 1].additionalHeaders.Authorization;

describe('QuattRemoteApiClient', () => {
  let settings: FakeSettings;
  let store: QuattTokenStore;

  beforeEach(() => {
    jest.clearAllMocks();
    settings = new FakeSettings();
    store = new QuattTokenStore(settings);
  });

  const clientFor = (cicId: string, tokens: QuattTokens) => {
    store.saveCredentials({cicId, installationId: 'inst-1', tokens});
    return new QuattRemoteApiClient('1.0.0', tokens, cicId, 'inst-1', store.sourceFor(cicId));
  };

  describe('recovering from a rejected token', () => {
    it('refreshes and retries once when the API answers 401', async () => {
      const client = clientFor('CIC-1', validTokens());

      // The token has not expired locally, but the server rejects it anyway.
      mockGet
        .mockRejectedValueOnce(httpError(401))
        .mockResolvedValueOnce(chillsResponse);
      mockCreate.mockResolvedValueOnce(refreshResponse('recovered-id-token'));

      await expect(client.getChills()).resolves.toEqual([{uuid: 'chill-1', name: 'Quatt Chill'}]);

      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(mockGet).toHaveBeenCalledTimes(2);
      expect(authHeaderOf(mockGet.mock.calls[0])).toBe('Bearer valid-id-token');
      expect(authHeaderOf(mockGet.mock.calls[1])).toBe('Bearer recovered-id-token');
    });

    it('persists the recovered token so other devices pick it up', async () => {
      const client = clientFor('CIC-1', validTokens());

      mockGet
        .mockRejectedValueOnce(httpError(401))
        .mockResolvedValueOnce(chillsResponse);
      mockCreate.mockResolvedValueOnce(refreshResponse('recovered-id-token'));

      await client.getChills();

      expect(store.getCredentials('CIC-1')?.tokens.idToken).toBe('recovered-id-token');
    });

    it('retries a rejected write as well', async () => {
      const client = clientFor('CIC-1', validTokens());

      mockReplace
        .mockRejectedValueOnce(httpError(401))
        .mockResolvedValueOnce({statusCode: 200, result: {}});
      mockCreate.mockResolvedValueOnce(refreshResponse('recovered-id-token'));

      await expect(client.updateCicSettings({dayMaxSoundLevel: '45'})).resolves.toBe(true);
      expect(mockReplace).toHaveBeenCalledTimes(2);
    });

    it('gives up after one retry rather than looping', async () => {
      const client = clientFor('CIC-1', validTokens());

      mockGet.mockRejectedValue(httpError(401));
      mockCreate.mockResolvedValueOnce(refreshResponse('still-rejected'));

      await expect(client.getChills()).rejects.toThrow();
      expect(mockGet).toHaveBeenCalledTimes(2);
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it('does not refresh on errors that are not auth failures', async () => {
      const client = clientFor('CIC-1', validTokens());

      mockGet.mockRejectedValue(httpError(500));

      await expect(client.getChills()).rejects.toThrow();
      expect(mockCreate).not.toHaveBeenCalled();
      expect(mockGet).toHaveBeenCalledTimes(1);
    });
  });

  describe('sharing credentials between devices', () => {
    it('refreshes only once when two devices act concurrently', async () => {
      const cic = clientFor('CIC-1', expiredTokens());
      const chill = new QuattRemoteApiClient('1.0.0', expiredTokens(), 'CIC-1', 'inst-1', store.sourceFor('CIC-1'));

      mockCreate.mockResolvedValue(refreshResponse('single-refresh'));
      mockGet.mockResolvedValue(chillsResponse);

      await Promise.all([cic.getChills(), chill.getChills()]);

      // Both clients needed a refresh, but the shared lock collapses it into one call.
      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(authHeaderOf(mockGet.mock.calls[0])).toBe('Bearer single-refresh');
      expect(authHeaderOf(mockGet.mock.calls[1])).toBe('Bearer single-refresh');
    });

    it('adopts a token refreshed by another device without refreshing again', async () => {
      const chill = clientFor('CIC-1', expiredTokens());

      // The CiC device refreshed in the meantime and wrote the result to the shared store.
      store.updateTokens('CIC-1', {
        idToken: 'refreshed-elsewhere',
        refreshToken: 'refresh-token',
        expiresAt: Date.now() + 3_600_000,
      });
      mockGet.mockResolvedValue(chillsResponse);

      await chill.getChills();

      expect(mockCreate).not.toHaveBeenCalled();
      expect(authHeaderOf(mockGet.mock.calls[0])).toBe('Bearer refreshed-elsewhere');
    });

    it('picks up an installation id changed by a repair', async () => {
      const chill = clientFor('CIC-1', validTokens());

      store.saveCredentials({cicId: 'CIC-1', installationId: 'inst-after-repair', tokens: validTokens()});
      mockGet.mockResolvedValue(chillsResponse);

      await chill.getChills();

      expect(mockGet.mock.calls[0][0]).toContain('/me/installation/inst-after-repair/devices/chills');
    });

    it('refreshes only once when devices build their own stores over one settings object', async () => {
      // How the drivers actually wire it: quatt_heatpump/device.ts and quatt_chill/device.ts
      // each construct `new QuattTokenStore(this.homey.settings, ...)` in their own onInit,
      // so the CiC and every Chill hold a different store instance backed by the same settings.
      store.saveCredentials({cicId: 'CIC-1', installationId: 'inst-1', tokens: expiredTokens()});

      const cicStore = new QuattTokenStore(settings);
      const chillStore = new QuattTokenStore(settings);
      const cic = new QuattRemoteApiClient('1.0.0', expiredTokens(), 'CIC-1', 'inst-1', cicStore.sourceFor('CIC-1'));
      const chill = new QuattRemoteApiClient('1.0.0', expiredTokens(), 'CIC-1', 'inst-1', chillStore.sourceFor('CIC-1'));

      mockCreate.mockResolvedValue(refreshResponse('single-refresh'));
      mockGet.mockResolvedValue(chillsResponse);

      await Promise.all([cic.getChills(), chill.getChills()]);

      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(authHeaderOf(mockGet.mock.calls[0])).toBe('Bearer single-refresh');
      expect(authHeaderOf(mockGet.mock.calls[1])).toBe('Bearer single-refresh');
    });

    it('burns the refresh token only once when two devices are rejected at the same time', async () => {
      // Both devices hold a token that looks valid locally but the API rejects, which is
      // exactly the post-repair state. The second device must adopt what the first
      // refreshed instead of spending the (now already used) refresh token again.
      store.saveCredentials({cicId: 'CIC-1', installationId: 'inst-1', tokens: validTokens()});

      const cic = new QuattRemoteApiClient('1.0.0', validTokens(), 'CIC-1', 'inst-1', new QuattTokenStore(settings).sourceFor('CIC-1'));
      const chill = new QuattRemoteApiClient('1.0.0', validTokens(), 'CIC-1', 'inst-1', new QuattTokenStore(settings).sourceFor('CIC-1'));

      mockGet
        .mockRejectedValueOnce(httpError(401))
        .mockRejectedValueOnce(httpError(401))
        .mockResolvedValue(chillsResponse);
      mockCreate.mockResolvedValue(refreshResponse('recovered-once'));

      await Promise.all([cic.getChills(), chill.getChills()]);

      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(authHeaderOf(mockGet.mock.calls[2])).toBe('Bearer recovered-once');
      expect(authHeaderOf(mockGet.mock.calls[3])).toBe('Bearer recovered-once');
      expect(store.getCredentials('CIC-1')?.tokens.idToken).toBe('recovered-once');
    });

    it('still refreshes when the rejected token is the one the store holds', async () => {
      // The collapse above must not swallow a genuine rejection: with nobody else
      // refreshing, a 401 has to reach the refresh endpoint.
      const client = clientFor('CIC-1', validTokens());

      mockGet
        .mockRejectedValueOnce(httpError(401))
        .mockResolvedValueOnce(chillsResponse);
      mockCreate.mockResolvedValueOnce(refreshResponse('refreshed-after-401'));

      await client.getChills();

      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(authHeaderOf(mockGet.mock.calls[1])).toBe('Bearer refreshed-after-401');
    });

    it('lets a client the driver keeps alive adopt what a repair wrote', async () => {
      // QuattChillDriver caches one client per installation for the life of the app, so
      // the client that survives a Repair has to notice the new identity rather than keep
      // using the tokens it was constructed with.
      const client = clientFor('CIC-1', validTokens());

      store.saveCredentials({
        cicId: 'CIC-1',
        installationId: 'inst-after-repair',
        tokens: {idToken: 'repaired-id-token', refreshToken: 'repaired-refresh-token', expiresAt: Date.now() + 3_600_000},
      });
      mockGet.mockResolvedValue(chillsResponse);

      await client.getChills();

      expect(mockCreate).not.toHaveBeenCalled();
      expect(mockGet.mock.calls[0][0]).toContain('/me/installation/inst-after-repair/devices/chills');
      expect(authHeaderOf(mockGet.mock.calls[0])).toBe('Bearer repaired-id-token');
    });

    it('still works without a shared store, for the pairing flow', async () => {
      const client = new QuattRemoteApiClient('1.0.0', expiredTokens(), 'CIC-1', 'inst-1');

      mockCreate.mockResolvedValueOnce(refreshResponse('standalone-refresh'));
      mockGet.mockResolvedValue(chillsResponse);

      await client.getChills();

      expect(authHeaderOf(mockGet.mock.calls[0])).toBe('Bearer standalone-refresh');
    });
  });
});
