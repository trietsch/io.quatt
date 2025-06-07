export class QuattApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QuattApiError';
  }
}

export class DeviceUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeviceUnavailableError';
  }
}
