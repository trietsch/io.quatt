import { QuattClient } from './index';
import { QuattApiError } from './errors';
import { RestClient } from 'typed-rest-client/RestClient';
import { CicStats, CicHeatpump, CicQualityControl, CicTime, CicBoiler, CicFlowMeter, CicThermostat, CicSystem } from './cic-stats';

// Mock the RestClient
jest.mock('typed-rest-client/RestClient');

const MockedRestClient = RestClient as jest.MockedClass<typeof RestClient>;
const mockGet = jest.fn();

MockedRestClient.mockImplementation(() => {
  return {
    get: mockGet,
  } as unknown as RestClient;
});

// Updated DeepPartial utility type
type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends (infer U)[] // Handle array types
    ? Array<DeepPartial<U>>
    : T[P] extends object | undefined // Handle object types, including those that are optional (e.g., obj?: Type)
    ? DeepPartial<NonNullable<T[P]>> // Apply DeepPartial to the non-nullable base type
    : T[P]; // Primitives and other types remain as is
};


// Helper function to create mock CicStats with deep merge
const createMockCicStats = (overrides?: DeepPartial<CicStats>): CicStats => {
  const defaultTime: CicTime = { ts: BigInt(0), tsHuman: '1970-01-01T00:00:00Z' };
  const defaultQc: CicQualityControl = {
    supervisoryControlMode: '0',
    flowRateFiltered: 0,
    stickyPumpProtectionEnabled: false,
  };
  const defaultHpStructure: CicHeatpump = {
    getMainWorkingMode: '0',
    modbusSlaveId: 1,
    powerInput: 0,
    power: 0,
    limitedByCop: false,
    silentModeStatus: false,
    temperatureWaterIn: 0,
    temperatureWaterOut: 0,
    temperatureOutside: 0,
  };
  const defaultBoiler: CicBoiler = {
    otFbChModeActive: false,
    otFbDhwActive: false,
    otFbFlameOn: false,
    otFbSupplyInletTemperature: 0,
    otFbSupplyOutletTemperature: 0,
    otTbCH: false,
    oTtbTurnOnOffBoilerOn: false,
    otFbWaterPressure: 0,
  };
  const defaultFlowMeter: CicFlowMeter = { waterSupplyTemperature: 0 };
  const defaultThermostat: CicThermostat = {
    otFtChEnabled: false,
    otFtDhwEnabled: false,
    otFtCoolingEnabled: false,
    otFtControlSetpoint: 0,
    otFtRoomSetpoint: 0,
    otFtRoomTemperature: 0,
  };
  const defaultSystem: CicSystem = { hostName: 'testhost' };

  const defaults: CicStats = {
    time: { ...defaultTime },
    qc: { ...defaultQc },
    hp1: { ...defaultHpStructure },
    // hp2 is optional and will be added if present in overrides
    boiler: { ...defaultBoiler },
    flowMeter: { ...defaultFlowMeter },
    thermostat: { ...defaultThermostat },
    system: { ...defaultSystem },
  };

  const deepMergeInner = <T extends object>(target: T, source: DeepPartial<T>): T => {
    const output = { ...target } as T;
    Object.keys(source).forEach((key) => {
      const sourceKey = key as keyof DeepPartial<T>;
      const targetValueAtKey = output[sourceKey]; // Value from defaults or already merged
      const sourceValueAtKey = source[sourceKey];

      if (sourceValueAtKey === undefined) {
        return; // Skip undefined overrides explicitly
      }

      if (typeof sourceValueAtKey === 'object' && sourceValueAtKey !== null && !Array.isArray(sourceValueAtKey)) {
        // If the target for this key is not an object, or if it's hp2 (which needs default structure)
        if (key === 'hp2') {
           // Ensure hp2 always merges with defaultHpStructure if sourceValueAtKey for hp2 is an object
          (output as any)[sourceKey] = deepMergeInner({ ...defaultHpStructure }, sourceValueAtKey as DeepPartial<CicHeatpump>);
        } else if (typeof targetValueAtKey === 'object' && targetValueAtKey !== null) {
          (output as any)[sourceKey] = deepMergeInner(targetValueAtKey as object, sourceValueAtKey as DeepPartial<object>);
        } else {
          // If target is not an object but source is, source replaces target (should be rare with defaults)
          (output as any)[sourceKey] = sourceValueAtKey;
        }
      } else {
        (output as any)[sourceKey] = sourceValueAtKey;
      }
    });
    return output;
  };

  if (overrides) {
    return deepMergeInner(defaults, overrides);
  }
  return defaults;
};


