export function issueKey(privateJwk: JsonWebKey, orderId: string, issuedAt?: number): Promise<string>;
export function generateKeyPair(): Promise<{ privateJwk: JsonWebKey; publicJwk: JsonWebKey }>;
