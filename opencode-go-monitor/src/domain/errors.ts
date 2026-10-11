export class CredentialsError extends Error {
  constructor(message = 'Credentials not found') {
    super(message);
    this.name = 'CredentialsError';
  }
}

export class AuthError extends Error {
  constructor(
    public readonly profileId: string,
    public readonly profileName: string,
    public readonly httpStatus: number,
  ) {
    super(`API key rejected (HTTP ${httpStatus})`);
    this.name = 'AuthError';
  }
}

export class ParseError extends Error {
  constructor(message = 'Failed to parse response') {
    super(message);
    this.name = 'ParseError';
  }
}

export class NetworkError extends Error {
  constructor(
    message = 'Network request failed',
    public readonly status?: number,
    /** Seconds requested by a `Retry-After` header (429/503), when present and valid. */
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'NetworkError';
  }
}
