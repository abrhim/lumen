export class Neo4jQueryError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'Neo4jQueryError';
  }
}

export class Neo4jAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Neo4jAuthError';
  }
}
