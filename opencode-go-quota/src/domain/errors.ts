export class CredentialsError extends Error {
  constructor(message = 'Credentials not found') {
    super(message);
    this.name = 'CredentialsError';
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
  ) {
    super(message);
    this.name = 'NetworkError';
  }
}