describe('QuattClient', () => {
  let quattClient: QuattClient;
  const deviceAddress = 'http://localhost';
  const appVersion = '1.0.0';

  beforeEach(() => {
    mockGet.mockReset();
    quattClient = new QuattClient(appVersion, deviceAddress);
  });

  describe('getCicStats', () => {
    it('should return transformed CicStats on successful response (200), including hp2 and otFbWaterPressure', async () => {
      const rawStatsInput: DeepPartial<CicStats> = {
        qc: { supervisoryControlMode: 50 as any, flowRateFiltered: 10.5 },
        hp1: { getMainWorkingMode: 1 as any, powerInput: 1000 },
        hp2: { getMainWorkingMode: 2 as any, powerInput: 1500, modbusSlaveId: 2 },
        boiler: { otFbWaterPressure: 1.8 },
      };
      const mockFullStats = createMockCicStats(rawStatsInput);

      const mockResponse = { statusCode: 200, result: mockFullStats };
      mockGet.mockResolvedValue(mockResponse);

      const result = await quattClient.getCicStats();

      expect(mockGet).toHaveBeenCalledWith(`http://${deviceAddress}:8080/beta/feed/data.json`);
      expect(result?.qc?.supervisoryControlMode).toBe('50');
      expect(result?.hp1?.getMainWorkingMode).toBe('1');
      expect(result?.hp2?.getMainWorkingMode).toBe('2'); // Transformed
      expect(result?.qc?.flowRateFiltered).toBe(10.5);
      expect(result?.hp1?.powerInput).toBe(1000);
      expect(result?.hp2?.powerInput).toBe(1500); // From input
      expect(result?.hp2?.modbusSlaveId).toBe(2); // From input
      expect(result?.hp2?.temperatureOutside).toBe(0); // From defaultHpStructure via deepMerge
      expect(result?.boiler?.otFbWaterPressure).toBe(1.8); // Test new field
    });

    it('should handle supervisoryControlMode >= 100 correctly', async () => {
      const mockFullStats = createMockCicStats({ qc: { supervisoryControlMode: 100 as any } });
      const mockResponse = { statusCode: 200, result: mockFullStats };
      mockGet.mockResolvedValue(mockResponse);

      const result = await quattClient.getCicStats();
      expect(result?.qc.supervisoryControlMode).toBe('100');
    });

    it('should handle hp2.getMainWorkingMode being null', async () => {
      const mockFullStats = createMockCicStats({
        hp2: { getMainWorkingMode: null as any, modbusSlaveId: 3 },
      });
      const mockResponse = { statusCode: 200, result: mockFullStats };
      mockGet.mockResolvedValue(mockResponse);

      const result = await quattClient.getCicStats();
      expect(result?.hp2?.getMainWorkingMode).toBeNull();
      expect(result?.hp2?.modbusSlaveId).toBe(3);
    });

    it('should return null when API returns 200 but null result', async () => {
      const mockResponse = { statusCode: 200, result: null };
      mockGet.mockResolvedValue(mockResponse);
      const result = await quattClient.getCicStats();
      expect(result).toBeNull();
    });

    it('should throw QuattApiError on 404 response', async () => {
      const mockResponse = { statusCode: 404, result: null };
      mockGet.mockResolvedValue(mockResponse);
      await expect(quattClient.getCicStats()).rejects.toThrow(QuattApiError);
      try {
        await quattClient.getCicStats();
      } catch (e: any) {
        expect(e.message).toBe(`Failed to fetch data from ${deviceAddress}: Status code 404`);
      }
    });

    it('should throw QuattApiError on 500 response', async () => {
      const mockResponse = { statusCode: 500, result: null };
      mockGet.mockResolvedValue(mockResponse);
      await expect(quattClient.getCicStats()).rejects.toThrow(QuattApiError);
      try {
        await quattClient.getCicStats();
      } catch (e: any) {
        expect(e.message).toBe(`Failed to fetch data from ${deviceAddress}: Status code 500`);
      }
    });

    it('should propagate other errors (e.g., network error)', async () => {
      const errorMessage = 'Network issue';
      mockGet.mockRejectedValue(new Error(errorMessage));
      await expect(quattClient.getCicStats()).rejects.toThrow(Error);
      try {
        await quattClient.getCicStats();
      } catch (e: any) {
        expect(e).toBeInstanceOf(Error);
        expect(e.message).toBe(errorMessage);
        expect(e).not.toBeInstanceOf(QuattApiError);
      }
    });

    describe('Data Transformation', () => {
        it('should transform qc.supervisoryControlMode (number) to string', async () => {
            const mockFullStats = createMockCicStats({ qc: { supervisoryControlMode: 50 as any } });
            mockGet.mockResolvedValue({ statusCode: 200, result: mockFullStats });
            const result = await quattClient.getCicStats();
            expect(result?.qc.supervisoryControlMode).toBe('50');
        });

        it('should transform qc.supervisoryControlMode (>=100 number) to string "100"', async () => {
            const mockFullStats = createMockCicStats({ qc: { supervisoryControlMode: 120 as any } });
            mockGet.mockResolvedValue({ statusCode: 200, result: mockFullStats });
            const result = await quattClient.getCicStats();
            expect(result?.qc.supervisoryControlMode).toBe('100');
        });

        it('should transform qc.supervisoryControlMode (string) to string', async () => {
            const mockFullStats = createMockCicStats({ qc: { supervisoryControlMode: "75" } });
            mockGet.mockResolvedValue({ statusCode: 200, result: mockFullStats });
            const result = await quattClient.getCicStats();
            expect(result?.qc.supervisoryControlMode).toBe('75');
        });

        it('should transform hp1.getMainWorkingMode (number) to string', async () => {
            const mockFullStats = createMockCicStats({ hp1: { getMainWorkingMode: 1 as any } });
            mockGet.mockResolvedValue({ statusCode: 200, result: mockFullStats });
            const result = await quattClient.getCicStats();
            expect(result?.hp1.getMainWorkingMode).toBe('1');
        });

        it('should transform hp1.getMainWorkingMode (string) to string', async () => {
            const mockFullStats = createMockCicStats({ hp1: { getMainWorkingMode: "2" } });
            mockGet.mockResolvedValue({ statusCode: 200, result: mockFullStats });
            const result = await quattClient.getCicStats();
            expect(result?.hp1.getMainWorkingMode).toBe('2');
        });

        it('should transform hp2.getMainWorkingMode (number) to string if hp2 exists', async () => {
            const mockFullStats = createMockCicStats({
                hp2: { getMainWorkingMode: 3 as any, modbusSlaveId: 2 },
            });
            mockGet.mockResolvedValue({ statusCode: 200, result: mockFullStats });
            const result = await quattClient.getCicStats();
            expect(result?.hp2?.getMainWorkingMode).toBe('3');
        });

        it('should not transform hp2.getMainWorkingMode if it is null and hp2 exists', async () => {
            const mockFullStats = createMockCicStats({
                hp2: { getMainWorkingMode: null as any, modbusSlaveId: 2 },
            });
            mockGet.mockResolvedValue({ statusCode: 200, result: mockFullStats });
            const result = await quattClient.getCicStats();
            expect(result?.hp2?.getMainWorkingMode).toBeNull();
        });

        it('should not attempt to transform hp2.getMainWorkingMode if hp2 does not exist', async () => {
            const mockFullStats = createMockCicStats();
            delete mockFullStats.hp2;
            mockGet.mockResolvedValue({ statusCode: 200, result: mockFullStats });
            const result = await quattClient.getCicStats();
            expect(result?.hp2).toBeUndefined();
        });
    });
  });
});
