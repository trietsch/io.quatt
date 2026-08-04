import {QuattTokenStore, QuattSettingsStorage, REMOTE_CREDENTIALS_SETTINGS_KEY} from './token-store';
import {QuattTokens} from './remote-api';

/**
 * In-memory stand-in for Homey's ManagerSettings.
 */
class FakeSettings implements QuattSettingsStorage {
  private values: Record<string, any> = {};

  get(key: string): any {
    return this.values[key];
  }

  set(key: string, value: any): void {
    this.values[key] = value;
  }
}

const tokensAt = (expiresAt: number, idToken = 'id-token'): QuattTokens => ({
  idToken,
  refreshToken: 'refresh-token',
  expiresAt,
});

describe('QuattTokenStore', () => {
  let settings: FakeSettings;
  let store: QuattTokenStore;

  beforeEach(() => {
    settings = new FakeSettings();
    store = new QuattTokenStore(settings);
  });

  describe('credential storage', () => {
    it('returns null when no credentials are stored for a CiC', () => {
      expect(store.getCredentials('CIC-unknown')).toBeNull();
    });

    it('round-trips credentials through settings', () => {
      store.saveCredentials({cicId: 'CIC-1', installationId: 'inst-1', tokens: tokensAt(1000)});

      expect(store.getCredentials('CIC-1')).toEqual({
        cicId: 'CIC-1',
        installationId: 'inst-1',
        tokens: tokensAt(1000),
      });
    });

    it('keeps credentials for multiple CiCs side by side', () => {
      store.saveCredentials({cicId: 'CIC-1', installationId: 'inst-1', tokens: tokensAt(1000, 'a')});
      store.saveCredentials({cicId: 'CIC-2', installationId: 'inst-2', tokens: tokensAt(2000, 'b')});

      expect(store.getCredentials('CIC-1')?.tokens.idToken).toBe('a');
      expect(store.getCredentials('CIC-2')?.tokens.idToken).toBe('b');
    });

    it('writes under a single settings key', () => {
      store.saveCredentials({cicId: 'CIC-1', installationId: 'inst-1', tokens: tokensAt(1000)});

      expect(Object.keys(settings.get(REMOTE_CREDENTIALS_SETTINGS_KEY))).toEqual(['CIC-1']);
    });

    it('ignores malformed stored data instead of throwing', () => {
      settings.set(REMOTE_CREDENTIALS_SETTINGS_KEY, 'not-an-object');

      expect(store.getCredentials('CIC-1')).toBeNull();
    });

    it('treats credentials without tokens as absent', () => {
      settings.set(REMOTE_CREDENTIALS_SETTINGS_KEY, {'CIC-1': {cicId: 'CIC-1'}});

      expect(store.getCredentials('CIC-1')).toBeNull();
    });
  });

  describe('updateTokens', () => {
    it('replaces only the tokens, keeping the installation id', () => {
      store.saveCredentials({cicId: 'CIC-1', installationId: 'inst-1', tokens: tokensAt(1000, 'old')});

      store.updateTokens('CIC-1', tokensAt(5000, 'new'));

      expect(store.getCredentials('CIC-1')).toEqual({
        cicId: 'CIC-1',
        installationId: 'inst-1',
        tokens: tokensAt(5000, 'new'),
      });
    });

    it('does nothing when the CiC is unknown', () => {
      store.updateTokens('CIC-unknown', tokensAt(5000));

      expect(store.getCredentials('CIC-unknown')).toBeNull();
    });
  });

  describe('migrateFromDevice', () => {
    it('seeds the shared store from per-device credentials', () => {
      const migrated = store.migrateFromDevice('CIC-1', tokensAt(1000, 'from-device'), 'inst-1');

      expect(migrated.tokens.idToken).toBe('from-device');
      expect(store.getCredentials('CIC-1')?.installationId).toBe('inst-1');
    });

    it('does not overwrite credentials that are already shared', () => {
      store.saveCredentials({cicId: 'CIC-1', installationId: 'inst-new', tokens: tokensAt(9000, 'current')});

      // A stale device store must not clobber the credentials a Repair just wrote.
      const migrated = store.migrateFromDevice('CIC-1', tokensAt(1000, 'stale'), 'inst-old');

      expect(migrated.tokens.idToken).toBe('current');
      expect(store.getCredentials('CIC-1')?.installationId).toBe('inst-new');
    });
  });

  describe('sourceFor', () => {
    it('gives every device the same view of the credentials', () => {
      store.saveCredentials({cicId: 'CIC-1', installationId: 'inst-1', tokens: tokensAt(1000, 'shared')});

      const cicSource = store.sourceFor('CIC-1');
      const chillSource = store.sourceFor('CIC-1');

      expect(chillSource.getTokens()?.idToken).toBe('shared');

      // A refresh performed by the CiC must be visible to the Chill.
      cicSource.setTokens(tokensAt(2000, 'refreshed'));

      expect(chillSource.getTokens()?.idToken).toBe('refreshed');
    });

    it('serialises concurrent work for the same CiC', async () => {
      const source = store.sourceFor('CIC-1');
      const order: string[] = [];

      const task = (name: string) => source.runExclusive(async () => {
        order.push(`${name}-start`);
        await new Promise((resolve) => setTimeout(resolve, 10));
        order.push(`${name}-end`);
      });

      await Promise.all([task('a'), task('b')]);

      // Never interleaved: the second caller waits for the first to finish.
      expect(order).toEqual(['a-start', 'a-end', 'b-start', 'b-end']);
    });

    it('lets a later caller run after an earlier one fails', async () => {
      const source = store.sourceFor('CIC-1');

      const failing = source.runExclusive(async () => {
        throw new Error('refresh failed');
      });

      await expect(failing).rejects.toThrow('refresh failed');
      await expect(source.runExclusive(async () => 'recovered')).resolves.toBe('recovered');
    });

    it('does not block work for a different CiC', async () => {
      let releaseFirst: () => void = () => undefined;
      const blocked = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });

      const first = store.sourceFor('CIC-1').runExclusive(async () => {
        await blocked;
        return 'first';
      });
      const second = store.sourceFor('CIC-2').runExclusive(async () => 'second');

      // CIC-2 completes while CIC-1 is still held.
      await expect(second).resolves.toBe('second');

      releaseFirst();
      await expect(first).resolves.toBe('first');
    });
  });
});
